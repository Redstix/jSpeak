import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { root, referenceBuild, config, fileHash, sha256, validateReference } from '../oracle/trace-build-info.mjs';
const exporter = fileURLToPath(new URL('export-tables.c', import.meta.url));
export function buildAccentData({ output = path.join(root, 'data/accent') } = {}) {
  const snapshot = () => ({ reference: validateReference(),
    sources: ['numbers.c', 'numbers.h', 'dictionary.c', 'translate.h', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    exporterSha256: fileHash(exporter), generatorSha256: fileHash(fileURLToPath(import.meta.url)) });
  const inputs = snapshot();
  mkdirSync(path.join(root, 'build'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'build/accent-data-'));
  const compiler = readFileSync(path.join(referenceBuild, 'CMakeCache.txt'), 'utf8').match(/^CMAKE_C_COMPILER:FILEPATH=(.+)$/m)?.[1];
  assert(compiler);
  const binary = path.join(directory, 'export-tables');
  execFileSync(compiler, ['-std=c11', '-O2', '-fwrapv', '-DLIBESPEAK_NG_EXPORT=1',
    ...['src/include', 'src/include/compat', 'src/ucd-tools/src/include', 'src/libespeak-ng'].map(p => '-I' + path.join(root, 'upstream/espeak-ng', p)),
    '-I' + path.join(referenceBuild, 'src/libespeak-ng/include'), exporter,
    ...inputs.libraries.map(entry => path.join(referenceBuild, entry.path)), '-lm', '-o', binary], { timeout: 60000, stdio: 'pipe' });
  const bytes = execFileSync(binary, [referenceBuild], { timeout: 30000 });
  const data = JSON.parse(bytes);
  assert.equal(data.schemaVersion, 1); assert.equal(data.profile.voice, 'en-us');
  assert.equal(data.latin.length, 160); assert.equal(data.ipa.length, 89); assert.equal(data.accents.length, 22); assert.equal(data.nonAscii.length, 15);
  const module = '// Generated original numbers.c static accent tables and phoneme.h constants. GPL-3.0-or-later.\n' +
    '// Copyright (C) 2005-2015 Jonathan Duddington; 2015-2016, 2020 Reece H. Dunn.\n// See licenses/espeak-ng/COPYING.txt.\n' +
    'export var ACCENT_PROFILE = Object.freeze(' + JSON.stringify(data.profile) + ');\n' +
    'export var ACCENT_CONSTANTS = Object.freeze(' + JSON.stringify(data.constants) + ');\n' +
    'export var ACCENT_NAMES = Object.freeze(' + JSON.stringify(data.accents) + '.map(function (row) { return Object.freeze(row); }));\n' +
    'export var ACCENT_NON_ASCII = new Uint16Array(' + JSON.stringify(data.nonAscii) + ');\n' +
    'export var ACCENT_LATIN = new Uint16Array(' + JSON.stringify(data.latin) + ');\n' +
    'export var ACCENT_IPA = new Uint16Array(' + JSON.stringify(data.ipa) + ');\n';
  assert.deepEqual(snapshot(), inputs);
  const manifest = { schemaVersion: 1, kind: 'original-static-letter-accent-data', upstreamCommit: config.commit, ...inputs,
    profile: data.profile, latinEntries: data.latin.length, ipaEntries: data.ipa.length, accentEntries: data.accents.length, nonAsciiEntries: data.nonAscii.length,
    exportSha256: sha256(bytes), moduleSha256: sha256(module), license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt' };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'tables.js'), module);
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(path.join(output, 'export.json'), JSON.stringify(data, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildAccentData(), null, 2));
