import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, root, referenceBuild, fileHash, sha256, validateReference } from '../oracle/trace-build-info.mjs';
import { hash32 } from '../build-data/pack.mjs';

export function buildDictionary({ output = path.join(root, 'data/dictionary') } = {}) {
  const reference = validateReference();
  const languagePath = path.join(root, 'upstream/espeak-ng/src/libespeak-ng/tr_languages.c');
  const headerPath = path.join(root, 'upstream/espeak-ng/src/libespeak-ng/translate.h');
  const language = readFileSync(languagePath, 'utf8');
  const definition = language.match(/static const char transpose_map_latin\[\] = \{([\s\S]*?)\};/);
  if (!definition) throw new Error('Missing original Latin transpose data');
  const text = definition[1].replace(/\/\/[^\n]*/g, '').replace(/\s/g, '');
  if (!/^(?:\d+,)*\d+,?$/.test(text)) throw new Error('Unsupported transpose data syntax');
  const transposeMap = text.replace(/,$/, '').split(',').map(Number);
  if (transposeMap.length !== 288 || transposeMap.some(value => value > 63)) throw new Error('Changed Latin transpose table');
  const constants = {};
  for (const match of readFileSync(headerPath, 'utf8').matchAll(/^#define\s+((?:FLAG_|SUFX_|RULE_|N_WORD_|N_PHONEME_|N_HASH_|N_RULE_GROUP|N_LETTER_GROUPS)\w*)\s+(0x[\da-fA-F]+|\d+)(?=\s|$)/gm)) constants[match[1]] = Number(match[2]);
  const bytes = readFileSync(path.join(referenceBuild, 'espeak-ng-data/en_dict'));
  const module = '// Generated original Latin dictionary transpose data and numeric constants. GPL-3.0-or-later.\n' +
    '// Copyright (C) 2005-2014 Jonathan Duddington; 2013-2017 Reece H. Dunn.\n' +
    '// See licenses/espeak-ng/COPYING.txt.\n' +
    `export var TRANSPOSE_MAP = new Uint8Array(${JSON.stringify(transposeMap)});\n` +
    `export var DICTIONARY_CONSTANTS = Object.freeze(${JSON.stringify(constants)});\n`;
  const manifest = { schemaVersion: 1, magic: 'JSPEAK_RAW_DICTIONARY', format: 'espeak-ng-dict-v1', upstreamCommit: config.commit, language: 'en', voice: 'en-us',
    sourcePath: 'en_dict', byteLength: bytes.length, sha256: sha256(bytes), hash32: hash32(bytes), hashSpec: 'xorshift32-byte-mix-seed0',
    hashBuckets: bytes.readUInt32LE(0), rulesOffset: bytes.readUInt32LE(4), dataFingerprint: reference.dataFingerprint,
    sourceFiles: [{ path: 'src/libespeak-ng/tr_languages.c', sha256: fileHash(languagePath) }, { path: 'src/libespeak-ng/translate.h', sha256: fileHash(headerPath) }, { path: 'src/libespeak-ng/dictionary.c', sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng/dictionary.c')) }],
    profileModuleSha256: sha256(module), license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt' };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'en_dict.bin'), bytes); writeFileSync(path.join(output, 'profile.js'), module);
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-dictionary/build.mjs');
  console.log(JSON.stringify(buildDictionary(), null, 2));
}
