import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateClauseWord2Build } from '../oracle/clause-word2-build-info.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../../src/core/word-services.js';
import { createPhonemeListSession, PHONEME_LIST_PROFILE } from '../../src/core/phoneme-list.js';
import { createWordToPhonemesSession } from '../../src/core/word-to-phonemes.js';
import { PHONEMIZER_PROFILE } from '../../data/phonemizer/profile.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => Buffer.from(bytes).toString('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const columnNames = ['phcode', 'stresslevel', 'wordstress', 'tonePh', 'sourceix', 'synthflags'];
let dictionary, table;
function resources() {
  if (!dictionary) dictionary = loadDictionary(new Uint8Array(readFileSync(path.join(root, 'data/dictionary/en_dict.bin'))), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
  if (!table) table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(80);
  return { dictionary, table };
}
export function collectWord2Fixtures(directory) {
  const report = JSON.parse(readFileSync(path.join(directory, 'report.json')));
  assert.equal(report.status, 'passed');
  assert.equal(report.kind, 'original-clause-word2-readonly-cli-observer-selfcheck');
  const fixtures = [], files = [];
  for (const capture of report.captures) {
    const name = path.join(directory, capture.id, 'observed.jsonl'), data = readFileSync(name);
    files.push({ path: path.relative(root, name), sha256: sha256(data) });
    const events = data.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    let rows, pending;
    for (const event of events) {
      if (event.kind === 'clause.words') rows = clone(event.wordsWithSentinel);
      else if (event.kind === 'word2.enter') {
        assert.equal(pending, undefined);
        for (let i = 0; i < event.words.length; i++) rows[event.wordIndex + i] = clone(event.words[i]);
        pending = { id: capture.id + '-word2-' + event.id, input: event, words: clone(rows) };
      } else if (event.kind === 'word2.exit') {
        assert(pending); assert.equal(pending.input.id, event.id);
        for (let i = 0; i < event.words.length; i++) rows[event.wordIndex + i] = clone(event.words[i]);
        fixtures.push({ ...pending, expected: event }); pending = undefined;
      }
    }
    assert.equal(pending, undefined);
  }
  assert.equal(fixtures.length, report.word2Calls);
  return { fixtures, report, files };
}
function initialWordState(event) {
  const { repeatHex, phonemeTable, native, clauseEnd, clauseEndRelation, ...state } = event.wordState;
  return { ...state, repeat: Buffer.from(repeatHex, 'hex'), clauseEnd: clauseEnd === null ? 0 : clauseEnd,
    clauseEndRelation: clauseEndRelation === 'in-source' ? 'in-source' : 'unrelated' };
}
function initialList(event) {
  const list = { length: event.phonemeList2.count };
  for (const name of columnNames) {
    list[name] = new (name === 'sourceix' || name === 'synthflags' ? Uint16Array : Uint8Array)(PHONEME_LIST_PROFILE.capacity);
    for (let i = 0; i < event.phonemeList2.count; i++) list[name][i] = event.phonemeList2.items[i][name];
  }
  const embeddedList = new Uint32Array(PHONEME_LIST_PROFILE.embeddedCapacity); embeddedList.set(event.embedded.list);
  return { list, state: { embeddedFlag: event.clauseState.embeddedFlag, anyStressedWords: event.clauseState.anyStressedWords,
    embeddedIndex: event.embedded.index, embeddedList, prevDictFlags0: event.wordState.prevDictFlags0,
    prevDictFlags1: event.wordState.prevDictFlags1, endStressedVowel: event.wordState.endStressedVowel, optionCapitals: event.wordState.optionCapitals } };
}
function semanticList(value) {
  // Word2 does not initialize wordstress on normal rows. Never count that raw
  // storage as a semantic result, even when global zero-initialization matches.
  return { count: value.count, capacity: value.capacity, items: value.items.map(({ wordstress, ...row }) => row) };
}
function snapshotList(list) {
  const saved = list.snapshot().list;
  return { count: saved.length, capacity: saved.phcode.length,
    items: Array.from({ length: saved.length }, (_, i) => Object.fromEntries(columnNames.map(name => [name, saved[name][i]]))) };
}
function wordState(state, event) {
  const { repeat, ...rest } = state;
  return { ...rest, repeatHex: hex(repeat),
    clauseEnd: event.wordState.clauseEnd === null ? null : rest.clauseEnd,
    clauseEndRelation: rest.clauseEndRelation === 'unrelated' ? 'unrelated' : 'in-source' };
}
export function replayWord2(fixture) {
  const { input, expected } = fixture, { dictionary, table } = resources();
  assert.equal(input.wordState.phonemeTable, 80); assert.equal(input.wordState.native, true);
  assert.equal(input.clauseState.selectedTable, 80); assert.equal(input.clauseState.voiceTable, 80);
  const services = createEnglishWordServices(dictionary, table, { initialState: initialWordState(input) });
  const list = createPhonemeListSession(table, PHONEME_LIST_PROFILE, initialList(input));
  const session = createWordToPhonemesSession(services, table, list, PHONEMIZER_PROFILE, {
    embeddedRead: input.embedded.read, optionEmphasis: input.clauseState.optionEmphasis,
    wordPhonemes: Buffer.from(input.phonemesHex, 'hex'), currentAlphabet: input.clauseState.currentAlphabet });
  const original = Buffer.from(input.bufferHex, 'hex'), before = original.slice(), rowsBefore = clone(fixture.words);
  const row = session.translate(original, { offset: input.offset, words: fixture.words, wordIndex: input.wordIndex,
    remaining: input.remaining, prePause: input.prePauseArgument,
    clauseEnd: input.wordState.clauseEnd === null ? undefined : input.offset + input.wordState.clauseEnd,
    clauseEndRelation: input.wordState.clauseEnd === null ? 'unrelated' : 'in-source' });
  assert.deepEqual(original, before, 'Modified caller buffer'); assert.deepEqual(fixture.words, rowsBefore, 'Modified caller rows');
  const after = services.wordTranslation.state(), commandState = list.state(), local = session.state();
  const actual = { flags: row.flags, bufferHex: hex(row.buffer), words: row.words.slice(input.wordIndex, input.wordIndex + input.remaining),
    phonemesHex: hex(row.phonemes), wordState: wordState(after, expected), phonemeList2: semanticList(snapshotList(list)),
    embedded: { index: commandState.embeddedIndex, read: local.embeddedRead, list: Array.from(commandState.embeddedList.slice(0, commandState.embeddedIndex)) },
    clauseState: { prePause: after.prePause, optionEmphasis: local.optionEmphasis, embeddedFlag: commandState.embeddedFlag,
      anyStressedWords: commandState.anyStressedWords, skipWords: after.skipWords } };
  const expectedWord = { ...expected.wordState, clauseEndRelation: expected.wordState.clauseEnd === null ? 'unrelated' : 'in-source' };
  const wanted = { flags: expected.flags, bufferHex: expected.bufferHex, words: expected.words,
    phonemesHex: expected.phonemesHex, wordState: expectedWord, phonemeList2: semanticList(expected.phonemeList2),
    embedded: { index: expected.embedded.index, read: expected.embedded.read, list: expected.embedded.list },
    clauseState: Object.fromEntries(Object.keys(actual.clauseState).map(name => [name, expected.clauseState[name]])) };
  assert.deepEqual(actual, wanted, fixture.id);
  // These belong to the caller or subsequent stages. Assert their unchanged
  // observation rather than fabricating a JS result by copying expected fields.
  for (const name of Object.keys(input.clauseState)) if (!(name in actual.clauseState)) assert.deepEqual(expected.clauseState[name], input.clauseState[name], 'Caller state changed: ' + name);
  assert.deepEqual(expected.embedded.values, input.embedded.values, 'Word2 modifies later-stage embedded values');
  if (input.origin !== 'clause') assert.equal(expected.clauseBufferHex, input.clauseBufferHex, 'Word2 modifies unrelated clause backing');
  return { id: fixture.id, status: 'exact', origin: input.origin, phonemes: row.phonemes.length,
    initialRows: input.phonemeList2.count, finalRows: expected.phonemeList2.count };
}
function runtimeFiles() {
  const files = new Set();
  function visit(name) {
    if (files.has(name)) return; files.add(name);
    const text = readFileSync(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) if (match[1].startsWith('.')) visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
  }
  visit('src/core/word-to-phonemes.js'); visit('src/core/word-services.js'); visit('src/core/phoneme-list.js');
  for (const name of ['tools/compare/word2.mjs', 'data/phonemizer/profile.js', 'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'build/oracle/espeak-ng-data/phontab']) files.add(name);
  return [...files].sort().map(name => ({ path: name, sha256: sha256(readFileSync(path.join(root, name))) }));
}
export function verifyWord2({ observerDirectory = 'artifacts/oracle-clause-word2-2pOOA5', directory } = {}) {
  observerDirectory = path.resolve(root, observerDirectory);
  const evidence = collectWord2Fixtures(observerDirectory), build = validateClauseWord2Build(), files = runtimeFiles();
  assert.equal(evidence.report.fingerprint, build.fingerprint);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/word2-differential-')); }
  mkdirSync(directory, { recursive: true }); const results = []; let active;
  try {
    for (const fixture of evidence.fixtures) { active = fixture; results.push(replayWord2(fixture)); }
    assert.deepEqual(runtimeFiles(), files, 'Runtime changed during differential');
    assert.deepEqual(collectWord2Fixtures(observerDirectory).files, evidence.files, 'Observer artifacts changed during differential');
    assert.deepEqual(validateClauseWord2Build(), build);
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active, completed: results.length, files,
      observerFingerprint: build.fingerprint, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory; throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Original CLI Word2 boundary replays with complete backing, actual previous WORD_TAB rows, active list and exposed mutable state; undefined wordstress excluded',
    exactCases: results.length, unsupportedCases: 0, origins: Object.fromEntries(['clause', 'number-split', 'spell-retry'].map(origin => [origin, results.filter(row => row.origin === origin).length])),
    observerDirectory: path.relative(root, observerDirectory), observerFingerprint: build.fingerprint, observerFiles: evidence.files, files, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/word2.mjs [observer-directory]');
  console.log(JSON.stringify(verifyWord2({ observerDirectory: process.argv[2] }), null, 2));
}
