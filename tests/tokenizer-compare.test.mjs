import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTokenizerCase, validateTokenizerEnvelope } from '../tools/compare/tokenizer.mjs';

// Structural comparator fixtures use an explicit synthetic fingerprint, not a C provenance claim.
function hello() {
  return {
    schemaVersion: 1,
    reference: { upstreamCommit: 'ba90c8e9f440ad544f674a790bb5f53878b6ffc5', helperFingerprint: 'a'.repeat(64), dataFingerprint: 'b'.repeat(64), profile: 'first-clause-tokenizer-en-us-v1' },
    request: { utf8Hex: '48656c6c6f20776f726c64', scans: [], translations: [], splits: [], alphabets: [] },
    profile: {}, status: 'ok', diagnostic: null,
    embeddedStateBefore: { embeddedIx: 0, embeddedRead: 0, list: [], optionSayas2: 0, countSayasDigits: 0, wordEmphasis: 0, optionSayas: 0, optionEmphasis: 0, pendingCount: 0 },
    embeddedStateAfter: { embeddedIx: 0, embeddedRead: 0, list: [], optionSayas2: 0, countSayasDigits: 0, wordEmphasis: 0, optionSayas: 0, optionEmphasis: 0, pendingCount: 0 },
    controlState: { optionPunctuation: 0, punctuationList: [] },
    readClause: { startCharacter: 0, startWord: 1, sourceHex: '48656c6c6f20776f726c6420', charixTop: 11, charix: [0, 1, 2, 3, 4, 5, 0, 7, 8, 9, 10, 11], terminator: 589864, tone: 0 },
    words: { bufferHex: '00202068656c6c6f20776f726c6420', items: [{ flags: 514, start: 3, prePause: 0, sourceix: 1, length: 5 }, { flags: 16, start: 9, prePause: 0, sourceix: 7, length: 5 }] },
    state: { sourceIndex: 13, sourceIndexWord: 12, finished: true, wordFlags: 262144, nextWordFlags: 0, countWords: 0, countSentences: 1, maxClausePause: 400, clausePauseMs: 400, newSentence: true, startSentence: true, terminator: 589864 },
    scans: [], translations: [], splits: [], alphabets: []
  };
}
function fixture(expected = hello()) {
  return { id: 'fixture', utf8Hex: expected.request.utf8Hex, expectedReadClauseUnsupported: null, allowedTokenizerUnsupported: [], expectedUndefined: false };
}

test('tokenizer comparator verifies complete words, ReadClause and all five local state fields', () => {
  assert.deepEqual(compareTokenizerCase(fixture(), hello()), { id: 'fixture', status: 'exact', wordCount: 2 });
  for (const change of [
    value => { value.words.items[0].length++; },
    value => { value.words.bufferHex = value.words.bufferHex.replace('68', '69'); },
    value => { value.readClause.charix[1]++; },
    value => { value.state.sourceIndex++; },
    value => { value.state.finished = false; },
    value => { value.state.nextWordFlags = 1; },
    value => { value.embeddedStateAfter.optionSayas2 = 18; }
  ]) {
    const value = hello(); change(value);
    assert.throws(() => compareTokenizerCase(fixture(value), value), /boundary|local state|embedded/);
  }
});

test('unknown/missing fields and incorrect widths fail rather than loosening the stage contract', () => {
  for (const change of [
    value => { value.unknown = true; },
    value => { value.words.items[0].unknown = 0; },
    value => { delete value.state.sourceIndex; },
    value => { value.words.items[0].length = 256; },
    value => { value.state.countWords = 1; },
    value => { value.readClause.startWord = 2; },
    value => { value.request.scans = [{}]; }
  ]) {
    const value = hello(); change(value);
    assert.throws(() => validateTokenizerEnvelope(value));
  }
});

test('infrastructure and generic errors cannot become reviewed unsupported cases', () => {
  const failure = new Error('spawn failed');
  assert.throws(() => compareTokenizerCase(fixture(), hello(), { readerFactory: () => ({ next() { throw failure; } }) }), error => error === failure);
  assert.throws(() => compareTokenizerCase(fixture(), hello(), { tokenizerFactory: () => ({ tokenize() { throw failure; } }) }), error => error === failure);
});

test('a ReadClause exception requires the reviewed exact reason/codepoint/clause index', () => {
  const error = Object.assign(new Error('unsupported'), { name: 'UnsupportedReadClauseError', code: 'READ_CLAUSE_UNSUPPORTED', reason: 'embedded-command', codepoint: 1, clauseIndex: 0 });
  const readerFactory = () => ({ next() { throw error; }, hasMore() { return false; } });
  assert.throws(() => compareTokenizerCase(fixture(), hello(), { readerFactory }), candidate => candidate === error);
  const reviewed = fixture(); reviewed.expectedReadClauseUnsupported = { reason: 'embedded-command', codepoint: 1, clauseIndex: 0 };
  assert.equal(compareTokenizerCase(reviewed, hello(), { readerFactory }).status, 'unsupported-read-clause');
  reviewed.expectedReadClauseUnsupported.codepoint = 2;
  assert.throws(() => compareTokenizerCase(reviewed, hello(), { readerFactory }), /reviewed/);
});

test('C undefined behavior is a separate outcome requiring matching JS rejection', () => {
  const expected = hello(); expected.request.utf8Hex = Buffer.from('ab - ' + '한'.repeat(88)).toString('hex');
  expected.status = 'undefined-upstream-behavior'; expected.readClause = null; expected.words = null; expected.state = null;
  expected.embeddedStateBefore = null; expected.embeddedStateAfter = null; expected.controlState = null;
  expected.diagnostic = { code: 'TOKENIZER_BOUNDS_UNDEFINED', source: 'src/libespeak-ng/translate.c', line: 1652, column: 6, index: 800, arrayType: 'char [800]' };
  const entry = fixture(expected); entry.expectedUndefined = true;
  const result = compareTokenizerCase(entry, expected);
  assert.equal(result.status, 'undefined-upstream-behavior'); assert.equal(result.jsRejection, 'output-capacity-overflow');
  entry.expectedUndefined = false;
  assert.throws(() => compareTokenizerCase(entry, expected), /Unexpected C undefined/);
  expected.diagnostic.code = 'SOME_OTHER_CRASH';
  assert.throws(() => validateTokenizerEnvelope(expected));
});

test('a fake C undefined diagnosis cannot hide a normally accepted JS boundary', () => {
  const expected = hello(); expected.status = 'undefined-upstream-behavior';
  expected.readClause = null; expected.words = null; expected.state = null;
  expected.embeddedStateBefore = null; expected.embeddedStateAfter = null; expected.controlState = null;
  expected.diagnostic = { code: 'TOKENIZER_BOUNDS_UNDEFINED', source: 'src/libespeak-ng/translate.c', line: 1652, column: 6, index: 800, arrayType: 'char [800]' };
  const entry = fixture(expected); entry.expectedUndefined = true;
  assert.throws(() => compareTokenizerCase(entry, expected), /JS accepted/);
});
