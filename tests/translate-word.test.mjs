import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadDictionary } from '../src/core/dictionary.js';
import { createPhonemeTables } from '../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../src/core/word-services.js';
import { WORD_TRANSLATION_PROFILE } from '../src/core/translate-word.js';

const tableFile = new URL('../build/oracle/espeak-ng-data/phontab', import.meta.url);
const options = { skip: existsSync(tableFile) ? false : 'Build pinned reference data before original word integration tests' };
let dictionary, table;
function session(initialState) {
  if (!dictionary) dictionary = loadDictionary(new Uint8Array(readFileSync(new URL('../data/dictionary/en_dict.bin', import.meta.url))), JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url))));
  if (!table) table = createPhonemeTables(new Uint8Array(readFileSync(tableFile))).select(80);
  return createEnglishWordServices(dictionary, table, { initialState }).wordTranslation;
}
const hex = bytes => Buffer.from(bytes).toString('hex');

test('dictionary and suffix words preserve original phonemes and rule/stress state', options, () => {
  const a = session().translate(Buffer.from('hello '));
  assert.equal(a.flags, 3221225472); assert.equal(hex(a.phonemes), '410d370690');
  assert.equal(a.stateAfter.wordVowelCount, 0); assert.equal(a.stateAfter.prevLastStress, 4);
  const b = session().translate(Buffer.from('running '));
  assert.equal(b.flags, 0); assert.equal(hex(b.phonemes), '220685327e45');
  assert.equal(b.stateAfter.wordVowelCount, 2); assert.equal(b.stateAfter.wordStressedCount, 1);
  assert.equal(Buffer.from(b.wordAfter).toString(), 'running ');
});

test('word3 reports replacement bytes while public word translates the replacement', options, () => {
  const initialPhonemes = Uint8Array.of(9);
  const direct = session().translate(Buffer.from('boogey '), { initialPhonemes });
  assert.equal(direct.flags, 3758096384); assert.equal(hex(direct.phonemes), '09');
  assert.equal(Buffer.from(direct.wordOut).toString(), 'boogie ');
  const translated = session().translate(Buffer.from('boogey '), { operation: 'word' });
  assert.equal(translated.flags, direct.flags); assert.equal(hex(translated.phonemes), '4806755225');
  assert.equal(translated.anyStressedWords, null);
});

test('spelling uses original VSHORT separators, last-letter stress and final pause', options, () => {
  const result = session({ optionSayas: 18 }).translate(Buffer.from('abc '));
  assert.equal(hex(result.phonemes), '059317480589175a06890b');
  assert.equal(result.stateAfter.repeatCount, 1); assert.equal(hex(result.stateAfter.repeat), '5a89');
});

test('emphasis changes primary stress and sets the original break flag', options, () => {
  const result = session().translate(Buffer.from('cat '), { words: [{ flags: 2048 }] });
  assert.equal(result.flags, 268435456); assert.equal(hex(result.phonemes), '311a232f');
});

test('state updates reach nested dictionary lookups and preserve output ownership', options, () => {
  const words = session(); words.setState({ expectPast: 2 });
  const result = words.translate(Buffer.from('read '));
  assert.equal(hex(result.phonemes), '22067b49'); assert.equal(result.stateAfter.expectPast, 1);
  const copy = result.phonemes.slice(); words.setState({ expectPast: 0 }); words.translate(Buffer.from('hello '));
  assert.deepEqual(result.phonemes, copy); assert.equal(result.stateAfter.expectPast, 1);
  assert.throws(() => words.setState({ missingState: 1 }), /Invalid word state/);
});

test('complete source buffers are borrowed immutably and return all original bytes', options, () => {
  const source = Uint8Array.from(Buffer.from('\0  hello world \0'));
  const saved = source.slice(); const result = session().translate(source, { offset: 3 });
  assert.deepEqual(source, saved); assert.deepEqual(result.bufferAfter, source);
  assert.equal(Buffer.from(result.wordAfter).toString(), 'hello world ');
  assert.equal(result.stateBefore.clauseEnd, 11);
});

test('KEY source underflow is deterministic and a real earlier space avoids the original UB', options, () => {
  const reader = session({ optionSayas: 36 }); let fault;
  assert.throws(() => reader.translate(Buffer.from('key ')), error => {
    fault = error; return error.code === 'WORD_TRANSLATION_UNSUPPORTED' && error.reason === 'rule-source-bounds';
  });
  assert.throws(() => reader.translate(Buffer.from('hello ')), error => error === fault);
  assert.doesNotThrow(() => session({ optionSayas: 36 }).translate(Buffer.from('\0  key \0'), { offset: 3 }));
});

test('profile and public source/WORD_TAB bounds are explicit', options, () => {
  assert(Object.isFrozen(WORD_TRANSLATION_PROFILE));
  assert.throws(() => session().translate(Buffer.from('hello')), /space- or NUL-terminated/);
  assert.throws(() => session().translate(Buffer.from('a \0b ')), /NUL-free/);
  assert.throws(() => session().translate(Buffer.from('hello '), { words: [{ length: 256 }] }), /WORD_TAB/);
  assert.throws(() => session().translate(Buffer.from('hello '), { operation: 'word', remaining: 1 }), /zero remaining/);
});
