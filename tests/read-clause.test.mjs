import test from 'node:test';
import assert from 'node:assert/strict';
import { createClauseReader, READ_CLAUSE_PROFILE } from '../src/core/read-clause.js';
import { CLAUSE } from '../src/core/clause-type.js';

const input = text => Uint8Array.from(Buffer.from(text, 'utf8'));
const textOf = row => Buffer.from(row.source).toString('utf8');
function readAll(text) {
  const reader = createClauseReader(input(text)); const rows = [];
  while (reader.hasMore()) { assert.ok(rows.length < 1000, 'bounded test reader'); rows.push(reader.next()); }
  return rows;
}

test('fixed new-session Hello world boundary matches C output and count_characters=-1', () => {
  const reader = createClauseReader(input('Hello world'));
  const row = reader.next();
  assert.equal(textOf(row), 'Hello world '); assert.equal(row.terminator, CLAUSE.EOF);
  assert.deepEqual(Array.from(row.charix), [0, 1, 2, 3, 4, 5, 0, 7, 8, 9, 10, 11]);
  assert.equal(row.charixTop, 11); assert.equal(row.startCharacter, 0); assert.equal(row.index, 0);
  assert.deepEqual(row.stateBefore, { decoderOffset: 0, decoderRemaining: 12, decoderEof: false, decoderPeek: 72,
    logicalEof: false, countCharacters: -1, clauseUpperCount: 0, clauseLowerCount: 0, phonemesRepeatCount: null });
  assert.deepEqual(row.stateAfter, { decoderOffset: 12, decoderRemaining: 0, decoderEof: true, decoderPeek: 0,
    logicalEof: true, countCharacters: 11, clauseUpperCount: 1, clauseLowerCount: 9, phonemesRepeatCount: 0 });
  assert.equal(reader.hasMore(), false); assert.throws(() => reader.next(), /CLAUSE_EOF/);
});

test('lookahead/unget preserves next clause without counting the first character twice', () => {
  const rows = readAll('One. Two.');
  assert.deepEqual(rows.map(textOf), ['One ', 'Two ', ' ']);
  assert.deepEqual(rows.map(row => row.startCharacter), [0, 5, 9]);
  assert.deepEqual(rows.map(row => row.terminator), [CLAUSE.PERIOD | CLAUSE.DOT_AFTER_LAST_WORD, CLAUSE.PERIOD | CLAUSE.DOT_AFTER_LAST_WORD, CLAUSE.EOF]);
  assert.equal(rows[0].stateAfter.decoderOffset, 6);
  assert.equal(rows[0].stateAfter.decoderPeek, 119); // decoder at w, logical next is saved T
  assert.deepEqual(rows[1].stateBefore, rows[0].stateAfter);
  assert.deepEqual(Array.from(rows[1].charix), [0, 1, 2, 3]);
  assert.equal(rows[2].stateAfter.countCharacters, 9); // final EOF-only call consumes nothing
});

test('multibyte charix uses byte-end indices, continuation -1, spaces/brackets stay zero', () => {
  const row = readAll('aé你😀')[0];
  assert.equal(textOf(row), 'aé你😀 '); assert.equal(row.charixTop, 10);
  assert.deepEqual(Array.from(row.charix), [0, 1, -1, 2, -1, -1, 3, -1, -1, -1, 4]);
  assert.deepEqual(Array.from(readAll('a (B)')[0].charix), [0, 1, 0, 0, 4, 0]);
});

test('default ignored characters preserve original count gaps and keep ZWJ', () => {
  const row = readAll('a\u00adb\u200cc\u200dd')[0];
  assert.equal(textOf(row), 'abc\u200dd ');
  assert.deepEqual(Array.from(row.charix), [0, 1, 3, 5, -1, -1, 6, 7]);
  assert.equal(row.stateAfter.countCharacters, 7);
  assert.equal(row.stateAfter.clauseLowerCount, 4);
});

test('paragraph consumption, lowercase abbreviation and decimal punctuation follow C', () => {
  const rows = readAll('a\n\nb');
  assert.deepEqual(rows.map(textOf), ['a ', 'b ']);
  assert.equal(rows[0].terminator, CLAUSE.PARAGRAPH); assert.equal(rows[1].startCharacter, 3);
  assert.deepEqual(readAll('lower. next').map(textOf), ['lower. next ']);
  assert.deepEqual(readAll('u.s.a.\'s next').map(textOf), ["u.s.a.'s next "]);
  assert.deepEqual(readAll('1.23 45.').map(textOf), ['1.23 45 ', ' ']);
  assert.equal(readAll('a\n\n\n\n\nb')[0].terminator, CLAUSE.PARAGRAPH + 60);
});

