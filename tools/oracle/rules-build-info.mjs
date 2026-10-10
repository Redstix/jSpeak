import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, referenceBuild, validateReference, fileHash, sha256 } from './trace-build-info.mjs';
export const rulesRoot = path.join(root, 'build/oracle-rules');
export const rulesSource = path.join(root, 'tools/oracle/rules-oracle.c');
export const rulesBinary = path.join(rulesRoot, 'rules-oracle');
export function rulesInputs() {
  return { reference: validateReference(), helperSourceSha256: fileHash(rulesSource),
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({ path: name, sha256: fileHash(path.join(referenceBuild, name)) })),
    sources: ['src/libespeak-ng/dictionary.c', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/phoneme.h', 'src/libespeak-ng/tr_languages.c'].map(name => ({ path: name, sha256: fileHash(path.join(root, 'upstream/espeak-ng', name)) })),
    dictionarySha256: fileHash(path.join(referenceBuild, 'espeak-ng-data/en_dict')), phontabSha256: fileHash(path.join(referenceBuild, 'espeak-ng-data/phontab')) };
}
export function validateRulesBuild() {
  const stamp = JSON.parse(readFileSync(path.join(rulesRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1); assert.deepEqual(stamp.inputs, rulesInputs(), 'Rules reference changed: rebuild');
  assert.equal(stamp.binarySha256, fileHash(rulesBinary), 'Rules helper binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
