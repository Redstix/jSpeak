import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const accentRoot = path.join(root, 'build/oracle-accent');
export const accentSource = path.join(root, 'tools/oracle/accent-oracle.c');
export const accentBinary = path.join(accentRoot, 'accent-oracle');
export function accentInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(accentSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['numbers.c', 'numbers.h', 'dictionary.c', 'translate.h', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })) };
}
export function validateAccentBuild() {
  const stamp = JSON.parse(readFileSync(path.join(accentRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, accentInputs(), 'Accent oracle inputs changed');
  assert.equal(stamp.binarySha256, fileHash(accentBinary), 'Accent binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
