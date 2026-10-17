// Pinned translateword.c TranslateWord3 and translate.c TranslateWordWithBounds.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2017 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { readForward } from './utf8-scan.js';
import { isAlpha, iswAlpha, iswDigit, iswUpper, iswSpace, isSpace, isEmoji, isEmojiModifier, isEmojiTag, toLowerCodePoint, writeUtf8CodePoint } from './unicode.js';
import { alphabetFromChar, shouldSplitIdeographs, ALPHABET_FLAGS } from './text-character.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { LETTER_BITS, REMOVE_ACCENT, RULE_PROFILE } from '../../data/rules/profile.js';
import { getVowelStress, WORD_STRESS_PROFILE } from './word-stress.js';
import { removeEnding, WORD_ENDING_PROFILE } from './word-ending.js';
import { createNumberTranslation } from './number-translation.js';
import { CMN_NUMBER_PROFILE, CMN_TEXT_CHARACTER_PROFILE, CMN_WORD_ENDING_PROFILE, CMN_WORD_STRESS_PROFILE, CMN_WORD_TRANSLATION_PROFILE } from '../../data/cmn/synthesis-profile.js';
import { isSuperscript, nonAsciiNumber, HEX_LETTER_NAMES } from './derived-letter.js';
import { encodePhonemes } from './phoneme-encode.js';

export var WORD_TRANSLATION_PROFILE = Object.freeze({ voice: 'en-us', translatorName: 25966, phonemeTable: 80,
  wordBytes: 160, phonemeBytes: 200, numbers: 16779328, numbers2: 0, stressFlags: 8, prefixes: 0, alt: 0,
  unpronouncable: 2, maxInitialConsonants: 3, accents: 0, ourAlphabet: 0, altAlphabet: 0,
  minRoman: 2, maxRoman: 49, spellingStress: false, OPTION_EMPHASIZE_ALLCAPS: 256 });
var STATE_FIELDS = ['dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags0', 'prevDictFlags1',
  'clauseTerminator', 'clauseEnd', 'clauseLowerCount', 'clauseUpperCount', 'prePause', 'prevLastStress', 'prepauseTimeout',
  'endStressedVowel', 'wordVowelCount', 'wordStressedCount', 'repeatCount', 'skipWords', 'optionSayas', 'optionCapitals', 'optionToneFlags'];
var STRESS_CODES = new Uint8Array([3, 2, 4, 5, 6, 7, 26]);
function empty() { return new Uint8Array(0); }
function cLength(bytes, start) { var end = start; while (end < bytes.length && bytes[end]) end++; return end - start; }
function ascii(text) { var out = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return out; }
function join(parts, limit) {
  var length = 0; for (var i = 0; i < parts.length; i++) length += parts[i].length;
  length = Math.min(length, limit === undefined ? 199 : limit);
  var out = new Uint8Array(length), offset = 0;
  for (i = 0; i < parts.length && offset < length; i++) { var size = Math.min(parts[i].length, length - offset); out.set(parts[i].subarray(0, size), offset); offset += size; }
  return out;
}
function cloneWords(words) { return words.map(function (row) { return { flags: row.flags, start: row.start, prePause: row.prePause, sourceix: row.sourceix, length: row.length }; }); }
function zeroWord() { return { flags: 0, start: 0, prePause: 0, sourceix: 0, length: 0 }; }

