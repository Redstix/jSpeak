import test from 'node:test';
import assert from 'node:assert/strict';
import { createLetterNames } from '../src/core/letter-names.js';
import { existsSync, readFileSync } from 'node:fs';
import { loadDictionary } from '../src/core/dictionary.js';
import { createPhonemeTables } from '../src/core/phoneme-table.js';
import { createEnglishWordServices } from '../src/core/word-services.js';
function mock(results) {
  const calls = [];let i = 0;
  const accent = (cp, initial) => initial;
  accent.lookupSymbol = bytes => { calls.push(bytes.slice());return results[i++]; };
  return { accent, calls };
}
test('normal text suppresses underscore names and keeps the first Lookup output', () => {
  const mocker = mock([{ flags: 0, phonemes: Uint8Array.of(9) }, { flags: 1, phonemes: Uint8Array.of(10) }]);
  const service = createLetterNames(mocker.accent, { setWordStress() { throw new Error('No normal-text stress call'); } });
  assert.deepEqual(service.lookupLetter(45), Uint8Array.of(9));
  assert.deepEqual(mocker.calls.map(bytes => [...bytes.slice(0, bytes.indexOf(0))]), [[45, 32], [95, 45, 32]]);
});
test('spelling names retain end-of-word versus spelling continuation bytes', () => {
  for (const nextLetter of [32, 65]) {
    const mocker = mock([{ flags: 1, phonemes: Uint8Array.of(44) }]);let received;
    const service = createLetterNames(mocker.accent, { setWordStress(bytes, options) { received = options;return { phonemes: bytes }; } });
    assert.deepEqual(service.lookupLetter(65, { nextLetter, control: 3 }), Uint8Array.of(44));
    assert.deepEqual(mocker.calls[0].slice(0, 4), Uint8Array.of(95, 65, 32, nextLetter === 32 ? 32 : 31));
    assert.deepEqual(received, { dictionaryFlags: 0, tonic: -1, control: 1 });
  }
});
test('whitespace spelling uses original numeric dictionary name', () => {
  const mocker = mock([{ flags: 1, phonemes: Uint8Array.of(7) }]);
  const service = createLetterNames(mocker.accent, { setWordStress() { throw new Error('Unexpected whitespace stress'); } });
  assert.deepEqual(service.lookupLetter(0x3000, { nextLetter: 32 }), Uint8Array.of(7));
  assert.equal(Buffer.from(mocker.calls[0].subarray(0, 8)).toString(), '_#12288 ');
});
test('unavailable spelling rule is reported at its actual dependency boundary', () => {
  const mocker = mock([{ flags: 0, phonemes: new Uint8Array(0) }, { flags: 0, phonemes: new Uint8Array(0) }]);
  assert.throws(() => createLetterNames(mocker.accent, { setWordStress() {} }).lookupLetter(65, { nextLetter: 32 }), error => error.code === 'LETTER_NAME_UNSUPPORTED' && error.reason === 'translate-rules-letter');
});
const tableFile = new URL('../build/oracle/espeak-ng-data/phontab', import.meta.url);
test('real textmode symbol preserves the original append after a zero-flags translation', { skip: existsSync(tableFile) ? false : 'Build pinned reference data before original-letter integration tests' }, () => {
  const dictionary = loadDictionary(new Uint8Array(readFileSync(new URL('../data/dictionary/en_dict.bin', import.meta.url))), JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url))));
  const tables = createPhonemeTables(new Uint8Array(readFileSync(tableFile)));
  const services = createEnglishWordServices(dictionary, tables.select(80));
  // Original Lookup returns zero flags and nonempty "cents" phonemes. The
  // subsequent TranslateRules appends to that output, so C says it twice.
  assert.equal(Buffer.from(services.letters.lookupLetter(162, { nextLetter: 32 })).toString('hex'), '5a067b322f5a5a067b322f5a');
});
