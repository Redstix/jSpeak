import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, traceSource, traceBuild, referenceBuild, fileHash, sha256, validateTraceBuild } from './trace-build-info.mjs';
export const clauseSource = path.join(root, 'tools/oracle/clause-oracle.c');
export const clauseRoot = path.join(root, 'build/oracle-clause');
export const clauseBinary = path.join(clauseRoot, 'clause-oracle');
export const clauseReferenceBinary = path.join(clauseRoot, 'clause-oracle-reference');
export function clauseInputs() {
  return {
    helperSourceSha256: fileHash(clauseSource),
    libraries: [referenceBuild, traceBuild].map(build => ({ espeak: fileHash(path.join(build, 'src/libespeak-ng/libespeak-ng.a')), ucd: fileHash(path.join(build, 'src/ucd-tools/libucd.a')) })),
    headers: ['src/include/espeak-ng/encoding.h', 'src/include/espeak-ng/espeak_ng.h', 'src/include/espeak-ng/speak_lib.h', 'src/ucd-tools/src/include/ucd/ucd.h', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/readclause.h', 'src/libespeak-ng/speech.h'].map(name => ({ path: name, sha256: fileHash(path.join(traceSource, name)) }))
  };
}
export function validateClauseBuild() {
  const trace = validateTraceBuild();
  const stamp = JSON.parse(readFileSync(path.join(clauseRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1, 'Unknown clause helper stamp');
  assert.equal(stamp.traceFingerprint, trace.fingerprint, 'Trace reference changed: rebuild clause helper');
  assert.deepEqual(stamp.inputs, clauseInputs(), 'Clause C source/library/headers changed: rebuild');
  assert.equal(stamp.binarySha256, fileHash(clauseBinary), 'Clause helper binary changed');
  assert.equal(stamp.referenceBinarySha256, fileHash(clauseReferenceBinary), 'Clean clause helper binary changed');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)), trace };
}
