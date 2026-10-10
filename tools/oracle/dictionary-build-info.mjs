import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, traceSource, traceBuild, referenceBuild, fileHash, sha256, validateTraceBuild } from './trace-build-info.mjs';
export const dictionarySource = path.join(root, 'tools/oracle/dictionary-oracle.c');
export const dictionaryRoot = path.join(root, 'build/oracle-dictionary');
export const dictionaryBinary = path.join(dictionaryRoot, 'dictionary-oracle');
export const dictionaryReferenceBinary = path.join(dictionaryRoot, 'dictionary-oracle-reference');
export function dictionaryInputs() {
  return { helperSourceSha256: fileHash(dictionarySource),
    libraries: [referenceBuild, traceBuild].map(build => ({ espeak: fileHash(path.join(build, 'src/libespeak-ng/libespeak-ng.a')), ucd: fileHash(path.join(build, 'src/ucd-tools/libucd.a')) })),
    headers: ['src/include/espeak-ng/espeak_ng.h', 'src/include/espeak-ng/speak_lib.h', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/dictionary.h', 'src/libespeak-ng/readclause.h', 'src/libespeak-ng/phoneme.h'].map(name => ({ path: name, sha256: fileHash(path.join(traceSource, name)) })) };
}
export function validateDictionaryBuild() {
  const trace = validateTraceBuild();
  const stamp = JSON.parse(readFileSync(path.join(dictionaryRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1);
  assert.equal(stamp.traceFingerprint, trace.fingerprint, 'Reference changed; rebuild dictionary helper');
  assert.deepEqual(stamp.inputs, dictionaryInputs(), 'Dictionary helper inputs changed; rebuild');
  assert.equal(stamp.binarySha256, fileHash(dictionaryBinary)); assert.equal(stamp.referenceBinarySha256, fileHash(dictionaryReferenceBinary));
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)), trace };
}
