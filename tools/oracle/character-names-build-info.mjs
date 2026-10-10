import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root, traceSource, traceBuild, referenceBuild, fileHash, sha256, validateTraceBuild } from './trace-build-info.mjs';
export const referenceSource = path.join(root, 'upstream/espeak-ng');
export const characterNamesRoot = path.join(root, 'build/oracle-character-names');
export const characterNamesSource = path.join(root, 'tools/oracle/character-names-oracle.c');
export const characterNamesBinary = path.join(characterNamesRoot, 'character-names-oracle');
export const characterNamesReferenceBinary = path.join(characterNamesRoot, 'character-names-oracle-reference');
export function characterNamesInputs() {
  return { helperSourceSha256: fileHash(characterNamesSource), libraries: [referenceBuild, traceBuild].map(build => ({ espeak: fileHash(path.join(build, 'src/libespeak-ng/libespeak-ng.a')), ucd: fileHash(path.join(build, 'src/ucd-tools/libucd.a')) })),
    originalReadClause: [referenceSource, traceSource].map(source => ({ path: path.join(source, 'src/libespeak-ng/readclause.c'), sha256: fileHash(path.join(source, 'src/libespeak-ng/readclause.c')) })) };
}
export function validateCharacterNamesBuild() {
  const trace = validateTraceBuild(), stamp = JSON.parse(readFileSync(path.join(characterNamesRoot, 'build-stamp.json')));
  assert.equal(stamp.schemaVersion, 1);assert.equal(stamp.traceFingerprint, trace.fingerprint);
  assert.deepEqual(stamp.inputs, characterNamesInputs(), 'Character-name oracle inputs changed; rebuild');
  assert.equal(stamp.binarySha256, fileHash(characterNamesBinary));assert.equal(stamp.referenceBinarySha256, fileHash(characterNamesReferenceBinary));
  return { trace, stamp, fingerprint: sha256(JSON.stringify(stamp)) };
}
