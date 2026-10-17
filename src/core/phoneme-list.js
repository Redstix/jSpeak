// Pinned translate.c:TranslateWord2, from the post-translation list boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.
import { PHONEME_LIST_PROFILE, PHONEME_LIST_CONSTANTS as C } from '../../data/phoneme-list/profile.js';
import { CMN_PHONEME_LIST_PROFILE } from '../../data/cmn/synthesis-profile.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { isAlpha } from './unicode.js';
export { PHONEME_LIST_PROFILE };
var BYTE_COLUMNS = ['phcode', 'stresslevel', 'wordstress', 'tonePh'];
var SHORT_COLUMNS = ['sourceix', 'synthflags'];
function integer(value, low, high, label) {
  if (!Number.isInteger(value) || value < low || value > high) throw new RangeError('Invalid phoneme-list ' + label);
  return value;
}
function unsupported(reason) {
  var error = new Error('Phoneme-list dependency not implemented: ' + reason);
  error.code = 'PHONEME_LIST_UNSUPPORTED'; error.reason = reason; throw error;
}
function copyColumn(input, Type, length, label) {
  if (!(input instanceof Type) || input.length !== length) throw new TypeError('Expected complete ' + label + ' typed column');
  return new Type(input);
}
function lengthOf(bytes) { var n = 0; while (n < bytes.length && bytes[n]) n++; return n; }

