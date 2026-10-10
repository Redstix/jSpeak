import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root } from '../oracle/trace-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { loadDictionary } from '../../src/core/dictionary.js';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { createEnglishClauseTranslation } from '../../src/core/translate-clause.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => Buffer.from(bytes).toString('hex');
const wordFields = ['flags', 'start', 'prePause', 'sourceix', 'length'];
const wordStateFields = ['dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast',
  'prevDictFlags0', 'prevDictFlags1', 'clauseTerminator', 'clauseEnd', 'clauseEndRelation',
  'clauseLowerCount', 'clauseUpperCount', 'prePause', 'prevLastStress', 'prepauseTimeout',
  'endStressedVowel', 'wordVowelCount', 'wordStressedCount', 'repeatCount', 'repeatHex',
  'skipWords', 'optionSayas', 'optionCapitals', 'optionToneFlags', 'phonemeTable', 'native'];

function normalizeWords(rows) {
  return rows.map(row => Object.fromEntries(wordFields.map(field => [field, row[field]])));
}

function normalizePhonemeList(list) {
  const count = list.length !== undefined ? list.length : list.count;
  const value = (name, index) => list.items ? list.items[index][name] : list[name][index];
  return Array.from({ length: count }, (_, index) => ({
    phcode: value('phcode', index),
    stresslevel: value('stresslevel', index),
    sourceix: value('sourceix', index),
    synthflags: value('synthflags', index),
    tonePh: value('phcode', index) === 21 ? value('tonePh', index) : 0,
  }));
}

function normalizeWordState(state) {
  return Object.fromEntries(wordStateFields.map(field => {
    if (field === 'repeatHex' && state.repeatHex === undefined) return [field, Buffer.from(state.repeat || new Uint8Array()).toString('hex')];
    if (field === 'clauseEnd' && state.clauseEnd === null) return [field, 0];
    return [field, state[field]];
  }));
}

function logicalBuffer(buffer, expectedHex) {
  const length = expectedHex.length / 2 - 1;
  return Buffer.from(buffer).subarray(0, length);
}

function projectExpectedClauseWords(event) {
  return {
    buffer: Buffer.from(event.bufferHex.slice(0, -2), 'hex'),
    wordCount: event.wordCount,
    words: normalizeWords(event.wordsWithSentinel),
    sourceIndex: event.sourceIndex,
    clausePause: event.clausePause,
    tone: event.tone,
    terminator: event.terminator,
    startSentence: event.newSentence2,
  };
}

function projectActualClauseWords(event, expected) {
  const tokenized = event.tokenized;
  const rows = Array.from({ length: tokenized.wordCount + 1 }, (_, index) => index < tokenized.wordCount
    ? Object.fromEntries(wordFields.map(field => [field, tokenized.words[field][index]]))
    : tokenized.sentinel);
  return {
    buffer: logicalBuffer(event.buffer, expected.bufferHex),
    wordCount: tokenized.wordCount,
    words: normalizeWords(rows),
    sourceIndex: tokenized.scanState.sourceIndex,
    clausePause: event.clausePause,
    tone: event.tone,
    terminator: event.terminator,
    startSentence: event.startSentence,
  };
}

function projectExpectedWordEnter(event) {
  return {
    origin: event.origin,
    offset: event.offset,
    remaining: event.remaining,
    wordIndex: event.wordIndex,
    prePauseArgument: event.prePauseArgument,
    words: normalizeWords(event.words),
    wordState: normalizeWordState(event.wordState),
    buffer: Buffer.from(event.bufferHex.slice(0, -2), 'hex'),
  };
}

function projectActualWordEnter(event, expected) {
  return {
    origin: event.relation,
    offset: event.offset,
    remaining: event.remaining,
    wordIndex: event.wordIndex,
    prePauseArgument: event.prePause,
    words: normalizeWords(event.words.slice(event.rowIndex, event.rowIndex + event.remaining)),
    wordState: normalizeWordState(event.state.word),
    buffer: logicalBuffer(event.buffer, expected.bufferHex),
  };
}

function projectExpectedWordExit(event) {
  return {
    flags: event.flags,
    phonemes: normalizePhonemeList(event.phonemeList2),
    wordState: normalizeWordState(event.wordState),
  };
}

function projectActualWordExit(event) {
  const list = event.list.list;
  return {
    flags: event.result.flags,
    phonemes: normalizePhonemeList(list),
    wordState: normalizeWordState(event.state.word),
  };
}

function projectExpectedFinal(event) {
  return {
    buffer: Buffer.from(event.bufferHex.slice(0, -2), 'hex'),
    wordCount: event.wordCount,
    words: normalizeWords(event.wordsWithSentinel),
    sourceIndex: event.sourceIndex,
    clausePause: event.clausePause,
    tone: event.tone,
    terminator: event.terminator,
    startSentence: event.newSentence2,
    phonemes: normalizePhonemeList(event.phonemeList2),
    wordState: normalizeWordState(event.wordState),
  };
}

function projectActualFinal(event, expected) {
  const list = event.phonemes.list;
  const rows = Array.from({ length: event.wordCount + 1 }, (_, index) => event.words[index]);
  return {
    buffer: logicalBuffer(event.buffer, expected.bufferHex),
    wordCount: event.wordCount,
    words: normalizeWords(rows),
    sourceIndex: event.sourceIndex,
    clausePause: event.clausePause,
    tone: event.tone,
    terminator: event.terminator,
    startSentence: event.startSentence,
    phonemes: normalizePhonemeList(list),
    wordState: normalizeWordState(event.state.word),
  };
}