export function createWordTranslationSession(services, selectedTable, initialState) {
  if (!services || !services.dictionary || !services.rules || !services.letters || !services.stress || !services.accent) throw new TypeError('Expected composed text services');
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  var profile = initialState && initialState.profile ? initialState.profile : WORD_TRANSLATION_PROFILE;
  var knownProfiles = { 'en-us': WORD_TRANSLATION_PROFILE, cmn: CMN_WORD_TRANSLATION_PROFILE };
  var expectedProfile = knownProfiles[profile.voice];
  if (!expectedProfile || JSON.stringify(profile) !== JSON.stringify(expectedProfile) ||
      selectedTable.index !== profile.phonemeTable || selectedTable.name !== profile.voice) throw new TypeError('Unsupported word translation profile');
  var initial = initialState || {}, current = {};
  for (var i = 0; i < STATE_FIELDS.length; i++) {
    var key = STATE_FIELDS[i]; current[key] = initial[key] === undefined ? key === 'dictCondition' ? profile.voice === 'cmn' ? 0 : 72 : 0 : initial[key];
    if (!Number.isInteger(current[key]) || current[key] < -0x80000000 || current[key] > 0xffffffff) throw new RangeError('Invalid word state ' + key);
  }
  var clauseEndSet = initial.clauseEnd !== undefined;
  var clauseEndRelation = initial.clauseEndRelation || 'in-source';
  if (clauseEndRelation !== 'in-source' && clauseEndRelation !== 'unrelated') throw new TypeError('Invalid clause-end relation');
  services.dictionary.setState({ repeat: initial.repeat || empty(), repeatCount: current.repeatCount, skipWords: current.skipWords });
  services.stress.setState({ prevLastStress: current.prevLastStress });
  services.rules.setState({ wordVowelCount: current.wordVowelCount, wordStressedCount: current.wordStressedCount, prePause: current.prePause });
  var fault = null;
  var globalWordPhonemes = empty();
  var numberProfile = profile.voice === 'cmn' ? CMN_NUMBER_PROFILE : undefined;
  var numbers = services.numbers || createNumberTranslation(services.dictionary, { profile: numberProfile, lookupSymbol: function (key, context) {
    if (services.dictionary.setContext) services.dictionary.setContext({ dictCondition: context.dictCondition,
      expectVerb: context.expectVerb >>> 0, expectVerbS: context.expectVerbS >>> 0, expectNoun: context.expectNoun >>> 0, expectPast: context.expectPast >>> 0,
      prevDictFlags: context.prevDictFlags0, clauseTerminator: context.clauseTerminator });
    return services.accent.lookupSymbol(key);
  } });
  function state() {
    var dict = services.dictionary.state(), rules = services.rules.state(), stress = services.stress.state();
    current.repeatCount = dict.repeatCount; current.skipWords = dict.skipWords; current.prevLastStress = stress.prevLastStress;
    current.wordVowelCount = rules.wordVowelCount; current.wordStressedCount = rules.wordStressedCount; current.prePause = rules.prePause;
    var out = {}; for (var k = 0; k < STATE_FIELDS.length; k++) out[STATE_FIELDS[k]] = current[STATE_FIELDS[k]];
    out.repeat = dict.repeat; out.clauseEndRelation = clauseEndRelation; out.phonemeTable = profile.phonemeTable; out.native = true;
    return out;
  }
  function setState(patch) {
    if (fault) throw fault;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Expected word state patch');
    var keys = Object.keys(patch);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === 'clauseEndRelation') {
        if (!['in-source', 'unrelated', 'before-source', 'after-source'].includes(patch[key])) throw new TypeError('Invalid clause-end relation');
      } else if (key === 'repeat') {
        if (!(patch[key] instanceof Uint8Array) || patch[key].length >= 20 || patch[key].indexOf(0) >= 0) throw new TypeError('Invalid repeat bytes');
      } else if (STATE_FIELDS.indexOf(key) < 0 || !Number.isInteger(patch[key]) || patch[key] < -0x80000000 || patch[key] > 0xffffffff) throw new RangeError('Invalid word state ' + key);
    }
    var dictionaryPatch = {}, rulePatch = {};
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      if (key === 'repeat' || key === 'repeatCount' || key === 'skipWords') dictionaryPatch[key] = patch[key];
      if (key === 'wordVowelCount' || key === 'wordStressedCount' || key === 'prePause') rulePatch[key] = patch[key];
    }
    services.dictionary.setState(dictionaryPatch); services.rules.setState(rulePatch);
    if (patch.prevLastStress !== undefined) services.stress.setState({ prevLastStress: patch.prevLastStress });
    for (i = 0; i < keys.length; i++) if (keys[i] !== 'repeat' && keys[i] !== 'clauseEndRelation') current[keys[i]] = patch[keys[i]];
    if (patch.clauseEnd !== undefined) clauseEndSet = true;
    if (patch.clauseEndRelation !== undefined) clauseEndRelation = patch.clauseEndRelation;
    syncContext(); return state();
  }
  function unsupported(reason) {
    var error = new Error('Word translation dependency not implemented: ' + reason);
    error.name = 'UnsupportedWordTranslationError'; error.code = 'WORD_TRANSLATION_UNSUPPORTED'; error.reason = reason;
    error.state = state(); fault = error; throw error;
  }
  function syncContext() {
    if (services.dictionary.setContext) services.dictionary.setContext({ dictCondition: current.dictCondition,
      expectVerb: current.expectVerb >>> 0, expectVerbS: current.expectVerbS >>> 0, expectNoun: current.expectNoun >>> 0, expectPast: current.expectPast >>> 0,
      prevDictFlags: current.prevDictFlags0, clauseTerminator: current.clauseTerminator });
  }
  function lookup(input, flags, endFlags, words, remaining, clauseEnd) {
    syncContext();
    var result = services.dictionary.lookup(input, { flags0: flags[0], flags1: flags[1], endFlags: endFlags >>> 0,
      words: words.slice(0, remaining), withWord: 1, wordFlags: words[0].flags,
      dictCondition: current.dictCondition, expectVerb: current.expectVerb >>> 0, expectVerbS: current.expectVerbS >>> 0,
      expectNoun: current.expectNoun >>> 0, expectPast: current.expectPast >>> 0, prevDictFlags: current.prevDictFlags0,
      clauseTerminator: current.clauseTerminator, clauseEnd: clauseEnd === null ? 0 : Math.max(0, Math.min(input.length, clauseEnd)), clauseEndRelation: clauseEnd === null ? 'unrelated' : 'in-source', native: true });
    flags.set(result.flags); return result;
  }
  function rule(buffer, start, flags, wordFlags, endEnabled, phonemes) {
    syncContext();
    var result;
    try {
      result = services.rules.translateBuffer(buffer, start, {
        dictFlags: flags, dictCondition: current.dictCondition, expectVerb: current.expectVerb >>> 0, wordFlags: wordFlags >>> 0,
        endPhonemesEnabled: endEnabled, phonemes: phonemes || empty(), prePause: current.prePause });
    } catch (error) {
      if (error instanceof RangeError && (error.message === 'UTF-8 scanner offset outside backing buffer' || error.message.indexOf('Dictionary rule read outside backing buffer at ') === 0)) unsupported('rule-source-bounds');
      throw error;
    }
    buffer.set(result.source); if (flags && result.dictFlags) flags.set(result.dictFlags);
    current.prePause = result.stateAfter.prePause;
    return result;
  }
  function stress(phonemes, flags, tonic, control) {
    return services.stress.setWordStress(phonemes, { dictionaryFlags: flags === null ? null : flags[0], tonic: tonic, control: control }).phonemes;
  }
  function changeStress(phonemes, level) {
    var scanned = getVowelStress(phonemes, selectedTable,
      profile.voice === 'cmn' ? CMN_WORD_STRESS_PROFILE : WORD_STRESS_PROFILE, { control: 0 });
    var levels = scanned.vowelStress;
    for (var i = 1; i < scanned.vowelCount; i++) {
      if (level >= 4) { if (levels[i] >= scanned.maxStress) { levels[i] = level; break; } }
      else if (levels[i] > level) levels[i] = level;
    }
    var result = new Uint8Array(200), at = 0, vowel = 1;
    for (i = 0; i < scanned.phonemes.length; i++) {
      var code = scanned.phonemes[i], ph = selectedTable.entries[code];
      if (!ph) unsupported('change-stress-invalid-phoneme');
      if (ph.type === 2 && !(ph.phflags & 0x100000)) { var value = levels[vowel++]; if (value === 0 || value > 1) result[at++] = STRESS_CODES[value]; }
      if (at >= 199) unsupported('change-stress-capacity'); result[at++] = code;
    }
    return result.slice(0, at);
  }
  function spellingStress(phonemes, control, count) {
    var total = 0, previous = 0;
    for (var i = 0; i < phonemes.length; i++) { if (phonemes[i] === 6 && previous !== 21) total++; previous = phonemes[i]; }
    var out = new Uint8Array(200), offset = 0, seen = 0; previous = 0;
    for (i = 0; i < phonemes.length; i++) {
      var code = phonemes[i];
      if (code === 6 && count > 1 && previous !== 21) { seen++; if (seen !== total && (seen % 3 !== 0 || seen === total - 1)) code = 5; }
      else if (code === 255) { if (control < 2 || i === 0) continue; code = seen % 3 === 0 || control > 2 ? 11 : 23; }
      out[offset++] = previous = code;
    }
    if (control >= 2) { if (offset >= 199) unsupported('spelling-stress-capacity'); out[offset++] = 11; }
    return out.slice(0, offset);
  }
  function translateLetter(buffer, start, phonemes, control, currentAlphabet) {
    syncContext();
    var decoded = readForward(buffer, start), cp = decoded.codepoint, capital = empty(), alphabetName = empty();
    if ((cp & 0xfff00) === 0xe000) cp &= 255;
    if ((control & 2) && iswUpper(cp)) capital = services.accent.lookupSymbol(ascii('_cap')).phonemes;
    cp = toLowerCodePoint(cp, false);
    var name = services.letters.lookupLetter(cp, { nextLetter: buffer[start + decoded.bytes], control: control & 1 });
    if (!name.length) {
      var derived = isSuperscript(cp);
      if (derived) {
        cp = derived & 0x3fff;
        if (control & 4) {
          var modifier = derived >> 14;
          if (modifier === 1 || modifier === 2) {
            capital = services.accent.lookupSymbol(ascii(modifier === 1 ? '_sub' : '_sup')).phonemes;
            if (!capital.length) unsupported('derived-letter-language');
          }
        }
      }
      name = services.letters.lookupLetter(cp, { nextLetter: buffer[start + decoded.bytes], control: control & 1 });
    }
    if (name[0] === 21) return { phonemes: name, bytes: 0 };
    var number = nonAsciiNumber(cp);
    if (!name.length && number > 0) name = services.letters.lookupLetter(number, { nextLetter: 0, control: control & 1 });
    var alphabet = alphabetFromChar(cp);
    if (alphabet !== currentAlphabet && alphabet && !(alphabet.flags & ALPHABET_FLAGS.DONT_NAME) && alphabet.offset !== 0) {
      var looked = services.accent.lookupSymbol(ascii(alphabet.name));
      if (!looked.flags) unsupported('alphabet-name-language');
      alphabetName = looked.phonemes;
    }
    if (!name.length) {
      var language = alphabet && alphabet.language && !(alphabet.flags & ALPHABET_FLAGS.NOT_LETTERS) ? alphabet.language : profile.altAlphabetLanguage;
      if (language !== profile.altAlphabetLanguage) unsupported('letter-language');
    }
    if (!name.length) {
      var alFlags = alphabet ? alphabet.flags : 0;
      if (!(alFlags & ALPHABET_FLAGS.NO_SYMBOL)) {
        if (iswAlpha(cp)) name = services.accent.lookupSymbol(ascii('_?A')).phonemes;
        if (!name.length && !iswSpace(cp)) name = services.accent.lookupSymbol(ascii('_??')).phonemes;
        if (!name.length) name = encodePhonemes(ascii("l'et@"), selectedTable, { reportBadPhoneme: false }).phonemes;
      }
      if ((control & 4) || !(alFlags & ALPHABET_FLAGS.NOT_CODE)) {
        var digits = new Uint8Array(12), digitCount = 0;
        if (alphabet && alphabet.offset === 0x2800) {
          for (var bit = 0; bit < 8; bit++) if (cp & (1 << bit)) digits[digitCount++] = 49 + bit;
        } else {
          var value = cp, reverse = new Uint8Array(8), used = 0;
          do { var digit = value % 16; reverse[used++] = digit < 10 ? 48 + digit : 87 + digit; value = Math.floor(value / 16); } while (value);
          while (used) digits[digitCount++] = reverse[--used];
        }
        for (var d = 0; d < digitCount; d++) {
          var digitName = services.letters.lookupLetter(digits[d], { nextLetter: 0, control: 1 });
          if ((!digitName.length || digitName[0] === 21) && digits[d] >= 97) digitName = encodePhonemes(ascii(HEX_LETTER_NAMES[digits[d] - 97]), selectedTable, { reportBadPhoneme: false }).phonemes;
          if (name.length + 1 + digitName.length >= 80) unsupported('letter-name-capacity');
          name = join([name, new Uint8Array([23]), digitName]);
        }
        name = join([name, new Uint8Array([9])]);
      }
    }
    if (name.length >= 80 || capital.length >= 30 || alphabetName.length >= 80 || 1 + name.length + capital.length + alphabetName.length >= 80) unsupported('letter-name-capacity');
    var addition = join([new Uint8Array([255]), alphabetName, capital, name]);
    return { phonemes: phonemes.length + addition.length < 200 ? join([phonemes, addition]) : phonemes, bytes: decoded.bytes };
  }
  function speakLetters(buffer, start, mode, alphabet) {
    var phonemes = empty(), count = 0, control = mode > 2 ? 2 : 0;
    if (mode > 1) control |= 4;
    while (buffer[start] && buffer[start] !== 32) {
      var letter = translateLetter(buffer, start, phonemes, control | (count ? 1 : 0), alphabet);
      start += letter.bytes; count++; phonemes = letter.phonemes;
      if (phonemes[0] === 21) return { switched: true, phonemes: phonemes, start: start };
    }
    return { switched: false, phonemes: spellingStress(phonemes, mode, count), start: start };
  }
  function unpronounceable(buffer, start, position) {
    var first = readForward(buffer, start).codepoint, alphabet = alphabetFromChar(first);
    if (alphabet && alphabet.offset !== 0) return false;
    if (buffer[start] === 32 || buffer[start] === 0 || buffer[start] === 39) return false;
    if (profile.unpronouncable === 1) return false;
    var offset = start, count = 0, vowelPosition = 9;
    var firstCodePoint = 0;
    while (true) {
      var decoded = readForward(buffer, offset), cp = decoded.codepoint; offset += decoded.bytes;
      if (!cp || cp === 32 || (cp === 39 && (count > 1 || position > 0))) break;
      count++;
      if (count === 1) firstCodePoint = cp;
      var vowel = cp >= 0xc0 && cp < RULE_PROFILE.removeAccentLimit ? LETTER_BITS[REMOVE_ACCENT[cp - 0xc0]] & 128 : cp < 256 ? LETTER_BITS[cp] & 128 : 0;
      if (vowel) { vowelPosition = count; break; }
      if (cp !== 39 && !iswAlpha(cp)) return false;
    }
    if (vowelPosition > 2 && profile.unpronouncable === 2) {
      var previous = buffer[start - 1]; buffer[start - 1] = 32;
      var result = rule(buffer, start, null, F.FLAG_UNPRON_TEST, false);
      buffer[start - 1] = previous;
      return result.endType === 0 || (result.endType & F.SUFX_UNPRON) !== 0;
    }
    if (firstCodePoint === profile.unpronouncable) vowelPosition--;
    if (vowelPosition > profile.maxInitialConsonants + 1) return true;
    return false;
  }
  function dottedAbbreviation(buffer, start) {
    var word = start, count = 0, copied = new Uint8Array(80), length = 0;
    while (true) {
      var decoded = readForward(buffer, word), bytes = decoded.bytes, ok = 0;
      if (buffer[word + bytes] === 32 && isAlpha(decoded.codepoint)) {
        if (buffer[word + bytes + 1] === 46) {
          if (buffer[word + bytes + 2] === 32) ok = 1;
          else if (buffer[word + bytes + 2] === 39 && buffer[word + bytes + 3] === 115) { bytes += 2; ok = 2; }
        } else if (count > 0) ok = 2;
      }
      if (!ok) break;
      if (bytes <= 0 || bytes > copied.length - length) return 0;
      copied.set(buffer.subarray(word, word + bytes), length); length += bytes; count++;
      if (ok === 2) { word += bytes; break; }
      word += bytes + 3;
    }
    if (count > 1) {
      buffer.set(copied.subarray(0, length), start); buffer.fill(32, start + length, word);
      services.dictionary.setState({ skipWords: (count - 1) * 2 });
    }
    return count;
  }
  function emojiReplacement(buffer, start, flags, words, remaining) {
    var stripped = new Uint8Array(162), modifiers = [], length = 0, removed = 0;
    while (buffer[start] && buffer[start] !== 32) {
      var decoded = readForward(buffer, start), cp = decoded.codepoint;
      if (isEmojiModifier(cp)) { removed++; if (modifiers.length < 8) modifiers.push(cp); }
      else if (isEmojiTag(cp)) removed++;
      else if (length + decoded.bytes < 160) { stripped.set(buffer.subarray(start, start + decoded.bytes), length); length += decoded.bytes; }
      start += decoded.bytes;
    }
    if (!removed || !length) return null;
    stripped[length++] = 32;
    var result = lookup(stripped.subarray(0, length), new Uint32Array(2), F.FLAG_ALLOW_TEXTMODE, words, remaining, 0);
    if (!(result.flags[0] & F.FLAG_TEXTMODE) && modifiers.length) return null;
    var replacement = result.word;
    if (replacement.length > 156) return null;
    replacement = replacement.slice();
    for (var i = 0; i < modifiers.length; i++) {
      var modifier = new Uint8Array(8), width = writeUtf8CodePoint(modifiers[i], modifier, 0); modifier[width++] = 32;
      result = lookup(modifier.subarray(0, width), new Uint32Array(2), F.FLAG_ALLOW_TEXTMODE, words, remaining, 0);
      if (!(result.flags[0] & F.FLAG_TEXTMODE)) continue;
      if (replacement.length + 2 + result.word.length >= 159) break;
      replacement = join([replacement, result.word], 159);
    }
    flags[0] |= F.FLAG_TEXTMODE; return replacement;
  }
  function plural(buffer, flags, last, phonemes) {
    if (!(flags & F.FLAG_HAS_PLURAL)) return phonemes;
    var token = ascii(last === 102 ? '\0 ss\0' : last === 104 || last === 115 || last === 120 ? '\0 iz\0' : '\0 zz\0');
    return rule(token, 2, null, 0, false, phonemes).phonemes;
  }
  function word3(buffer, start, words, remaining, wantWordOut, anyStressed, alphabet, initialPhonemes, clauseEnd) {
    var flags = new Uint32Array(2), flags2 = new Uint32Array(2), wflags = words[0].flags;
    var phonemes = empty(), prefix = empty(), unpron = empty(), ending = empty(), phonemes2 = empty();
    var endType = 0, endType1 = 0, prefixType = 0, prefixFlags = 0, wasUnpronounceable = 0;
    var output = initialPhonemes.slice(), wordOut = wantWordOut ? empty() : null;
    services.dictionary.setState({ skipWords: 0 });
    var word1 = buffer[start] === 32 ? start + 1 : start, wordx = word1;
    var first = readForward(buffer, wordx).codepoint, last = 0, wordLength = 0;
    while (buffer[wordx] && buffer[wordx] !== 32) { var decoded = readForward(buffer, wordx); wordx += decoded.bytes; last = decoded.codepoint; wordLength++; }
    var original = buffer.slice(start, start + Math.min(wordx - start, 159)), spell = 0, found = false, emphasize = 0;
    function done(value) { return { flags: value >>> 0, phonemes: output, wordOut: wordOut, anyStressedWords: anyStressed }; }
    function dict(at, target, endingFlags) { return lookup(buffer.subarray(at, at + cLength(buffer, at)), target, endingFlags, words, remaining, clauseEnd === null ? null : clauseEnd - at); }
    function remove(at, type, copy) {
      var removed = removeEnding(buffer.subarray(at, at + cLength(buffer, at)), type,
        profile.voice === 'cmn' ? CMN_WORD_ENDING_PROFILE : WORD_ENDING_PROFILE,
        { expectVerb: current.expectVerb, copyWord: copy });
      buffer.set(removed.word, at); current.expectVerb = removed.expectVerb; return removed;
    }
    function translateNumber(roman) {
      syncContext();
      var padding = Math.max(0, 3 - word1), numberBuffer = buffer;
      if (padding) { numberBuffer = new Uint8Array(buffer.length + padding); numberBuffer.set(buffer, padding); }
      var result = numbers[roman ? 'roman' : 'number'](numberBuffer, { offset: word1 + padding, capacity: 200, words: words, remaining: remaining,
        control: 0, flags: flags, initialPhonemes: phonemes, optionSayas: current.optionSayas,
        dictionaryContext: { dictCondition: current.dictCondition, expectVerb: current.expectVerb, expectVerbS: current.expectVerbS,
          expectNoun: current.expectNoun, expectPast: current.expectPast, prevDictFlags0: current.prevDictFlags0,
          prevDictFlags1: current.prevDictFlags1, clauseTerminator: current.clauseTerminator, clauseEnd: clauseEnd === null ? 0 : clauseEnd - word1, clauseEndRelation: clauseEnd === null ? 'unrelated' : 'in-source' } });
      buffer.set(result.buffer.subarray(padding)); flags.set(result.flags); phonemes = result.phonemes;
      for (var i = 0; i < words.length; i++) Object.assign(words[i], result.words[i]);
      current.prevDictFlags0 = result.prevDictFlags0; current.prevDictFlags1 = result.prevDictFlags1;
      return !!result.found;
    }
    if (wordLength === 1 && (wflags & F.FLAG_TRANSLATOR2)) {
      var nextCp = readForward(buffer, wordx + 1).codepoint;
      if (!isAlpha(nextCp) || alphabetFromChar(last) !== alphabetFromChar(nextCp)) spell = 1;
    }
    var looked;
    if (current.optionSayas === 36) {
      if (wordLength === 1) spell = 4;
      else { buffer[--word1] = 95; looked = dict(word1, flags, 0); found = !!looked.found; phonemes = looked.phonemes; }
    }
    if (current.optionSayas & 16) spell = current.optionSayas & 15;
    else {
      if (!found) { looked = dict(word1, flags, F.FLAG_ALLOW_TEXTMODE); found = !!looked.found; phonemes = looked.phonemes; }
      var replaced = looked && looked.replacement ? looked.word : null;
      if (!found && !(flags[0] & F.FLAG_TEXTMODE) && isEmoji(first)) replaced = emojiReplacement(buffer, word1, flags, words, remaining);
      if ((flags[0] & (F.FLAG_ALLOW_DOT | F.FLAG_NEEDS_DOT)) && buffer[wordx + 1] === 46) buffer[wordx + 1] = 32;
      if (flags[0] & F.FLAG_TEXTMODE) { if (wantWordOut) wordOut = replaced || buffer.slice(word1, word1 + cLength(buffer, word1)); return done(flags[0]); }
      if (!found && (flags[0] & F.FLAG_SKIPWORDS) && !(flags[0] & F.FLAG_ABBREV)) {
        wordx = word1; var combined = 0;
        while (combined < services.dictionary.state().skipWords) { if (buffer[wordx] === 32) { buffer[wordx] = 45; combined++; } if (!buffer[wordx++]) unsupported('grouped-word-bounds'); }
      }
      if (wordLength === 1 && services.dictionary.state().skipWords === 0 && dottedAbbreviation(buffer, word1)) {
        flags.fill(0); spell = 1; if (services.dictionary.state().skipWords) flags[0] = F.FLAG_SKIPWORDS;
      }
      if (phonemes[0] === 21) { output = phonemes; return done(0); }
      if (!found && (flags[0] & F.FLAG_ABBREV)) spell = 1;
      if (!found && iswDigit(first)) {
        syncContext(); output = services.accent.lookupSymbol(ascii('_0lang')).phonemes;
        if (output[0] === 21) return done(0);
        found = translateNumber(false);
      }
      if (!found && (wflags & F.FLAG_UPPERS) !== F.FLAG_FIRST_UPPER &&
          ((wflags & F.FLAG_LAST_WORD) || remaining <= 1 || !(words[1].flags & F.FLAG_NOSPACE))) {
        found = translateNumber(true); if (found) flags[0] |= F.FLAG_ABBREV;
      }
      if ((wflags & F.FLAG_ALL_UPPER) && wordLength > 1 && iswAlpha(first)) {
        if ((current.optionToneFlags & 256) && !(flags[0] & F.FLAG_ABBREV)) emphasize = F.FLAG_EMPHASIZED;
        else if (!found && !(flags[0] & F.FLAG_SKIPWORDS) && wordLength < 4 && current.clauseLowerCount > 3 && current.clauseUpperCount <= current.clauseLowerCount) spell = 1;
      }
    }
    if (spell > 0) {
      var spelled = speakLetters(buffer, word1, spell, alphabet); output = spelled.phonemes;
      if (spelled.switched) return done(wordLength > 1 ? F.FLAG_SPELLWORD : 0);
      if (wflags & F.FLAG_TRANSLATOR2) return done(0);
      output = plural(buffer, wflags, last, output); return done(flags[0] & F.FLAG_SKIPWORDS);
    }
    if (!found) {
      var position = 0, length = 999; wordx = word1;
      while ((length < 3 && length > 0) || (wordLength > 1 && unpronounceable(buffer, wordx, position))) {
        wasUnpronounceable = F.FLAG_WAS_UNPRONOUNCABLE; emphasize = 0;
        if (buffer[wordx] === 39) break;
        var letter = translateLetter(buffer, wordx, unpron, position ? 1 : 0, alphabet);
        wordx += letter.bytes; position++; unpron = letter.phonemes;
        if (unpron[0] === 21) { output = unpron; return done(unpron.length === 3 && unpron[1] === 101 && unpron[2] === 110 ? F.FLAG_SPELLWORD : 0); }
        length = 0; while (buffer[wordx + length] !== 32) { if (!buffer[wordx + length]) unsupported('unpronounceable-source-bounds'); length++; }
      }
      unpron = spellingStress(unpron, 0, position);
      if (buffer[wordx] !== 32) {
        if (unpron.length && buffer[wordx] !== 39) buffer[wordx - 1] = 32;
        var translated = rule(buffer, wordx, flags, wflags, true, phonemes);
        phonemes = translated.phonemes; ending = translated.endPhonemes; endType = translated.endType;
        if (phonemes[0] === 21) { output = phonemes; return done(0); }
        if (!phonemes.length && !ending.length && wordLength === 1) {
          var single = readForward(buffer, wordx).codepoint;
          if (isAlpha(single) || isSuperscript(single)) { spelled = speakLetters(buffer, wordx, spell, alphabet); output = spelled.phonemes; return done(0); }
        }
        var saved = buffer[wordx - 1], confirmPrefix = true;
        for (var loop = 0; loop < 50 && (endType & F.SUFX_P); loop++) {
          if (confirmPrefix && !(endType & F.SUFX_B)) {
            var withoutPrefix = rule(buffer, wordx, flags, wflags | F.FLAG_NO_PREFIX | F.FLAG_NO_TRACE, true);
            if (withoutPrefix.endType) {
              var temporary = remove(wordx, withoutPrefix.endType, true);
              translated = rule(buffer, wordx, flags, wflags | F.FLAG_NO_TRACE, true, phonemes);
              phonemes = translated.phonemes; ending = translated.endPhonemes; endType = translated.endType;
              buffer.set(temporary.wordCopy, wordx);
              if (!(endType & F.SUFX_P)) { endType = withoutPrefix.endType; phonemes = withoutPrefix.phonemes; ending = withoutPrefix.endPhonemes; }
              confirmPrefix = false; continue;
            }
          }
          prefixType = endType;
          if (prefixType & F.SUFX_V) current.expectVerb = 1;
          buffer[wordx - 1] = saved;
          if (prefixType & F.SUFX_B) unsupported('separator-prefix');
          for (var n = prefixType & 15; n > 0; n--) { wordx++; while ((buffer[wordx] & 0xc0) === 0x80) wordx++; }
          saved = buffer[wordx - 1]; buffer[wordx - 1] = 32; confirmPrefix = true; wflags |= F.FLAG_PREFIX_REMOVED;
          prefix = join([prefix, ending]); ending = empty(); endType = 0;
          looked = dict(wordx, flags2, F.SUFX_P); found = !!looked.found; phonemes = looked.phonemes;
          if (!flags[0]) flags.set(flags2); else prefixFlags = 1;
          if (!found) {
            translated = rule(buffer, wordx, flags, wflags & (F.FLAG_HYPHEN_AFTER | F.FLAG_PREFIX_REMOVED), true, phonemes);
            phonemes = translated.phonemes; ending = translated.endPhonemes; endType = translated.endType;
            if (phonemes[0] === 21) { buffer[wordx - 1] = saved; output = phonemes; return done(0); }
          }
        }
        if (endType !== 0 && !(endType & F.SUFX_P)) {
          endType1 = endType; phonemes2 = phonemes.slice();
          var removed = remove(wordx, endType, true), endFlags = removed.endFlags, wordCopy = removed.wordCopy;
          var more = true;
          while (more) {
            more = false; phonemes = empty();
            if (prefix.length) {
              buffer[wordx - 1] = saved; looked = dict(word1, flags2, endFlags); found = !!looked.found; phonemes = looked.phonemes; buffer[wordx - 1] = 32;
              if (phonemes[0] === 21) { buffer.set(wordCopy, wordx); output = phonemes; return done(0); }
              if (!flags[0]) flags.set(flags2);
              if (found) prefix = empty();
              if (!found && flags2[0]) prefixFlags = 1;
            }
            if (!found) {
              looked = dict(wordx, flags2, endFlags); found = !!looked.found; phonemes = looked.phonemes;
              if (phonemes[0] === 21) { buffer.set(wordCopy, wordx); output = phonemes; return done(0); }
              if (!flags[0]) flags.set(flags2);
            }
            if (!found) {
              if (endType & F.SUFX_Q) phonemes = phonemes2.slice();
              else {
                if (endFlags & F.FLAG_SUFX) wflags |= F.FLAG_SUFFIX_REMOVED;
                if (endType & F.SUFX_A) wflags |= F.FLAG_SUFFIX_VOWEL;
                if (endType & F.SUFX_M) {
                  var previousEnding = ending;
                  translated = rule(buffer, wordx, flags, wflags, true, phonemes);
                  phonemes = translated.phonemes; ending = join([translated.endPhonemes, previousEnding]); endType = translated.endType;
                  if (endType !== 0 && !(endType & F.SUFX_P)) { endFlags = remove(wordx, endType, false).endFlags; more = true; }
                } else { translated = rule(buffer, wordx, flags, wflags, false, phonemes); phonemes = translated.phonemes; endType = 0; }
                if (phonemes[0] === 21) { output = phonemes; buffer.set(wordCopy, wordx); buffer[wordx - 1] = saved; return done(0); }
              }
            }
          }
          if (!(endType1 & F.SUFX_T)) { phonemes = services.rules.appendPhonemes(phonemes, ending, 200); ending = empty(); }
          buffer.set(wordCopy, wordx);
        }
        buffer[wordx - 1] = saved;
      }
    }
    output = plural(buffer, wflags, last, output); wflags |= emphasize;
    var prefixStress = 0;
    for (var p = 0; p < prefix.length; p++) if (prefix[p] === 6 || prefix[p] === 7) prefixStress = prefix[p];
    if (prefixFlags || prefixStress) {
      if (prefixType & F.SUFX_T) {
        phonemes = stress(phonemes, flags, 3, 0); var primary = false;
        for (p = 0; p < prefix.length; p++) if (prefix[p] === 6) { if (primary) prefix[p] = 5; else primary = true; }
      }
      output = stress(join([unpron, prefix, phonemes]), flags, -1, 0);
    } else { phonemes = stress(phonemes, flags, -1, ending.length ? 2 : 0); output = join([unpron, prefix, phonemes]); }
    output = join([output, ending]);
    if (wflags & F.FLAG_LAST_WORD) flags[0] &= ~F.FLAG_PAUSE1;
    if (wflags & F.FLAG_EMPHASIZED2) { output = changeStress(output, 6); if (wflags & F.FLAG_EMPHASIZED) flags[0] |= F.FLAG_PAUSE1; }
    else {
      var skipped = services.dictionary.state().skipWords;
      if (skipped < remaining && (words[skipped].flags & F.FLAG_LAST_WORD)) {
        if (flags[0] & (F.FLAG_STRESS_END | F.FLAG_STRESS_END2)) output = changeStress(output, 4);
        // The pinned source tests the nonnull bool pointer, not its value.
        else if (flags[0] & F.FLAG_UNSTRESS_END) output = changeStress(output, 3);
      }
    }
    if (endType1 & F.SUFX_F) { current.expectVerb = 2; current.expectVerbS = 2; }
    if (flags[1] & F.FLAG_PASTF) { current.expectPast = 3; current.expectVerb = 0; current.expectNoun = 0; }
    else if (flags[1] & F.FLAG_VERBF) { current.expectVerb = 2; current.expectVerbS = 0; current.expectNoun = 0; }
    else if (flags[1] & F.FLAG_VERBSF) { current.expectVerb = 0; current.expectVerbS = 2; current.expectPast = 0; current.expectNoun = 0; }
    else if (flags[1] & F.FLAG_NOUNF) { current.expectNoun = 2; current.expectVerb = 0; current.expectVerbS = 0; current.expectPast = 0; }
    if (buffer[wordx] && !(flags[1] & F.FLAG_VERB_EXT)) {
      for (var k = 0; k < 4; k++) { var field = ['expectVerb', 'expectVerbS', 'expectNoun', 'expectPast'][k]; if (current[field] > 0) current[field]--; }
    }
    if (wordLength === 1 && iswAlpha(first) && first !== 105) flags[0] |= F.FLAG_ALLOW_DOT;
    flags[0] |= wasUnpronounceable; buffer.set(original, start); return done(flags[0]);
  }
  function segmentReplacement(bytes) {
    var out = new Uint8Array(322), source = new Uint8Array(bytes.length + 8), index = 0, offset = 2, cp = 0;
    out[1] = 32; source.set(bytes);
    while (source[index]) {
      var previous = cp, decoded = readForward(source, index); cp = decoded.codepoint;
      var insertSpace = false;
      if (isAlpha(previous)) {
        if (isAlpha(cp)) insertSpace = shouldSplitIdeographs(cp, previous,
          profile.voice === 'cmn' ? CMN_TEXT_CHARACTER_PROFILE : undefined);
        else if (cp === 45) {
          if (isAlpha(readForward(source, index + decoded.bytes).codepoint)) {
            if (offset + 2 > out.length) break;
            out[offset++] = 32; index += decoded.bytes; cp = 32; continue;
          }
        } else if (!isSpace(cp) && cp >= 128 && cp !== 39) insertSpace = true;
      } else if (previous >= 128 && !isSpace(previous) && isAlpha(cp) && previous !== 39) insertSpace = true;
      if (offset + decoded.bytes + 2 > out.length) break;
      if (insertSpace) out[offset++] = 32;
      out.set(source.subarray(index, index + decoded.bytes), offset); offset += decoded.bytes; index += decoded.bytes;
    }
    return out;
  }
  function withBounds(buffer, start, words, remaining, wantWordOut, anyStressed, alphabet, initialPhonemes, clauseEnd, depth) {
    var result = word3(buffer, start, words, remaining, wantWordOut, anyStressed, alphabet, initialPhonemes, clauseEnd);
    if ((result.flags & F.FLAG_TEXTMODE) && wantWordOut) {
      var replacement = segmentReplacement(result.wordOut), at = 2, accumulated = empty(), first = true, available = 200;
      while (replacement[at] && available > 1) {
        var decoded = readForward(replacement, at);
        if (iswUpper(decoded.codepoint)) {
          words[0].flags = (words[0].flags | F.FLAG_FIRST_UPPER) >>> 0;
          var lower = new Uint8Array(8), width = writeUtf8CodePoint(toLowerCodePoint(decoded.codepoint, false), lower, 0);
          if (width === decoded.bytes) replacement.set(lower.subarray(0, width), at);
        } else words[0].flags = (words[0].flags & ~F.FLAG_FIRST_UPPER) >>> 0;
        var skip = services.dictionary.state().skipWords;
        // Replacement storage is distinct from the caller's original clause.
        var translated = depth < 3 ? withBounds(replacement, at, words, remaining, true, result.anyStressedWords, alphabet, result.phonemes, null, depth + 1) :
          word3(replacement, at, words, remaining, false, result.anyStressedWords, alphabet, result.phonemes, null);
        result.phonemes = translated.phonemes;
        result.anyStressedWords = translated.anyStressedWords;
        var addition = first ? translated.phonemes : join([new Uint8Array([15]), translated.phonemes], 200);
        var size = addition.length;
        accumulated = join([accumulated, addition.subarray(0, Math.max(0, available - 1))]); available -= size; first = false;
        var count = services.dictionary.state().skipWords + 1;
        while (count-- > 0) {
          while (replacement[at] !== 32 && replacement[at] !== 9 && replacement[at] !== 10 && replacement[at] !== 13 && replacement[at] !== 12 && replacement[at] !== 11) {
            if (!replacement[at] || at >= replacement.length) unsupported('replacement-word-bounds'); at++;
          }
          while (replacement[at] === 32 || (replacement[at] >= 9 && replacement[at] <= 13)) at++;
        }
        services.dictionary.setState({ skipWords: skip });
      }
      if (accumulated.length) result.phonemes = accumulated;
    }
    return result;
  }
  function translate(input, options) {
    if (fault) throw fault;
    var opts = options || {}, operation = opts.operation === undefined ? 'word3' : opts.operation;
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected word Uint8Array');
    var fullInput = opts.offset !== undefined, offset = fullInput ? opts.offset : 3;
    if (!Number.isInteger(offset) || offset < 3 || (fullInput && offset >= input.length)) throw new RangeError('Invalid word source offset');
    var sourceLength = fullInput ? cLength(input, offset) : input.length;
    var endIndex = (fullInput ? offset : 0) + sourceLength;
    var terminator = endIndex < input.length ? input[endIndex] : input[endIndex - 1];
    if (!sourceLength || ![32, 0].includes(terminator) || (!fullInput && input.indexOf(0) >= 0)) throw new TypeError('Word input must be NUL-free, space- or NUL-terminated Uint8Array');
    if (operation !== 'word' && operation !== 'word3' && operation !== 'withBounds') throw new TypeError('Unknown word translation operation');
    var prefix = opts.prefixBytes === undefined ? new Uint8Array([0, 32]) : opts.prefixBytes;
    if (!(prefix instanceof Uint8Array) || prefix.length !== 2) throw new TypeError('Expected two prefix bytes');
    var incomingWords = opts.words === undefined ? [zeroWord()] : opts.words;
    if (!Array.isArray(incomingWords) || incomingWords.length > 300) throw new TypeError('Expected bounded WORD_TAB array');
    var words = incomingWords.map(function (word) {
      var out = zeroWord(), keys = Object.keys(out);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k], value = word[key] === undefined ? 0 : word[key];
        var max = key === 'flags' ? 0xffffffff : key === 'start' || key === 'sourceix' ? 65535 : 255;
        if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError('Invalid WORD_TAB ' + key); out[key] = value;
      }
      return out;
    });
    var beforeWords = cloneWords(words), remaining = opts.remaining === undefined ? operation === 'word' ? 0 : words.length : opts.remaining;
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > words.length) throw new RangeError('Invalid remaining WORD_TAB count');
    var wantWordOut = opts.wordOut === undefined ? true : opts.wordOut, anyStressed = opts.anyStressedWords === undefined ? false : opts.anyStressedWords;
    if (typeof wantWordOut !== 'boolean' || typeof anyStressed !== 'boolean') throw new TypeError('Expected word output/stress booleans');
    if (operation === 'word' && (remaining !== 0 || (wantWordOut && !words.length))) throw new RangeError('TranslateWord requires zero remaining and a word row for replacement');
    var alphabet = opts.alphabetCodepoint === undefined || opts.alphabetCodepoint === null ? null : alphabetFromChar(opts.alphabetCodepoint);
    if (operation === 'word' && (alphabet !== null || anyStressed)) throw new TypeError('TranslateWord uses fresh default alphabet/stress context');
    var initialPhonemes = opts.initialPhonemes === undefined ? empty() : opts.initialPhonemes;
    if (!(initialPhonemes instanceof Uint8Array) || initialPhonemes.length >= 200 || initialPhonemes.indexOf(0) >= 0) throw new TypeError('Invalid initial word phonemes');
    var buffer = new Uint8Array(input.length + 16);
    if (fullInput) buffer.set(input); else { buffer.set(prefix, 1); buffer.set(input, 3); }
    if (!clauseEndSet) current.clauseEnd = sourceLength - 1;
    if (current.clauseEnd < 0 || current.clauseEnd > sourceLength) throw new RangeError('Clause end outside source');
    var before = state(), activeWords = words.length ? words : [zeroWord()];
    globalWordPhonemes = initialPhonemes.slice();
    var translated;
    try {
      translated = operation !== 'word3' ? withBounds(buffer, offset, activeWords, remaining, wantWordOut, anyStressed, alphabet, initialPhonemes, clauseEndRelation === 'unrelated' ? null : current.clauseEnd + offset, 0) :
        word3(buffer, offset, activeWords, remaining, wantWordOut, anyStressed, alphabet, initialPhonemes, clauseEndRelation === 'unrelated' ? null : current.clauseEnd + offset);
    } catch (error) {
      if (error.code === 'DICTIONARY_UNSUPPORTED' || error.code === 'DICTIONARY_RULES_UNSUPPORTED' || error.code === 'LETTER_NAME_UNSUPPORTED' || error.code === 'ACCENT_UNSUPPORTED' || error.code === 'NUMBER_UNSUPPORTED') unsupported(error.code.toLowerCase() + ':' + error.reason);
      throw error;
    }
    if (operation !== 'word3') globalWordPhonemes = translated.phonemes.slice();
    return { flags: translated.flags, phonemes: translated.phonemes, wordOut: translated.wordOut,
      prefixAfter: buffer.slice(offset - 2, offset), wordAfter: buffer.slice(offset, sourceLength + offset), bufferAfter: buffer.slice(0, input.length + (fullInput ? 0 : 3)),
      wordsBefore: beforeWords, wordsAfter: cloneWords(words),
      stateBefore: before, stateAfter: state(), anyStressedWords: operation === 'word' ? null : translated.anyStressedWords };
  }
  function translateLookup(buffer, options) {
    var opts = options || {}, savedSayas = current.optionSayas;
    current.optionSayas = opts.sayAs === undefined ? 0 : opts.sayAs;
    try {
      var result = withBounds(buffer.slice(), opts.offset, [zeroWord()], 0, false, false, null, globalWordPhonemes, null, 0);
      globalWordPhonemes = result.phonemes.slice(); return result;
    }
    finally { current.optionSayas = savedSayas; }
  }
  return { translate: translate, translateLookup: translateLookup, state: state, setState: setState };
}
