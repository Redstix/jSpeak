import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createTokenizerOracle } from '../oracle/tokenizer.mjs';
import { createClauseReader } from '../../src/core/read-clause.js';
import { createClauseTokenizer } from '../../src/core/tokenize-clause.js';
import { TEXT_CHARACTER_PROFILE } from '../../src/core/text-character.js';
import { EMBEDDED_DEFAULTS } from '../../src/core/embedded.js';
import { makeTokenizerCorpus } from './tokenizer-corpus.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createReadClauseDictionary } from './character-name-services.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const scanFields = ['sourceIndex', 'sourceIndexWord', 'finished', 'wordFlags', 'nextWordFlags'];
const readFields = ['startCharacter', 'startWord', 'sourceHex', 'charixTop', 'charix', 'terminator', 'tone'];
const wordFields = ['flags', 'start', 'prePause', 'sourceix', 'length'];
const embeddedFields = ['embeddedIx', 'embeddedRead', 'list', 'optionSayas2', 'countSayasDigits', 'wordEmphasis', 'optionSayas', 'optionEmphasis', 'pendingCount'];
function keys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields`);
}
function integer(value, lo, hi, label) { assert(Number.isInteger(value) && value >= lo && value <= hi, `Invalid ${label}`); }
function hex(value, label) { assert(typeof value === 'string' && /^(?:[0-9a-f]{2})*$/.test(value), `Invalid ${label}`); }
const select = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));

export function checkTokenizerProfile(profile, reference) {
  assert.deepEqual(profile, {
    voice: 'en-us', inputEncoding: 'UTF-8', capacity: 800, randomSeed: 1,
    options: { ssml: 0, phonemeInput: 256, endPause: 4096, capitals: 0, punctuation: 0, lineLength: 0, sayas: 0, silence: 0, speed: 175, pitch: 50, amplitude: 100 },
    translator: { name: 25966, phonemeTable: 80, dictCondition: 72, numbers: 16779328, lowercaseSentence: false,
      letterBitsOffset: 0, toneNumbers: 0, decimalSeparator: 46, thousandsSeparator: 44, dotlessI: 0,
      charsIgnore: [[173, 1], [8204, 1]], punctWithinWord: [39], charPlusApostrophe: [], replaceCharsPresent: true },
    embedded: { capacity: 250, defaults: [...EMBEDDED_DEFAULTS], constants: {
      CTRL_EMBEDDED: 1, SAYAS_CHARS: 18, SAYAS_GLYPHS: 19, SAYAS_SINGLE_CHARS: 20, SAYAS_KEY: 36, SAYAS_DIGITS: 64, SAYAS_DIGITS1: 193,
      EMBED_P: 1, EMBED_S: 2, EMBED_A: 3, EMBED_R: 4, EMBED_H: 5, EMBED_T: 6, EMBED_I: 7, EMBED_S2: 8, EMBED_Y: 9, EMBED_M: 10, EMBED_U: 11, EMBED_B: 12, EMBED_F: 13
    } }
  }, 'Tokenizer C initial profile differs from implemented profile');
  const manifest = JSON.parse(readFileSync(path.join(root, 'data/text/manifest.json'), 'utf8'));
  assert.equal(manifest.upstreamCommit, reference.upstreamCommit);
  assert.equal(manifest.reference.dataFingerprint, reference.dataFingerprint);
  assert.equal(manifest.moduleSha256, sha256(readFileSync(path.join(root, 'data/text/tables.js'))));
  assert.deepEqual(manifest.profile, TEXT_CHARACTER_PROFILE);
}

export function validateTokenizerEnvelope(value) {
  keys(value, ['schemaVersion', 'reference', 'request', 'profile', 'status', 'diagnostic', 'readClause', 'words', 'state', 'embeddedStateBefore', 'embeddedStateAfter', 'controlState', 'scans', 'translations', 'splits', 'alphabets'], 'tokenizer envelope');
  assert.equal(value.schemaVersion, 1);
  keys(value.reference, ['upstreamCommit', 'helperFingerprint', 'dataFingerprint', 'profile'], 'reference');
  assert.match(value.reference.upstreamCommit, /^[0-9a-f]{40}$/);
  for (const field of ['helperFingerprint', 'dataFingerprint']) assert.match(value.reference[field], /^[0-9a-f]{64}$/);
  assert.equal(value.reference.profile, 'first-clause-tokenizer-en-us-v1');
  keys(value.request, ['utf8Hex', 'scans', 'translations', 'splits', 'alphabets'], 'request');
  hex(value.request.utf8Hex, 'input bytes');
  for (const field of ['scans', 'translations', 'splits', 'alphabets']) {
    assert.deepEqual(value.request[field], []); assert.deepEqual(value[field], []);
  }
  if (value.status === 'undefined-upstream-behavior') {
    keys(value.diagnostic, ['code', 'source', 'line', 'column', 'index', 'arrayType'], 'upstream diagnostic');
    assert.equal(value.diagnostic.code, 'TOKENIZER_BOUNDS_UNDEFINED');
    assert.equal(value.diagnostic.source, 'src/libespeak-ng/translate.c');
    integer(value.diagnostic.line, 1, 100000, 'diagnostic line');
    integer(value.diagnostic.column, 1, 10000, 'diagnostic column');
    integer(value.diagnostic.index, 0, 0xffffffff, 'diagnostic index');
    assert.equal(typeof value.diagnostic.arrayType, 'string');
    assert.equal(value.readClause, null); assert.equal(value.words, null); assert.equal(value.state, null);
    assert.equal(value.embeddedStateBefore, null); assert.equal(value.embeddedStateAfter, null); assert.equal(value.controlState, null);
    return value;
  }
  assert.equal(value.status, 'ok'); assert.equal(value.diagnostic, null);
  keys(value.readClause, readFields, 'ReadClause');
  assert.equal(value.readClause.startWord, 1, 'Only fresh first clause is supported');
  assert.equal(value.readClause.startCharacter, 0);
  hex(value.readClause.sourceHex, 'ReadClause sourceHex');
  assert(value.readClause.sourceHex.length <= 839 * 2, 'ReadClause source backing bounds');
  integer(value.readClause.charixTop, 0, 800, 'charixTop');
  assert(Array.isArray(value.readClause.charix) && value.readClause.charix.length === value.readClause.charixTop + 1);
  value.readClause.charix.forEach(cp => integer(cp, -32768, 32767, 'charix'));
  integer(value.readClause.terminator, 0, 0xffffffff, 'terminator'); integer(value.readClause.tone, 0, 15, 'tone');
  keys(value.words, ['bufferHex', 'items'], 'words');
  hex(value.words.bufferHex, 'tokenizer bufferHex');
  assert(value.words.bufferHex.startsWith('002020'), 'sbuf must preserve the leading NUL and two spaces');
  assert(value.words.bufferHex.length <= 799 * 2, 'sbuf exceeds defined C output bounds');
  assert(Array.isArray(value.words.items) && value.words.items.length <= 299, 'WORD_TAB count');
  for (const word of value.words.items) {
    keys(word, wordFields, 'word');
    integer(word.flags, 0, 0xffffffff, 'flags');
    integer(word.start, 0, Math.min(65535, value.words.bufferHex.length / 2), 'word start');
    integer(word.prePause, 0, 255, 'prePause'); integer(word.sourceix, 0, 65535, 'sourceix'); integer(word.length, 0, 255, 'word length');
  }
  keys(value.state, [...scanFields, 'countWords', 'countSentences', 'maxClausePause', 'clausePauseMs', 'newSentence', 'startSentence', 'terminator'], 'tokenizer state');
  for (const field of ['sourceIndex', 'sourceIndexWord', 'wordFlags', 'nextWordFlags', 'countSentences', 'maxClausePause', 'clausePauseMs', 'terminator']) integer(value.state[field], 0, 0xffffffff, field);
  for (const field of ['finished', 'newSentence', 'startSentence']) assert.equal(typeof value.state[field], 'boolean', field);
  assert.equal(value.state.countWords, 0, 'Helper must stop before word translation');
  assert.equal(value.state.newSentence, true, 'Helper must begin with a fresh InitText session');
  for (const name of ['embeddedStateBefore', 'embeddedStateAfter']) {
    const embedded = value[name]; keys(embedded, embeddedFields, name);
    integer(embedded.embeddedIx, 0, 248, 'embeddedIx'); integer(embedded.embeddedRead, 0, embedded.embeddedIx, 'embeddedRead');
    integer(embedded.pendingCount, 0, embedded.embeddedIx, 'pendingCount');
    assert(Array.isArray(embedded.list) && embedded.list.length === embedded.embeddedIx);
    embedded.list.forEach(command => integer(command, 0, 0xffffffff, 'packed command'));
    for (const field of ['optionSayas2', 'countSayasDigits', 'wordEmphasis', 'optionSayas', 'optionEmphasis']) integer(embedded[field], -0x80000000, 0x7fffffff, field);
  }
  keys(value.controlState, ['optionPunctuation', 'punctuationList'], 'ReadClause control state');
  integer(value.controlState.optionPunctuation, 0, 2, 'optionPunctuation');
  assert(Array.isArray(value.controlState.punctuationList) && value.controlState.punctuationList.length <= 59);
  value.controlState.punctuationList.forEach(cp => integer(cp, 0, 0xffffffff, 'punctuation codepoint'));
  return value;
}

export function serializeTokenizer(row) {
  assert(row.sbuf instanceof Uint8Array);
  integer(row.wordCount, 0, 299, 'JS word count');
  keys(row.words, wordFields, 'JS word columns');
  const types = { flags: Uint32Array, start: Uint16Array, prePause: Uint8Array, sourceix: Uint16Array, length: Uint8Array };
  for (const field of wordFields) assert(row.words[field] instanceof types[field] && row.words[field].length === row.wordCount, `${field} type/length`);
  keys(row.scanState, scanFields, 'JS scan state');
  return { bufferHex: Buffer.from(row.sbuf).toString('hex'), items: Array.from({ length: row.wordCount }, (_, i) => Object.fromEntries(wordFields.map(field => [field, row.words[field][i]]))) };
}

export function compareTokenizerCase(fixture, expected, { readerFactory = createClauseReader, tokenizerFactory = createClauseTokenizer } = {}) {
  validateTokenizerEnvelope(expected);
  assert.equal(expected.request.utf8Hex, fixture.utf8Hex);
  const reader = readerFactory(Buffer.from(fixture.utf8Hex, 'hex'));
  const tokenizer = tokenizerFactory();
  let clause, row;
  try { clause = reader.next(); }
  catch (error) {
    assert.equal(expected.status, 'ok', 'A C undefined case cannot be classified as a ReadClause gap');
    if (error.name !== 'UnsupportedReadClauseError' || error.code !== 'READ_CLAUSE_UNSUPPORTED' || !fixture.expectedReadClauseUnsupported) throw error;
    assert.deepEqual(select(error, ['reason', 'codepoint', 'clauseIndex']), fixture.expectedReadClauseUnsupported, 'ReadClause gap changed from reviewed fixed-input exception');
    assert.equal(error.clauseIndex, 0); assert.equal(reader.hasMore(), false);
    assert.throws(() => reader.next(), again => again === error);
    return { id: fixture.id, status: 'unsupported-read-clause', reason: error.reason, codepoint: error.codepoint };
  }
  if (expected.status === 'ok') {
    const actualRead = { startCharacter: clause.startCharacter, startWord: 1, sourceHex: Buffer.from(clause.source).toString('hex'),
      charixTop: clause.charixTop, charix: Array.from(clause.charix), terminator: clause.terminator, tone: clause.tone };
    // startWord=1 is the independently defined fresh caller initial value, not C-derived state.
    assert.equal(clause.index, 0);
    assert.deepEqual(actualRead, expected.readClause, `${fixture.id} ReadClause boundary`);
    assert.deepEqual(reader.controlState(), expected.controlState, `${fixture.id} ReadClause control state`);
  }
  try { row = tokenizer.tokenize(clause); }
  catch (error) {
    if (expected.status === 'undefined-upstream-behavior') {
      assert.equal(fixture.expectedUndefined, true, 'Unexpected C undefined-behavior case');
      assert.equal(error.name, 'UnsupportedTokenizerError'); assert.equal(error.code, 'TOKENIZER_UNSUPPORTED');
      assert.equal(error.reason, 'output-capacity-overflow');
      assert.equal(expected.diagnostic.arrayType, 'char [800]'); assert(expected.diagnostic.index >= 800);
      assert.throws(() => tokenizer.tokenize(clause), again => again === error);
      return { id: fixture.id, status: 'undefined-upstream-behavior', diagnostic: expected.diagnostic, jsRejection: error.reason };
    }
    if (error.name !== 'UnsupportedTokenizerError' || error.code !== 'TOKENIZER_UNSUPPORTED' || !fixture.allowedTokenizerUnsupported.includes(error.reason)) throw error;
    assert.throws(() => tokenizer.tokenize(clause), again => again === error);
    return { id: fixture.id, status: 'unsupported-tokenizer', reason: error.reason, codepoint: error.codepoint };
  }
  assert.equal(expected.status, 'ok', 'JS accepted a C undefined-behavior boundary');
  assert.equal(fixture.expectedUndefined, false, 'Required upstream undefined case unexpectedly became defined');
  assert.deepEqual(serializeTokenizer(row), expected.words, `${fixture.id} words boundary`);
  assert.deepEqual(row.scanState, select(expected.state, scanFields), `${fixture.id} tokenizer local state`);
  assert.deepEqual(row.embeddedStateBefore, expected.embeddedStateBefore, `${fixture.id} embedded initial state`);
  assert.deepEqual(row.embeddedStateAfter, expected.embeddedStateAfter, `${fixture.id} embedded final state`);
  assert.deepEqual(row.stateBefore, { ignoreNextN: 0 });
  assert.deepEqual(row.stateAfter, { ignoreNextN: 0 }); // fixed en from-patterns are one codepoint
  return { id: fixture.id, status: 'exact', wordCount: row.wordCount };
}

function sourceSnapshot() {
  const files = ['src/core/read-clause.js', 'src/core/tokenize-clause.js', 'src/core/unicode.js', 'src/core/clause-type.js',
    'src/core/utf8-scan.js', 'src/core/text-character.js', 'src/core/embedded.js', 'data/unicode/manifest.json', 'data/unicode/tables.js',
    'data/clause/manifest.json', 'data/clause/properties.js', 'data/text/manifest.json', 'data/text/tables.js',
    'tools/compare/tokenizer.mjs', 'tools/compare/tokenizer-corpus.mjs', 'tools/compare/clause-corpus.mjs', 'tools/compare/clause-exceptions.json',
    'tools/oracle/tokenizer.mjs', 'tools/oracle/tokenizer-build-info.mjs', 'tools/oracle/trace-build-info.mjs', 'tools/oracle/corpus.json',
    'tools/compare/character-name-services.mjs', 'src/core/dictionary.js', 'src/core/letter-accent.js', 'src/core/word-stress.js',
    'src/core/character-names.js', 'src/core/phoneme-table.js', 'src/data/binary.js', 'data/dictionary/en_dict.bin',
    'src/core/text-services.js', 'src/core/letter-names.js', 'src/core/dictionary-rules.js', 'data/rules/profile.js',
    'data/dictionary/manifest.json', 'data/dictionary/profile.js', 'data/accent/tables.js', 'data/stress/profile.js', 'build/oracle/espeak-ng-data/phontab'];
  return runtimeSnapshot(['src/core/read-clause.js', 'src/core/tokenize-clause.js', 'src/core/word-services.js'], files);
}

export function verifyTokenizer({ seed = 0x5eedc102, fuzzCases = 128, directory } = {}) {
  const fixtures = makeTokenizerCorpus({ seed, fuzzCases });
  const oracle = createTokenizerOracle();
  const baselineRequest = { utf8Hex: '4869' };
  const baseline = validateTokenizerEnvelope(oracle(baselineRequest));
  checkTokenizerProfile(baseline.profile, baseline.reference);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/tokenizer-differential-')); }
  mkdirSync(directory, { recursive: true });
  const requests = JSON.stringify({ schemaVersion: 1, seed, fuzzCases, fixtures }, null, 2) + '\n';
  const provenance = { reference: baseline.reference, profile: baseline.profile, files: sourceSnapshot() };
  writeFileSync(path.join(directory, 'requests.json'), requests);
  writeFileSync(path.join(directory, 'oracle.jsonl'), '');
  const results = [];
  let active = null;
  try {
    for (const fixture of fixtures) {
      active = fixture;
      const expected = validateTokenizerEnvelope(oracle({ utf8Hex: fixture.utf8Hex }));
      assert.deepEqual(expected.reference, baseline.reference); assert.deepEqual(expected.profile, baseline.profile);
      appendFileSync(path.join(directory, 'oracle.jsonl'), JSON.stringify({ id: fixture.id, result: expected }) + '\n');
      results.push(compareTokenizerCase(fixture, expected, { readerFactory: bytes => createClauseReader(bytes, { dictionary: createReadClauseDictionary() }) }));
    }
    assert.deepEqual(sourceSnapshot(), provenance.files, 'JS/runtime data or comparison files changed during differential run');
    assert.deepEqual(createTokenizerOracle()(baselineRequest), baseline, 'C helper/reference changed during differential run');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', ...provenance, active,
      completedCases: results.length, error: error.stack, actual: error.actual ?? null, expected: error.expected ?? null }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + path.join(directory, 'failure.json'); throw error;
  }
  const gaps = results.filter(row => row.status.startsWith('unsupported-'));
  const undefinedCases = results.filter(row => row.status === 'undefined-upstream-behavior');
  const report = { schemaVersion: 1, status: 'passed-supported-slice', scope: 'M02.2 fresh first-clause ReadClause + tokenizer words, local state and embedded/control state; no word translation',
    coverageComplete: false, seed, fuzzCases, totalCases: results.length, exactCases: results.filter(row => row.status === 'exact').length,
    comparedWords: results.reduce((sum, row) => sum + (row.wordCount || 0), 0), unsupportedCases: gaps.length, unsupported: gaps,
    upstreamUndefinedCases: undefinedCases.length, upstreamUndefined: undefinedCases,
    comparedStateFields: scanFields, comparedEmbeddedFields: embeddedFields, comparedControlFields: ['optionPunctuation', 'punctuationList'],
    observedOnlyCallerFields: ['countWords', 'countSentences', 'maxClausePause', 'clausePauseMs', 'newSentence', 'startSentence', 'terminator'],
    requestsSha256: sha256(requests), ...provenance, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/compare/tokenizer.mjs');
  console.log(JSON.stringify(verifyTokenizer(), null, 2));
}
