import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBinaryReader, byteHash32 } from '../src/data/binary.js';
import { loadDictionary, createDictionarySession, transposeDictionaryWord, hashDictionary, DICTIONARY_CONSTANTS as F } from '../src/core/dictionary.js';
import { createLetterAccentLookup } from '../src/core/letter-accent.js';
import { normalizeDictionaryRequest } from '../tools/oracle/dictionary.mjs';

const raw = new Uint8Array(readFileSync(new URL('../data/dictionary/en_dict.bin', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url)));
const dictionary = loadDictionary(raw, manifest);
const bytes = text => new Uint8Array(Buffer.from(text));
function session() { let accent; const result = createDictionarySession(dictionary, { lookupAccentedLetter: (cp, initial) => accent(cp, initial) }); accent = createLetterAccentLookup(result); return result; }

test('binary reader respects supplied views, little endian and bounded terminators', () => {
  const reader = createBinaryReader(Uint8Array.of(99, 1, 2, 3, 4, 0, 88).subarray(1, 6));
  assert.equal(reader.u32(0), 0x04030201);assert.equal(reader.u16(1), 0x0302);assert.equal(reader.zeroEnd(0), 4);
  for (const offset of [-1, NaN, 2 ** 53, 2]) assert.throws(() => reader.u32(offset), RangeError);
  assert.throws(() => reader.zeroEnd(0, 4), /terminator/);assert.throws(() => reader.range(0, -1), RangeError);
});
test('raw dictionary loader checks provenance, integrity and structural bounds', () => {
  assert.equal(dictionary.entryCount, 7792);assert.equal(dictionary.groups2Used, 72);assert.equal(dictionary.replacementOffset, 125064);
  for (const change of [{ schemaVersion: 2 }, { upstreamCommit: 'x' }, { language: 'fr' }, { hash32: 0 }, { rulesOffset: 8 }]) assert.throws(() => loadDictionary(raw, { ...manifest, ...change }));
  assert.throws(() => loadDictionary(raw.subarray(0, -1), manifest), /checksum/);
  const corrupt = raw.slice();corrupt[8] = 1;
  assert.throws(() => loadDictionary(corrupt, { ...manifest, hash32: byteHash32(corrupt) }), /entry length/);
  const badRule = raw.slice();badRule[manifest.rulesOffset] = 255;
  assert.throws(() => loadDictionary(badRule, { ...manifest, hash32: byteHash32(badRule) }), /rule group/);
});
test('TransposeAlphabet preserves the original suffix used by HashDictionary', () => {
  for (const [text, width, result, hash] of [['hello', 68, '20530c3c6f', 44], ['read', 67, '48504464', 614], ['café', 67, '0c11a2c3a9', 552]]) {
    const input = bytes(text), transformed = transposeDictionaryWord(input);
    assert.equal(transformed.length, width);assert.equal(Buffer.from(transformed.bytes.subarray(0, input.length)).toString('hex'), result);assert.equal(hashDictionary(transformed.bytes), hash);assert.deepEqual(input, bytes(text));
  }
  assert.throws(() => transposeDictionaryWord(new Uint8Array(160).fill(97)), /159|N_WORD/);
});
test('text replacement and multiword emphasis follow the actual dictionary flags', () => {
  const s = session();
  assert.equal(s.lookup(bytes('boogey ')).replacement, false);
  const replacement = s.lookup(bytes('boogey '), { endFlags: F.FLAG_ALLOW_TEXTMODE });
  assert.equal(replacement.found, 0);assert.equal(replacement.replacement, true);assert.equal(Buffer.from(replacement.word).toString(), 'boogie ');
  const phrase = s.lookup(bytes('bow down '), { words: [{ flags: 0, length: 3 }, { flags: 0, length: 4 }] });
  assert(phrase.flags[0] & F.FLAG_SKIPWORDS);assert.equal(phrase.stateAfter.skipWords, 1);
  const emphasized = s.lookup(bytes('bow down '), { words: [{ flags: 0, length: 3 }, { flags: F.FLAG_EMPHASIZED, length: 4 }] });
  assert.equal(emphasized.flags[0] & F.FLAG_SKIPWORDS, 0);
});
test('lookup outputs do not alias dictionary bytes or shared repeat snapshots', () => {
  const s = session(), before = byteHash32(raw);
  const first = s.lookup(bytes('hello '));assert(first.phonemes.length);first.phonemes.fill(255);first.flags.fill(0);first.word.fill(0);
  assert.equal(byteHash32(raw), before);assert.notDeepEqual(s.lookup(bytes('hello ')).phonemes, first.phonemes);
  const accented = s.lookup(bytes('é '));accented.stateAfter.repeat.fill(0);assert.notDeepEqual(s.state().repeat, accented.stateAfter.repeat);
});
test('repeat suppression keeps found decision while silencing the fourth equals symbol', () => {
  const s = session();
  const output = Array.from({ length: 5 }, () => s.lookup(bytes('=')));
  assert(output[0].phonemes.length > 0);assert.equal(output[2].stateAfter.repeatCount, 3);assert.equal(output[3].phonemes.length, 0);assert.equal(output[3].found, 1);
  s.resetRepeat();assert.equal(s.state().repeatCount, 0);assert(s.lookup(bytes('=' )).phonemes.length > 0);
});
test('default clause end tracks the full supplied byte span beyond an embedded NUL', () => {
  const s = session();
  assert.equal(s.lookup(bytes('a')).found, 1);
  assert.equal(s.lookup(bytes('a\0ignored')).found, 0);
  assert.equal(s.lookup(bytes('a\0ignored'), { clauseEnd: 1 }).found, 1);
});
test('dictionary state can be saved and restored without aliasing or partial invalid updates', () => {
  const s = session();s.lookup(bytes('='));s.lookup(bytes('='));s.lookup(bytes('='));
  const saved = s.state();s.resetRepeat();s.setState(saved);saved.repeat.fill(0);
  assert.equal(s.lookup(bytes('=')).phonemes.length, 0);
  const before = s.state();assert.throws(() => s.setState({ repeatCount: 2, repeat: new Uint8Array(20) }));assert.deepEqual(s.state(), before);
  s.setState({ skipWords: 3 });assert.equal(s.state().skipWords, 3);
});
test('nested dictionary calls inherit translator context while explicit settings override it', () => {
  const s = session();s.setContext({ expectVerb: 1 });
  const verb = s.lookup(bytes('house '));
  assert.deepEqual(verb.phonemes, session().lookup(bytes('house '), { expectVerb: 1 }).phonemes);
  assert.notDeepEqual(verb.phonemes, s.lookup(bytes('house '), { expectVerb: 0 }).phonemes);
  const before = s.context();assert.throws(() => s.setContext({ expectVerb: 0, clauseEnd: 3 }));assert.deepEqual(s.context(), before);
});
test('dictionary runtime and C adapter reject malformed contextual fields', () => {
  const s = session();
  for (const options of [{ endFlags: -1 }, { flags0: 1.5 }, { withWord: 2 }, { clauseEnd: 99 }, { native: 1 }, { words: [{ flags: 0, length: 256 }] }, { unexpected: 1 }]) assert.throws(() => s.lookup(bytes('hello '), options));
  for (const request of [null, [], { operation: 'oops' }, { utf8Hex: 'ab0' }, { utf8Hex: 'FF' }, { repeats: 0 }, { native: 1 }, { words: [{ flags: 0, length: 256 }] }, { withWord: 2 }, { bad: true }]) assert.throws(() => normalizeDictionaryRequest(request));
});
