// Pinned dictionary.c:RemoveEnding, initialized en-us suffix behavior.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.
import { WORD_ENDING_PROFILE, ADD_E_EXCEPTIONS, ADD_E_ADDITIONS } from '../../data/word-ending/profile.js';
import { CMN_WORD_ENDING_PROFILE } from '../../data/cmn/synthesis-profile.js';
import { LETTER_BITS, LETTER_GROUPS, REMOVE_ACCENT, RULE_PROFILE } from '../../data/rules/profile.js';
import { writeUtf8CodePoint } from './unicode.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
export { WORD_ENDING_PROFILE };

function isLetter(byte, group) {
  // RemoveEnding passes plain C chars to IsLetter; non-ASCII bytes are signed.
  var cp = byte >= 128 ? byte - 256 : byte;
  if (LETTER_GROUPS[group] !== null) return LETTER_GROUPS[group].indexOf(cp) >= 0;
  if (cp >= 0xc0 && cp < RULE_PROFILE.removeAccentLimit) return LETTER_BITS[REMOVE_ACCENT[cp - 0xc0]] & (1 << group);
  return cp >= 0 && cp < 256 ? LETTER_BITS[cp] & (1 << group) : 0;
}
function int32(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new RangeError('Invalid ' + label);
}
export function removeEnding(input, endType, profile, options) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Expected word Uint8Array');
  int32(endType, 'ending type');
  if (!profile || typeof profile !== 'object') throw new TypeError('Expected explicit initialized ending profile');
  var knownProfiles = { 'en-us': WORD_ENDING_PROFILE, cmn: CMN_WORD_ENDING_PROFILE };
  var expectedProfile = knownProfiles[profile.voice];
  if (!expectedProfile || JSON.stringify(profile) !== JSON.stringify(expectedProfile)) throw new Error('Unsupported word-ending profile');
  var opts = options || {}, expectVerb = opts.expectVerb === undefined ? 0 : opts.expectVerb;
  var copyWord = opts.copyWord === undefined ? true : opts.copyWord;
  int32(expectVerb, 'expected verb');
  if (typeof copyWord !== 'boolean') throw new TypeError('Expected word-copy boolean');
  var length = 0;
  while (length < input.length && input[length] !== 0) length++;
  var word = new Uint8Array(length + 12), start = 3;
  word[0] = word[1] = word[2] = 32;
  word.set(input.subarray(0, length), start); word[start + length] = 32;
  var end = start;
  while (word[end] !== 32) { if (word[end] === 69) word[end] = 101; end++; }
  var original = copyWord ? word.slice(start, start + Math.min(end - start, profile.wordCopyCapacity - 1)) : null;
  var endingBytes = endType & 0x3f;
  for (var count = endingBytes; count > 0; count--) {
    if (end <= start) throw new RangeError('Suffix starts before the logical word');
    end--;
    while (end >= start && (word[end] & 0xc0) === 0x80) { end--; endingBytes++; }
    if (end < start) throw new RangeError('Suffix continuation sequence leaves logical word');
  }
  var removed = Math.min(endingBytes, profile.endingCapacity - 1), ending = word.slice(end, end + removed);
  word.fill(32, end, end + removed);
  end--;
  var endFlags = (endType & 0xfff0) | F.FLAG_SUFX;
  if ((endType & F.SUFX_I) && word[end] === 105) word[end] = 121;
  if (endType & F.SUFX_E) {
    if (isLetter(word[end - 1], 7) && isLetter(word[end], 1)) {
      if (!ADD_E_EXCEPTIONS.some(matches)) endFlags |= F.FLAG_SUFX_E_ADDED;
    } else if (ADD_E_ADDITIONS.some(matches)) endFlags |= F.FLAG_SUFX_E_ADDED;
    if (endFlags & F.FLAG_SUFX_E_ADDED) writeUtf8CodePoint(profile.suffixAddE, word, end + 1);
  }
  if ((endType & F.SUFX_V) && expectVerb === 0) expectVerb = 1;
  if ((ending.length === 1 && ending[0] === 115) || (ending.length === 2 && ending[0] === 101 && ending[1] === 115)) endFlags |= F.FLAG_SUFX_S;
  if (ending[0] === 39) endFlags &= ~F.FLAG_SUFX;
  // A zero-length suffix can add e over our synthetic trailing space.
  var resultLength = length + (word[start + length] !== 32 ? 1 : 0);
  return { word: word.slice(start, start + resultLength), wordCopy: original, endFlags: endFlags, expectVerb: expectVerb };

  function matches(suffix) {
    var position = end + 1 - suffix.length;
    if (position < start) return false;
    for (var i = 0; i < suffix.length; i++) if (word[position + i] !== suffix.charCodeAt(i)) return false;
    return true;
  }
}
