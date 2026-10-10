import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, fileHash } from './trace-build-info.mjs';
import { createLetterNamesOracle } from './character-names.mjs';
import { createAccentOracle } from './accent.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../../src/core/word-services.js';
import { runtimeSnapshot } from '../compare/runtime-snapshot.mjs';

const read = name => new Uint8Array(readFileSync(path.join(root, name)));
const dictionary = loadDictionary(read('data/dictionary/en_dict.bin'), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
const selected = createPhonemeTables(read('build/oracle/espeak-ng-data/phontab')).select(80);
const newSession = () => createEnglishWordServices(dictionary, selected);
const oracle = createLetterNamesOracle(), accentOracle = createAccentOracle();
const dictionaryState = service => { const s = service.dictionary.state();return { repeatCount: s.repeatCount, repeatHex: Buffer.from(s.repeat).toString('hex'), skipWords: s.skipWords }; };
const state = service => ({ ...dictionaryState(service), prevLastStress: service.stress.state().prevLastStress });
const snapshot = () => runtimeSnapshot(['src/core/word-services.js', 'tools/oracle/letter-names-selfcheck.mjs'], ['data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'build/oracle/espeak-ng-data/phontab']);
mkdirSync(path.join(root, 'artifacts'), { recursive: true });const output = mkdtempSync(path.join(root, 'artifacts/letter-names-'));
const beforeSources = snapshot(), evidence = [], exceptions = [];
let active, comparisons = 0, accentComparisons = 0;
try {
  for (const nextLetter of [-1, 32, 31]) for (const control of [0, 1]) {
    const requests = Array.from({ length: 256 }, (_, codepoint) => ({ codepoint, nextLetter, control }));
    active = requests;const expected = oracle(requests);assert.deepEqual(oracle(requests), expected);assert.deepEqual(oracle(requests, { reference: true }), expected);
    const services = newSession();
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];active = request;const before = state(services), phonemes = services.letters.lookupLetter(request.codepoint, request);
      assert.deepEqual({ stateBefore: before, outputHex: Buffer.from(phonemes).toString('hex'), stateAfter: state(services) }, expected.result[i], JSON.stringify(request));comparisons++;
    }
    evidence.push(expected);
  }
  const accentRequest = { letters: Array.from({ length: 768 }, (_, i) => i) };
  active = accentRequest;const expectedAccent = accentOracle(accentRequest);assert.deepEqual(accentOracle(accentRequest), expectedAccent);
  const services = newSession();
  for (let codepoint = 0; codepoint < 768; codepoint++) {
    active = { codepoint };const before = dictionaryState(services), phonemes = services.accent(codepoint);
    assert.deepEqual({ codepoint, stateBefore: before, phonemesHex: Buffer.from(phonemes).toString('hex'), stateAfter: dictionaryState(services) }, expectedAccent.result[codepoint]);accentComparisons++;
  }
  assert.deepEqual(snapshot(), beforeSources, 'Service sources changed during comparison');
  writeFileSync(path.join(output, 'cases.json'), JSON.stringify({ letters: evidence, accent: expectedAccent, exceptions }, null, 2) + '\n');
  const report = { schemaVersion: 1, status: 'passed', kind: 'original-LookupLetter-and-integrated-accent-vs-JS', reference: evidence[0].reference,
    comparisons, accentComparisons, exceptionCount: exceptions.length, exceptions, sources: beforeSources, casesSha256: fileHash(path.join(output, 'cases.json')),
    closedDependency: 'LookupLetter textmode symbols and U+0252 accents invoke actual recursive TranslateWord/TranslateRules implementations and match C including shared dictionary and stress states.',
    limitation: 'Only fixed en-us. No dynamic language dependency closure claim; original fixed buffer limits remain enforced.' };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');console.log(`PASS: ${comparisons} LookupLetter, ${accentComparisons} integrated accents; ${exceptions.length} explicit TranslateWord dependencies. Report: ${output}/report.json`);
} catch (error) {writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ active, error: error.stack }, null, 2) + '\n');throw error;}