test('Armenian in-word punctuation preserves tone and inserts the upstream emphasis marker', () => {
  const row = readAll('Հայե՞րեն ա')[0];
  assert.equal(Buffer.from(row.source).toString('hex'), 'd580d5a1d5b5d5a5d680d5a5d5b6d4b020d5a120');
  assert.equal(row.tone, 2); assert.equal(row.terminator, CLAUSE.EOF);
  assert.equal(row.stateAfter.clauseUpperCount, 1); assert.equal(row.stateAfter.clauseLowerCount, 7);
  assert.deepEqual(Array.from(row.charix), [0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 6, -1, 7, -1, 8, -1, 9, 0, -1, 10]);
});

test('CLI phoneme-input mode bypasses punctuation scanning only within its actual state', () => {
  const rows = readAll('[[...]] x.');
  assert.deepEqual(rows.map(textOf), ['[[...]] x ', ' ']);
  assert.equal(rows[0].terminator, CLAUSE.PERIOD | CLAUSE.DOT_AFTER_LAST_WORD);
  assert.throws(() => readAll('[[x]] ...'), error => error.code === 'READ_CLAUSE_UNSUPPORTED' && error.reason === 'punctuation-name-dictionary');
});

test('missing dictionary calls fail explicitly and poison that session', () => {
  for (const [text, reason] of [['Wait... what?', 'punctuation-name-dictionary'], ['…', 'punctuation-name-dictionary'], ['a\x01B1!', 'punctuation-name-dictionary']]) {
    const reader = createClauseReader(input(text)); let observed;
    assert.throws(() => reader.next(), error => { observed = error; return error.code === 'READ_CLAUSE_UNSUPPORTED' && error.reason === reason; });
    assert.equal(reader.hasMore(), false);
    assert.throws(() => reader.next(), error => error === observed);
    assert.equal(observed.clauseIndex, 0); assert.ok(observed.state.decoderOffset > 0);
  }
  assert.doesNotThrow(() => readAll('ok\0...\x01')); // bytes past the C-string NUL are not reachable
});

test('embedded controls pass through except the original V/B ReadClause branches', () => {
  assert.equal(textOf(readAll('a\x01+10Pword')[0]), 'a\x01+10Pword ');
  const voice = readAll('a\x01Ven-us next');
  assert.equal(textOf(voice[0]), 'a'); assert.equal(voice[0].terminator, CLAUSE.VOICE);
  assert.equal(voice[0].voiceChange.length, 0); assert.equal(textOf(voice[1]), 'next ');
  const reader = createClauseReader(input('\x01B., hello'));
  assert.equal(textOf(reader.next()), '     hello ');
  assert.deepEqual(reader.controlState(), { optionPunctuation: 2, punctuationList: [46, 44] });
  assert.equal(textOf(readAll('\x01B1hello')[0]), '   hello ');
});

test('dictionary dependency is called for ellipsis, reset per clause and shares the repeat counter', () => {
  const calls = []; let repeats = 9;
  const service = { lookupCharName(cp, only) { calls.push([cp, only]); repeats = 2; return new Uint8Array(0); },
    resetRepeat() { calls.push('reset'); repeats = 0; }, state() { return { repeatCount: repeats }; } };
  const reader = createClauseReader(input('Wait... what?'), { dictionary: service });
  assert.equal(reader.state().phonemesRepeatCount, null);
  const first = reader.next();
  assert.equal(first.stateAfter.phonemesRepeatCount, 2);
  assert.deepEqual(calls, ['reset', [8230, true]]);
  reader.next(); assert.equal(calls.filter(call => call === 'reset').length, 2);
  assert.throws(() => createClauseReader(input('x'), { dictionary: {} }), /dictionary service/);
});

test('punctuation announcement preserves deferred second lookahead and exact period lookup order', () => {
  const calls = [];
  const service = { lookupCharName(cp, only) { calls.push([cp, only]); return input('[\x02name]]'); },
    lookupSpecial(bytes) { calls.push(textOf({ source: bytes })); return input('[\x02period]]'); },
    resetRepeat() {}, state() { return { repeatCount: 0 }; } };
  const reader = createClauseReader(input('\x01B1 hi. X'), { dictionary: service });
  const first = reader.next();
  assert.equal(textOf(first), '    hi '); assert.equal(first.terminator, CLAUSE.SHORTFALL);
  assert.equal(first.charixTop, 6);
  const second = reader.next();
  assert.equal(textOf(second), ' [\x02period]]'); assert.equal(second.terminator, CLAUSE.PERIOD);
  assert.equal(second.charixTop, 0); assert.deepEqual(Array.from(second.charix), [0]);
  assert.deepEqual(calls, ['_.p', '_.p']);
  assert.equal(textOf(reader.next()), ' X ');
});

