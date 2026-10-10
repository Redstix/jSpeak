import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterNames } from '../src/core/character-names.js';
function dictionary(responses) {
  const requests = [];let count = 0;
  return { requests, lookup(bytes, options) { requests.push({ bytes: bytes.slice(), options });return responses[count++]; }, resetRepeat() {}, state() { return { repeatCount: 0 }; } };
}
const missing = () => ({ found: 0, flags: Uint32Array.of(0, 0), phonemes: new Uint8Array(0) });
test('character only mode performs a real direct lookup and preserves empty result', () => {
  const dict = dictionary([missing()]), service = createCharacterNames(dict, {}, { setWordStress() { throw new Error('Unexpected stress'); } });
  assert.equal(service.lookupCharName(0x2026, true).length, 0);
  assert.deepEqual(dict.requests[0].bytes, Uint8Array.of(0xe2, 0x80, 0xa6));assert.equal(dict.requests.length, 1);
});
test('character naming retains flags from underscore lookup for the second lookup', () => {
  const first = missing();first.flags[0] = 123;first.flags[1] = 456;
  const dict = dictionary([first, missing()]), service = createCharacterNames(dict, {}, { setWordStress() {} });
  assert.throws(() => service.lookupCharName(43, false), error => error.code === 'CHARACTER_NAME_UNSUPPORTED' && error.reason === 'translate-rules-character');
  assert.deepEqual(dict.requests.map(value => [...value.bytes]), [[95, 43], [43]]);assert.deepEqual(dict.requests[1].options, { flags0: 123, flags1: 456 });
});
test('rule fallback receives original prefix, capacity and returns original placeholder when empty', () => {
  const dict = dictionary([missing(), missing()]);let context;
  const service = createCharacterNames(dict, {}, { setWordStress() {} }, { translateRules(bytes, options) { context = { bytes, options };return new Uint8Array(0); } });
  assert.equal(Buffer.from(service.lookupCharName(43, false)).toString(), '[\x02(X1)(X1)(X1)]]');
  assert.deepEqual(context.options, { offset: 2, capacity: 60, wordFlags: 0 });assert.deepEqual(context.bytes.slice(0, 4), Uint8Array.of(0, 32, 43, 0));
});
test('character names decode stressed phonemes and enforce the original fixed buffer', () => {
  const dict = dictionary([{ found: 1, flags: Uint32Array.of(3, 0), phonemes: Uint8Array.of(5) }]);let received;
  const entries = Array(256).fill(null);entries[5] = { mnemonic: 97, type: 2 };
  const service = createCharacterNames(dict, { entries }, { setWordStress(bytes, options) { received = options;return { phonemes: bytes }; } });
  assert.deepEqual(service.lookupSpecial(Uint8Array.of(97)), Uint8Array.of(91, 2, 97, 93, 93));assert.deepEqual(received, { dictionaryFlags: 3, tonic: -1, control: 0 });
  const long = dictionary([{ found: 1, flags: Uint32Array.of(0, 0), phonemes: new Uint8Array(55).fill(5) }]);
  assert.throws(() => createCharacterNames(long, { entries }, { setWordStress() {} }).lookupSpecial(Uint8Array.of(97)), error => error.reason === 'original-phoneme-buffer-capacity');
});
