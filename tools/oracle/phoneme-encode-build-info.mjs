import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const encodeRoot = path.join(root, 'build/oracle-phoneme-encode');
export const encodeSource = path.join(root, 'tools/oracle/phoneme-encode-oracle.c');
export const encodeBinary = path.join(encodeRoot, 'phoneme-encode-oracle');
export function encodeInputs() {
  return { reference: validateReference(), phontabSha256: fileHash(path.join(referenceBuild, 'espeak-ng-data/phontab')), helperSourceSha256: fileHash(encodeSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['common.c', 'common.h', 'synthdata.c', 'dictionary.c', 'translate.h', 'phoneme.h'].map(name => ({ path: 'src/libespeak-ng/' + name, sha256: fileHash(path.join(root, 'upstream/espeak-ng/src/libespeak-ng', name)) })) };
}
export function validateEncodeBuild() {
  const stamp = JSON.parse(readFileSync(path.join(encodeRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, encodeInputs(), 'Encode oracle inputs changed');
  assert.equal(stamp.binarySha256, fileHash(encodeBinary), 'Encode binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
