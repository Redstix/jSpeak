import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, fileHash } from './trace-build-info.mjs';
import { createCharacterNamesOracle } from './character-names.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../../src/core/word-services.js';
import { runtimeSnapshot } from '../compare/runtime-snapshot.mjs';
const read = name => new Uint8Array(readFileSync(path.join(root, name)));
const dictionary = loadDictionary(read('data/dictionary/en_dict.bin'), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
const table = createPhonemeTables(read('build/oracle/espeak-ng-data/phontab')).select(80);
function session() {
  const services = createEnglishWordServices(dictionary, table);
  return { names: services.characterNames, state() { const state = services.dictionary.state(); return { repeatCount: state.repeatCount, repeatHex: Buffer.from(state.repeat).toString('hex'), skipWords: state.skipWords, prevLastStress: services.stress.state().prevLastStress }; } };
}
const snapshot = () => runtimeSnapshot(['src/core/word-services.js', 'tools/oracle/character-names-selfcheck.mjs'], ['data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'build/oracle/espeak-ng-data/phontab']);
const beforeSources = snapshot();
const oracle = createCharacterNamesOracle();
mkdirSync(path.join(root, 'artifacts'), { recursive: true });const output = mkdtempSync(path.join(root, 'artifacts/character-names-'));
const ellipses = [0xeaf, 0x1801, 0x2026, 0xfe19, 0x22ee, 0x22ef, 0x22f0, 0x22f1];
const batches = [
  Array.from({ length: 768 }, (_, codepoint) => ({ codepoint, only: true })),
  [...ellipses, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x10ffff, 0x110000, 0xffffffff].map(codepoint => ({ codepoint, only: true })),
  [61, 61, 61, 61, 61, 61].map((codepoint, i) => ({ codepoint, only: true, reset: i === 5 })),
  Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~abcdefghijklmnopqrstuvwxyz0123456789é').map(c => ({ codepoint: c.codePointAt(0), only: false }))
];
let active, comparisons = 0;
const evidence = [];
try {
  for (const requests of batches) {
    active = requests; const expected = oracle(requests);assert.deepEqual(oracle(requests), expected);assert.deepEqual(oracle(requests, { reference: true }), expected);
    const js = session();
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];active = request;if (request.reset) js.names.resetRepeat();
      const before = js.state(), result = js.names.lookupCharName(request.codepoint, request.only);
      assert.deepEqual({ stateBefore: before, outputHex: Buffer.from(result).toString('hex'), stateAfter: js.state() }, expected.result[i], JSON.stringify(request));comparisons++;
      if (ellipses.includes(request.codepoint) && request.only) assert.equal(result.length, 0);
    }
    evidence.push(expected);
  }
  assert.deepEqual(snapshot(), beforeSources, 'Service sources changed during comparison');
  writeFileSync(path.join(output, 'cases.json'), JSON.stringify(evidence, null, 2) + '\n');
  const report = { schemaVersion: 1, status: 'passed', kind: 'original-static-LookupCharName-vs-JS', reference: evidence[0].reference, comparisons, batches: batches.length,
    exceptions: [],
    cRunsPerBatch: 3, ellipsisDictionaryDecisions: ellipses.map(codepoint => ({ codepoint, phonemeNameEmpty: true })),
    sources: beforeSources,
    casesSha256: fileHash(path.join(output, 'cases.json')), limitation: 'Only fixed en-us. Uses actual recursive word/rule services; original fixed character-name buffer limits are checked explicitly. Does not establish dynamic language dependency closure.' };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');console.log(`PASS: ${comparisons} original C character-name outputs and shared states. Report: ${output}/report.json`);
} catch (error) { writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ active, error: error.stack }, null, 2) + '\n');throw error; }
