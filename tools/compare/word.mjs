import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createWordOracle, normalizeWordRequest, wordStateFields } from '../oracle/word.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../../src/core/word-services.js';
import { WORD_TRANSLATION_PROFILE } from '../../src/core/translate-word.js';
import { makeWordCorpus } from './word-corpus.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => bytes === null ? null : Buffer.from(bytes).toString('hex');
const wordFields = ['flags', 'start', 'prePause', 'sourceix', 'length'];
const stateFields = [...wordStateFields, 'clauseEndRelation', 'repeatHex', 'phonemeTable', 'native'];
function keys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' object');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label + ' keys');
}
function hexadecimal(value, label) { assert(typeof value === 'string' && /^(?:[0-9a-f]{2})*$/.test(value), label + ' hex'); }
function integer(value, min, max, label) { assert(Number.isInteger(value) && value >= min && value <= max, label + ' integer'); }
export function validateWordEnvelope(value) {
  keys(value, ['schemaVersion', 'reference', 'profile', 'request', 'status', 'diagnostic', 'result'], 'word envelope');
  assert.equal(value.schemaVersion, 1);
  keys(value.reference, ['upstreamCommit', 'helperFingerprint', 'dataFingerprint', 'profile'], 'word reference');
  assert.match(value.reference.upstreamCommit, /^[0-9a-f]{40}$/);
  for (const key of ['helperFingerprint', 'dataFingerprint']) assert.match(value.reference[key], /^[0-9a-f]{64}$/);
  assert.equal(value.reference.profile, 'direct-word-en-us-v1');
  assert.deepEqual(value.profile, WORD_TRANSLATION_PROFILE);
  keys(value.request, ['operation', 'utf8Hex', 'prefixHex', 'bufferHex', 'offset', 'words', 'remaining', 'wordOut', 'anyStressedWords', 'alphabetCodepoint', 'initialPhonemesHex', 'state'], 'word request');
  if (value.status === 'undefined-upstream-behavior') {
    assert.equal(value.result, null);
    assert.deepEqual(value.diagnostic, { code: 'WORD_SOURCE_UNDERFLOW', sanitizer: 'AddressSanitizer', kind: 'stack-buffer-overflow',
      source: 'src/libespeak-ng/common.c', line: 138, callerSource: 'src/libespeak-ng/dictionary.c', callerLine: 1967, relativeIndex: -1 });
    return value;
  }
  assert.equal(value.status, 'ok'); assert.equal(value.diagnostic, null);
  const result = value.result;
  keys(result, ['flags', 'phonemesHex', 'wordOutHex', 'prefixAfterHex', 'wordAfterHex', 'bufferAfterHex', 'wordsBefore', 'wordsAfter', 'stateBefore', 'stateAfter', 'anyStressedWords'], 'word result');
  integer(result.flags, 0, 0xffffffff, 'flags');
  for (const field of ['phonemesHex', 'prefixAfterHex', 'wordAfterHex', 'bufferAfterHex']) hexadecimal(result[field], field);
  assert(result.phonemesHex.length < 400); assert.equal(result.prefixAfterHex.length, 4);
  assert.equal(result.wordAfterHex.length, value.request.utf8Hex.length); assert.equal(result.bufferAfterHex.length, value.request.bufferHex.length);
  if (value.request.wordOut) hexadecimal(result.wordOutHex, 'wordOutHex'); else assert.equal(result.wordOutHex, null);
  for (const field of ['wordsBefore', 'wordsAfter']) {
    assert(Array.isArray(result[field])); assert.equal(result[field].length, value.request.words.length);
    for (const row of result[field]) {
      keys(row, wordFields, 'WORD_TAB');
      for (const key of wordFields) integer(row[key], 0, key === 'flags' ? 0xffffffff : key === 'start' || key === 'sourceix' ? 65535 : 255, key);
    }
  }
  for (const field of ['stateBefore', 'stateAfter']) {
    const state = result[field]; keys(state, stateFields, field);
    for (const key of wordStateFields) integer(state[key], -0x80000000, 0xffffffff, key);
    assert.equal(state.clauseEndRelation, 'in-source'); assert.equal(state.phonemeTable, 80); assert.equal(state.native, true);
    hexadecimal(state.repeatHex, 'repeatHex'); assert(state.repeatHex.length <= 38);
  }
  if (value.request.operation === 'word') assert.equal(result.anyStressedWords, null); else assert.equal(typeof result.anyStressedWords, 'boolean');
  return value;
}
function serializeState(state) { const { repeat, ...rest } = state; assert(repeat instanceof Uint8Array); return { ...rest, repeatHex: hex(repeat) }; }
export function serializeWord(row) {
  return { flags: row.flags, phonemesHex: hex(row.phonemes), wordOutHex: hex(row.wordOut), prefixAfterHex: hex(row.prefixAfter),
    wordAfterHex: hex(row.wordAfter), bufferAfterHex: hex(row.bufferAfter), wordsBefore: row.wordsBefore, wordsAfter: row.wordsAfter,
    stateBefore: serializeState(row.stateBefore), stateAfter: serializeState(row.stateAfter), anyStressedWords: row.anyStressedWords };
}
let dictionary, table;
export function createWordSession(initialState) {
  if (!dictionary) dictionary = loadDictionary(new Uint8Array(readFileSync(path.join(root, 'data/dictionary/en_dict.bin'))), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
  if (!table) table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(80);
  return createEnglishWordServices(dictionary, table, { initialState }).wordTranslation;
}
export function compareWordCase(fixture, expected, factory = createWordSession) {
  validateWordEnvelope(expected);
  const request = normalizeWordRequest(fixture.request), { repeatHex, ...state } = request.state;
  assert.deepEqual(expected.request, request, 'C request differs from independently normalized input');
  const session = factory({ ...state, repeat: Buffer.from(repeatHex, 'hex') });
  const input = Buffer.from(request.bufferHex, 'hex'), saved = input.slice();
  let row;
  try {
    row = session.translate(input, { offset: request.offset, operation: request.operation, words: request.words, remaining: request.remaining,
      wordOut: request.wordOut, anyStressedWords: request.anyStressedWords, alphabetCodepoint: request.alphabetCodepoint,
      initialPhonemes: Buffer.from(request.initialPhonemesHex, 'hex') });
  } catch (error) {
    if (expected.status !== 'undefined-upstream-behavior') throw error;
    assert.equal(fixture.expectedUndefined, true, 'Unreviewed C undefined input');
    assert.equal(error.name, 'UnsupportedWordTranslationError'); assert.equal(error.code, 'WORD_TRANSLATION_UNSUPPORTED');
    assert.equal(error.reason, 'rule-source-bounds'); assert.throws(() => session.translate(input), again => again === error);
    return { id: fixture.id, status: 'undefined-upstream-behavior', diagnostic: expected.diagnostic, jsRejection: error.reason };
  }
  assert.equal(expected.status, 'ok', 'JS accepted C undefined behavior');
  assert.equal(fixture.expectedUndefined, false, 'Reviewed C source-UB case became defined');
  assert.deepEqual(input, saved, 'JS modified caller input');
  assert.deepEqual(serializeWord(row), expected.result, fixture.id);
  return { id: fixture.id, status: 'exact', phonemes: row.phonemes.length };
}
function snapshot(extraFiles) {
  const files = new Set(['tools/compare/word.mjs', 'tools/compare/word-corpus.mjs', 'tools/oracle/word.mjs', 'tools/oracle/word-build-info.mjs',
    'tools/oracle/trace-build-info.mjs', 'tools/oracle/corpus.json', 'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json',
    'build/oracle/espeak-ng-data/phontab', ...extraFiles]);
  const visit = name => {
    if (files.has(name)) return;
    files.add(name);
    const source = readFileSync(path.join(root, name), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
    }
  };
  visit('src/core/word-services.js');
  return [...files].sort().map(name => ({ path: name, sha256: sha256(readFileSync(path.join(root, name))) }));
}
export function verifyWord({ replayFile, directory } = {}) {
  const fixtures = makeWordCorpus(), extra = [];
  if (replayFile) {
    replayFile = path.relative(root, path.resolve(root, replayFile)); extra.push(replayFile);
    const entries = JSON.parse(readFileSync(path.join(root, replayFile)));
    for (const entry of entries) fixtures.push({ id: `replay-${entry.id}-${entry.call}`, request: entry.response.request, expectedUndefined: false });
  }
  assert.equal(new Set(fixtures.map(row => row.id)).size, fixtures.length, 'Duplicate fixture IDs');
  const oracle = createWordOracle(), baseline = validateWordEnvelope(oracle({ utf8Hex: '686920' })), files = snapshot(extra);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/word-differential-')); }
  mkdirSync(directory, { recursive: true });
  const requests = JSON.stringify({ schemaVersion: 1, replayFile: replayFile || null, fixtures }, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requests); writeFileSync(path.join(directory, 'oracle.jsonl'), '');
  const results = []; let active;
  try {
    for (const fixture of fixtures) {
      active = fixture; const expected = validateWordEnvelope(oracle(fixture.request));
      assert.deepEqual(expected.reference, baseline.reference); assert.deepEqual(expected.profile, baseline.profile);
      appendFileSync(path.join(directory, 'oracle.jsonl'), JSON.stringify({ id: fixture.id, response: expected }) + '\n');
      results.push(compareWordCase(fixture, expected));
    }
    assert.deepEqual(snapshot(extra), files, 'Runtime/data/fixture changed during differential');
    assert.deepEqual(createWordOracle()({ utf8Hex: '686920' }), baseline, 'Original C helper changed during differential');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active, completed: results.length, files,
      reference: baseline.reference, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory; throw error;
  }
  const undefinedCases = results.filter(row => row.status === 'undefined-upstream-behavior');
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed en-us direct word3/public word/bounded replacement wrapper; exact complete buffers, words, phonemes and exposed state',
    totalCases: results.length, exactCases: results.length - undefinedCases.length,
    comparedPhonemes: results.reduce((sum, row) => sum + (row.phonemes || 0), 0), unsupportedCases: 0,
    upstreamUndefinedCases: undefinedCases.length, upstreamUndefined: undefinedCases, replayFile: replayFile || null,
    reference: baseline.reference, profile: baseline.profile, files, requestsSha256: sha256(requests), artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/word.mjs [replays.json]');
  console.log(JSON.stringify(verifyWord({ replayFile: process.argv[2] }), null, 2));
}
