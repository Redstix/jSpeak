import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const wordRoot = path.join(root, 'build/oracle-word');
export const wordSource = path.join(root, 'tools/oracle/word-oracle.c');
export const wordBinary = path.join(wordRoot, 'word-oracle');
export const wordSafetyBinary = path.join(wordRoot, 'word-oracle-asan');
export function wordInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(wordSource), sharedHeaderSha256: fileHash(path.join(root, 'tools/oracle/word-shared.h')),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['translate.c', 'translateword.c', 'translateword.h', 'translate.h', 'dictionary.c', 'common.c', 'common.h', 'numbers.c', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })) };
}
export function validateWordBuild() {
  const stamp = JSON.parse(readFileSync(path.join(wordRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, wordInputs(), 'Word oracle inputs changed'); assert.equal(stamp.binarySha256, fileHash(wordBinary), 'Word helper changed');
  assert.equal(stamp.safetyBinarySha256, fileHash(wordSafetyBinary), 'Word safety helper changed');
  for (const object of stamp.safetyObjects) assert.equal(fileHash(path.join(wordRoot, object.path)), object.sha256);
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
