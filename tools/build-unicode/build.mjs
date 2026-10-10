import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
export const FLAG_NAMES = ['iswAlnum', 'iswAlpha', 'iswBlank', 'iswCntrl', 'iswDigit', 'iswGraph', 'iswLower', 'iswPrint', 'iswPunct', 'iswSpace', 'iswUpper', 'iswXdigit'];
const sourceNames = ['src/ucd-tools/src/include/ucd/ucd.h', 'src/ucd-tools/src/categories.c', 'src/ucd-tools/src/proplist.c', 'src/ucd-tools/src/ctype.c', 'src/ucd-tools/src/case.c'];

export function compressTable(bytes) {
  if (bytes.toString('ascii', 0, 8) !== 'JSCUCD01' || bytes.readUInt32LE(8) !== 0x110000 || bytes.length !== 12 + 0x110000 * 12) throw new Error('Invalid UCD export');
  const ranges = []; const lower = []; const upper = [];
  let start = 0; let prior = bytes.readUInt32LE(12);
  for (let cp = 0; cp < 0x110000; cp++) {
    const offset = 12 + cp * 12;
    const combined = bytes.readUInt32LE(offset);
    const lo = bytes.readUInt32LE(offset + 4); const up = bytes.readUInt32LE(offset + 8);
    if (combined !== prior) { ranges.push(start, cp - 1, prior); start = cp; prior = combined; }
    if (lo !== cp) lower.push(cp, lo);
    if (up !== cp) upper.push(cp, up);
  }
  ranges.push(start, 0x10ffff, prior);
  return { ranges, lower, upper };
}

function typed(name, values) {
  const lines = [];
  for (let i = 0; i < values.length; i += 18) lines.push('  ' + values.slice(i, i + 18).join(','));
  return 'export var ' + name + ' = new Uint32Array([\n' + lines.join(',\n') + '\n]);\n';
}

export function buildUnicode({ output = path.join(root, 'data/unicode') } = {}) {
  const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  const source = path.join(root, 'upstream/espeak-ng');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== config.commit || git(['status', '--porcelain'])) throw new Error('Expected clean pinned upstream');
  const sources = sourceNames.map(name => ({ path: name, sha256: hash(readFileSync(path.join(source, name))) }));
  const exportPath = fileURLToPath(new URL('export-ucd.c', import.meta.url));
  const temporary = mkdtempSync(path.join(tmpdir(), 'jspeak-ucd-'));
  try {
    const binary = path.join(temporary, 'export-ucd');
    const args = ['-std=c99', '-O2', '-I', path.join(source, 'src/ucd-tools/src/include'), exportPath,
      ...sourceNames.filter(name => name.endsWith('.c')).map(name => path.join(source, name)), '-o', binary];
    execFileSync('cc', args, { stdio: 'pipe', timeout: 60000 });
    const bytes = execFileSync(binary, [], { maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
    const { ranges, lower, upper } = compressTable(bytes);
    const metadata = { schemaVersion: 1, upstreamCommit: config.commit, unicodeVersion: '11.0.0',
      codePointCount: 0x110000, layout: 'range triples inclusive start/end/(category<<12|flags); sorted codepoint/mapping pairs',
      flags: FLAG_NAMES, invalidCategory: 5, sourceFiles: sources,
      sourceFingerprint: hash(JSON.stringify(sources)), exporterSha256: hash(readFileSync(exportPath)),
      tableExportSha256: hash(bytes), rangeCount: ranges.length / 3, lowerCount: lower.length / 2, upperCount: upper.length / 2,
      typedArrayBytes: (ranges.length + lower.length + upper.length) * 4,
      license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt and licenses/espeak-ng/COPYING.UCD.txt' };
    const module = '// Generated from pinned eSpeak NG ucd-tools; do not edit. GPL-3.0-or-later.\n' +
      '// Copyright (C) 2012-2018, 2021 Reece H. Dunn.\n' +
      '// See licenses/espeak-ng/COPYING.txt and licenses/espeak-ng/COPYING.UCD.txt.\n' +
      'export var UNICODE_METADATA = ' + JSON.stringify({ schemaVersion: 1, upstreamCommit: config.commit, unicodeVersion: '11.0.0', sourceFingerprint: metadata.sourceFingerprint }) + ';\n' +
      typed('UCD_RANGES', ranges) + typed('LOWER_CASE', lower) + typed('UPPER_CASE', upper);
    metadata.moduleSha256 = hash(module);
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, 'tables.js'), module);
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
    return metadata;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-unicode/build.mjs');
  console.log(JSON.stringify(buildUnicode(), null, 2));
}
