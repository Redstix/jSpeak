import test from 'node:test';
import assert from 'node:assert/strict';
import { createClauseReader } from '../src/core/read-clause.js';
import { createClauseTokenizer, WORD_FLAGS } from '../src/core/tokenize-clause.js';

const input = text => Uint8Array.from(Buffer.from(text));
const read = text => createClauseReader(input(text)).next();
const tokenize = text => createClauseTokenizer().tokenize(read(text));
const items = row => Array.from({ length: row.wordCount }, (_, i) => ['flags', 'start', 'prePause', 'sourceix', 'length'].map(key => row.words[key][i]));
function exact(text, buffer, rows) {
  const result = tokenize(text);
  assert.equal(Buffer.from(result.sbuf).toString('utf8'), buffer);
  assert.deepEqual(items(result), rows);
  return result;
}

// Expected bytes and WORD_TAB values come from the pinned C words boundary.
test('Hello words preserve source indices, flags, leading NUL and the final space', () => {
  const row = exact('Hello world', '\0  hello world ', [[514, 3, 0, 1, 5], [16, 9, 0, 7, 5]]);
  assert.deepEqual(row.stateBefore, { ignoreNextN: 0 });
  assert.deepEqual(row.stateAfter, { ignoreNextN: 0 });
  assert(row.words.flags instanceof Uint32Array);
  assert(row.words.start instanceof Uint16Array);
  assert(row.words.sourceix instanceof Uint16Array);
  assert(row.words.prePause instanceof Uint8Array);
  assert(row.words.length instanceof Uint8Array);
});

test('direct empty and whitespace clauses produce an empty word list, retaining sbuf prefix', () => {
  for (const text of ['', ' ', ' \t\r\n']) exact(text, '\0  ', []);
});

test('CamelCase, uppercase runs and English acronym plurals match complete C fields', () => {
  exact("fooBar XMLParser NATO MPs DVDs ABC's", '\0  foo bar xml parser nato mp dvd abc  ', [
    [512, 3, 0, 1, 3], [2, 7, 0, 4, 3], [3, 11, 0, 8, 3], [258, 15, 0, 11, 6],
    [3, 22, 0, 18, 4], [7, 27, 0, 23, 3], [262151, 30, 0, 25, 1], [262167, 34, 0, 30, 1]
  ]);
});

test('Unicode case mapping and combining marks keep byte offsets distinct from source character lengths', () => {
  exact('e\u0301 é İ ß', '\0  e\u0301 é i ß ', [
    [512, 3, 0, 1, 2], [0, 7, 0, 4, 1], [3, 10, 0, 6, 1], [16, 12, 0, 8, 1]
  ]);
});

test('real en replacement entries expand ligatures and flag only actual substitutions', () => {
  exact('æ Æ Œ ﬀ ﬃ Ά Ώ ʻ', '\0  ae ae oe ff ﬃ α ω ', [
    [2097664, 3, 0, 1, 1], [2097154, 6, 0, 3, 1], [2097154, 9, 0, 5, 1],
    [2097152, 12, 0, 7, 1], [0, 15, 0, 9, 1], [2097155, 19, 0, 11, 1], [2097171, 22, 0, 13, 1]
  ]);
});

test('Hangul recursive inserted syllables expand to Jamo without altering source lengths', () => {
  const row = tokenize('한국어 한글 ㄱ ㅎ');
  assert.equal(Buffer.from(row.sbuf).toString('hex'), '002020e18492e185a1e186abe18480e185aee186a8e185a520e18492e185a1e186abe18480e185b3e186af20e1848020e1849220');
  assert.deepEqual(items(row), [[512, 3, 0, 1, 3], [0, 25, 0, 5, 2], [0, 44, 0, 8, 1], [16, 48, 0, 10, 1]]);
});

