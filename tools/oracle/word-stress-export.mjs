import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, sha256 } from './trace-build-info.mjs';
import { createWordStressOracle } from './word-stress.mjs';
const envelope = createWordStressOracle()();
const module = '// Actual initialized fixed en-us stress options. GPL-3.0-or-later.\n' +
  'export var WORD_STRESS_PROFILE = Object.freeze(' + JSON.stringify(envelope.profile) + ');\n';
const directory = path.join(root, 'data/stress');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'profile.js'), module);
writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, kind: 'initialized-en-us-word-stress-profile',
  reference: envelope.reference, profile: envelope.profile, moduleSha256: sha256(module),
  license: 'GPL-3.0-or-later; licenses/espeak-ng/COPYING.txt' }, null, 2) + '\n');
console.log(JSON.stringify(envelope.profile));
