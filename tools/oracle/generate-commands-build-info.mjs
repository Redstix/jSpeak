import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const generateCommandsRoot = path.join(root, 'build/oracle-generate-commands');
export const generateCommandsSource = path.join(root, 'tools/oracle/generate-commands-oracle.c');
export const generateCommandsBinary = path.join(generateCommandsRoot, 'generate-commands-oracle');

export function generateCommandsInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/generate-commands-oracle.c', sha256: fileHash(generateCommandsSource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
