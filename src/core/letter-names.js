// Original numbers.c LookupLetter, initialized en-us translator.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2016, 2020 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { writeUtf8CodePoint, iswSpace } from './unicode.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';

export function createLetterNames(accentLookup, stressSession, options) {
  if (typeof accentLookup !== 'function' || typeof accentLookup.lookupSymbol !== 'function') throw new TypeError('Expected shared accent/Lookup service');
  if (!stressSession || typeof stressSession.setWordStress !== 'function') throw new TypeError('Expected word stress session');
  var opts = options || {};
  function unsupported(reason) { var error = new Error('Letter-name dependency not implemented: ' + reason); error.code = 'LETTER_NAME_UNSUPPORTED'; error.reason = reason; throw error; }
  function lookupLetter(letter, context) {
    if (!Number.isInteger(letter) || letter < 0 || letter > 0xffffffff) throw new RangeError('Expected uint32 letter');
    var setting = context || {}, next = setting.nextLetter === undefined ? -1 : setting.nextLetter, control = setting.control === undefined ? 0 : setting.control;
    if (!Number.isInteger(next) || next < -1 || next > 255 || !Number.isInteger(control) || control < 0 || control > 0x7fffffff) throw new RangeError('Invalid letter-name context');
    var single = new Uint8Array(10), width = writeUtf8CodePoint(letter, single, 2);single[width + 2] = 32;
    var result;
    if (next === -1) {
      result = accentLookup.lookupSymbol(single.subarray(2));
      if (result.flags) return result.phonemes;
      single[1] = 95;
      accentLookup.lookupSymbol(single.subarray(1));
      // Original tr=en returns here whether the underscore name was found.
      return result.phonemes;
    }
    if (letter <= 32 || iswSpace(letter)) {
      var name = '_#' + letter + ' ';
      if (name.length + 2 > single.length) unsupported('original-space-name-buffer-capacity');
      for (var i = 0; i < name.length; i++) single[i + 1] = name.charCodeAt(i);
      single[name.length + 1] = 0;
      return accentLookup.lookupSymbol(single.subarray(1)).phonemes;
    }
    single[width + 3] = next === 32 ? 32 : F.RULE_SPELLING;single[1] = 95;
    result = accentLookup.lookupSymbol(single.subarray(1));
    if (!result.flags) {
      single[1] = 32;result = accentLookup.lookupSymbol(single.subarray(2));
      if (!result.flags) {
        if (typeof opts.translateRules !== 'function') unsupported('translate-rules-letter');
        result.phonemes = opts.translateRules(single, { offset: 2, capacity: F.N_PHONEME_BYTES, wordFlags: F.FLAG_NO_TRACE, phonemes: result.phonemes });
        if (!(result.phonemes instanceof Uint8Array)) throw new TypeError('Letter rule callback must return Uint8Array');
      }
    }
    if (!result.phonemes.length) result.phonemes = accentLookup(letter, result.phonemes);
    if (!result.phonemes.length || result.phonemes[0] === 21) return result.phonemes;
    if (result.phonemes.length >= F.N_PHONEME_BYTES) unsupported('original-phoneme-buffer-capacity');
    var stressed = stressSession.setWordStress(result.phonemes, { dictionaryFlags: 0, tonic: -1, control: control & 1 }).phonemes;
    if (stressed.length >= F.N_PHONEME_BYTES) unsupported('original-stress-buffer-capacity');
    return stressed;
  }
  return { lookupLetter: lookupLetter };
}
