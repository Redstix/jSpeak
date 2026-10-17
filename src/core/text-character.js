// Pinned translate.c/tr_languages.c character preprocessing, fixed en-us profile.
// Copyright (C) 2005-2015 Jonathan Duddington. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt. No host codecs or Unicode predicates.
import { iswUpper, toLowerCodePoint, toUpperCodePoint } from './unicode.js';
import { readForward } from './utf8-scan.js';
import { TEXT_CHARACTER_PROFILE, TEXT_CHARACTER_CONSTANTS, REPLACEMENT_BYTES, ALPHABETS } from '../../data/text/tables.js';

export { TEXT_CHARACTER_PROFILE };
export var FLAG_CHAR_REPLACED = TEXT_CHARACTER_CONSTANTS.FLAG_CHAR_REPLACED;
export var ALPHABET_FLAGS = Object.freeze({
  DONT_NAME: TEXT_CHARACTER_CONSTANTS.AL_DONT_NAME,
  NOT_LETTERS: TEXT_CHARACTER_CONSTANTS.AL_NOT_LETTERS,
  WORDS: TEXT_CHARACTER_CONSTANTS.AL_WORDS,
  NOT_CODE: TEXT_CHARACTER_CONSTANTS.AL_NOT_CODE,
  NO_SYMBOL: TEXT_CHARACTER_CONSTANTS.AL_NO_SYMBOL,
  IDEOGRAPHS: TEXT_CHARACTER_CONSTANTS.AL_IDEOGRAPHS
});

function uint32(cp) {
  if (typeof cp !== 'number' || !Number.isInteger(cp) || cp < 0 || cp > 0xffffffff) throw new RangeError('Expected uint32 code point');
}
export function alphabetFromChar(cp) {
  uint32(cp);
  for (var i = 0; i < ALPHABETS.length; i++) {
    var alphabet = ALPHABETS[i];
    if (cp <= alphabet.rangeMax) return cp >= alphabet.rangeMin ? alphabet : null;
  }
  return null;
}
export function shouldSplitIdeographs(cp, previous, profile) {
  uint32(cp); uint32(previous);
  var supplied = profile || TEXT_CHARACTER_PROFILE;
  if (supplied.ideographs && (cp > 0x3040 || previous > 0x3040)) return true;
  if (supplied.altAlphabet !== 0) {
    var currentAlphabet = alphabetFromChar(cp), previousAlphabet = alphabetFromChar(previous);
    if ((currentAlphabet !== null && currentAlphabet.offset === supplied.altAlphabet && (currentAlphabet.flags & ALPHABET_FLAGS.IDEOGRAPHS)) ||
        (previousAlphabet !== null && previousAlphabet.offset === supplied.altAlphabet && (previousAlphabet.flags & ALPHABET_FLAGS.IDEOGRAPHS))) return true;
  }
  return false;
}

var HANGUL_COMPATIBILITY = new Uint8Array([
  0, 0x00, 0x01, 0xaa, 0x02, 0xac, 0xad, 0x03,
  0x04, 0x05, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb4,
  0xb6, 0x06, 0x07, 0x08, 0xb9, 0x09, 0x0a, 0xbc,
  0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x61,
  0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71,
  0x72, 0x73, 0x74, 0x75
]);

// Keeps the static SubstituteChar counter within one text session. The caller
// reuses this session across clauses and feeds an inserted code point through
// TranslateChar again, exactly like TranslateClause's char_inserted path.
export function createTextCharacterSession(profile) {
  var supplied = profile || TEXT_CHARACTER_PROFILE;
  var replacementBytes = supplied === TEXT_CHARACTER_PROFILE ? REPLACEMENT_BYTES :
    supplied.replacementBytes instanceof Uint8Array ? supplied.replacementBytes : null;
  if (replacementBytes === null) throw new TypeError('Expected language replacement bytes');
  var ignoreNextN = 0;
  function lower(cp) { return toLowerCodePoint(cp, supplied.dotlessI !== 0); }
  function findReplacement(c, next, nextOffset) {
    var from = 0;
    while (replacementBytes[from] || replacementBytes[from + 1] || replacementBytes[from + 2] || replacementBytes[from + 3]) {
      var fc = readForward(replacementBytes, from); from += fc.bytes;
      if (c === fc.codepoint) {
        if (replacementBytes[from] === 0) return from + 1;
        var matched = true, nmatched = 0, matchNext = nextOffset;
        while (replacementBytes[from] !== 0) {
          fc = readForward(replacementBytes, from); from += fc.bytes;
          var nc = readForward(next, matchNext); matchNext += nc.bytes;
          if (lower(nc.codepoint) !== fc.codepoint) matched = false;
          else nmatched++;
        }
        if (matched) { ignoreNextN = nmatched; return from + 1; }
      }
      while (replacementBytes[from] !== 0) from++;
      from++;
      while (replacementBytes[from] !== 0) from++;
      from++;
    }
    return -1;
  }
  function substitute(source, nextOffset, c, nextIn, insert, wordFlags) {
    if (ignoreNextN > 0) { ignoreNextN--; return { codepoint: 8, insert: insert, wordFlags: wordFlags }; }
    if (c === 0) return { codepoint: 0, insert: insert, wordFlags: wordFlags };
    var upperCase = iswUpper(c) !== 0;
    var to = findReplacement(upperCase ? lower(c) : c, source, nextOffset);
    if (to < 0) return { codepoint: c, insert: insert, wordFlags: wordFlags };
    var first = readForward(replacementBytes, to); to += first.bytes;
    var newC = first.codepoint;
    if (replacementBytes[to] !== 0) {
      var second = readForward(replacementBytes, to).codepoint;
      insert = upperCase && iswUpper(nextIn) ? toUpperCodePoint(second) : second;
    }
    if (upperCase) newC = toUpperCodePoint(newC);
    return { codepoint: newC, insert: insert, wordFlags: (wordFlags | FLAG_CHAR_REPLACED) >>> 0 };
  }
  function translate(source, nextOffset, prevIn, c, nextIn, insert, wordFlags) {
    if (!(source instanceof Uint8Array)) throw new TypeError('Expected source Uint8Array');
    if (!Number.isInteger(nextOffset) || nextOffset < 0 || nextOffset >= source.length) throw new RangeError('Next offset outside source backing');
    uint32(prevIn); uint32(c); uint32(nextIn);
    if (insert === undefined) insert = 0;
    if (wordFlags === undefined) wordFlags = 0;
    uint32(insert); uint32(wordFlags);
    var code = c - 0xac00;
    if (code >= 0 && c <= 0xd7af) {
      var initial = Math.floor(code / (28 * 21));
      var medial = Math.floor(code / 28) % 21;
      var final = code % 28;
      if (initial === 11) {
        c = medial + 0x1161;
        if (final > 0) insert = final + 0x11a7;
      } else {
        c = initial + 0x1100;
        insert = 11 * 28 * 21 + medial * 28 + final + 0xac00;
      }
      return { codepoint: c, insert: insert, wordFlags: wordFlags };
    }
    code = c - 0x3130;
    if (code >= 0 && code < HANGUL_COMPATIBILITY.length) return { codepoint: HANGUL_COMPATIBILITY[code] + 0x1100, insert: insert, wordFlags: wordFlags };
    // The af/nl source-mutating branch is unreachable for exported en-us.
    return substitute(source, nextOffset, c, nextIn, insert, wordFlags);
  }
  return { translate: translate, state: function () { return { ignoreNextN: ignoreNextN }; } };
}
