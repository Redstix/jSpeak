import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, traceSource, traceBuild, referenceBuild, traceRoot, fileHash, sha256, validateTraceBuild } from './trace-build-info.mjs';
export const unicodeSource = path.join(root, 'tools/oracle/unicode-oracle.c');
export const unicodeRoot = path.join(traceRoot, 'unicode');
export const unicodeBinary = path.join(unicodeRoot, 'unicode-oracle');
export const unicodeReferenceBinary = path.join(unicodeRoot, 'unicode-oracle-reference');
export function unicodeInputs() {
  return {
    helperSourceSha256: fileHash(unicodeSource),
    libraries: [referenceBuild, traceBuild].map(build => ({ espeak: fileHash(path.join(build, 'src/libespeak-ng/libespeak-ng.a')), ucd: fileHash(path.join(build, 'src/ucd-tools/libucd.a')) })),
    headers: ['src/include/espeak-ng/encoding.h', 'src/include/espeak-ng/espeak_ng.h', 'src/include/compat/wctype.h', 'src/ucd-tools/src/include/ucd/ucd.h', 'src/libespeak-ng/common.h', 'src/libespeak-ng/translate.h', 'src/libespeak-ng/readclause.h'].map(name => ({ path: name, sha256: fileHash(path.join(traceSource, name)) }))
  };
}
export function validateUnicodeBuild() {
  const trace = validateTraceBuild();
  const stamp = JSON.parse(readFileSync(path.join(unicodeRoot, 'build-stamp.json'), 'utf8'));
  assert.equal(stamp.schemaVersion, 1, 'Unknown Unicode helper stamp');
  assert.equal(stamp.traceFingerprint, trace.fingerprint, 'Trace reference changed: rebuild Unicode helper');
  assert.deepEqual(stamp.inputs, unicodeInputs(), 'Unicode C source, library or headers changed: rebuild');
  assert.equal(stamp.binarySha256, fileHash(unicodeBinary), 'Unicode helper binary changed: rebuild');
  assert.equal(stamp.referenceBinarySha256, fileHash(unicodeReferenceBinary), 'Unicode reference helper binary changed: rebuild');
  return { stamp, fingerprint: sha256(JSON.stringify(stamp)), trace };
}
