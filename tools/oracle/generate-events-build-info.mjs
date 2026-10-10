import path from 'node:path';
import { root, referenceBuild, fileHash, validateReference } from './trace-build-info.mjs';

export const generateEventsRoot = path.join(root, 'build/oracle-generate-events');
export const generateEventsSource = path.join(root, 'tools/oracle/generate-events-oracle.c');
export const generateEventsObserved = path.join(generateEventsRoot, 'synthesize-observed.c');
export const generateEventsBinary = path.join(generateEventsRoot, 'generate-events-oracle');

export function generateEventsInputs() {
  return {
    reference: validateReference(),
    source: { path: 'tools/oracle/generate-events-oracle.c', sha256: fileHash(generateEventsSource) },
    libraries: ['src/libespeak-ng/libespeak-ng.a', 'src/ucd-tools/libucd.a'].map(name => ({
      path: name, sha256: fileHash(path.join(referenceBuild, name)),
    })),
    data: ['phontab', 'phonindex', 'phondata', 'intonations'].map(name => ({
      path: 'espeak-ng-data/' + name, sha256: fileHash(path.join(referenceBuild, 'espeak-ng-data', name)),
    })),
  };
}
