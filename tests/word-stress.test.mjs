import test from 'node:test';
import assert from 'node:assert/strict';
import { createWordStressSession, getVowelStress, WORD_STRESS_PROFILE } from '../src/core/word-stress.js';
import { CMN_WORD_STRESS_PROFILE } from '../data/cmn/synthesis-profile.js';

function fixture() {
  const entries = new Array(256).fill(null);
  const record = (code, type, stdLength = 0, phflags = 0) => entries[code] = { code, type, stdLength, phflags, program: 0 };
  record(0, 0); record(1, 0);
  for (const [code, stress] of [[2, 1], [3, 0], [4, 2], [5, 3], [6, 4], [7, 5], [8, 2], [26, 6]]) record(code, 1, stress);
  record(13, 2, 0, 2); record(20, 13);
  record(40, 2); record(41, 2, 0, 0x100000); record(50, 3);
  return { index: 80, name: 'en-us', nPhonemes: 51, entries };
}
const get = (bytes, options) => getVowelStress(Uint8Array.from(bytes), fixture(), WORD_STRESS_PROFILE, options);

function cmnFixture() {
  const table = fixture();
  table.index = 8;
  table.name = 'cmn';
  return table;
}

test('GetVowelStress resolves priority, preceding-vowel and dictionary-position stress', () => {
  const priority = get([6, 40, 7, 40]);
  assert.deepEqual(Array.from(priority.phonemes), [40, 40]);
  assert.deepEqual(Array.from(priority.vowelStress), [1, 3, 4, 1]);
  assert.equal(priority.stressedSyllable, 2); assert.equal(priority.maxStress, 4);
  const previous = get([40, 8, 40]);
  assert.deepEqual(Array.from(previous.vowelStress), [1, 4, -1, 1]);
  assert.equal(previous.stressedSyllable, 1);
  const specified = get([6, 40, 40], { stressedSyllable: 99 });
  assert.deepEqual(Array.from(specified.vowelStress), [1, -1, 4, 1]);
  assert.equal(specified.stressedSyllable, 2);
});

test('GetVowelStress treats nonsyllabic vowels, weak vowels, and syllabic markers separately', () => {
  assert.deepEqual(Array.from(get([41, 13], { control: 0 }).vowelStress), [1, -1, 1]);
  assert.deepEqual(Array.from(get([41, 13], { control: 1 }).vowelStress), [1, 1, 1]);
  const syllabic = get([5, 50, 20, 40]);
  assert.deepEqual(Array.from(syllabic.vowelStress), [1, 3, 3, 1]);
  assert.deepEqual(Array.from(syllabic.phonemes), [50, 20, 40]);
  assert.deepEqual(Array.from(get([255, 40, 0, 40]).phonemes), [40]);
});

test('SetWordStress inserts primary/secondary/diminished stress and respects tonic and unstressed flags', () => {
  const session = createWordStressSession(fixture(), WORD_STRESS_PROFILE);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40, 40, 40, 40, 40)).phonemes), [6, 40, 3, 40, 5, 40, 3, 40, 5, 40]);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40), { dictionaryFlags: 8 }).phonemes), [40]);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40), { tonic: 6 }).phonemes), [26, 40]);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(255)).phonemes), [13]);
});

test('SetWordStress preserves session stress through consonants/empty input and resets on pauses', () => {
  const session = createWordStressSession(fixture(), WORD_STRESS_PROFILE, { prevLastStress: 3 });
  assert.equal(session.setWordStress(Uint8Array.of(50)).prevLastStress, 3);
  assert.equal(session.setWordStress(Uint8Array.of(40)).prevLastStress, 4);
  assert.equal(session.setWordStress(new Uint8Array()).prevLastStress, 4);
  const pause = session.setWordStress(Uint8Array.of(1));
  assert.equal(pause.prevLastStress, 0); assert.deepEqual(Array.from(pause.phonemes), []);
  assert.deepEqual(session.state(), { prevLastStress: 0 });
});

test('cmn SetWordStress places primary stress on the final syllable', () => {
  const session = createWordStressSession(cmnFixture(), CMN_WORD_STRESS_PROFILE);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40)).phonemes), [6, 40]);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40, 40)).phonemes), [40, 6, 40]);
  assert.deepEqual(Array.from(session.setWordStress(Uint8Array.of(40, 40, 40)).phonemes), [5, 40, 40, 6, 40]);
});

test('stress services preserve C bounded truncation and reject unsupported profiles and undefined input sizes', () => {
  const table = fixture(), session = createWordStressSession(table, WORD_STRESS_PROFILE);
  assert.equal(session.setWordStress(new Uint8Array(199).fill(50)).phonemes.length, 197);
  const result = getVowelStress(new Uint8Array(199).fill(40), table, WORD_STRESS_PROFILE);
  assert.equal(result.phonemes.length, 98); assert.equal(result.vowelCount, 99); assert.equal(result.vowelStress.length, 100);
  assert.throws(() => session.setWordStress(new Uint8Array(200).fill(40)), /200/);
  assert.throws(() => session.setWordStress(Uint8Array.of(40), { tonic: 7 }), /tonic/);
  assert.throws(() => createWordStressSession(table, { ...WORD_STRESS_PROFILE, stressRule: 2 }), /profile/);
  assert.throws(() => createWordStressSession({ ...table, index: 0 }, WORD_STRESS_PROFILE), /en-us/);
});
