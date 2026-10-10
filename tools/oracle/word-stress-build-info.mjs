import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const wordStressRoot = path.join(root, 'build/oracle-word-stress');
export const wordStressSource = path.join(root, 'tools/oracle/word-stress-oracle.c');
export const wordStressBinary = path.join(wordStressRoot, 'word-stress-oracle');
export function wordStressInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(wordStressSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['src/libespeak-ng/dictionary.c', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/phoneme.h', 'src/libespeak-ng/synthesize.h', 'src/libespeak-ng/tr_languages.c'].map(name => ({ path: name, sha256: fileHash(path.join(root, 'upstream/espeak-ng', name)) })),
    phontabSha256: fileHash(path.join(referenceBuild, 'espeak-ng-data/phontab')) };
}
export function validateWordStressBuild() {
  const stamp = JSON.parse(readFileSync(path.join(wordStressRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1);
  assert.deepEqual(stamp.inputs, wordStressInputs(), 'Word-stress reference changed: rebuild');
  assert.equal(stamp.binarySha256, fileHash(wordStressBinary), 'Word-stress helper binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
