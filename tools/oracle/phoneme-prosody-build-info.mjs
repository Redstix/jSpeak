import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const phonemeProsodyRoot = path.join(root, 'build/oracle-phoneme-prosody');
export const phonemeProsodySource = path.join(root, 'tools/oracle/phoneme-prosody-oracle.c');
export const phonemeProsodyBinary = path.join(phonemeProsodyRoot, 'phoneme-prosody-oracle');

export function phonemeProsodyInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/phoneme-prosody-oracle.c', sha256: fileHash(phonemeProsodySource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
