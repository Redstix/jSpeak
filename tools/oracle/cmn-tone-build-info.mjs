import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const cmnToneRoot = path.join(root, 'build/oracle-cmn-tone');
export const cmnToneSource = path.join(root, 'tools/oracle/cmn-tone-oracle.c');
export const cmnToneBinary = path.join(cmnToneRoot, 'cmn-tone-oracle');

export function cmnToneInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/cmn-tone-oracle.c', sha256: fileHash(cmnToneSource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
