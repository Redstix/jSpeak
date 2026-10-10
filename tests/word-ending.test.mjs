import test from 'node:test';
import assert from 'node:assert/strict';
import { removeEnding, WORD_ENDING_PROFILE } from '../src/core/word-ending.js';
const remove = (text, endType, options) => removeEnding(Buffer.from(text), endType, WORD_ENDING_PROFILE, options);
const text = bytes => Buffer.from(bytes).toString();

test('RemoveEnding reverses English e-dropping and y-to-i and honors original source lists', () => {
  for (const [word, endType, expected, flags] of [
    ['hoped', 0x102, 'hope ', 276], ['tried', 0x202, 'try  ', 516],
    ['missions', 0x101, 'mission ', 268], ['sponges', 0x102, 'sponge ', 284],
    ['bit', 0x100, 'bite', 276]
  ]) {
    const result = remove(word, endType);
    assert.equal(text(result.word), expected); assert.equal(result.endFlags, flags);
    assert.equal(text(result.wordCopy), word);
  }
});

test('RemoveEnding preserves plural/apostrophe flags and verb state at original transition', () => {
  assert.equal(remove('dogs', 1).endFlags, 12);
  assert.equal(remove("dog's", 2).endFlags, 0);
  const verb = remove('Eats', 0x801);
  assert.equal(text(verb.word), 'eat '); assert.equal(text(verb.wordCopy), 'eats');
  assert.equal(verb.expectVerb, 1); assert.equal(verb.endFlags, 2060);
  assert.equal(remove('Eats', 0x801, { expectVerb: -7 }).expectVerb, -7);
  assert.deepEqual(remove('testing', -8382205), { word: Uint8Array.from(Buffer.from('test   ')), wordCopy: Uint8Array.from(Buffer.from('testing')), endFlags: 6404, expectVerb: 1 });
});

test('RemoveEnding follows continuation bytes while preserving spaces and subsequent text', () => {
  const unicode = remove('café雪𝄞', 2);
  assert.equal(text(unicode.word), 'café       ');
  assert.equal(text(remove('cats tail', 1).word), 'cat  tail');
  assert.equal(text(remove('Eats EATS', 1).wordCopy), 'eats');
  assert.equal(text(remove('Eats EATS', 1).word), 'eat  EATS');
  assert.equal(text(remove('cats\0ignored', 1).word), 'cat ');
  const malformed = removeEnding(Uint8Array.of(97, 128, 128), 1, WORD_ENDING_PROFILE);
  assert.deepEqual(Array.from(malformed.word), [32, 32, 32]);
});

test('RemoveEnding keeps the original 49-byte replacement cap and 159-byte copy cap', () => {
  const long = remove('a'.repeat(64), 63);
  assert.equal(text(long.word), 'a' + ' '.repeat(49) + 'a'.repeat(14));
  assert.equal(long.endFlags, 52);
  assert.equal(remove('E'.repeat(160), 1).wordCopy.length, 159);
  assert.equal(text(remove('E'.repeat(160), 1).wordCopy), 'e'.repeat(159));
  assert.equal(remove('cats', 1, { copyWord: false }).wordCopy, null);
});

test('RemoveEnding owns returned arrays and rejects undefined backing-memory accesses', () => {
  const input = Buffer.from('dogs');
  const result = removeEnding(input, 1, WORD_ENDING_PROFILE);
  result.word[0] = 0; result.wordCopy[0] = 0;
  assert.equal(text(input), 'dogs');
  assert.equal(text(remove('dogs', 1).word), 'dog ');
  assert.throws(() => remove('a', 2), /before the logical word/);
  assert.throws(() => removeEnding(Uint8Array.of(128), 1, WORD_ENDING_PROFILE), /leaves logical word/);
  assert.throws(() => removeEnding(input, 1, { ...WORD_ENDING_PROFILE, suffixAddE: 0 }), /profile/);
  assert.throws(() => remove('a', 0x80000000), /ending type/);
});