test('emoji tokens preserve modifier/ZWJ/tag sequences and pair regional indicators', () => {
  const flag = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';
  exact('😀😀 👍🏽 🇨🇳🇺🇸🇬 👩‍👩‍👧‍👦 ' + flag,
    '\0  😀 😀 👍🏽 🇨🇳 🇺🇸 🇬 👩‍👩‍👧‍👦 ' + flag + ' ', [
      [512, 3, 0, 1, 1], [256, 8, 0, 2, 1], [0, 13, 0, 4, 2], [0, 22, 0, 7, 2],
      [256, 31, 0, 9, 2], [256, 40, 0, 11, 1], [0, 45, 0, 13, 7], [16, 71, 0, 21, 7]
    ]);
  exact('a👩‍🔬b \u200d😀 a\u200d😀', '\0  a 👩‍🔬 b \u200d 😀 a \u200d 😀 ', [
    [512, 3, 0, 1, 1], [256, 5, 0, 2, 3], [256, 17, 0, 5, 1], [0, 19, 0, 7, 1],
    [256, 23, 0, 8, 1], [0, 28, 0, 10, 1], [0, 30, 0, 11, 1], [272, 34, 0, 12, 1]
  ]);
});

test('numeric token boundaries match before downstream number expansion', () => {
  exact('0x10 1,234 23rd', '\0  0 x 10 1, 234 23 rd ', [
    [512, 3, 0, 1, 1], [0, 5, 0, 2, 1], [0, 7, 0, 3, 2], [0, 10, 0, 6, 2],
    [0, 13, 0, 8, 3], [0, 17, 0, 12, 2], [16, 20, 0, 14, 2]
  ]);
});

test('tabs/newlines/underscore preserve the upstream MULTIPLE_SPACES flags and source mapping', () => {
  exact('one\t two\nthree_four', '\0  one two three four ', [
    [512, 3, 0, 1, 3], [262144, 7, 0, 6, 3], [262144, 11, 0, 10, 5], [262160, 17, 0, 15, 5]
  ]);
});

test('phoneme mode keeps case and punctuation until its actual closing bracket pair', () => {
  exact('[[h@loU w3:ld]] next', '\0  h@loU w3:ld next ', [[520, 3, 0, 3, 5], [8, 9, 0, 9, 5], [262160, 15, 0, 17, 4]]);
});

test('ReadClause Armenian emphasis marker reaches the previous word FOCUS flag', () => {
  exact('a\u055cword next', '\0  aword next ', [[1536, 3, 0, 1, 6], [262160, 9, 0, 7, 1]]);
});

test('WORD_TAB length has unsigned-char wrap and capacity follows C token output limits', () => {
  for (const [size, expected] of [[255, 255], [256, 0], [300, 44]]) {
    const row = tokenize('a'.repeat(size));
    assert.deepEqual(items(row), [[528, 3, 0, 1, expected]]);
    assert.equal(row.sbuf.length, size + 4);
  }
  const reader = createClauseReader(input('x'.repeat(795) + '😀Z'));
  const tokenizer = createClauseTokenizer();
  const first = tokenizer.tokenize(reader.next());
  assert.equal(first.sbuf.length, 797);
  assert.deepEqual(items(first), [[528, 3, 0, 1, 27]]);
  const second = tokenizer.tokenize(reader.next());
  assert.equal(Buffer.from(second.sbuf).toString(), '\0  z ');
  assert.deepEqual(items(second), [[531, 3, 0, 1, 1]]);
});

test('successive clauses and independent sessions own outputs without consuming supplied records', () => {
  const reader = createClauseReader(input('Mr. Smith went home.'));
  const tokenizer = createClauseTokenizer();
  const clause = reader.next(), sourceCopy = clause.source.slice(), charixCopy = clause.charix.slice();
  const first = tokenizer.tokenize(clause), firstBytes = first.sbuf.slice();
  assert.deepEqual(items(first), [[66066, 3, 0, 1, 2]]);
  assert.deepEqual(items(tokenizer.tokenize(reader.next())), [[514, 3, 0, 1, 5], [0, 9, 0, 7, 4], [65552, 14, 0, 12, 4]]);
  assert.deepEqual(first.sbuf, firstBytes);
  assert.deepEqual(clause.source, sourceCopy); assert.deepEqual(clause.charix, charixCopy);
  assert.deepEqual(items(createClauseTokenizer().tokenize(clause)), items(first));
});

