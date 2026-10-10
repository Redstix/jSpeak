import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const numberRoot = path.join(root, 'build/oracle-number');
export const numberSource = path.join(root, 'tools/oracle/number-oracle.c');
export const numberBinary = path.join(numberRoot, 'number-oracle');
export const numberCleanBinary = path.join(numberRoot, 'number-oracle-clean');
export function numberInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(numberSource), sharedHeaderSha256: fileHash(path.join(root, 'tools/oracle/word-shared.h')),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['translate.c', 'numbers.h', 'translateword.h', 'translate.h', 'dictionary.c', 'numbers.c', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })) };
}
export function validateNumberBuild() {
  const stamp = JSON.parse(readFileSync(path.join(numberRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, numberInputs(), 'Number oracle inputs changed'); assert.equal(stamp.binarySha256, fileHash(numberBinary), 'Number helper changed');
  assert.equal(stamp.cleanBinarySha256, fileHash(numberCleanBinary), 'Clean number helper changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
