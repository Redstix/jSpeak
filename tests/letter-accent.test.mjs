import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLetterAccentLookup } from '../src/core/letter-accent.js';
import { createDictionarySession, loadDictionary, DICTIONARY_CONSTANTS as F } from '../src/core/dictionary.js';

test('unmapped, capital and name-only letters preserve the original C buffer without lookups', () => {
  const accent = createLetterAccentLookup({ lookup() { throw new Error('Unexpected dependency'); } });
  const initial = Uint8Array.of(1, 2, 0, 3);
  for (const cp of [65, 0xf0, 0x100, 0x17f, 0x251, 0x259, 0x2a9, 0xd800, 0x110000, 0xffffffff]) assert.deepEqual(accent(cp, initial), Uint8Array.of(1, 2));
  assert.deepEqual(initial, Uint8Array.of(1, 2, 0, 3));
});
test('Lookup exposes its TranslateWord dependency and forwards original bounded replacement context', () => {
  const fake = { lookup() { return { found: 0, flags: Uint32Array.of(F.FLAG_TEXTMODE, 0), phonemes: new Uint8Array(0), word: new Uint8Array(100).fill(97) }; } };
  assert.throws(() => createLetterAccentLookup(fake).lookupSymbol(Uint8Array.of(95, 120)), error => error.code === 'ACCENT_UNSUPPORTED' && error.reason === 'translate-word-textmode');
  let observed;
  const accent = createLetterAccentLookup(fake, { translateWord(buffer, context) { observed = { buffer, context }; return { flags: 1, phonemes: Uint8Array.of(42) }; } });
  assert.deepEqual(accent.lookupSymbol(Uint8Array.of(95, 120)), { flags: 1, phonemes: Uint8Array.of(42) });
  assert.deepEqual(observed.context, { offset: 3, sayAs: 0 });
  assert.equal(observed.buffer.length, 80); assert.deepEqual(observed.buffer.slice(0, 3), Uint8Array.of(0, 32, 32)); assert.equal(observed.buffer[78], 97); assert.equal(observed.buffer[79], 0);
});
test('LookupLetter2 exposes TranslateRules with the original 20-byte limit and preceding bytes', () => {
  const missing = { lookup() { return { found: 0, flags: Uint32Array.of(0, 0), phonemes: new Uint8Array(0) }; } };
  assert.throws(() => createLetterAccentLookup(missing).lookupLetter(0x3b1), error => error.code === 'ACCENT_UNSUPPORTED' && error.reason === 'translate-rules-letter');
  let observed;
  const accent = createLetterAccentLookup(missing, { translateRules(buffer, context) { observed = { buffer, context }; return Uint8Array.of(7, 8); } });
  assert.deepEqual(accent.lookupLetter(0x3b1), Uint8Array.of(7, 8));
  assert.deepEqual(observed.context, { offset: 2, capacity: 20, wordFlags: 0, phonemes: new Uint8Array(0) });
  assert.deepEqual(observed.buffer.slice(0, 6), Uint8Array.of(0, 32, 0xce, 0xb1, 32, 0));
});
test('real dictionary accents share session state and identify the remaining U+0252 rule dependency', () => {
  const dict = loadDictionary(new Uint8Array(readFileSync(new URL('../data/dictionary/en_dict.bin', import.meta.url))), JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url))));
  let accent; const session = createDictionarySession(dict, { lookupAccentedLetter: (cp, initial) => accent(cp, initial) }); accent = createLetterAccentLookup(session);
  const accented = session.lookup(new Uint8Array(Buffer.from('é ')));
  assert.equal(accented.found, 1); assert(accented.phonemes.length > 0); assert.deepEqual(accented.stateAfter, session.state()); assert(accented.stateAfter.repeatCount > 0);
  assert.throws(() => accent(0x252), error => error.code === 'ACCENT_UNSUPPORTED' && error.reason === 'translate-rules-letter');
});
