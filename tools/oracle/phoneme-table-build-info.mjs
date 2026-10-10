import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';

export const phonemeTableRoot = path.join(root, 'build/oracle-phoneme-table');
export const phonemeTableSource = path.join(root, 'tools/oracle/phoneme-table-oracle.c');
export const phonemeTableBinary = path.join(phonemeTableRoot, 'phoneme-table-oracle');
export function phonemeTableInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(phonemeTableSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['src/libespeak-ng/synthdata.c', 'src/libespeak-ng/dictionary.c', 'src/libespeak-ng/phoneme.h', 'src/libespeak-ng/synthdata.h', 'src/libespeak-ng/dictionary.h'].map(name => ({ path: name, sha256: fileHash(path.join(root, 'upstream/espeak-ng', name)) })),
    phontabSha256: fileHash(path.join(referenceBuild, 'espeak-ng-data/phontab')) };
}
export function validatePhonemeTableBuild() {
  const stamp = JSON.parse(readFileSync(path.join(phonemeTableRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1);
  assert.deepEqual(stamp.inputs, phonemeTableInputs(), 'Phoneme-table oracle inputs changed: rebuild');
  assert.equal(stamp.binarySha256, fileHash(phonemeTableBinary), 'Phoneme-table helper binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