export function createPhonemeListSession(table, profile, initial) {
  if (!table || !Array.isArray(table.entries) || table.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  if (!profile) throw new TypeError('Expected explicit phoneme-list profile');
  var knownProfiles = { 'en-us': PHONEME_LIST_PROFILE, cmn: CMN_PHONEME_LIST_PROFILE };
  var expectedProfile = knownProfiles[profile.voice];
  if (!expectedProfile || JSON.stringify(profile) !== JSON.stringify(expectedProfile) ||
      table.index !== profile.phonemeTable || table.name !== profile.voice) throw new Error('Unsupported phoneme-list profile');
  var supplied = initial || {}, list = { length: 1 }, current = supplied.state || {}, state = {};
  for (var b = 0; b < BYTE_COLUMNS.length; b++) {
    var byteName = BYTE_COLUMNS[b];
    list[byteName] = supplied.list ? copyColumn(supplied.list[byteName], Uint8Array, profile.capacity, byteName) : new Uint8Array(profile.capacity);
  }
  for (var s = 0; s < SHORT_COLUMNS.length; s++) {
    var shortName = SHORT_COLUMNS[s];
    list[shortName] = supplied.list ? copyColumn(supplied.list[shortName], Uint16Array, profile.capacity, shortName) : new Uint16Array(profile.capacity);
  }
  if (supplied.list) list.length = integer(supplied.list.length, 1, profile.capacity, 'initial count');
  else list.phcode[0] = C.phonPAUSE_SHORT; // fresh original clause arena, including its required predecessor
  for (var name of ['embeddedFlag', 'endStressedVowel', 'optionCapitals']) state[name] = integer(current[name] === undefined ? 0 : current[name], -0x80000000, 0x7fffffff, name);
  for (var unsigned of ['prevDictFlags0', 'prevDictFlags1']) state[unsigned] = integer(current[unsigned] === undefined ? 0 : current[unsigned], 0, 0xffffffff, unsigned);
  state.embeddedIndex = integer(current.embeddedIndex === undefined ? 0 : current.embeddedIndex, 0, profile.embeddedCapacity, 'embedded index');
  state.anyStressedWords = current.anyStressedWords === undefined ? false : current.anyStressedWords;
  if (typeof state.anyStressedWords !== 'boolean') throw new TypeError('Expected any-stressed-words boolean');
  state.embeddedList = current.embeddedList === undefined ? new Uint32Array(profile.embeddedCapacity) : copyColumn(current.embeddedList, Uint32Array, profile.embeddedCapacity, 'embedded commands');

  function stateCopy() { return { ...state, embeddedList: state.embeddedList.slice() }; }
  function setState(patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('Expected phoneme-list state patch');
    var copied = {}, names = Object.keys(patch);
    for (var i = 0; i < names.length; i++) {
      var name = names[i], value = patch[name];
      if (name === 'embeddedList') copied[name] = copyColumn(value, Uint32Array, profile.embeddedCapacity, name);
      else if (name === 'anyStressedWords') { if (typeof value !== 'boolean') throw new TypeError('Expected any-stressed-words boolean'); copied[name] = value; }
      else if (name === 'prevDictFlags0' || name === 'prevDictFlags1') copied[name] = integer(value, 0, 0xffffffff, name);
      else if (name === 'embeddedIndex') copied[name] = integer(value, 0, profile.embeddedCapacity, name);
      else if (name === 'embeddedFlag' || name === 'endStressedVowel' || name === 'optionCapitals') copied[name] = integer(value, -0x80000000, 0x7fffffff, name);
      else throw new RangeError('Unknown phoneme-list state field: ' + name);
    }
    for (var j = 0; j < names.length; j++) state[names[j]] = copied[names[j]];
  }
  function beginClause(patch) {
    if (patch !== undefined) setState(patch);
    for (var name of BYTE_COLUMNS.concat(SHORT_COLUMNS)) list[name][0] = 0;
    list.phcode[0] = C.phonPAUSE_SHORT; list.length = 1;
    // Only the arena and its directly adjacent translator resets here.
    // The caller owns earlier embedded parsing and any_stressed_words reset.
    state.prevDictFlags0 = state.prevDictFlags1 = state.endStressedVowel = 0;
  }
  function snapshot() {
    var copied = { length: list.length };
    for (var name of BYTE_COLUMNS.concat(SHORT_COLUMNS)) copied[name] = list[name].slice();
    return { list: copied, state: stateCopy() };
  }
  function entry(index) {
    if (index < 0 || index >= profile.capacity) throw new RangeError('Phoneme-list access outside arena');
    return index;
  }
  function setPlist(index, code) {
    entry(index); list.phcode[index] = code; list.stresslevel[index] = 0; list.tonePh[index] = 0;
    list.synthflags[index] = state.embeddedFlag; list.sourceix[index] = 0; state.embeddedFlag = 0;
    // Original SetPlist2 does not initialize wordstress.
  }
  function appendEmbeddedWordEnd() {
    if (list.length >= profile.capacity - 2 || !state.embeddedFlag) return false;
    setPlist(list.length, C.phonEND_WORD); list.wordstress[list.length++] = 0;
    state.embeddedFlag = 0; return true;
  }
  function finishClause(sourceIndex) {
    integer(sourceIndex, 0, 0xffffffff, 'clause source index');
    if (list.length > profile.capacity - 2) throw new RangeError('Clause termination requires two reserved phoneme slots');
    for (var i = 0; i < 2; i++) {
      var index = list.length + i;
      list.phcode[index] = C.phonPAUSE; list.stresslevel[index] = 0;
      list.sourceix[index] = sourceIndex; list.synthflags[index] = 0;
    }
    list.length += 2;
  }
  function appendWord(input, options) {
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected word phoneme bytes');
    var opts = options || {}, length = lengthOf(input);
    if (length >= profile.phonemeCapacity) throw new RangeError('Word phonemes exceed original capacity');
    var flags = integer(opts.dictionaryFlags === undefined ? 0 : opts.dictionaryFlags, 0, 0xffffffff, 'dictionary flags');
    var wordFlags = integer(opts.wordFlags === undefined ? 0 : opts.wordFlags, 0, 0xffffffff, 'word flags');
    var sourceIndex = integer(opts.sourceIndex === undefined ? 0 : opts.sourceIndex, 0, 65535, 'source index');
    var wordLength = integer(opts.wordLength === undefined ? 0 : opts.wordLength, 0, 255, 'word length');
    var prePause = integer(opts.prePause === undefined ? 0 : opts.prePause, -0x80000000, 0x7fffffff, 'pre-pause');
    var pitchRaised = integer(opts.pitchRaised === undefined ? 0 : opts.pitchRaised, 0, 0x7fffffff, 'raised pitch');
    var switched = opts.switchPhonemes === undefined ? -1 : opts.switchPhonemes;
    if (switched !== -1) unsupported('alternate-translator');
    if (list.length >= profile.capacity - 9) throw new RangeError('Caller must reserve the original nine phoneme slots before this boundary');
    var word = opts.wordBytes === undefined ? new Uint8Array() : opts.wordBytes;
    if (!(word instanceof Uint8Array)) throw new TypeError('Expected word bytes');
    if (state.optionCapitals === 1 && (wordFlags & F.FLAG_FIRST_UPPER) && (wordFlags & F.FLAG_ALL_UPPER) && word.length < 2) throw new RangeError('Capital indication requires the original second word byte');
    if (pitchRaised > 0 && state.embeddedIndex >= profile.embeddedCapacity) throw new RangeError('Pitch restore exceeds embedded command arena');
    var phonemes = new Uint8Array(profile.phonemeCapacity); phonemes.set(input.subarray(0, length));
    var begin = list.length, stress = 0, nextStress = 1, nextTone = 0, srcix = 0;
    var sourceIx = (sourceIndex & 0x7ff) | (Math.min(wordLength, 31) << 11);
    var maxStress = -1, maxStressIndex = 0, prevVowel = -1, firstPhoneme = true, position = 0;
    var found = (flags & F.FLAG_FOUND) && !(flags & F.FLAG_TEXTMODE) ? C.SFLAG_DICTIONARY : 0;
    while (prePause > 0 && list.length < profile.capacity - 9) {
      if (prePause > 1) { setPlist(list.length++, C.phonPAUSE); prePause -= 2; }
      else { setPlist(list.length++, C.phonPAUSE_NOLINK); prePause--; }
      state.endStressedVowel = 0; state.prevDictFlags0 = 0; state.prevDictFlags1 = 0;
    }
    var firstRow = list.length;
    if (state.optionCapitals === 1 && (wordFlags & F.FLAG_FIRST_UPPER)) {
      setPlist(list.length++, C.phonPAUSE_SHORT); setPlist(list.length++, C.phonCAPITAL);
      var second = word[1] >= 128 ? word[1] - 256 : word[1];
      if ((wordFlags & F.FLAG_ALL_UPPER) && isAlpha(second)) { setPlist(list.length++, C.phonPAUSE_SHORT); setPlist(list.length++, C.phonCAPITAL); }
    }
    if (wordFlags & F.FLAG_HYPHEN) {
      var first = table.entries[phonemes[position]];
      if (!first) unsupported('invalid-hyphen-first-phoneme');
      if (first.type === 0) position++;
    }
    if (phonemes[position] === 0 && state.embeddedFlag) { phonemes[position] = C.phonPAUSE_VSHORT; phonemes[position + 1] = 0; }
    var code;
    while ((code = phonemes[position++]) !== 0 && list.length < profile.capacity - 5) {
      if (code === 255) continue;
      var ph = table.entries[code];
      if (!ph) continue;
      if (code === C.phonSWITCH) unsupported('phoneme-table-switch');
      if (ph.type === 1) {
        if (ph.program === 0) nextStress = ph.stdLength;
        else if (prevVowel >= 0) list.tonePh[prevVowel] = code;
        else nextTone = code;
      } else if (code === C.phonSYLLABIC) {
        prevVowel = entry(list.length - 1); list.synthflags[prevVowel] |= C.SFLAG_SYLLABLE; list.stresslevel[prevVowel] = nextStress;
      } else if (code === C.phonLENGTHEN) list.synthflags[entry(list.length - 1)] |= C.SFLAG_LENGTHEN;
      else if (code === C.phonEND_WORD) srcix = sourceIx + 1;
      else if (code === C.phonX1) flags |= F.FLAG_DOUBLING;
      else {
        var index = entry(list.length);
        list.phcode[index] = code; list.tonePh[index] = 0; list.synthflags[index] = state.embeddedFlag | found;
        state.embeddedFlag = 0; list.sourceix[index] = srcix; srcix = 0;
        if (ph.type === 2) {
          stress = nextStress; nextStress = 1;
          if (stress >= 4) state.anyStressedWords = true;
          if (prevVowel >= 0 && list.length - 1 !== prevVowel) list.stresslevel[list.length - 1] = stress;
          list.synthflags[index] |= C.SFLAG_SYLLABLE; prevVowel = index;
          if (stress > maxStress) { maxStress = stress; maxStressIndex = index; }
          if (nextTone !== 0) { list.tonePh[index] = nextTone; nextTone = 0; }
        } else if (firstPhoneme && (state.prevDictFlags0 & F.FLAG_DOUBLING)) list.synthflags[index] |= C.SFLAG_LENGTHEN;
        list.stresslevel[index] = stress; list.length++; firstPhoneme = false;
      }
    }
    if (wordFlags & F.FLAG_COMMA_AFTER) setPlist(list.length++, C.phonPAUSE_CLAUSE);
    if (!(wordFlags & F.FLAG_HYPHEN)) list.sourceix[entry(firstRow)] = sourceIx;
    state.endStressedVowel = 0;
    if (stress >= 4) {
      var last = table.entries[list.phcode[entry(list.length - 1)]];
      if (!last) unsupported('invalid-final-phoneme');
      if (last.type === 2) state.endStressedVowel = 1;
    }
    if (pitchRaised > 0) {
      state.embeddedList[state.embeddedIndex++] = C.EMBED_P + 0x60 + 0x80 + (pitchRaised << 8);
      setPlist(list.length, C.phonPAUSE_SHORT); list.synthflags[list.length++] = C.SFLAG_EMBEDDED;
    }
    if (flags & F.FLAG_STRESS_END2) list.synthflags[maxStressIndex] |= C.SFLAG_PROMOTE_STRESS;
    state.prevDictFlags0 = flags >>> 0;
    return { flags: flags >>> 0, phonemes: phonemes.slice(0, lengthOf(phonemes)), begin: begin, end: list.length };
  }
  return { appendWord: appendWord, appendEmbeddedWordEnd: appendEmbeddedWordEnd, finishClause: finishClause,
    length: function () { return list.length; }, snapshot: snapshot, state: stateCopy, setState: setState, beginClause: beginClause };
}
