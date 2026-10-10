import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const waveSampleRoot = path.join(root, 'build/oracle-wave-sample');
export const waveSampleSource = path.join(root, 'tools/oracle/wave-sample-oracle.c');
export const waveSampleBinary = path.join(waveSampleRoot, 'wave-sample-oracle');

export function waveSampleInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/wave-sample-oracle.c', sha256: fileHash(waveSampleSource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
