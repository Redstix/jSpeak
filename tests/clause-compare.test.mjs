import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeClauseCorpus } from '../tools/compare/clause-corpus.mjs';
import { compareClauseCase, validateClauseRecords, serializeClause, checkClauseProfile } from '../tools/compare/clause.mjs';
import { createClauseReader } from '../src/core/read-clause.js';
import { createClauseOracle } from '../tools/oracle/clause.mjs';
import { clauseBinary } from '../tools/oracle/clause-build-info.mjs';

const available = existsSync(clauseBinary);
const options = { skip: available ? false : 'Build independent C helper with node tools/oracle/clause-build.mjs; full differential is tools/compare/clause.mjs' };
const oracle = available ? createClauseOracle() : null;
const fixture = value => ({ id: 'contract', utf8Hex: Buffer.from(value).toString('hex'), maxClauses: 128, expectedUnsupported: null });

test('clause corpus retains original cases, raw byte coverage and deterministic seed', () => {
  const corpus = makeClauseCorpus({ fuzzCases: 2 });
  assert.deepEqual(makeClauseCorpus({ fuzzCases: 2 }), corpus);
  assert.equal(corpus.filter(c => c.id.startsWith('smoke-')).length, 22);
  assert.equal(corpus.filter(c => c.id.startsWith('lead-')).length, 256);
  assert.equal(new Set(corpus.map(c => c.id)).size, corpus.length);
  assert.equal(corpus.find(c => c.id === 'smoke-004').expectedUnsupported.reason, 'punctuation-name-dictionary');
  assert(corpus.some(c => c.utf8Hex === 'eda080'));
  for (const settings of [{ seed: -1 }, { seed: 0x100000000 }, { fuzzCases: 4097 }, { fuzzCases: 1.2 }]) assert.throws(() => makeClauseCorpus(settings));
});
test('clause differential compares first and subsequent returned clauses including delayed EOF', options, () => {
  const input = fixture('Hello world. Next.');
  const expected = oracle(inputRequest(input));
  checkClauseProfile(expected.profile);
  assert.equal(expected.clauses.length, 3);
  assert.equal(expected.clauses[1].stateAfter.decoderEof, true);
  assert.equal(expected.clauses[1].terminator & 0x10000, 0);
  assert.deepEqual(compareClauseCase(input, expected.clauses), { id: 'contract', status: 'exact', comparedClauses: 3, reachedEof: true });
});
function inputRequest(input) { return { utf8Hex: input.utf8Hex, maxClauses: input.maxClauses }; }
test('clause comparator rejects field mutations, unknown fields and premature records', options, () => {
  const input = fixture('Hello world. Next.');
  const expected = oracle(inputRequest(input)).clauses;
  const mutants = [
    rows => rows[0].sourceHex = '20',
    rows => rows[0].charix[1]++,
    rows => rows[0].terminator++,
    rows => rows[0].tone = 1,
    rows => rows[0].stateAfter.decoderPeek++,
    rows => rows[0].unexpected = 0,
    rows => rows[0].stateBefore.unexpected = 0,
    rows => rows[0].charix.pop(),
    rows => rows.pop(),
  ];
  for (const mutate of mutants) {
    const rows = structuredClone(expected); mutate(rows);
    assert.throws(() => compareClauseCase(input, rows));
  }
  assert.throws(() => validateClauseRecords([], 128));
  assert.throws(() => serializeClause({ source: [], charix: [], voiceChange: [] }));
});
test('clause coverage gaps preserve exact prefix and never absorb unexpected or infrastructure errors', options, () => {
  const input = { ...fixture('Hello. Wait... what?'), expectedUnsupported: { reason: 'punctuation-name-dictionary', codepoint: 0x2026, clauseIndex: 1 } };
  const expected = oracle(inputRequest(input)).clauses;
  const result = compareClauseCase(input, expected);
  assert.equal(result.status, 'unsupported'); assert.equal(result.comparedClauses, 1);
  assert.equal(result.clauseIndex, 1); assert.equal(result.reason, 'punctuation-name-dictionary');
  assert.throws(() => compareClauseCase({ ...input, expectedUnsupported: null }, expected));
  const malformed = structuredClone(expected); malformed[1].charix = [];
  assert.throws(() => compareClauseCase(input, malformed));
  const infrastructureError = new Error('C process timeout');
  assert.throws(() => compareClauseCase(input, expected, () => { throw infrastructureError; }), error => error === infrastructureError);
  const rows = structuredClone(expected); rows[0].sourceHex = '20';
  assert.throws(() => compareClauseCase(input, rows));
});
test('unsupported allowance cannot hide a spurious rejection of ordinary text', options, () => {
  const input = { ...fixture('Plain text.'), expectedUnsupported: { reason: 'punctuation-name-dictionary', codepoint: 0x2026, clauseIndex: 0 } };
  const expected = oracle(inputRequest(input)).clauses;
  for (const codepoint of [65, 0x2026]) {
    const fake = () => {
      let fault;
      return { hasMore: () => !fault, next() {
        throw fault ||= Object.assign(new Error('test-only injected unsupported'), { name: 'UnsupportedReadClauseError', code: 'READ_CLAUSE_UNSUPPORTED', reason: 'punctuation-name-dictionary', codepoint, clauseIndex: 0 });
      } };
    };
    assert.throws(() => compareClauseCase(input, expected, fake));
  }
});
test('clause comparator verifies error snapshots and distinguishes bounded prefix from EOF', options, () => {
  const input = { ...fixture('Hello world. Next.'), maxClauses: 1 };
  const expected = oracle(inputRequest(input)).clauses;
  assert.equal(compareClauseCase(input, expected).reachedEof, false);
  const gap = { ...fixture('Wait... what?'), expectedUnsupported: { reason: 'punctuation-name-dictionary', codepoint: 0x2026, clauseIndex: 0 } };
  const gapExpected = oracle(inputRequest(gap)).clauses;
  const staleState = bytes => {
    const reader = createClauseReader(bytes);
    return { ...reader, next() { try { return reader.next(); } catch (error) { error.state.decoderOffset++; throw error; } } };
  };
  assert.throws(() => compareClauseCase(gap, gapExpected, staleState));
});
test('clause harness does not accept a reader that truncates at decoder EOF or leaks fields', options, () => {
  const input = fixture('Hello world. Next.');
  const expected = oracle(inputRequest(input)).clauses;
  const premature = bytes => {
    const reader = createClauseReader(bytes);
    return { ...reader, hasMore: () => reader.hasMore() && !reader.state().decoderEof };
  };
  assert.throws(() => compareClauseCase(input, expected, premature));
  const extra = bytes => {
    const reader = createClauseReader(bytes);
    return { ...reader, next: () => ({ ...reader.next(), injected: 123 }) };
  };
  assert.throws(() => compareClauseCase(input, expected, extra));
});
