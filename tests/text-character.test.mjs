import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createTextCharacterSession, alphabetFromChar, shouldSplitIdeographs, TEXT_CHARACTER_PROFILE, FLAG_CHAR_REPLACED, ALPHABET_FLAGS } from '../src/core/text-character.js';
import { REPLACEMENT_BYTES } from '../data/text/tables.js';
import { decodeReplacementStream } from '../tools/build-text/build.mjs';

const translate = (cp, next = 32, insert = 0, flags = 0) => createTextCharacterSession().translate(Uint8Array.of(next < 128 ? next : 32, 0), 0, 32, cp, next, insert, flags);

test('initialized en-us data keeps replacement entries and exact four-NUL sentinel', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/text/manifest.json', import.meta.url)));
  assert.equal(REPLACEMENT_BYTES.length, 116);
  assert.equal(decodeReplacementStream(REPLACEMENT_BYTES).length, 18);
  assert.equal(createHash('sha256').update(REPLACEMENT_BYTES).digest('hex'), manifest.replacementStreamSha256);
  assert.throws(() => decodeReplacementStream(REPLACEMENT_BYTES.slice(0, -1)), /sentinel/);
  assert.equal(TEXT_CHARACTER_PROFILE.translatorName, 25966);
  assert.equal(TEXT_CHARACTER_PROFILE.dotlessI, 0);
  assert.equal(TEXT_CHARACTER_PROFILE.letterBitsOffset, 0);
  assert.equal(TEXT_CHARACTER_PROFILE.ideographs, 0);
  assert.equal(TEXT_CHARACTER_PROFILE.altAlphabet, 0);
  assert.deepEqual(TEXT_CHARACTER_PROFILE.punctWithinWord, [39]);
  assert(Object.isFrozen(TEXT_CHARACTER_PROFILE.punctWithinWord));
});

test('TranslateChar applies en replacement case to first and inserted letters independently', () => {
  assert.deepEqual(translate(0xe6), { codepoint: 97, insert: 101, wordFlags: FLAG_CHAR_REPLACED });
  assert.deepEqual(translate(0xc6), { codepoint: 65, insert: 101, wordFlags: FLAG_CHAR_REPLACED });
  assert.deepEqual(translate(0xc6, 66), { codepoint: 65, insert: 69, wordFlags: FLAG_CHAR_REPLACED });
  assert.deepEqual(translate(0x152, 0x391), { codepoint: 79, insert: 69, wordFlags: FLAG_CHAR_REPLACED });
  assert.deepEqual(translate(0x386, 32, 123, 4), { codepoint: 0x391, insert: 123, wordFlags: FLAG_CHAR_REPLACED | 4 });
  assert.deepEqual(translate(0x2bb), { codepoint: 39, insert: 0, wordFlags: FLAG_CHAR_REPLACED });
  assert.deepEqual(translate(0x41, 32, 123, 0x80000000), { codepoint: 0x41, insert: 123, wordFlags: 0x80000000 });
  assert.deepEqual(translate(0), { codepoint: 0, insert: 0, wordFlags: 0 });
});

test('Hangul expansion feeds inserted syllables back through the same character session', () => {
  const session = createTextCharacterSession();
  const source = Uint8Array.of(0);
  const first = session.translate(source, 0, 32, 0xac01, 32);
  assert.deepEqual(first, { codepoint: 0x1100, insert: 0xc545, wordFlags: 0 });
  const second = session.translate(source, 0, first.codepoint, first.insert, 32);
  assert.deepEqual(second, { codepoint: 0x1161, insert: 0x11a8, wordFlags: 0 });
  const third = session.translate(source, 0, second.codepoint, second.insert, 32);
  assert.deepEqual(third, { codepoint: 0x11a8, insert: 0, wordFlags: 0 });
  assert.deepEqual(translate(0x3133), { codepoint: 0x11aa, insert: 0, wordFlags: 0 });
  assert.deepEqual(translate(0x3130), { codepoint: 0x1100, insert: 0, wordFlags: 0 });
  assert.deepEqual(session.state(), { ignoreNextN: 0 });
});

test('AlphabetFromChar returns C table identity and preserves gaps and unusual ranges', () => {
  assert.equal(alphabetFromChar(0x37f), null);
  assert.equal(alphabetFromChar(0x380), alphabetFromChar(0x3ff));
  assert.equal(alphabetFromChar(0x400).name, '_cyr');
  assert.equal(alphabetFromChar(0x880), null);
  assert.equal(alphabetFromChar(0x3100).flags, ALPHABET_FLAGS.NOT_CODE | ALPHABET_FLAGS.IDEOGRAPHS);
  assert.equal(alphabetFromChar(0xa700).name, '_ko');
  assert.equal(alphabetFromChar(0x10480), null);
  assert.equal(alphabetFromChar(0xffffffff), null);
  assert(Object.isFrozen(alphabetFromChar(0x380)));
  assert.equal(shouldSplitIdeographs(0x4e00, 0x4e01), false);
  assert.equal(shouldSplitIdeographs(0x3041, 0x41), false);
  for (const cp of [-1, 1.5, 0x100000000, 'a']) assert.throws(() => alphabetFromChar(cp));
});
