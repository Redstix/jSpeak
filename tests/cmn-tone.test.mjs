import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createPhonemeTables } from '../src/core/phoneme-table.js';
import { createPitchCalculator } from '../src/core/calc-pitches.js';
import { createLengthCalculator } from '../src/core/calc-lengths.js';
import { createPhonemeListBuffer } from '../src/core/phoneme-interpreter.js';
import { CMN_PROSODY_PROFILE } from '../data/cmn/prosody-profile.js';
import { CMN_PROSODY_PROFILE as CMN_LENGTH_PROFILE } from '../data/cmn/synthesis-profile.js';

const phontabPath = new URL('../build/oracle/espeak-ng-data/phontab', import.meta.url);
const phonindexPath = new URL('../build/oracle/espeak-ng-data/phonindex', import.meta.url);
const phondataPath = new URL('../build/oracle/espeak-ng-data/phondata', import.meta.url);
const available = existsSync(phontabPath);

test('cmn tone calculator promotes tone 35 and preserves original pitch endpoints', { skip: !available }, () => {
  const table = createPhonemeTables(readFileSync(phontabPath)).select(8);
  const list = {
    length: 4,
    phcode: Uint8Array.of(50, 37, 9, 9),
    stresslevel: Uint8Array.of(0, 4, 0, 0),
    wordstress: Uint8Array.of(4, 4, 0, 0),
    tonePh: Uint8Array.of(0, 120, 0, 0),
    sourceix: new Uint16Array([1, 0, 0, 0]),
    synthflags: new Uint16Array([0, 4, 0, 0]),
    type: Uint8Array.of(8, 2, 0, 0),
    newword: Uint8Array.of(13, 0, 2, 0),
    stdLength: Uint8Array.of(0, 0, 0, 0),
    pitch1: new Uint16Array(4),
    pitch2: new Uint16Array(4)
  };
  const result = createPitchCalculator(table, CMN_PROSODY_PROFILE).calculate(list, 4, 0);
  assert.equal(result.list.stresslevel[1], 7);
  assert.equal(result.list.tonePh[1], 120);
  assert.equal(result.list.pitch1[1], 30);
  assert.equal(result.list.pitch2[1], 50);
});

test('tone-language dispatch only accepts the reviewed cmn profile', () => {
  assert.deepEqual(CMN_PROSODY_PROFILE, { voice: 'cmn', translatorName: 6516078, phonemeTable: 8, toneLanguage: 1 });
  const table = { entries: new Array(256) };
  assert.throws(() => createPitchCalculator(table, { toneLanguage: 2 }), /Unsupported tone language/);
  assert.throws(() => createPitchCalculator(table, { toneLanguage: 1 }), /Expected cmn phoneme table/);
});

test('cmn length calculation uses the original tone pitch envelope', { skip: !available }, () => {
  const table = createPhonemeTables(readFileSync(phontabPath)).select(8);
  const list = createPhonemeListBuffer(13);
  const codes = new Array(13).fill(9), types = new Array(13).fill(0);
  codes[1] = 50;
  codes[2] = 37;
  types[1] = 8;
  types[2] = 2;
  for (let index = 0; index < codes.length; index++) {
    list.phcode[index] = codes[index];
    list.phonemeId[index] = codes[index] + 1;
    list.type[index] = types[index];
  }
  list.sourceix[1] = 1;
  list.newword[1] = 13;
  list.newword[4] = 2;
  list.synthflags[2] = 4;
  list.stresslevel[2] = 4;
  list.tonePh[2] = 115;
  list.pitch1[2] = 30;
  list.pitch2[2] = 50;
  const result = createLengthCalculator(table, CMN_LENGTH_PROFILE, {
    phonindexBytes: readFileSync(phonindexPath),
    phondataBytes: readFileSync(phondataPath)
  }).calculate(list, 9, { list: new Uint32Array(250), index: 0 });
  assert.equal(result.list.pitch1[1], 14);
  assert.equal(result.list.pitch2[1], 30);
});