test('Hangul expansion plus prepause reports a C sbuf-capacity overrun instead of enlarging the buffer', () => {
  assert.equal(tokenize('a - ' + '한'.repeat(88)).sbuf.length, 799);
  const tokenizer = createClauseTokenizer(); let observed;
  assert.throws(() => tokenizer.tokenize(read('ab - ' + '한'.repeat(88))), error => {
    observed = error;
    return error.code === 'TOKENIZER_UNSUPPORTED' && error.reason === 'output-capacity-overflow' && error.sourceIndex === 270;
  });
  assert.throws(() => tokenizer.tokenize(read('x')), error => error === observed);
});

test('voice state outside the fixed translator fails explicitly and poisons that session', () => {
  const voice = read('x'); voice.voiceChange = input('en-gb');
  const tokenizer = createClauseTokenizer(); let observed;
  assert.throws(() => tokenizer.tokenize(voice), error => { observed = error; return error.reason === 'voice-change'; });
  assert.throws(() => tokenizer.tokenize(read('x')), error => error === observed);
});

test('embedded commands preserve queue termination, actual defaults and unknown lowercase text', () => {
  const row = exact('\x01P hello', '\0  hello ', [[262736, 3, 0, 1, 2]]);
  assert.deepEqual(row.embeddedStateAfter.list, [12929]);
  assert.equal(row.embeddedStateAfter.pendingCount, 0);
  const empty = exact('\x01F', '\0  ', [[592, 3, 0, 1, 2]]);
  assert.deepEqual(empty.embeddedStateAfter.list, [141]); assert.equal(empty.embeddedStateAfter.pendingCount, 1);
  exact('\x01+10s word', '\0  + 10 s word ', [[262656, 3, 0, 1, 2], [0, 5, 0, 3, 2], [0, 8, 0, 5, 1], [16, 10, 0, 7, 4]]);
});

test('say-as digit groups, key conversion and emphasis execute before word translation', () => {
  const grouped = exact('\x0166Y 123456 7890 word', '\0  12 34 56 78 90 word ', [
    [262720, 3, 0, 1, 2], [0, 6, 0, 8, 2], [0, 9, 0, 10, 2], [262144, 12, 0, 13, 2], [0, 15, 0, 15, 2], [262160, 18, 0, 18, 4]
  ]);
  assert.equal(grouped.embeddedStateAfter.optionSayas2, 66);
  assert.equal(grouped.embeddedStateAfter.optionSayas, 0);
  const key = exact('\x0136Y A B', '\0  a B ', [[262720, 3, 0, 1, 4], [16, 5, 0, 8, 1]]);
  assert.equal(key.embeddedStateAfter.optionSayas2, 20);
  const emphasized = exact('\x013F one \x010F Two', '\0  one two ', [[264768, 3, 0, 1, 3], [262226, 7, 0, 9, 3]]);
  assert.deepEqual(emphasized.embeddedStateAfter.list, [909, 141]);
});

test('invalid profile and malformed clause arrays are rejected without inferring input format', () => {
  assert(Object.isFrozen(WORD_FLAGS));
  for (const options of [{ voice: 'en-gb' }, { ssml: true }, { capacity: 801 }]) assert.throws(() => createClauseTokenizer(options), /Unsupported tokenizer profile/);
  assert.throws(() => createClauseTokenizer('en-us'), /options object/);
  assert.throws(() => createClauseTokenizer().tokenize({}), /ReadClause/);
  const clause = read('a'); clause.charixTop++;
  assert.throws(() => createClauseTokenizer().tokenize(clause), /buffer bounds/);
});
