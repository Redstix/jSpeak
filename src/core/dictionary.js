// Port of pinned dictionary.c list loading, TransposeAlphabet and LookupDictList.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington; 2013-2017 Reece H. Dunn.
// See licenses/espeak-ng/COPYING.txt. This module never performs runtime I/O.
import { createBinaryReader, byteHash32 } from '../data/binary.js';
import { TRANSPOSE_MAP, DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { readForward } from './utf8-scan.js';
import { isAlpha } from './unicode.js';

const COMMIT = 'ba90c8e9f440ad544f674a790bb5f53878b6ffc5';
const DICTIONARY_IDENTITIES = Object.freeze({
  'en-us': Object.freeze({ language: 'en', voice: 'en-us' }),
  cmn: Object.freeze({ language: 'cmn', voice: 'cmn' })
});
export { DICTIONARY_CONSTANTS } from '../../data/dictionary/profile.js';
function cLength(bytes, start) { var i = start || 0; while (i < bytes.length && bytes[i]) i++; return i - (start || 0); }
function same(a, aStart, b, bStart, count) {
  for (var i = 0; i < count; i++) if (a[aStart + i] !== b[bStart + i]) return false;
  return true;
}
function padded(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected dictionary input bytes');
  var length = cLength(bytes, 0); var result = new Uint8Array(length + 8); result.set(bytes.subarray(0, length)); return result;
}
export function hashDictionary(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected dictionary key bytes');
  var hash = 0, count = 0;
  while (count < bytes.length && bytes[count]) { hash = hash * 8 + bytes[count++]; hash = (hash & 0x3ff) ^ (hash >> 8); }
  return (hash + count) & 0x3ff;
}
export function transposeDictionaryWord(bytes) {
  var word = padded(bytes); var length = cLength(word, 0);
  if (length >= F.N_WORD_BYTES) throw new RangeError('Transpose input exceeds N_WORD_BYTES-1');
  var mapped = new Uint8Array(F.N_WORD_BYTES + 1), cursor = 0, used = 0, allAlpha = true;
  do {
    var decoded = readForward(word, cursor); var cp = decoded.codepoint; cursor += decoded.bytes;
    if (cp) {
      if (cp >= 96 && cp <= 383 && TRANSPOSE_MAP[cp - 96] > 0) mapped[used++] = TRANSPOSE_MAP[cp - 96];
      else { allAlpha = false; break; }
    }
  } while (cp !== 0 && used < F.N_WORD_BYTES);
  if (!allAlpha) return { bytes: word, length: length };
  var accumulator = 0, bits = 0, target = 0;
  for (var i = 0; i < used; i++) {
    accumulator = (accumulator << 6) + (mapped[i] & 63); bits += 6;
    if (bits >= 8) { bits -= 8; mapped[target++] = (accumulator >> bits) & 255; }
  }
  if (bits > 0) mapped[target++] = (accumulator << (8 - bits)) & 255;
  // C copies exactly compressed length, leaving the original suffix and NUL.
  // HashDictionary therefore sees that suffix, despite the compressed match length.
  word.set(mapped.subarray(0, target), 0);
  return { bytes: word, length: target | 0x40 };
}
export function loadDictionary(bytes, manifest) {
  if (!manifest || manifest.magic !== 'JSPEAK_RAW_DICTIONARY' || manifest.schemaVersion !== 1 || manifest.format !== 'espeak-ng-dict-v1' || manifest.upstreamCommit !== COMMIT || manifest.hashSpec !== 'xorshift32-byte-mix-seed0') throw new Error('Incompatible dictionary manifest');
  const identity = DICTIONARY_IDENTITIES[manifest.voice];
  if (!identity || manifest.language !== identity.language || manifest.voice !== identity.voice) throw new Error('Incompatible dictionary manifest');
  var binary = createBinaryReader(bytes);
  if (bytes.length !== manifest.byteLength || byteHash32(bytes) !== manifest.hash32) throw new Error('Dictionary length/checksum mismatch');
  if (binary.u32(0) !== 1024 || bytes.length <= 1032) throw new Error('Invalid dictionary header');
  var rulesOffset = binary.u32(4);
  if (rulesOffset < 1032 || rulesOffset >= bytes.length || rulesOffset !== manifest.rulesOffset) throw new Error('Invalid dictionary rule offset');
  var buckets = new Uint32Array(1024), at = 8, entryCount = 0;
  for (var bucket = 0; bucket < 1024; bucket++) {
    buckets[bucket] = at;
    while (binary.u8(at)) {
      var end = at + binary.u8(at);
      if (end > rulesOffset || end < at + 2) throw new Error('Invalid dictionary entry length');
      var header = binary.u8(at + 1), body = at + 2 + (header & 63);
      if (body > end) throw new Error('Dictionary word exceeds entry');
      if (!(header & 128)) {
        var phonemeEnd = binary.zeroEnd(body, end);
        if (phonemeEnd - body >= F.N_PHONEME_BYTES) throw new Error('Dictionary phonemes exceed C capacity');
        body = phonemeEnd + 1;
      }
      while (body < end) {
        var attribute = binary.u8(body++);
        if (attribute >= 164 || attribute === 64) throw new Error('Undefined dictionary condition shift');
        if (attribute > 80 && attribute < 100) { body = end; break; }
      }
      entryCount++; at = end;
    }
    at++;
    if (at > rulesOffset) throw new Error('Dictionary buckets overlap rules');
  }
  // The compiler aligns the rules section; any gap must be padding.
  while (at < rulesOffset) if (binary.u8(at++) !== 0) throw new Error('Nonzero dictionary alignment padding');
  var groups1 = new Uint32Array(256), groups2 = new Uint32Array(120), groups2Name = new Uint32Array(120), groups2Start = new Uint8Array(256), groups2Count = new Uint8Array(256), groups3 = new Uint32Array(128), letterGroups = new Uint32Array(95);
  groups2Start.fill(255); var groups2Used = 0, replacementOffset = 0;
  at = rulesOffset;
  if (binary.u8(at) !== F.RULE_GROUP_END) while (binary.u8(at) !== 0) {
    if (binary.u8(at++) !== F.RULE_GROUP_START) throw new Error('Invalid dictionary rule group');
    if (binary.u8(at) === F.RULE_REPLACEMENTS) {
      at = (at + 4) & ~3; replacementOffset = at;
      while (binary.u32(at) !== 0) at++;
      while (binary.u8(at) !== F.RULE_GROUP_END) at++;
      at++; continue;
    }
    if (binary.u8(at) === F.RULE_LETTERGP2) {
      var group = (binary.u8(at + 1) - 65) & 255; at += 2;
      if (group >= 95) throw new Error('Invalid dictionary letter group');
      letterGroups[group] = at;
    } else {
      var name = at, nameEnd = binary.zeroEnd(at), first = binary.u8(at), second = binary.u8(at + 1); at = nameEnd + 1;
      var size = nameEnd - name;
      if (size <= 1) groups1[first] = at;
      else if (first === 1) {
        if (second < 1 || second > 128) throw new Error('Invalid offset dictionary group');
        groups3[second - 1] = at;
      } else {
        if (groups2Used >= 120) throw new Error('Too many two-letter dictionary groups');
        if (groups2Start[first] === 255) groups2Start[first] = groups2Used;
        groups2Count[first]++; groups2[groups2Used] = at; groups2Name[groups2Used++] = first + (second << 8);
      }
    }
    while (binary.u8(at) !== F.RULE_GROUP_END) at = binary.zeroEnd(at) + 1;
    at++;
  }
  return { bytes: bytes, manifest: manifest, buckets: buckets, entryCount: entryCount, rulesOffset: rulesOffset,
    groups1: groups1, groups2: groups2, groups2Name: groups2Name, groups2Start: groups2Start, groups2Count: groups2Count, groups2Used: groups2Used,
    groups3: groups3, letterGroups: letterGroups, replacementOffset: replacementOffset };
}

export function createDictionarySession(dictionary, options) {
  if (!dictionary || !(dictionary.bytes instanceof Uint8Array) || !(dictionary.buckets instanceof Uint32Array)) throw new TypeError('Expected loaded dictionary');
  var opts = options || {};
  if (typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('Expected dictionary options');
  for (var option in opts) if (option !== 'lookupAccentedLetter' && option !== 'dictCondition' && option !== 'textmode') throw new TypeError('Unknown dictionary option: ' + option);
  if (opts.lookupAccentedLetter !== undefined && typeof opts.lookupAccentedLetter !== 'function') throw new TypeError('Expected accented-letter callback');
  if (opts.dictCondition !== undefined && (!Number.isInteger(opts.dictCondition) || opts.dictCondition < 0 || opts.dictCondition > 0xffffffff)) throw new RangeError('Invalid dictionary condition');
  if (opts.textmode !== undefined && typeof opts.textmode !== 'boolean') throw new TypeError('Expected dictionary textmode boolean');
  var repeat = new Uint8Array(0), repeatCount = 0, skipWords = 0;
  var context = { dictCondition: opts.dictCondition === undefined ? 72 : opts.dictCondition, expectVerb: 0, expectVerbS: 0, expectNoun: 0, expectPast: 0, prevDictFlags: 0, clauseTerminator: 0 };
  function setContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected dictionary context');
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(context, key)) throw new TypeError('Unknown shared dictionary context: ' + key);
      if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 0xffffffff) throw new RangeError('Invalid shared dictionary context: ' + key);
    }
    for (var field in value) context[field] = value[field];
  }
  function state() { return { repeatCount: repeatCount, repeat: repeat.slice(), skipWords: skipWords }; }
  function setState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected dictionary state');
    for (var key in value) {
      if (key === 'repeat') {
        if (!(value.repeat instanceof Uint8Array) || value.repeat.length > 19) throw new TypeError('Expected bounded repeat bytes');
      } else if (key === 'repeatCount' || key === 'skipWords') {
        if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 0x7fffffff) throw new RangeError('Invalid dictionary state: ' + key);
      } else throw new TypeError('Unknown dictionary state: ' + key);
    }
    if (value.repeat !== undefined) repeat = new Uint8Array(value.repeat.subarray(0, cLength(value.repeat, 0)));
    if (value.repeatCount !== undefined) repeatCount = value.repeatCount;
    if (value.skipWords !== undefined) skipWords = value.skipWords;
  }
  function unsupported(reason) { var error = new Error('Dictionary dependency not implemented: ' + reason); error.code = 'DICTIONARY_UNSUPPORTED'; error.reason = reason; throw error; }
  function lookup(input, settings) {
    var text = padded(input), inputLength = cLength(text, 0), setting = settings || {};
    if (typeof setting !== 'object' || Array.isArray(setting)) throw new TypeError('Expected dictionary lookup settings');
    setting = { ...context, ...setting };
    var numeric = ['endFlags', 'wordFlags', 'flags0', 'flags1', 'dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags', 'clauseTerminator', 'clauseEnd', 'withWord'];
    for (var key in setting) {
      if (numeric.indexOf(key) >= 0) {
        if (!Number.isInteger(setting[key]) || setting[key] < 0 || setting[key] > 0xffffffff) throw new RangeError('Invalid dictionary setting: ' + key);
      } else if (key === 'native') {
        if (typeof setting.native !== 'boolean') throw new TypeError('Expected native boolean');
      } else if (key === 'clauseEndRelation') {
        if (setting[key] !== 'in-source' && setting[key] !== 'unrelated') throw new TypeError('Unknown clause-end relation');
      } else if (key !== 'words') throw new TypeError('Unknown dictionary setting: ' + key);
    }
    if (setting.withWord > 1 || setting.clauseEnd > input.length) throw new RangeError('Dictionary context outside supplied input');
    if (setting.words !== undefined) {
      if (!Array.isArray(setting.words) || setting.words.length > 300) throw new TypeError('Expected bounded WORD_TAB entries');
      for (var wi = 0; wi < setting.words.length; wi++) {
        var entry = setting.words[wi];
        if (!entry || !Number.isInteger(entry.flags) || entry.flags < 0 || entry.flags > 0xffffffff || !Number.isInteger(entry.length) || entry.length < 0 || entry.length > 255) throw new TypeError('Invalid WORD_TAB entry');
      }
    }
    var flags = new Uint32Array([setting.flags0 || 0, setting.flags1 || 0]);
    var endFlags = setting.endFlags || 0, wordFlags = setting.words && setting.words.length ? setting.words[0].flags : setting.withWord ? setting.wordFlags || 0 : 0;
    var condition = setting.dictCondition === undefined ? 72 : setting.dictCondition;
    var clauseEnd = setting.clauseEnd === undefined ? input.length : setting.clauseEnd;
    var before = state(), phonemes = new Uint8Array(0), found = -1, replacement = null;
    function lookup2(original, nextWord) {
      var transformed = transposeDictionaryWord(original), word = transformed.bytes, width = transformed.length;
      var bytes = dictionary.bytes, at = dictionary.buckets[hashDictionary(word)], lookupSymbol = flags[1] & F.FLAG_LOOKUP_SYMBOL;
      while (bytes[at]) {
        var next = at + bytes[at], header = bytes[at + 1];
        if ((header & 127) !== width || !same(word, 0, bytes, at + 2, width & 63)) { at = next; continue; }
        var cursor = at + 2 + (header & 63), dictionaryFlags = 0, dictionaryFlags2 = 0, failed = false, wordEnd = nextWord;
        if (header & 128) phonemes = new Uint8Array(0);
        else { var phEnd = cursor; while (bytes[phEnd]) phEnd++; phonemes = new Uint8Array(bytes.subarray(cursor, phEnd)); cursor = phEnd + 1; }
        while (cursor < next) {
          var flag = bytes[cursor++];
          if (flag >= 100) {
            if (flag >= 132) { if (condition & (1 << (flag - 132))) failed = true; }
            else if (!(condition & (1 << (flag - 100)))) failed = true;
          } else if (flag > 80) {
            var count = flag - 80, chars = next - cursor, wtab = setting.words;
            if (wtab && wtab.length > count) for (var i = 0; i <= count && wtab[i].length; i++) if (wtab[i].flags & F.FLAG_EMPHASIZED2) failed = true;
            if (!same(text, nextWord, bytes, cursor, chars)) failed = true;
            if (!failed) { dictionaryFlags |= F.FLAG_SKIPWORDS; skipWords = count; wordEnd = nextWord + chars; }
            cursor = next;
          } else if (flag > 64) {
            dictionaryFlags = (dictionaryFlags & ~15) | (flag & 15);
            if ((flag & 12) === 12) dictionaryFlags |= F.FLAG_STRESS_END;
          } else if (flag >= 32) dictionaryFlags2 |= 1 << (flag - 32);
          else dictionaryFlags |= 1 << flag;
        }
        at = next;
        if (failed) continue;
        if (!(endFlags & F.FLAG_SUFX) && (dictionaryFlags2 & F.FLAG_STEM)) continue;
        if ((endFlags & F.SUFX_P) && (dictionaryFlags2 & (F.FLAG_ONLY | F.FLAG_ONLY_S))) continue;
        if (endFlags & F.FLAG_SUFX) {
          if (dictionaryFlags2 & F.FLAG_ONLY) continue;
          if ((dictionaryFlags2 & F.FLAG_ONLY_S) && !(endFlags & F.FLAG_SUFX_S)) continue;
        }
        if ((dictionaryFlags2 & F.FLAG_CAPITAL) && !(wordFlags & F.FLAG_FIRST_UPPER)) continue;
        if ((dictionaryFlags2 & F.FLAG_ALLCAPS) && !(wordFlags & F.FLAG_ALL_UPPER)) continue;
        if ((dictionaryFlags & F.FLAG_NEEDS_DOT) && !(wordFlags & F.FLAG_HAS_DOT)) continue;
        if ((dictionaryFlags2 & F.FLAG_ATEND) && !lookupSymbol) {
          if (setting.clauseEndRelation === 'unrelated') unsupported('unrelated-clause-end-comparison');
          if (wordEnd < clauseEnd) continue;
        }
        if ((dictionaryFlags2 & F.FLAG_ATSTART) && !(wordFlags & F.FLAG_FIRST_WORD)) continue;
        if ((dictionaryFlags2 & F.FLAG_SENTENCE) && !((setting.clauseTerminator || 0) & 0x80000)) continue;
        if (dictionaryFlags2 & F.FLAG_VERB) {
          if (!(setting.expectVerb || (setting.expectVerbS && (endFlags & F.FLAG_SUFX_S)))) continue;
          if (((setting.prevDictFlags || 0) & F.FLAG_ALT7_TRANS) && (endFlags & F.FLAG_SUFX_S)) continue;
        }
        if ((dictionaryFlags2 & F.FLAG_PAST) && !setting.expectPast) continue;
        if ((dictionaryFlags2 & F.FLAG_NOUN) && (!setting.expectNoun || (endFlags & F.SUFX_V))) continue;
        if ((dictionaryFlags2 & F.FLAG_NATIVE) && setting.native === false) continue;
        flags[0] = (dictionaryFlags | F.FLAG_FOUND_ATTRIBUTES) >>> 0; flags[1] = dictionaryFlags2 >>> 0;
        if (!phonemes.length) return -1;
        flags[0] |= F.FLAG_FOUND;
        var decoded = readForward(word, 0);
        if (word[decoded.bytes] === 0 && !isAlpha(decoded.codepoint)) flags[0] |= F.FLAG_MAX3;
        return wordEnd;
      }
      return -1;
    }
    var word = new Uint8Array(F.N_WORD_BYTES + 8), length = 0, word1 = 0, word2 = 0;
    function utf8Width(offset) { var c = text[offset]; return c < 128 ? 1 : c < 224 ? 2 : c < 240 ? 3 : 4; }
    var nbytes;
    while (text[word2 + (nbytes = utf8Width(word2))] === 32 && text[word2 + nbytes + 1] === 46) {
      if (nbytes + 1 > F.N_WORD_BYTES - length) { length = 0; break; }
      word.set(text.subarray(word2, word2 + nbytes), length); length += nbytes; word[length++] = 46; word2 += nbytes + 3;
    }
    if (length > 0) {
      nbytes = 0; while (text[word2 + nbytes] && text[word2 + nbytes] !== 32) nbytes++;
      if (length + nbytes + 1 <= F.N_WORD_BYTES) {
        word.set(text.subarray(word2, word2 + nbytes), length); word[length + nbytes] = 0;
        found = lookup2(word, word2);
        if (found >= 0) { flags[0] |= F.FLAG_SKIPWORDS; skipWords = length; return finish(1); }
      }
    }
    for (length = 0; length < F.N_WORD_BYTES - 1; length++) {
      var c = text[word1++]; if (!c || c === 32) break;
      if (c === 46 && length > 0 && word[length - 1] >= 48 && word[length - 1] <= 57) break;
      word[length] = c;
    }
    word[length] = 0;
    found = lookup2(word, word1);
    if (flags[0] & F.FLAG_MAX3) {
      if (repeat.length === phonemes.length && same(repeat, 0, phonemes, 0, repeat.length)) { repeatCount++; if (repeatCount > 3) phonemes = new Uint8Array(0); }
      else { repeat = phonemes.slice(0, 19); repeatCount = 1; }
    } else repeatCount = 0;
    if (found < 0 && (flags[1] & F.FLAG_ACCENT)) {
      if (typeof opts.lookupAccentedLetter !== 'function') unsupported('accented-letter');
      var start = word[0] === 95 ? 1 : 0, letter = readForward(word, start);
      phonemes = opts.lookupAccentedLetter(letter.codepoint, phonemes);
      if (!(phonemes instanceof Uint8Array)) throw new TypeError('Accented letter callback must return Uint8Array');
      found = start + letter.bytes;
    }
    if (found < 0 && length >= 2) {
      phonemes = new Uint8Array(0);
      if (((endFlags & F.FLAG_SUFX_E_ADDED) && word[length - 1] === 101) || ((endFlags & F.SUFX_D) && word[length - 1] === word[length - 2])) {
        word[length - 1] = 0; found = lookup2(word, word1);
      }
    }
    if (found >= 0) {
      if (opts.textmode === true) flags[0] = (flags[0] ^ F.FLAG_TEXTMODE) >>> 0;
      if (flags[0] & F.FLAG_TEXTMODE) {
        if (endFlags & F.FLAG_ALLOW_TEXTMODE) { replacement = new Uint8Array(phonemes.length + 1); replacement.set(phonemes); replacement[phonemes.length] = 32; }
        phonemes = new Uint8Array(0); return finish(0);
      }
      return finish(1);
    }
    phonemes = new Uint8Array(0); return finish(0);
    function finish(foundValue) {
      return { found: foundValue, flags: flags, phonemes: phonemes, replacement: replacement !== null,
        word: replacement || text.slice(0, inputLength), stateBefore: before, stateAfter: state() };
    }
  }
  return { lookup: lookup, state: state, setState: setState, setContext: setContext,
    context: function () { return { ...context }; }, resetRepeat: function () { repeatCount = 0; } };
}