test('repeated nonterminal punctuation keeps embedded speed brackets and numeric count', () => {
  const service = { lookupCharName() { return input('[\x02slash]]'); }, resetRepeat() {}, state() { return { repeatCount: 0 }; } };
  const read = count => textOf(createClauseReader(input('\x01B1 a' + '/'.repeat(count) + 'b'), { dictionary: service }).next());
  assert.equal(read(1), '    a [\x02slash]] b ');
  assert.equal(read(2), '    a\x01+10S [\x02slash]] [\x02slash]] \x01-10S b ');
  assert.equal(read(3), '    a\x01+10S [\x02slash]] [\x02slash]] [\x02slash]] \x01-10S b ');
  assert.equal(read(12), '    a [\x02slash]] 12 [\x02slash]] b ');
});

test('missing character rules are explicit while unrelated service failures remain failures', () => {
  const service = { lookupCharName() { throw Object.assign(new Error('rules'), { code: 'CHARACTER_NAME_UNSUPPORTED', reason: 'translate-rules-character' }); },
    resetRepeat() {}, state() { return { repeatCount: 0 }; } };
  const reader = createClauseReader(input('\x01B1 +'), { dictionary: service });
  let failure;
  assert.throws(() => reader.next(), error => { failure = error; return error.code === 'READ_CLAUSE_UNSUPPORTED' && error.reason === 'character-name-translate-rules-character' && error.codepoint === 43; });
  assert.throws(() => reader.next(), error => error === failure);
  const unexpected = new Error('unexpected service failure');
  service.lookupCharName = () => { throw unexpected; };
  assert.throws(() => createClauseReader(input('\x01B1 +'), { dictionary: service }).next(), error => error === unexpected);
});

test('capacity fallback retains complete multibyte output and supports repeated bounded clauses', () => {
  const rows = readAll('A'.repeat(795) + '😀Z');
  assert.equal(rows[0].terminator, CLAUSE.NONE); assert.equal(rows[0].charixTop, 799);
  assert.equal(rows[0].source.length, 800); assert.equal(textOf(rows[0]), 'A'.repeat(795) + '😀 ');
  assert.deepEqual(rows.slice(1).map(textOf), ['Z ']);
  const all = readAll('x'.repeat(3000));
  assert.deepEqual(all.map(row => row.charixTop), [796, 796, 796, 612]);
  assert.equal(all.map(row => textOf(row).slice(0, -1)).join(''), 'x'.repeat(3000));
});

test('BOM, empty input and embedded NUL follow direct ReadClause rather than CLI invocation policy', () => {
  const empty = readAll('')[0]; assert.equal(textOf(empty), ' '); assert.equal(empty.charixTop, 0);
  assert.deepEqual(Array.from(empty.charix), [0]); assert.equal(empty.stateAfter.countCharacters, 0);
  assert.equal(textOf(readAll('\ufeffa')[0]), '\ufeffa ');
  const nul = readAll('abc\0tail')[0]; assert.equal(textOf(nul), 'abc '); assert.equal(nul.stateAfter.decoderOffset, 4);
});

test('completed records own their buffers and independent sessions have no shared counters', () => {
  const a = createClauseReader(input('One. Two.')); const first = a.next();
  const copy = first.source.slice(); a.next(); assert.deepEqual(first.source, copy);
  const b = createClauseReader(input('z')); assert.equal(b.next().stateAfter.clauseUpperCount, 0);
  assert.equal(first.stateAfter.clauseUpperCount, 1);
});

test('profile is frozen and unsupported modes/capacity cannot be selected accidentally', () => {
  assert.equal(Object.isFrozen(READ_CLAUSE_PROFILE), true); assert.equal(Object.isFrozen(READ_CLAUSE_PROFILE.charsIgnore), true);
  for (const option of [{ capacity: 801 }, { voice: 'en-gb' }, { encoding: 'AUTO' }, { ssml: true }, { punctuation: 1 }, { phonemeInput: false }]) {
    assert.throws(() => createClauseReader(input('x'), option), /Unsupported ReadClause profile/);
  }
  assert.throws(() => createClauseReader(input('x'), 'UTF-8'), /options object/);
  assert.throws(() => createClauseReader('x'), /Uint8Array/);
  assert.doesNotThrow(() => createClauseReader(input('x'), { capacity: 800, encoding: 'UTF-8', voice: 'en-us' }));
});
