import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild, config, fileHash, sha256, validateReference } from '../oracle/trace-build-info.mjs';

const source = path.join(root, 'upstream/espeak-ng');
const exporter = fileURLToPath(new URL('export-profile.c', import.meta.url));
const sourceNames = ['src/libespeak-ng/common.c', 'src/libespeak-ng/translate.c', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/tr_languages.c', 'src/libespeak-ng/dictionary.c', 'dictsource/en_rules'];
const libraryNames = ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'];

export function decodeReplacementStream(bytes) {
  assert(bytes instanceof Uint8Array, 'Expected replacement byte stream');
  const rows = [];
  let cursor = 0;
  const terminated = () => {
    const start = cursor;
    while (cursor < bytes.length && bytes[cursor] !== 0) cursor++;
    assert(cursor < bytes.length, 'Unterminated replacement entry');
    return Array.from(bytes.slice(start, cursor++));
  };
  while (cursor < bytes.length && bytes[cursor] !== 0) {
    const from = terminated(), to = terminated();
    rows.push({ from, to });
  }
  // Four-NUL sentinel starts at the next from-entry, after the final to NUL.
  assert(bytes.length - cursor === 4 && bytes.slice(-4).every(byte => byte === 0), 'Missing four-NUL sentinel');
  assert(bytes.slice(cursor).every(byte => byte === 0), 'Unexpected trailing replacement data');
  return rows;
}

export function buildTextData({ output = path.join(root, 'data/text') } = {}) {
  const snapshot = () => ({ reference: validateReference(),
    sources: sourceNames.map(name => ({ path: name, sha256: fileHash(path.join(source, name)) })),
    libraries: libraryNames.map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    exporterSha256: fileHash(exporter), generatorSha256: fileHash(fileURLToPath(import.meta.url)) });
  const provenance = snapshot();
  const temporary = mkdtempSync(path.join(tmpdir(), 'jspeak-text-data-'));
  try {
    const binary = path.join(temporary, 'export-profile');
    const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
    assert(compiler, 'Missing C compiler');
    execFileSync(compiler, ['-std=c11', '-O2', '-Wall', '-Wextra', '-DLIBESPEAK_NG_EXPORT=1',
      ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(name => '-I' + path.join(source, name)),
      '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), exporter,
      ...libraryNames.map(name => path.join(referenceBuild, name)), '-lm', '-o', binary], { timeout: 60000, stdio: 'pipe' });
    const exportedBytes = execFileSync(binary, [path.join(referenceBuild, 'espeak-ng-data')], { timeout: 30000 });
    const data = JSON.parse(exportedBytes);
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.profile.voice, 'en-us');
    assert.equal(data.profile.translatorName, 25966);
    assert.notEqual(data.replaceCharsHex, null, 'Fixed en-us replacement stream unexpectedly absent');
    assert(/^(?:[0-9a-f]{2})+$/.test(data.replaceCharsHex), 'Invalid replacement export');
    const replacementBytes = Buffer.from(data.replaceCharsHex, 'hex');
    const replacements = decodeReplacementStream(replacementBytes);
    const module = '// Generated from initialized pinned en-us translator and AlphabetFromChar. GPL-3.0-or-later.\n' +
      '// Copyright (C) 2005-2015 Jonathan Duddington; see licenses/espeak-ng/COPYING.txt.\n' +
      'export var TEXT_CHARACTER_PROFILE = Object.freeze(' + JSON.stringify(data.profile) + ');\n' +
      'Object.freeze(TEXT_CHARACTER_PROFILE.punctWithinWord); Object.freeze(TEXT_CHARACTER_PROFILE.charPlusApostrophe);\n' +
      'export var TEXT_CHARACTER_CONSTANTS = Object.freeze(' + JSON.stringify(data.constants) + ');\n' +
      'export var REPLACEMENT_BYTES = new Uint8Array(' + JSON.stringify(Array.from(replacementBytes)) + ');\n' +
      'export var ALPHABETS = Object.freeze(' + JSON.stringify(data.alphabets) + '.map(function (row) { return Object.freeze(row); }));\n';
    const manifest = { schemaVersion: 1, kind: 'en-us-text-character-data', upstreamCommit: config.commit, ...provenance,
      profile: data.profile, replacementBytes: replacementBytes.length, replacementEntries: replacements.length,
      replacementStreamSha256: sha256(replacementBytes), alphabetEntries: data.alphabets.length,
      exportSha256: sha256(exportedBytes), moduleSha256: sha256(module),
      license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt' };
    assert.deepEqual(snapshot(), provenance, 'Reference changed during text data export');
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, 'tables.js'), module);
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(path.join(output, 'profile-export.json'), JSON.stringify(data, null, 2) + '\n');
    return manifest;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-text/build.mjs');
  console.log(JSON.stringify(buildTextData(), null, 2));
}