export function verifyClauseTranslation({ observedDirectory = 'artifacts/oracle-clause-word2-2pOOA5', directory } = {}) {
  const observed = path.resolve(root, observedDirectory);
  const reportPath = path.join(observed, 'report.json');
  assert(existsSync(reportPath), 'Missing original clause Word2 observer report');
  const observedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(observedReport.status, 'passed');
  assert.equal(observedReport.cliTransparencyCases, 68);
  assert.equal(observedReport.word2Calls, 712);

  const dictionaryBytes = new Uint8Array(readFileSync(path.join(root, 'data/dictionary/en_dict.bin')));
  const dictionary = loadDictionary(dictionaryBytes, JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
  const table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(80);
  const files = runtimeSnapshot(['src/core/translate-clause.js'], [
    'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'build/oracle/espeak-ng-data/phontab',
    'tools/compare/clause-translation.mjs', path.relative(root, reportPath),
  ]);
  if (!directory) {
    mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    directory = mkdtempSync(path.join(root, 'artifacts/clause-translation-'));
  }
  mkdirSync(directory, { recursive: true });

  const results = [];
  let active = null;
  try {
    for (const capture of observedReport.captures) {
      active = capture;
      const tracePath = path.join(observed, capture.id, 'observed.jsonl');
      const expectedEvents = existsSync(tracePath)
        ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
      if (!existsSync(tracePath)) assert.equal(capture.events, 0, 'Missing original clause Word2 trace');
      const actualEvents = [];
      const input = new Uint8Array(Buffer.from(capture.utf8Hex, 'hex'));
      const engine = createEnglishClauseTranslation(input, dictionary, table, {
        trace(kind, row) { actualEvents.push({ kind, ...row }); },
      });
      while (engine.hasMore()) engine.next();

      const expectedWords = expectedEvents.filter(event => event.kind === 'clause.words');
      const actualWords = actualEvents.filter(event => event.kind === 'clause.words');
      const expectedEnters = expectedEvents.filter(event => event.kind === 'word2.enter');
      const actualEnters = actualEvents.filter(event => event.kind === 'word2.enter');
      const expectedExits = expectedEvents.filter(event => event.kind === 'word2.exit');
      const actualExits = actualEvents.filter(event => event.kind === 'word2.exit');
      const expectedFinals = expectedEvents.filter(event => event.kind === 'clause.before-phonemelist');
      const actualFinals = actualEvents.filter(event => event.kind === 'clause.before-phonemelist');

      assert.equal(actualWords.length, expectedWords.length, capture.id + ': clause.words count');
      assert.equal(actualEnters.length, expectedEnters.length, capture.id + ': word2.enter count');
      assert.equal(actualExits.length, expectedExits.length, capture.id + ': word2.exit count');
      assert.equal(actualFinals.length, expectedFinals.length, capture.id + ': final clause count');

      for (let index = 0; index < expectedWords.length; index++) {
        assert.deepEqual(projectActualClauseWords(actualWords[index], expectedWords[index]), projectExpectedClauseWords(expectedWords[index]),
          capture.id + ': clause.words ' + index);
      }
      for (let index = 0; index < expectedEnters.length; index++) {
        assert.deepEqual(projectActualWordEnter(actualEnters[index], expectedEnters[index]), projectExpectedWordEnter(expectedEnters[index]),
          capture.id + ': word2.enter ' + index);
      }
      for (let index = 0; index < expectedExits.length; index++) {
        assert.deepEqual(projectActualWordExit(actualExits[index]), projectExpectedWordExit(expectedExits[index]),
          capture.id + ': word2.exit ' + index);
      }
      for (let index = 0; index < expectedFinals.length; index++) {
        assert.deepEqual(projectActualFinal(actualFinals[index], expectedFinals[index]), projectExpectedFinal(expectedFinals[index]),
          capture.id + ': clause.before-phonemelist ' + index);
      }
      results.push({
        id: capture.id,
        status: 'exact',
        clauses: expectedFinals.length,
        word2Calls: expectedEnters.length,
        comparedPhonemes: expectedFinals.reduce((sum, event) => sum + event.phonemeList2.count, 0),
      });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/translate-clause.js'], [
      'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'build/oracle/espeak-ng-data/phontab',
      'tools/compare/clause-translation.mjs', path.relative(root, reportPath),
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({
      status: 'failed', active, completed: results.length, files, observedDirectory, error: error.stack,
      actual: error.actual, expected: error.expected,
    }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }

  const report = {
    schemaVersion: 1,
    status: 'passed-supported-slice',
    coverageComplete: false,
    scope: 'Fixed en-us original CLI clause → Word2 → pre-MakePhonemeList; semantic fields only',
    totalCases: results.length,
    exactCases: results.length,
    clauses: results.reduce((sum, row) => sum + row.clauses, 0),
    word2Calls: results.reduce((sum, row) => sum + row.word2Calls, 0),
    comparedPhonemes: results.reduce((sum, row) => sum + row.comparedPhonemes, 0),
    unsupportedCases: 0,
    observedDirectory: path.relative(root, observed),
    files,
    artifactDirectory: directory,
  };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/clause-translation.mjs [observed-directory]');
  console.log(JSON.stringify(verifyClauseTranslation({ observedDirectory: process.argv[2] }), null, 2));
}
