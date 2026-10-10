import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDictionary, createDictionarySession } from '../src/core/dictionary.js';
import { createPhonemeTables } from '../src/core/phoneme-table.js';
import { createDictionaryRulesSession, RULE_PROFILE } from '../src/core/dictionary-rules.js';

const file = new URL('../build/oracle/espeak-ng-data/phontab', import.meta.url);
const options = { skip: existsSync(file) ? false : 'Build pinned reference data before original-rule contract tests' };
const dictionary = loadDictionary(readFileSync(new URL('../data/dictionary/en_dict.bin', import.meta.url)), JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url))));
const selected = existsSync(file) ? createPhonemeTables(readFileSync(file)).select(80) : null;
const hex = bytes => Buffer.from(bytes).toString('hex');
const session = () => createDictionaryRulesSession(dictionary, selected, RULE_PROFILE, { dictionarySession: createDictionarySession(dictionary) });

test('rules consume original group data and retain phoneme/count behavior', options, () => {
  const reader = session();
  const cat = reader.translate(Buffer.from('cat'));
  assert.equal(hex(cat.phonemes), '31232f');
  assert.equal(cat.stateAfter.wordVowelCount, 1);
  assert.equal(cat.stateAfter.wordStressedCount, 1);
  assert.equal(hex(reader.translate(Buffer.from('hello')).phonemes), '417b3790');
  assert.equal(hex(reader.translate(Buffer.from('ɒ')).phonemes), '');
});

test('ending rules retain signed C ending flags, phoneme separation, and restored input', options, () => {
  const input = Buffer.from('testing'), saved = input.slice();
  const result = session().translate(input);
  assert.equal(result.endType, -8382205);
  assert.equal(hex(result.phonemes), '2f7b5a2f');
  assert.equal(hex(result.endPhonemes), '027e45');
  assert.deepEqual(Buffer.from(result.word), saved);
  assert.deepEqual(input, saved);
  const complete = session().translate(Buffer.from('hopeful'), { endPhonemesEnabled: false });
  assert.equal(complete.endType, 0); assert.equal(hex(complete.phonemes), '4190305476');
  assert.equal(Buffer.from(complete.word).toString(), 'hopeful');
});

test('rule scores let dictionary alternatives override the ordinary suffix match', options, () => {
  const basic = session().translate(Buffer.from('capable'), { dictFlags: Uint32Array.of(0, 0) });
  const alternate = session().translate(Buffer.from('capable'), { dictFlags: Uint32Array.of(32768, 0) });
  assert.equal(basic.endType, -8385788);
  assert.equal(hex(basic.endPhonemes), '0d4876');
  assert.equal(alternate.endType, 0);
  assert.equal(hex(alternate.phonemes), '31069330934876');
  assert.deepEqual(Array.from(alternate.dictFlags), [32768, 0]);
});

test('append capacity rejects whole additions and updates counters only when appended', options, () => {
  const result = session().translate(Buffer.from('cat'), { phSize: 3 });
  assert.equal(hex(result.phonemes), '3123');
  assert.equal(result.stateAfter.wordVowelCount, 1);
  const empty = session().translate(Buffer.from('cat'), { phSize: 1 });
  assert.equal(empty.phonemes.length, 0); assert.equal(empty.stateAfter.wordVowelCount, 0);
  const unpronounced = session().translate(Buffer.from('testing'), { wordFlags: 0x80000000 });
  assert.equal(unpronounced.phonemes.length, 0); assert.equal(unpronounced.stateAfter.wordVowelCount, 0);
});

test('rule output never aliases Buffer-backed original dictionary or input', options, () => {
  const before = createHash('sha256').update(dictionary.bytes).digest('hex');
  const reader = session(), first = reader.translate(Buffer.from('testing'));
  first.phonemes.fill(0); first.endPhonemes.fill(0); first.word.fill(0);
  assert.equal(createHash('sha256').update(dictionary.bytes).digest('hex'), before);
  assert.equal(hex(reader.translate(Buffer.from('testing')).endPhonemes), '027e45');
});

test('reachable missing name/number services fail explicitly and profiles/capacities are bounded', options, () => {
  assert.throws(() => session().translate(Buffer.from('mother-in-law')), error => error.code === 'DICTIONARY_RULES_UNSUPPORTED' && error.reason === 'letter-lookup');
  assert.throws(() => session().translate(Buffer.from('42')), error => error.code === 'DICTIONARY_RULES_UNSUPPORTED' && error.reason === 'digit-lookup');
  assert.throws(() => session().translate(Buffer.from('cat'), { phSize: 201 }), /capacity/);
  assert.throws(() => createDictionaryRulesSession(dictionary, selected, { ...RULE_PROFILE, toneNumbers: 1 }), /profile/);
});

