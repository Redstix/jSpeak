// Port of pinned numbers.c: LookupAccentedLetter/LookupLetter2 and dictionary.c:Lookup.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2016, 2020 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { ACCENT_PROFILE, ACCENT_CONSTANTS as C, ACCENT_NAMES, ACCENT_NON_ASCII, ACCENT_LATIN, ACCENT_IPA } from '../../data/accent/tables.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { writeUtf8CodePoint } from './unicode.js';
export { ACCENT_PROFILE } from '../../data/accent/tables.js';

function unsupported(reason) { var error = new Error('Accented letter dependency not implemented: ' + reason); error.code = 'ACCENT_UNSUPPORTED'; error.reason = reason; throw error; }
function bytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Expected phoneme Uint8Array');
  var end = 0; while (end < value.length && value[end]) end++;
  return value.slice(0, end);
}
function join(parts) {
  var size = 0, i, at = 0;
  for (i = 0; i < parts.length; i++) size += parts[i].length;
  var result = new Uint8Array(size);
  for (i = 0; i < parts.length; i++) { result.set(parts[i], at); at += parts[i].length; }
  return result;
}
function ascii(text) { var result = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) result[i] = text.charCodeAt(i); return result; }

// The same dictionary session must be used by the caller and these nested
// lookups so its repetition and skip-word side effects remain observable.
export function createLetterAccentLookup(dictionarySession, options) {
  if (!dictionarySession || typeof dictionarySession.lookup !== 'function') throw new TypeError('Expected dictionary session');
  var opts = options || {}, accents = opts.accents === undefined ? ACCENT_PROFILE.accents : opts.accents;
  if (!Number.isInteger(accents) || accents < 0 || accents > 255) throw new RangeError('Invalid accents option');
  function lookupSymbol(word) {
    var settings = { flags1: F.FLAG_LOOKUP_SYMBOL, endFlags: F.FLAG_ALLOW_TEXTMODE };
    if (opts.dictCondition !== undefined) settings.dictCondition = opts.dictCondition;
    var result = dictionarySession.lookup(word, settings);
    var flags = result.found ? result.flags[0] : 0, phonemes = result.phonemes;
    if (result.flags[0] & F.FLAG_TEXTMODE) {
      if (typeof opts.translateWord !== 'function') unsupported('translate-word-textmode');
      // Original Lookup makes an 80-byte buffer, with three leading bytes,
      // truncates replacement to 76 bytes, and clears option_sayas temporarily.
      var padded = new Uint8Array(80), text = bytes(result.word);
      padded[1] = padded[2] = 32; padded.set(text.subarray(0, 76), 3);
      var translated = opts.translateWord(padded, { offset: 3, sayAs: 0 });
      if (!translated || !Number.isInteger(translated.flags)) throw new TypeError('TranslateWord must return flags and phonemes');
      flags = translated.flags >>> 0; phonemes = bytes(translated.phonemes);
    }
    return { flags: flags >>> 0, phonemes: bytes(phonemes) };
  }
  function lookupLetter(letter) {
    var buffer = new Uint8Array(10); buffer[1] = 95;
    var length = writeUtf8CodePoint(letter, buffer, 2); buffer[length + 2] = 32;
    var result = lookupSymbol(buffer.subarray(1));
    if (result.flags === 0) {
      buffer[1] = 32; result = lookupSymbol(buffer.subarray(2));
      if (result.flags === 0) {
        if (typeof opts.translateRules !== 'function') unsupported('translate-rules-letter');
        result.phonemes = bytes(opts.translateRules(buffer, { offset: 2, capacity: 20, wordFlags: 0, phonemes: result.phonemes }));
        if (result.phonemes.length >= 20) throw new RangeError('TranslateRules exceeds original 20-byte capacity');
      }
    }
    if (result.phonemes.length >= 30) unsupported('letter-buffer-overflow');
    return result.phonemes;
  }
  function lookupAccentedLetter(letter, initial) {
    if (!Number.isInteger(letter) || letter < 0 || letter > 0xffffffff) throw new RangeError('Expected uint32 letter');
    var original = initial === undefined ? new Uint8Array(0) : bytes(initial);
    var data = 0, accent1 = 0, accent2 = 0, letter2 = 0;
    // Preserve the original exclusive U+017F bound, although the data table
    // includes that final long-s entry.
    if (letter >= 0xe0 && letter < 0x17f) data = ACCENT_LATIN[letter - 0xe0];
    else if (letter >= 0x250 && letter <= 0x2a8) data = ACCENT_IPA[letter - 0x250];
    if (data === 0) return original;
    var basic = (data & 63) + 59;
    if (basic < 97) basic = ACCENT_NON_ASCII[basic - 59];
    if (data & C.M_LIGATURE) { letter2 = ((data >> 6) & 63) + 59; accent2 = (data >> 12) & 7; }
    else { accent1 = (data >> 6) & 31; accent2 = (data >> 11) & 15; }
    if (accent1 === 0 && !(data & C.M_LIGATURE)) return original;
    var first = lookupSymbol(ascii(ACCENT_NAMES[accent1].name));
    if (first.phonemes.length >= 30) unsupported('accent-buffer-overflow');
    if (first.flags === 0) return original;
    var letterPhonemes = lookupLetter(basic);
    if (!letterPhonemes.length) return original;
    var second = new Uint8Array(0), before = new Uint8Array(0);
    if (accent2) {
      var next = lookupSymbol(ascii(ACCENT_NAMES[accent2].name)); second = next.phonemes;
      if (second.length >= 30) unsupported('accent-buffer-overflow');
      if (next.flags & F.FLAG_ACCENT_BEFORE) { before = second; second = new Uint8Array(0); }
    }
    var output;
    if (letter2) output = join([first.phonemes, Uint8Array.of(C.phonPAUSE_VSHORT), letterPhonemes, Uint8Array.of(C.phonSTRESS_P), lookupLetter(letter2), second]);
    else if (accent1 === 0) output = letterPhonemes;
    else if ((accents & 1) || (first.flags & F.FLAG_ACCENT_BEFORE) || (ACCENT_NAMES[accent1].flags & 1)) output = join([first.phonemes, Uint8Array.of(C.phonPAUSE_VSHORT, C.phonSTRESS_P), letterPhonemes]);
    else output = join([Uint8Array.of(C.phonSTRESS_2), letterPhonemes, Uint8Array.of(C.phonPAUSE_VSHORT), first.phonemes, Uint8Array.of(C.phonPAUSE_VSHORT)]);
    return join([before, output]);
  }
  // Expose the real Lookup/LookupLetter2 dependency boundaries for integration.
  lookupAccentedLetter.lookupSymbol = lookupSymbol;
  lookupAccentedLetter.lookupLetter = lookupLetter;
  return lookupAccentedLetter;
}
