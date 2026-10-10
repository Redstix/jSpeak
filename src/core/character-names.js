// Pinned readclause.c LookupSpecial, LookupCharName and DecodeWithPhonemeMode.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington; 2015-2017 Reece H. Dunn.
import { writeUtf8CodePoint } from './unicode.js';
import { decodePhonemes } from './phoneme-table.js';

export function createCharacterNames(dictionarySession, selectedTable, stressSession, options) {
  if (!dictionarySession || typeof dictionarySession.lookup !== 'function' || typeof dictionarySession.resetRepeat !== 'function' || typeof dictionarySession.state !== 'function') throw new TypeError('Expected dictionary session');
  if (!stressSession || typeof stressSession.setWordStress !== 'function') throw new TypeError('Expected word stress session');
  var opts = options || {};
  function unsupported(reason) { var error = new Error('Character-name dependency not implemented: ' + reason); error.code = 'CHARACTER_NAME_UNSUPPORTED'; error.reason = reason; throw error; }
  function decode(phonemes, flags, capacity) {
    if (phonemes.length >= capacity) unsupported('original-phoneme-buffer-capacity');
    var stressed = stressSession.setWordStress(phonemes, { dictionaryFlags: flags[0], tonic: -1, control: 0 }).phonemes;
    if (stressed.length >= capacity) unsupported('original-stress-buffer-capacity');
    var decoded = decodePhonemes(stressed, selectedTable);
    if (decoded.length >= 55) unsupported('original-decoded-buffer-capacity');
    var output = new Uint8Array(decoded.length + 4);
    output[0] = 91; output[1] = 2; output.set(decoded, 2); output[output.length - 2] = 93; output[output.length - 1] = 93;
    return output;
  }
  function lookupSpecial(input) {
    var result = dictionarySession.lookup(input);
    return result.found ? decode(result.phonemes, result.flags, 55) : null;
  }
  function lookupCharName(codepoint, only) {
    if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0xffffffff || typeof only !== 'boolean') throw new TypeError('Expected uint32 codepoint and only boolean');
    var letter = new Uint8Array(24); letter[1] = 95;
    var width = writeUtf8CodePoint(codepoint, letter, 2);
    var result;
    if (only) result = dictionarySession.lookup(letter.subarray(2, 2 + width));
    else {
      result = dictionarySession.lookup(letter.subarray(1, 2 + width));
      if (!result.found) {
        result = dictionarySession.lookup(letter.subarray(2, 2 + width), { flags0: result.flags[0], flags1: result.flags[1] });
        if (!result.found) {
          if (typeof opts.translateRules !== 'function') unsupported('translate-rules-character');
          letter[1] = 32;
          var rules = opts.translateRules(letter, { offset: 2, capacity: 60, wordFlags: 0 });
          if (!(rules instanceof Uint8Array)) throw new TypeError('Character rule callback must return Uint8Array');
          result.phonemes = rules;
        }
      }
    }
    if (result.phonemes.length) return decode(result.phonemes, result.flags, 60);
    return only ? new Uint8Array(0) : Uint8Array.of(91, 2, 40, 88, 49, 41, 40, 88, 49, 41, 40, 88, 49, 41, 93, 93);
  }
  return { lookupCharName: lookupCharName, lookupSpecial: lookupSpecial,
    resetRepeat: dictionarySession.resetRepeat, state: dictionarySession.state };
}