test('TranslateRules accepts long source context and retains the original 159-byte restoration cap', options, () => {
  const reader = session(), source = Buffer.from('cat ' + 'a'.repeat(4092));
  const result = reader.translate(source);
  assert.equal(hex(result.phonemes), '31232f'); assert.deepEqual(Buffer.from(result.word), source);
  assert.doesNotThrow(() => reader.translate(new Uint8Array(160).fill(97)));
  const text = 'b'.repeat(160) + 'hopeful';
  const long = reader.translate(Buffer.from(text), { endPhonemesEnabled: false });
  assert.equal(long.word.length, text.length);
  assert.equal(Buffer.from(long.word.subarray(0, 159)).toString(), text.slice(0, 159));
});

test('public AppendPhonemes restores counters and preserves C stress and capacity behavior', options, () => {
  const reader = session();
  reader.setState({ wordVowelCount: 2, wordStressedCount: 1, prePause: 4 });
  const added = Buffer.from('03230623ff230d', 'hex');
  const result = reader.appendPhonemes(new Uint8Array(), added);
  assert.equal(hex(result), '03230623ff230d');
  assert.deepEqual(reader.state(), { wordVowelCount: 6, wordStressedCount: 3, prePause: 4, repeatCount: 0, skipWords: 0 });
  const rejected = reader.appendPhonemes(result, Uint8Array.of(35), 8);
  assert.equal(hex(rejected), hex(result)); assert.equal(reader.state().wordVowelCount, 6);
  rejected[0] = 0; assert.equal(result[0], 3); result[0] = 0; assert.equal(added[0], 3);
  reader.setState({ wordVowelCount: 0x7fffffff, wordStressedCount: 0x7fffffff });
  reader.appendPhonemes(new Uint8Array(), Uint8Array.of(35));
  assert.equal(reader.state().wordVowelCount, -0x80000000);
  assert.equal(reader.state().wordStressedCount, -0x80000000);
  assert.equal(reader.state().prePause, 4);
  reader.setState({ wordVowelCount: 99 });
  assert.equal(reader.translate(Buffer.from('cat')).stateBefore.wordVowelCount, 99);
  assert.equal(reader.state().wordVowelCount, 1);
});

test('TranslateRules preserves supplied preceding bytes and bounds backward context', options, () => {
  const reader = session(), prefix = Uint8Array.of(32, 95);
  assert.equal(hex(reader.translate(Buffer.from('a')).phonemes), '77');
  assert.equal(hex(reader.translate(Buffer.from('a'), { prefixBytes: prefix }).phonemes), '23');
  assert.deepEqual(Array.from(prefix), [32, 95]);
  assert.doesNotThrow(() => reader.translate(Buffer.from('cat'), { prefixBytes: Uint8Array.of(0, 0) }));
  const before = reader.state();
  assert.throws(() => reader.translate(Buffer.from('cat'), { prefixBytes: Uint8Array.of(32) }), /prefix/);
  assert.throws(() => reader.translate(Buffer.from('a'), { prefixBytes: Uint8Array.of(32, 0xe0) }), /crosses the word boundary/);
  assert.throws(() => reader.translate(Buffer.from('a'), { prefixBytes: Uint8Array.of(0xc3, 32) }), /crosses the word boundary/);
  assert.deepEqual(reader.state(), before);
  assert.throws(() => reader.setState({ wordVowelCount: 4, repeatCount: 0 }), /state field/);
  assert.deepEqual(reader.state(), before);
});

test('TranslateRules full buffer preserves real context, NUL boundaries and owned output', options, () => {
  const reader = session(), prefix = Buffer.from('\0  earlier words '), word = Buffer.from('testing other text ');
  const input = Buffer.concat([prefix, word, Buffer.from([0, 69, 69, 0]), Buffer.alloc(16)]);
  const saved = Buffer.from(input), result = reader.translateBuffer(input, prefix.length);
  assert.equal(result.endType, -8382205); assert.equal(hex(result.phonemes), '2f7b5a2f');
  assert.deepEqual(Buffer.from(result.source), saved); assert.deepEqual(Buffer.from(result.word), word);
  result.source.fill(0); result.word.fill(0); assert.deepEqual(input, saved);
  const shortPrefix = Buffer.from([0, 32, 97, 32, 0, 0]);
  assert.equal(hex(reader.translateBuffer(shortPrefix, 2).phonemes), '77');
  assert.throws(() => reader.translateBuffer(Buffer.from([32, 97, 32, 0]), 1), /outside backing buffer/);
  assert.throws(() => reader.translateBuffer(Buffer.from(' cat'), 1), /terminating NUL/);
  assert.throws(() => reader.translateBuffer(shortPrefix, 2, { prefixBytes: Uint8Array.of(32, 32) }), /already supplies/);
});
