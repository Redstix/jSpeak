import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const phonemeMakeRoot = path.join(root, 'build/oracle-phoneme-make');
export const phonemeMakeSource = path.join(root, 'tools/oracle/phoneme-make-oracle.c');
export const phonemeMakeBinary = path.join(phonemeMakeRoot, 'phoneme-make-oracle');

export function phonemeMakeInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/phoneme-make-oracle.c', sha256: fileHash(phonemeMakeSource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
