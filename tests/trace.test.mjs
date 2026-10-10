import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareTraces, validateTrace } from '../tools/compare/trace.mjs';
import { makeTraceCorpus } from '../tools/oracle/trace-corpus.mjs';

function fixture() {
  return {
    schemaVersion: 1, stage: 'frontend-observations-v1', caseId: 'hello',
    reference: { upstreamCommit: 'a'.repeat(40), buildFingerprint: 'b'.repeat(64), dataFingerprint: 'c'.repeat(64), observationPatchSha256: 'd'.repeat(64), profile: { voice: 'en-us', speed: 175, pitch: 50, amplitude: 100, inputEncoding: 'UTF-8', randomSeed: 1 } },
    input: { utf8Hex: '61' }, initialState: { process: 'fresh-cli', randomSeed: 1 },
    events: [{ seq: 0, kind: 'decode', codepoint: 97, remainingBefore: 2, consumedBytes: 1 }],
    finalState: { eventCount: 1, clauseCount: 0 }
  };
}
test('trace compares semantic fields irrespective of JSON key ordering', () => {
  const a = fixture(); const b = JSON.parse(JSON.stringify(a));
  b.events[0] = { consumedBytes: 1, kind: 'decode', remainingBefore: 2, codepoint: 97, seq: 0 };
  assert.deepEqual(compareTraces(a, b), { equal: true });
  b.events[0].codepoint = 98; b.events[0].consumedBytes = 0;
  assert.equal(compareTraces(b, a).path, '$.events[0].codepoint');
});
test('trace reports first semantic difference, including length without alignment', () => {
  const a = fixture(); const b = fixture(); b.events[0].codepoint = 98;
  assert.deepEqual(compareTraces(a, b), { equal: false, kind: 'semantic', path: '$.events[0].codepoint', expected: 97, actual: 98 });
  b.events = []; b.finalState.eventCount = 0;
  assert.equal(compareTraces(a, b).path, '$.events.length');
});
test('valid traces with different event shapes report kind despite reordered object keys', () => {
  const expected = fixture(); const actual = fixture();
  const decode = actual.events[0];
  const clause = { charix: [0], sourceHex: '61', charixTop: 0, startCharacter: 0, startWord: 1, terminator: 0, tone: 0, seq: 0, kind: 'clause' };
  const words = { items: [], bufferHex: '002020', seq: 1, kind: 'words' };
  const phones = { items: [], initialTable: 3, postPauseMs: 10, startSentence: true, seq: 2, kind: 'phonemes-before-list' };
  expected.events = [clause, words, phones]; expected.finalState = { eventCount: 3, clauseCount: 1 };
  actual.events = [decode, { ...clause, seq: 1 }, { ...words, seq: 2 }, { ...phones, seq: 3 }]; actual.finalState = { eventCount: 4, clauseCount: 1 };
  const result = compareTraces(expected, actual);
  assert.deepEqual(result, { equal: false, kind: 'semantic', path: '$.events[0].kind', expected: 'clause', actual: 'decode' });
  assert.equal(compareTraces(actual, expected).path, '$.events[0].kind');
});
test('trace refuses incompatible metadata before comparing event values', () => {
  for (const key of ['upstreamCommit', 'buildFingerprint', 'dataFingerprint', 'observationPatchSha256']) {
    const a = fixture(); const b = fixture(); b.reference[key] = 'f'.repeat(b.reference[key].length); b.events[0].codepoint = 98;
    assert.equal(compareTraces(a, b).kind, 'incompatible');
    assert.equal(compareTraces(a, b).path, '$.reference.' + key);
  }
});
test('trace rejects unknown fields, event kinds, schemas, profile, widths, NaN and sequence corruption', () => {
  const corruptions = [t => t.extra = 1, t => t.reference.extra = 1, t => t.schemaVersion++, t => t.stage = 'other', t => t.reference.profile.voice = 'en', t => t.events[0].extra = 1, t => t.events[0].kind = 'unknown', t => t.events[0].seq = 1, t => t.events[0].codepoint = -1, t => t.events[0].codepoint = 2 ** 32, t => t.events[0].codepoint = NaN, t => t.events[0].consumedBytes = 3, t => t.input.utf8Hex = 'abc', t => t.finalState.clauseCount = 1];
  for (const mutate of corruptions) { const value = fixture(); mutate(value); assert.throws(() => validateTrace(value)); }
});
test('trace rejects truncated clauses and inconsistent phoneme table identity', () => {
  const t = fixture();
  t.events.push({ seq: 1, kind: 'clause', startCharacter: 0, startWord: 1, terminator: 0, tone: 0, charixTop: 0, sourceHex: '61', charix: [0] });
  t.finalState = { eventCount: 2, clauseCount: 1 }; assert.throws(() => validateTrace(t), /incomplete final clause/);
  t.events.push({ seq: 2, kind: 'words', bufferHex: '206120', items: [{ flags: 0, start: 1, prePause: 0, sourceix: 0, length: 1 }] });
  t.events.push({ seq: 3, kind: 'phonemes-before-list', initialTable: 3, postPauseMs: 10, startSentence: true, items: [{ table: 4, code: 1, stress: 0, sourceix: 1, synthflags: 0, switchTo: -1 }] });
  t.finalState.eventCount = 4; assert.throws(() => validateTrace(t), /table chain/);
  t.events[3].items[0].table = 3; validateTrace(t);
});
test('comparator command fails for a deliberate candidate mismatch and invalid trace', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jspeak-trace-test-'));
  try {
    const a = path.join(directory, 'expected.json'), b = path.join(directory, 'candidate.json');
    const candidate = fixture(); candidate.events[0].codepoint++;
    writeFileSync(a, JSON.stringify(fixture())); writeFileSync(b, JSON.stringify(candidate));
    const command = path.resolve('tools/compare/trace.mjs');
    const mismatch = spawnSync(process.execPath, [command, a, b], { encoding: 'utf8' });
    assert.equal(mismatch.status, 1); assert.equal(JSON.parse(mismatch.stdout).kind, 'semantic');
    candidate.events[0].codepoint = -1; writeFileSync(b, JSON.stringify(candidate));
    assert.equal(spawnSync(process.execPath, [command, a, b]).status, 2);
  } finally { rmSync(directory, { recursive: true }); }
});
test('fixed-seed semantic corpus is reproducible, bounded and seed-sensitive', () => {
  assert.deepEqual(makeTraceCorpus(123, 10), makeTraceCorpus(123, 10));
  assert.notDeepEqual(makeTraceCorpus(123, 10), makeTraceCorpus(124, 10));
  assert.equal(makeTraceCorpus(123, 10).length, 44);
  assert.throws(() => makeTraceCorpus(-1, 10)); assert.throws(() => makeTraceCorpus(1, 1001));
});
