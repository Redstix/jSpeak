// Node-only loader for comparison harnesses; the runtime services do no I/O.
import { readFileSync } from 'node:fs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../../src/core/word-services.js';
let dictionary, selected;
export function createReadClauseDictionary() {
  if (!dictionary) dictionary = loadDictionary(new Uint8Array(readFileSync(new URL('../../data/dictionary/en_dict.bin', import.meta.url))), JSON.parse(readFileSync(new URL('../../data/dictionary/manifest.json', import.meta.url))));
  if (!selected) selected = createPhonemeTables(new Uint8Array(readFileSync(new URL('../../build/oracle/espeak-ng-data/phontab', import.meta.url)))).select(80);
  return createEnglishWordServices(dictionary, selected).characterNames;
}
