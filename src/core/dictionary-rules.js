// Original dictionary.c rule matching and fixed en-us TranslateRules behavior.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt. Adapters supply original dictionary data.
import { DICTIONARY_CONSTANTS as F } from './dictionary.js';
import { readForward, readBackward } from './utf8-scan.js';
import { isAlpha, iswAlpha, isDigit, bracketIndex } from './unicode.js';
import { alphabetFromChar } from './text-character.js';
import { RULE_PROFILE, LETTER_BITS, LETTER_GROUPS, REMOVE_ACCENT } from '../../data/rules/profile.js';
export { RULE_PROFILE };

function cLength(bytes, start) { var i = start; while (i < bytes.length && bytes[i]) i++; return i - start; }
function uint(value, label) { if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Invalid ' + label); }
function copyString(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected rule input Uint8Array');
  return new Uint8Array(bytes.subarray(0, cLength(bytes, 0)));
}
function isLetter(cp, group) {
  if (group < 0 || group > 7) return 0;
  var letters = LETTER_GROUPS[group];
  if (letters !== null) return letters.indexOf(cp) >= 0 ? 1 : 0;
  if (cp >= 0xc0 && cp < RULE_PROFILE.removeAccentLimit) return LETTER_BITS[REMOVE_ACCENT[cp - 0xc0]] & (1 << group);
  return cp >= 0 && cp < 256 ? LETTER_BITS[cp] & (1 << group) : 0;
}

export function createDictionaryRulesSession(dictionary, selectedTable, profile, options) {
  if (!dictionary || !(dictionary.bytes instanceof Uint8Array) || !(dictionary.groups1 instanceof Uint32Array)) throw new TypeError('Expected loaded original dictionary');
  if (!selectedTable || selectedTable.index !== 80 || selectedTable.name !== 'en-us') throw new TypeError('Expected original en-us phoneme table');
  if (!profile) throw new TypeError('Expected explicit initialized rule profile');
  var profileKeys = Object.keys(RULE_PROFILE);
  for (var pk = 0; pk < profileKeys.length; pk++) if (profile[profileKeys[pk]] !== RULE_PROFILE[profileKeys[pk]]) throw new Error('Unsupported rule profile: ' + profileKeys[pk]);
  var dependencies = options || {}, dictSession = dependencies.dictionarySession;
  var current = { wordVowelCount: 0, wordStressedCount: 0, prePause: 0, repeatCount: 0, skipWords: 0 };
  var db = dictionary.bytes;
  function unsupported(reason) {
    var error = new Error('Dictionary rules dependency not implemented: ' + reason);
    error.code = 'DICTIONARY_RULES_UNSUPPORTED'; error.reason = reason; throw error;
  }
  function at(bytes, index) {
    if (index < 0 || index >= bytes.length) throw new RangeError('Dictionary rule read outside backing buffer at ' + index);
    return bytes[index];
  }
  function ruleByte(index) { return at(db, index); }
  function phonemesAt(index) { return index === null ? new Uint8Array(0) : new Uint8Array(db.subarray(index, index + cLength(db, index))); }
  function syncDictionary() {
    if (dictSession) {
      var state = dictSession.state(); current.repeatCount = state.repeatCount; current.skipWords = state.skipWords;
    }
  }
  function state() { syncDictionary(); return { ...current }; }
  function setState(patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('Expected rules state patch');
    var keys = Object.keys(patch);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], value = patch[key];
      if (key !== 'wordVowelCount' && key !== 'wordStressedCount' && key !== 'prePause') throw new RangeError('Unknown rules state field: ' + key);
      if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new RangeError('Invalid rules state: ' + key);
    }
    for (var j = 0; j < keys.length; j++) current[keys[j]] = patch[keys[j]];
    return state();
  }
  function appendPhonemes(input, added, capacity) {
    var phonemes = copyString(input), extra = copyString(added);
    if (capacity === undefined) capacity = F.N_WORD_PHONEMES;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > F.N_WORD_PHONEMES) throw new RangeError('Invalid append phoneme capacity');
    if (phonemes.length + extra.length >= capacity) return phonemes;
    var unstressMark = false;
    for (var i = 0; i < extra.length; i++) {
      var code = extra[i];
      if (code >= selectedTable.nPhonemes || selectedTable.entries[code] === null) continue;
      var ph = selectedTable.entries[code];
      if (ph.type === 1) { if (ph.stdLength < 4) unstressMark = true; }
      else if (ph.type === 2) {
        if (!(ph.phflags & 2) && !unstressMark) current.wordStressedCount = (current.wordStressedCount + 1) | 0;
        unstressMark = false; current.wordVowelCount = (current.wordVowelCount + 1) | 0;
      }
    }
    var result = new Uint8Array(phonemes.length + extra.length);
    result.set(phonemes); result.set(extra, phonemes.length); return result;
  }
  function letterGroup(word, position, group, pre) {
    if (group < 0 || group >= dictionary.letterGroups.length) return -1;
    var p = dictionary.letterGroups[group];
    if (!p) return -1;
    while (ruleByte(p) !== F.RULE_GROUP_END) {
      if (ruleByte(p) === 126) return 0;
      var length = cLength(db, p), w = position, skip = false;
      if (pre) {
        if (at(word, w) === 0) skip = true;
        for (var i = 0; !skip && i < length - 1; i++) { w--; if (at(word, w) === 0) skip = true; }
      }
      if (!skip) {
        while (ruleByte(p) === at(word, w) && at(word, w) !== 0) { w++; p++; }
        if (ruleByte(p) === 0) return pre ? length : w - position;
      }
      while (ruleByte(p++) !== 0) {}
    }
    return -1;
  }
  function matchRule(word, position, wordStart, groupLength, rule, oldMatch, setting) {
    if (!rule) return { ...oldMatch, points: 0, position: position + 1 };
    var best = { points: 0, phonemes: new Uint8Array(0), endType: 0, delForward: null }, consumedBest = 0, common = null;
    while (ruleByte(rule) !== F.RULE_GROUP_END) {
      var checkStart = false, consumed = 0, distanceLeft = -2, distanceRight = -6, failed = 0;
      var unpronouncedIgnore = setting.wordFlags & F.FLAG_UNPRON_TEST, mode = 0, letterW = 0;
      var match = { points: 1, phonemes: new Uint8Array(0), endType: 0, delForward: null };
      var pre = position, post = position + groupLength;
      while (!failed) {
        var rb = ruleByte(rule++), points = 0;
        if (rb <= F.RULE_LINENUM) {
          switch (rb) {
            case 0:
              if (common !== null) {
                var ph = common, code;
                while ((code = ruleByte(ph++)) !== 0 && code !== F.RULE_PHONEMES) {
                  if (code === F.RULE_CONDITION) ph++;
                  if (code === F.RULE_LINENUM) ph += 2;
                }
                match.phonemes = phonemesAt(ph);
              }
              rule--; failed = 2; break;
            case F.RULE_PRE_ATSTART: checkStart = true; unpronouncedIgnore = 0; mode = F.RULE_PRE; break;
            case F.RULE_PRE: mode = F.RULE_PRE; if (setting.wordFlags & F.FLAG_UNPRON_TEST) failed = 1; break;
            case F.RULE_POST: mode = F.RULE_POST; break;
            case F.RULE_PHONEMES: match.phonemes = phonemesAt(rule); failed = 2; break;
            case F.RULE_PH_COMMON: common = rule; break;
            case F.RULE_CONDITION:
              var condition = ruleByte(rule++);
              if (condition >= 32 ? (setting.dictCondition & (1 << (condition - 32))) !== 0 : (setting.dictCondition & (1 << condition)) === 0) failed = 1;
              if (!failed) match.points++; break;
            case F.RULE_LINENUM: rule += 2; break;
          }
          continue;
        }
        if (mode === 0) {
          var letter = at(word, post++);
          if (letter === rb || (letter === 69 && rb === 101)) { if ((letter & 0xc0) !== 0x80) points = 21; consumed++; }
          else failed = 1;
        } else if (mode === F.RULE_POST) {
          distanceRight += 6; if (distanceRight > 18) distanceRight = 19;
          var lastLetterW = letterW;
          if (!at(word, post - 1)) { failed = 1; break; }
          var decoded = readForward(word, post), extra = decoded.bytes - 1;
          letterW = decoded.codepoint; letter = at(word, post++);
          switch (rb) {
            case F.RULE_LETTERGP:
              var group = (ruleByte(rule++) - 65) & 255;
              if (isLetter(letterW, group)) { points = (group === 2 ? 19 : 20) - distanceRight; post += extra; } else failed = 1;
              break;
            case F.RULE_LETTERGP2:
              group = (ruleByte(rule++) - 65) & 255;
              var width = letterGroup(word, post - 1, group, false);
              if (width >= 0) { points = 20 - distanceRight; post += width - 1; } else failed = 1;
              break;
            case F.RULE_NOTVOWEL:
              if (isLetter(letterW, 0) || (letterW === 32 && (setting.wordFlags & F.FLAG_SUFFIX_VOWEL))) failed = 1;
              else { points = 20 - distanceRight; post += extra; }
              break;
            case F.RULE_DIGIT:
              if (isDigit(letterW)) { points = 20 - distanceRight; post += extra; } else failed = 1;
              break;
            case F.RULE_NONALPHA:
              if (!iswAlpha(letterW)) { points = 21 - distanceRight; post += extra; } else failed = 1;
              break;
            case F.RULE_DOUBLE:
              if (letterW === lastLetterW) { points = 21 - distanceRight; post += extra; } else failed = 1;
              break;
            case F.RULE_DOLLAR:
              post--;
              var command = ruleByte(rule++);
              if (command === 1) match.endType = F.SUFX_UNPRON;
              else if (command === 2) { if (setting.wordFlags & F.FLAG_PREFIX_REMOVED) failed = 1; else points = 1; }
              else if ((command & 0xf0) === 0x10) { if (setting.dictFlags0 & (1 << (14 + (command & 15)))) points = 23; else failed = 1; }
              else if ((command & 0xf0) === 0x20 || command === 3) { points = dollarRule(command); if (points === null) { failed = 1; points = 0; } }
              break;
            case 45:
              if (letter === 45 || (letter === 32 && (setting.wordFlags & F.FLAG_HYPHEN_AFTER))) points = 22 - distanceRight; else failed = 1;
              break;
            case F.RULE_SYLLABLE:
              var p = post + extra, syllables = 1, vowelCount = 0, vowel = 0;
              while (ruleByte(rule) === F.RULE_SYLLABLE) { rule++; syllables++; }
              while (letterW !== 32 && letterW !== 0) {
                if (vowel === 0 && isLetter(letterW, 7)) vowelCount++;
                vowel = isLetter(letterW, 7); decoded = readForward(word, p); p += decoded.bytes; letterW = decoded.codepoint;
              }
              if (syllables <= vowelCount) points = 18 + syllables - distanceRight; else failed = 1;
              break;
            case F.RULE_NOVOWELS:
              p = post + extra;
              while (letterW !== 32 && letterW !== 0) {
                if (isLetter(letterW, 7)) { failed = 1; break; }
                decoded = readForward(word, p); p += decoded.bytes; letterW = decoded.codepoint;
              }
              if (!failed) points = 19 - distanceRight;
              break;
            case F.RULE_SKIPCHARS:
              p = post - 1; var p2 = p, ruleW = readForward(db, rule).codepoint, groupBytes = -1;
              while (letterW !== ruleW && letterW !== 32 && letterW !== 0 && groupBytes === -1) {
                if (ruleW === F.RULE_LETTERGP2) groupBytes = letterGroup(word, p, (ruleByte(rule + 1) - 65) & 255, false);
                p2 = p; decoded = readForward(word, p); p += decoded.bytes; letterW = decoded.codepoint;
              }
              if (letterW === ruleW || groupBytes >= 0) post = p2;
              break;
            case F.RULE_INC_SCORE: post--; points = 20; break;
            case F.RULE_DEC_SCORE: post--; points = -20; break;
            case F.RULE_DEL_FWD:
              for (p = position + groupLength; p < post; p++) if (at(word, p) === 101) { match.delForward = p; break; }
              break;
            case F.RULE_ENDING:
              // rule[0] is plain signed C char in the pinned build.
              var high = ruleByte(rule); if (high >= 128) high -= 256;
              match.endType = (high << 16) + ((ruleByte(rule + 1) & 127) << 8) + (ruleByte(rule + 2) & 127);
              rule += 3; break;
            case F.RULE_NO_SUFFIX:
              if (setting.wordFlags & F.FLAG_SUFFIX_REMOVED) failed = 1; else { post--; points = 1; }
              break;
            default:
              if (letter === rb) { if ((letter & 0xc0) !== 0x80) points = 21 - distanceRight; } else failed = 1;
              break;
          }
        } else if (mode === F.RULE_PRE) {
          distanceLeft += 2; if (distanceLeft > 18) distanceLeft = 19;
          if (!at(word, pre)) { failed = 1; break; }
          lastLetterW = readForward(word, pre).codepoint;
          pre--; decoded = readBackward(word, pre); extra = decoded.bytes - 1; letterW = decoded.codepoint; letter = at(word, pre);
          switch (rb) {
            case F.RULE_LETTERGP:
              group = (ruleByte(rule++) - 65) & 255;
              if (isLetter(letterW, group)) { points = (group === 2 ? 19 : 20) - distanceLeft; pre -= extra; } else failed = 1;
              break;
            case F.RULE_LETTERGP2:
              group = (ruleByte(rule++) - 65) & 255; width = letterGroup(word, pre, group, true);
              if (width >= 0) { points = 20 - distanceRight; pre -= width - 1; } else failed = 1;
              break;
            case F.RULE_NOTVOWEL:
              if (!isLetter(letterW, 0)) { points = 20 - distanceLeft; pre -= extra; } else failed = 1;
              break;
            case F.RULE_DOUBLE:
              if (letterW === lastLetterW) { points = 21 - distanceLeft; pre -= extra; } else failed = 1;
              break;
            case F.RULE_DIGIT:
              if (isDigit(letterW)) { points = 21 - distanceLeft; pre -= extra; } else failed = 1;
              break;
            case F.RULE_NONALPHA:
              if (!iswAlpha(letterW)) { points = 21 - distanceRight; pre -= extra; } else failed = 1;
              break;
            case F.RULE_DOLLAR:
              pre++; command = ruleByte(rule++);
              if (command === 3 || (command & 0xf0) === 0x20) { points = dollarRule(command); if (points === null) { failed = 1; points = 0; } }
              break;
            case F.RULE_SYLLABLE:
              syllables = 1; while (ruleByte(rule) === F.RULE_SYLLABLE) { rule++; syllables++; }
              if (syllables <= current.wordVowelCount) points = 18 + syllables - distanceLeft; else failed = 1;
              break;
            case F.RULE_STRESSED: pre++; if (current.wordStressedCount > 0) points = 19; else failed = 1; break;
            case F.RULE_NOVOWELS:
              p = pre - extra;
              while (letterW !== 32) {
                if (isLetter(letterW, 7)) { failed = 1; break; }
                decoded = readBackward(word, p - 1); p -= decoded.bytes; letterW = decoded.codepoint;
              }
              if (!failed) points = 3;
              break;
            case F.RULE_IFVERB: pre++; if (setting.expectVerb) points = 1; else failed = 1; break;
            case F.RULE_CAPITAL: pre++; if (setting.wordFlags & F.FLAG_FIRST_UPPER) points = 1; else failed = 1; break;
            case 46:
              for (p = pre; at(word, p) !== 0 && at(word, p) !== 32; p--) if (at(word, p) === 46) { points = 50; break; }
              if (!at(word, p) || at(word, p) === 32) failed = 1;
              break;
            case 45:
              if (letter === 45 || (letter === 32 && (setting.wordFlags & F.FLAG_HYPHEN))) points = 22 - distanceRight; else failed = 1;
              break;
            case F.RULE_SKIPCHARS:
              p = pre + 1; p2 = p; groupBytes = -1;
              while (at(word, p) !== ruleByte(rule) && at(word, p) !== 32 && at(word, p) !== 0 && groupBytes === -1) {
                p2 = p; p--;
                if (ruleByte(rule) === F.RULE_LETTERGP2) groupBytes = letterGroup(word, p2, (ruleByte(rule + 1) - 65) & 255, true);
              }
              if (at(word, p) === ruleByte(rule)) pre = p2;
              if (groupBytes >= 0) pre = p2 + 1;
              break;
            default:
              if (letter === rb) { if (letter === 32) points = 4; else if ((letter & 0xc0) !== 0x80) points = 21 - distanceLeft; } else failed = 1;
              break;
          }
        }
        if (failed === 0) match.points += points;
      }
      if (failed === 2 && unpronouncedIgnore === 0 && (!checkStart || at(word, pre - 1) === 32)) {
        if (checkStart) match.points += 4;
        if (match.points >= best.points) { best = match; consumedBest = consumed; }
      }
      while (ruleByte(rule++) !== 0) {}
    }
    return { ...best, position: position + Math.max(1, consumedBest + groupLength) };

    function dollarRule(command) {
      var length = position - wordStart + consumed + groupLength + 1;
      if (length + 2 > F.N_WORD_BYTES) return null;
      if (!dictSession) unsupported('lookup-flags');
      var partial = new Uint8Array(length + 2);
      partial.set(word.subarray(wordStart - 1, wordStart - 1 + length)); partial[length] = 32;
      var result = dictSession.lookup(partial.subarray(1), { expectVerb: setting.expectVerb, dictCondition: setting.dictCondition });
      syncDictionary();
      if (command === 3 && (result.flags[0] & F.FLAG_FOUND) && !(result.flags[1] & F.FLAG_ONLY)) return 23;
      return result.flags[0] & (1 << (14 + (command & 15))) ? 23 : null;
    }
  }

  function translate(input, options, bufferOffset) {
    var opts = options || {}, fullBuffer = bufferOffset !== undefined;
    var source, start, raw;
    if (fullBuffer) {
      if (!(input instanceof Uint8Array)) throw new TypeError('Expected rule source buffer Uint8Array');
      if (!Number.isInteger(bufferOffset) || bufferOffset < 1 || bufferOffset >= input.length) throw new RangeError('Invalid rule source offset');
      if (opts.prefixBytes !== undefined) throw new TypeError('Full source already supplies prefix bytes');
      source = new Uint8Array(input); start = bufferOffset;
      var wordLength = cLength(source, start);
      if (start + wordLength >= source.length) throw new RangeError('Rule source buffer requires a terminating NUL');
      raw = source.subarray(start, start + wordLength);
    } else raw = copyString(input);
    var wordFlags = opts.wordFlags === undefined ? 0 : opts.wordFlags;
    var condition = opts.dictCondition === undefined ? profile.dictCondition : opts.dictCondition;
    uint(wordFlags, 'word flags'); uint(condition, 'dictionary condition');
    var dictFlags = opts.dictFlags === undefined || opts.dictFlags === null ? null : opts.dictFlags;
    if (dictFlags !== null && (!(dictFlags instanceof Uint32Array) || dictFlags.length !== 2)) throw new TypeError('Expected two uint32 dictionary flags');
    if (dictFlags !== null) dictFlags = dictFlags.slice();
    var phSize = opts.phSize === undefined ? 200 : opts.phSize;
    if (!Number.isInteger(phSize) || phSize < 1 || phSize > 200) throw new RangeError('Invalid rule phoneme capacity');
    var phonemes = opts.phonemes === undefined ? new Uint8Array(0) : copyString(opts.phonemes);
    if (phonemes.length >= phSize) throw new RangeError('Initial phonemes exceed rule capacity');
    var endEnabled = opts.endPhonemesEnabled === undefined ? true : opts.endPhonemesEnabled;
    if (typeof endEnabled !== 'boolean') throw new TypeError('Expected end-phonemes boolean');
    var prefix = opts.prefixBytes === undefined ? Uint8Array.of(32, 32) : opts.prefixBytes;
    if (!(prefix instanceof Uint8Array) || prefix.length !== 2) throw new TypeError('Expected two prefix bytes');
    for (var pi = 0; pi < 2; pi++) {
      if (prefix[pi] >= 0xc0 && prefix[pi] <= 0xf7 &&
          !(prefix[pi] <= 0xdf && pi === 0 && (prefix[1] & 0xc0) === 0x80)) {
        throw new RangeError('Prefix UTF-8 lead crosses the word boundary');
      }
    }
    var expectVerb = opts.expectVerb === undefined ? 0 : opts.expectVerb;
    uint(expectVerb, 'expected verb');
    if (opts.prePause !== undefined) { uint(opts.prePause, 'pre-pause'); current.prePause = opts.prePause; }
    if (opts.repeatCount !== undefined && !dictSession) { uint(opts.repeatCount, 'repeat count'); current.repeatCount = opts.repeatCount; }
    var before = state();
    current.wordVowelCount = 0; current.wordStressedCount = 0;
    if (!fullBuffer) {
      source = new Uint8Array(Math.max(raw.length + 16, F.N_WORD_BYTES + 16)); start = 3;
      // RULE_NOVOWELS scans back to space, including across NUL bytes.
      // Bound a supplied two-byte context with the preceding word boundary.
      if (opts.prefixBytes !== undefined) source[0] = 32;
      source.set(prefix, 1); source.set(raw, start); source[start + raw.length] = 32;
    }
    var original = source.slice(), ending = new Uint8Array(0);
    var setting = { wordFlags: wordFlags, dictFlags0: dictFlags === null ? 0 : dictFlags[0], dictCondition: condition, expectVerb: expectVerb };
    var position = start, anyAlpha = 0, digitCount = 0;
    var match1 = { points: 0, phonemes: new Uint8Array(0), endType: 0, delForward: null }, match2 = { ...match1 };
    while (at(source, position) !== 32 && at(source, position) !== 0) {
      var c = at(source, position), decoded = readForward(source, position), wc = decoded.codepoint, wcBytes = decoded.bytes;
      if (isAlpha(wc)) anyAlpha++;
      var groups = dictionary.groups2Count[c];
      if (isDigit(wc)) {
        if (typeof dependencies.lookup !== 'function') unsupported('digit-lookup');
        var key = new Uint8Array(wcBytes + 1); key[0] = 95; key.set(source.subarray(position, position + wcBytes), 1);
        var digitPhonemes = copyString(dependencies.lookup(key)); syncDictionary();
        if (++digitCount >= 2) {
          var paused = new Uint8Array(digitPhonemes.length + 1); paused.set(digitPhonemes); paused[digitPhonemes.length] = 11;
          digitPhonemes = paused; digitCount = 0;
        }
        append(digitPhonemes); position += wcBytes; continue;
      }
      digitCount = 0;
      var found = false;
      if (wc < 128 && dictionary.groups3[wc]) {
        match1 = matchRule(source, position, start, wcBytes, dictionary.groups3[wc], match1, setting); position = match1.position; found = true;
      }
      if (!found && groups > 0) {
        var c12 = c + (at(source, position + 1) << 8), firstGroup = dictionary.groups2Start[c];
        for (var g = firstGroup; g < firstGroup + groups; g++) {
          if (dictionary.groups2Name[g] === c12) {
            found = true;
            match2 = matchRule(source, position, start, 2, dictionary.groups2[g], match2, setting);
            if (match2.points > 0) match2.points += 35;
            match1 = matchRule(source, position, start, 1, dictionary.groups1[c], match1, setting);
            position = match1.position;
            if (match2.points >= match1.points) { match1 = { ...match2 }; position = match2.position; }
          }
        }
      }
      if (!found) {
        if (dictionary.groups1[c]) {
          match1 = matchRule(source, position, start, 1, dictionary.groups1[c], match1, setting); position = match1.position;
        } else {
          match1 = matchRule(source, position, start, 0, dictionary.groups1[0], match1, setting); position = match1.position;
          if (match1.points === 0) {
            var letterDecoded = readForward(source, position - 1), letter = letterDecoded.codepoint, n = letterDecoded.bytes - 1;
            if (letter === 0xe028 && current.prePause < profile.bracketPauseAnnounced) current.prePause = profile.bracketPauseAnnounced;
            if (bracketIndex(letter) && current.prePause < profile.bracketPause) current.prePause = profile.bracketPause;
            if (letter >= 0xc0 && letter < profile.removeAccentLimit && REMOVE_ACCENT[letter - 0xc0]) {
              if (at(source, position - 2) !== 32 || at(source, position + n) !== 32) {
                source[position - 1] = REMOVE_ACCENT[letter - 0xc0];
                while ((source[position] = at(source, position + n)) !== 32) position++;
                while (n-- > 0) source[position++] = 32;
                phonemes = new Uint8Array(0); position = start; current.wordVowelCount = 0; current.wordStressedCount = 0;
                continue;
              }
            }
            var alphabet = alphabetFromChar(letter);
            if (alphabet !== null && alphabet.offset !== profile.letterBitsOffset && (alphabet.flags & 4)) {
              var switched = [21];
              for (var shift = 24; shift >= 0; shift -= 8) { var byte = (alphabet.language >>> shift) & 255; if (byte) switched.push(byte); }
              phonemes = Uint8Array.from(switched); return finish(0, false);
            }
          }
        }
        if (match1.points === 0) {
          if (wc >= 0x300 && wc <= 0x36f) {
            // Combining accents inside a word are ignored by the original.
          } else if (isAlpha(wc)) {
            if (anyAlpha > 1 || at(source, position + wcBytes - 1) > 32) {
              phonemes = new Uint8Array(0); if (dictFlags !== null) dictFlags[0] |= F.FLAG_SPELLWORD;
              break;
            }
          } else {
            if (typeof dependencies.lookupLetter !== 'function') unsupported('letter-lookup');
            var named = copyString(dependencies.lookupLetter(wc, { nextLetter: -1, control: 0 })); syncDictionary();
            if (named.length) { match1.phonemes = named; match1.points = 1; }
          }
          position += wcBytes - 1;
        } else {
          current.repeatCount = 0;
          if (dictSession) dictSession.resetRepeat();
        }
      }
      if (match1.points > 0) {
        if (wordFlags & F.FLAG_UNPRON_TEST) return finish(match1.endType | 1, false);
        if (match1.phonemes[0] === 21 && !(wordFlags & F.FLAG_DONT_SWITCH_TRANSLATOR)) {
          phonemes = match1.phonemes.slice(); return finish(0, false);
        }
        match1.endType &= ~F.SUFX_UNPRON;
        if (match1.endType !== 0 && endEnabled) {
          if (!((match1.endType & F.SUFX_P) && (wordFlags & F.FLAG_NO_PREFIX))) {
            if ((match1.endType & F.SUFX_P) && (match1.endType & 127) === 0) match1.endType |= position - start;
            ending = match1.phonemes.slice(); return finish(match1.endType, true);
          }
        }
        if (match1.delForward !== null) source[match1.delForward] = 69;
        append(match1.phonemes);
      }
    }
    return finish(0, true);

    function append(added) {
      phonemes = appendPhonemes(phonemes, added, phSize);
    }
    function finish(endType, restore) {
      if (restore) source.set(original.subarray(start, start + Math.min(raw.length + 1, F.N_WORD_BYTES - 1)), start);
      var result = { endType: endType, word: source.slice(start, start + raw.length), phonemes: phonemes, endPhonemes: ending,
        dictFlags: dictFlags, stateBefore: before, stateAfter: state() };
      if (fullBuffer) result.source = source;
      return result;
    }
  }
  function translateBuffer(buffer, wordOffset, options) { return translate(buffer, options, wordOffset); }
  return { translate: translate, translateBuffer: translateBuffer, state: state, setState: setState, appendPhonemes: appendPhonemes };
}
