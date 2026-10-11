import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { root } from '../oracle/trace-build-info.mjs';
import { cmnToneBinary, cmnToneInputs } from '../oracle/cmn-tone-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createPitchCalculator } from '../../src/core/calc-pitches.js';
import { CMN_PROSODY_PROFILE } from '../../data/cmn/prosody-profile.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const TONE_CODES = Object.freeze({ T11: 108, T15: 118, T21: 110, T22: 113, T33: 114, T35: 115, T44: 117, T53: 120, T55: 121, T51: 112, T214: 111 });
const COMPARED_FIELDS = ['stresslevel', 'tonePh', 'pitch1', 'pitch2'];

function pauseRows() {
  return [
    { code: 9, stress: 0, wordstress: 0, tone: 0, source: 0, flags: 0 },
    { code: 9, stress: 0, wordstress: 0, tone: 0, source: 0, flags: 0 }
  ];
}

function syllable(toneCode, source) {
  return [
    { code: 50, stress: 0, wordstress: 0, tone: 0, source, flags: 0 },
    { code: 37, stress: 4, wordstress: 4, tone: toneCode, source: 0, flags: 4 }
  ];
}

function caseRows(toneCodes) {
  const rows = [];
  for (let index = 0; index < toneCodes.length; index++) rows.push(...syllable(toneCodes[index], (index + 1) * 2));
  return [...rows, ...pauseRows()];
}

export const CMN_TONE_CASES = Object.freeze([
  { id: 'no-tone-promotion', tones: [0] },
  { id: 'tone-35', tones: [TONE_CODES.T35] },
  { id: 'tone-55', tones: [TONE_CODES.T55] },
  { id: 'tone-15', tones: [TONE_CODES.T15] },
  { id: 'tone-51', tones: [TONE_CODES.T51] },
  { id: 'tone-214', tones: [TONE_CODES.T214] },
  { id: 'sandhi-214-214', tones: [TONE_CODES.T214, TONE_CODES.T214] },
  { id: 'sandhi-214-55', tones: [TONE_CODES.T214, TONE_CODES.T55] },
  { id: 'sandhi-51-51', tones: [TONE_CODES.T51, TONE_CODES.T51] },
  { id: 'sandhi-55-11', tones: [TONE_CODES.T55, TONE_CODES.T11] },
  { id: 'sandhi-53-11', tones: [TONE_CODES.T53, TONE_CODES.T11] },
  { id: 'sandhi-214-11', tones: [TONE_CODES.T214, TONE_CODES.T11] },
  { id: 'three-tone-run', tones: [TONE_CODES.T55, TONE_CODES.T35, TONE_CODES.T51] }
].map(Object.freeze));

function oracleInput(cases) {
  const lines = [];
  for (const row of cases) {
    const rows = caseRows(row.tones);
    lines.push(rows.length, 0, 1, 0, 0);
    for (const item of rows) lines.push(item.code, item.stress, item.wordstress, item.tone, item.source, item.flags);
  }
  return lines.join('\n') + '\n';
}

function listFromOracle(result) {
  const count = result.count;
  const arrays = {};
  for (const name of ['phcode', 'stresslevel', 'wordstress', 'tonePh', 'sourceix', 'synthflags',
    'length', 'env', 'type', 'prepause', 'amp', 'newword', 'pitch1', 'pitch2', 'stdLength', 'phontabAddr', 'soundParam']) {
    arrays[name] = name === 'phcode' || name === 'stresslevel' || name === 'wordstress' || name === 'tonePh'
      ? new Uint8Array(1000) : name === 'sourceix' || name === 'synthflags'
      ? name === 'sourceix' ? new Uint16Array(1000) : new Uint16Array(1000)
      : new Uint16Array(1000);
    arrays[name].set(result[name].slice(0, count));
  }
  return { ...arrays, length: count };
}

export function verifyCmnTone({ directory } = {}) {
  assert(existsSync(cmnToneBinary), 'Build the cmn tone oracle first');
  const input = oracleInput(CMN_TONE_CASES);
  const requestSha256 = sha256(Buffer.from(input));
  const oracle = JSON.parse(execFileSync(cmnToneBinary, [path.join(root, 'build/oracle')], {
    input, maxBuffer: 64 * 1024 * 1024, timeout: 120000
  }));
  assert.equal(oracle.profile.voice, 'cmn');
  assert.equal(oracle.profile.translatorName, 6516078);
  assert.equal(oracle.profile.phonemeTable, 8);
  assert.equal(oracle.profile.toneLanguage, 1);
  assert.equal(oracle.results.length, CMN_TONE_CASES.length, 'Oracle result count differs');

  const table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(8);
  const calculator = createPitchCalculator(table, CMN_PROSODY_PROFILE);
  const files = runtimeSnapshot(['src/core/calc-pitches.js', 'src/core/calc-pitches-tone.js', 'data/cmn/prosody-profile.js'], [
    'tools/oracle/cmn-tone-oracle.c', 'tools/compare/cmn-tone.mjs'
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/cmn-tone-')); }
  mkdirSync(directory, { recursive: true });
  const results = [];
  try {
    for (let index = 0; index < CMN_TONE_CASES.length; index++) {
      const expected = oracle.results[index].pitches;
      const before = listFromOracle(oracle.results[index].before);
      const actual = calculator.calculate(before, before.length, 0).list;
      for (const field of COMPARED_FIELDS) {
        assert.deepEqual(Array.from(actual[field].subarray(0, expected.count)), expected[field],
          CMN_TONE_CASES[index].id + ' ' + field);
      }
      results.push({ id: CMN_TONE_CASES[index].id, status: 'exact', count: expected.count });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/calc-pitches.js', 'src/core/calc-pitches-tone.js', 'data/cmn/prosody-profile.js'], [
      'tools/oracle/cmn-tone-oracle.c', 'tools/compare/cmn-tone.mjs'
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length, files,
      error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }
  const report = {
    schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed cmn original CalcPitches_Tone over constructed MakePhonemeList outputs',
    profile: CMN_PROSODY_PROFILE, totalCases: results.length, exactCases: results.length,
    comparedFields: COMPARED_FIELDS, comparedPhonemes: results.reduce((sum, row) => sum + row.count, 0),
    unsupportedCases: 0, requestSha256, oracleReference: cmnToneInputs().reference,
    files, artifactDirectory: directory,
    limitation: 'Synthetic pre-MakePhonemeList rows cover tone promotion and reviewed Mandarin sandhi combinations; they do not complete the cmn text frontend or claim full M15.'
  };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/cmn-tone.mjs [directory]');
  console.log(JSON.stringify(verifyCmnTone(process.argv[2] ? { directory: process.argv[2] } : {}), null, 2));
}
