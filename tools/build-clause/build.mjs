import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = ['src/ucd-tools/src/include/ucd/ucd.h', 'src/ucd-tools/src/categories.c', 'src/ucd-tools/src/proplist.c',
  'src/libespeak-ng/readclause.c', 'src/libespeak-ng/translate.h'];

export function compressPropertyExport(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 12 + 0x110000 * 4 ||
      bytes.toString('ascii', 0, 8) !== 'JSCLPR01' || bytes.readUInt32LE(8) !== 0x110000) throw new Error('Invalid clause property export');
  const ranges = [];
  let start = 0, previous = 0;
  for (let cp = 0; cp <= 0x110000; cp++) {
    const value = cp === 0x110000 ? 0 : bytes.readUInt32LE(12 + cp * 4);
    if (value > 0xfff) throw new Error('Clause property exceeds 12-bit mask');
    if (value !== previous) {
      if (previous) ranges.push(start, cp - 1, previous);
      start = cp; previous = value;
    }
  }
  return ranges;
}

// Current CLAUSE macros contain only integer constants and OR of prior macros.
// Unknown future syntax is rejected, never executed as JavaScript.
export function extractClauseConstants(header) {
  const definitions = {};
  for (const match of header.matchAll(/^#define\s+(CLAUSE_\w+)\s+([^\r\n]+)/gm)) {
    const expression = match[2].split('//')[0].replace(/[()\s]/g, '');
    let value = 0;
    for (const token of expression.split('|')) {
      if (/^(?:0x[0-9a-fA-F]+|\d+)$/.test(token)) value |= Number(token);
      else if (Object.hasOwn(definitions, token)) value |= definitions[token];
      else throw new Error('Unsupported CLAUSE constant expression: ' + match[1]);
    }
    definitions[match[1]] = value >>> 0;
  }
  if (!Object.keys(definitions).length) throw new Error('Missing CLAUSE constants');
  return Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key.slice(7), value]));
}

export function buildClauseProperties({ output = path.join(root, 'data/clause') } = {}) {
  const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  const source = path.join(root, 'upstream/espeak-ng');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', timeout: 30000 }).trim();
  if (git(['rev-parse', 'HEAD']) !== config.commit || git(['status', '--porcelain'])) throw new Error('Expected clean pinned upstream');
  const sources = sourceNames.map(name => ({ path: name, sha256: hash(readFileSync(path.join(source, name))) }));
  const readclause = readFileSync(path.join(source, sourceNames[3]), 'utf8');
  if (!/^#define ESPEAKNG_CLAUSE_TYPE_PROPERTY_MASK 0xFFF0000000000000ull$/m.test(readclause)) throw new Error('Clause property mask changed');
  const constants = extractClauseConstants(readFileSync(path.join(source, sourceNames[4]), 'utf8'));
  const properties = {};
  const header = readFileSync(path.join(source, sourceNames[0]), 'utf8');
  for (const match of header.matchAll(/^#define ESPEAKNG_PROPERTY_(\w+)\s+(0x[0-9a-fA-F]+)ull/gm)) {
    const value = BigInt(match[2]);
    if ((value & 0x000fffffffffffffn) !== 0n || value > 0xfff0000000000000n) throw new Error('Unexpected extended property width');
    properties[match[1]] = Number(value >> 52n);
  }
  const exporter = fileURLToPath(new URL('export-properties.c', import.meta.url));
  const temporary = mkdtempSync(path.join(tmpdir(), 'jspeak-clause-properties-'));
  try {
    const binary = path.join(temporary, 'export-properties');
    execFileSync('cc', ['-std=c99', '-O2', '-I', path.join(source, 'src/ucd-tools/src/include'), exporter,
      path.join(source, sourceNames[1]), path.join(source, sourceNames[2]), '-o', binary], { timeout: 60000 });
    const bytes = execFileSync(binary, [], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    const ranges = compressPropertyExport(bytes);
    const manifest = { schemaVersion: 1, kind: 'espeak-clause-property-top12', upstreamCommit: config.commit,
      unicodeVersion: '11.0.0', codePointCount: 0x110000, mask64Hex: 'fff0000000000000', sourceShift: 52,
      layout: 'sparse triples inclusive start/end/raw property top12; absent codepoints have zero properties',
      sourceFiles: sources, sourceFingerprint: hash(JSON.stringify(sources)), exporterSha256: hash(readFileSync(exporter)),
      tableExportSha256: hash(bytes), properties, constants, rangeCount: ranges.length / 3, typedArrayBytes: ranges.length * 4,
      license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt and licenses/espeak-ng/COPYING.UCD.txt' };
    const lines = [];
    for (let i = 0; i < ranges.length; i += 18) lines.push('  ' + ranges.slice(i, i + 18).join(','));
    const module = '// Generated from pinned ucd-tools raw properties; no C clause answers. GPL-3.0-or-later.\n' +
      '// Copyright (C) 2017-2018 Reece H. Dunn.\n' +
      '// See licenses/espeak-ng/COPYING.txt and licenses/espeak-ng/COPYING.UCD.txt.\n' +
      'export var CLAUSE_PROPERTY_METADATA = ' + JSON.stringify({ schemaVersion: 1, upstreamCommit: config.commit,
        sourceFingerprint: manifest.sourceFingerprint, sourceShift: 52 }) + ';\n' +
      'export var CLAUSE_PROPERTY_RANGES = new Uint32Array([\n' + lines.join(',\n') + '\n]);\n';
    manifest.moduleSha256 = hash(module);
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, 'properties.js'), module);
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-clause/build.mjs');
  console.log(JSON.stringify(buildClauseProperties(), null, 2));
}
