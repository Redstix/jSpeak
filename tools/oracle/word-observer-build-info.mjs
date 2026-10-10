import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const wordObserverRoot = path.join(root, 'build/oracle-word-observer');
export const wordObserverBinary = path.join(wordObserverRoot, 'espeak-ng');
export function validateWordObserverBuild() {
  const stamp = JSON.parse(readFileSync(path.join(wordObserverRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1);
  assert.equal(stamp.kind, 'readonly-original-TranslateWord3-link-wrapper');
  assert.deepEqual(stamp.reference, validateReference(), 'Word observer reference changed');
  for (const input of stamp.inputs) assert.equal(fileHash(path.join(root, input.path)), input.sha256, 'Word observer input changed: ' + input.path);
  assert.equal(fileHash(path.join(wordObserverRoot, 'word-observer.o')), stamp.objectSha256);
  assert.equal(fileHash(wordObserverBinary), stamp.binarySha256);
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
