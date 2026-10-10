import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const derivedRoot = path.join(root, 'build/oracle-derived');
export const derivedSource = path.join(root, 'tools/oracle/derived-oracle.c');
export const derivedBinary = path.join(derivedRoot, 'derived-oracle');
export function derivedInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(derivedSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['numbers.c', 'numbers.h', 'translateword.c', 'translateword.h', 'dictionary.c', 'translate.h', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })) };
}
export function validateDerivedBuild() {
  const stamp = JSON.parse(readFileSync(path.join(derivedRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, derivedInputs(), 'Derived oracle inputs changed');
  assert.equal(stamp.binarySha256, fileHash(derivedBinary), 'Derived binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
