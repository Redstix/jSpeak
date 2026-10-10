import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild, fileHash, sha256 } from './trace-build-info.mjs';
import { createWordStressOracle } from './word-stress.mjs';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createWordStressSession, getVowelStress, WORD_STRESS_PROFILE } from '../../src/core/word-stress.js';

export function makeWordStressCorpus(table) {
  const requests = [];
  const add = (phonemes, settings = {}) => requests.push({ kind: 'set', phonemesHex: Buffer.from(phonemes).toString('hex'), dictionaryFlags: null, tonic: -1, control: 0, stressedSyllable: 0, prevLastStress: 3, ...settings });
  for (let code = 0; code < 256; code++) {
    for (const control of [0, 1]) for (const stressedSyllable of [0, 1, 99]) add([code], { kind: 'get', control, stressedSyllable });
    for (const dictionaryFlags of [null, 0, 1, 7, 8, 11, 15, 0x80000008]) for (const tonic of [-1, 0, 1, 3, 4, 5, 6]) add([code], { dictionaryFlags, tonic });
  }
  const vowels = table.entries.filter(ph => ph && ph.type === 2 && !(ph.phflags & 0x100000)).map(ph => ph.code);
  const consonants = table.entries.filter(ph => ph && ph.type >= 3 && ph.type <= 9).map(ph => ph.code);
  for (const code of vowels) {
    for (const stress of [2, 3, 4, 5, 6, 7, 8, 26]) {
      add([stress, code, 13, stress, code, 12, consonants[0]], { kind: 'get', control: 1 });
      add([stress, code, 13, stress, code, 12, consonants[0]]);
    }
  }
  for (const length of [0, 1, 2, 3, 4, 5, 6, 97, 98, 99, 100, 196, 197, 198, 199]) {
    for (const code of [13, vowels[0], consonants[0], 20, 255]) {
      add(new Uint8Array(length).fill(code));
      add(new Uint8Array(length).fill(code), { kind: 'get', control: 1 });
    }
  }
  let random = 0x5eed5702;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  for (let i = 0; i < 1024; i++) {
    const bytes = Uint8Array.from({ length: next() % 80 }, () => next() & 255);
    add(bytes, { dictionaryFlags: next() % 2 ? null : next(), tonic: (next() % 8) - 1, control: next() % 4 });
    add(bytes, { kind: 'get', stressedSyllable: next() % 10, control: next() % 2 });
  }
  return requests;
}
export function verifyWordStress({ directory } = {}) {
  const names = ['src/core/word-stress.js', 'src/core/phoneme-table.js', 'data/stress/profile.js', 'data/stress/manifest.json', 'tools/oracle/word-stress.mjs', 'tools/oracle/word-stress-selfcheck.mjs'];
  const snapshot = () => names.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
  const files = snapshot(), table = createPhonemeTables(readFileSync(path.join(referenceBuild, 'espeak-ng-data/phontab'))).select(80);
  const oracle = createWordStressOracle(), initial = oracle();
  assert.deepEqual(initial.profile, WORD_STRESS_PROFILE);
  const requests = makeWordStressCorpus(table);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/word-stress-')); }
  mkdirSync(directory, { recursive: true });
  const requestBytes = JSON.stringify(requests, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestBytes);
  let active = null;
  try {
    for (let offset = 0; offset < requests.length; offset += 256) {
      const rows = requests.slice(offset, offset + 256);
      active = { batchOffset: offset };
      const reference = oracle(rows);
      assert.deepEqual(reference.reference, initial.reference); assert.deepEqual(reference.profile, WORD_STRESS_PROFILE);
      rows.forEach((row, index) => {
        active = { index: offset + index, request: row };
        const bytes = Buffer.from(row.phonemesHex, 'hex');
        const result = row.kind === 'get' ? getVowelStress(bytes, table, WORD_STRESS_PROFILE, row) :
          createWordStressSession(table, WORD_STRESS_PROFILE, { prevLastStress: row.prevLastStress }).setWordStress(bytes, row);
        const { phonemes, vowelStress, ...rest } = result;
        const actual = { phonemesHex: Buffer.from(phonemes).toString('hex'), ...(vowelStress ? { vowelStress: Array.from(vowelStress) } : {}), ...rest };
        assert.deepEqual(actual, reference.results[index], `C word stress ${offset + index}`);
      });
    }
    assert.deepEqual(snapshot(), files, 'Word-stress sources changed during verification');
    assert.deepEqual(createWordStressOracle()().reference, initial.reference, 'Word-stress C reference changed during verification');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', active, error: error.stack, files, reference: initial.reference }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + path.join(directory, 'failure.json');
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed', scope: 'Fixed initialized en-us GetVowelStress/SetWordStress; original selected phoneme table',
    cases: requests.length, getCases: requests.filter(row => row.kind === 'get').length, setCases: requests.filter(row => row.kind === 'set').length,
    requestsSha256: sha256(requestBytes), files, reference: initial.reference, profile: initial.profile, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/word-stress-selfcheck.mjs');
  console.log(JSON.stringify(verifyWordStress(), null, 2));
}
