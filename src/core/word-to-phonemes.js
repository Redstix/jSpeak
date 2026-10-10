// Pinned translate.c:TranslateWord2, before the compact phoneme-list boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2017 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { PHONEME_LIST_CONSTANTS as C } from '../../data/phoneme-list/profile.js';
import { encodePhonemes } from './phoneme-encode.js';
import { iswAlpha } from './unicode.js';
import { readForward } from './utf8-scan.js';

function unsupported(reason) {
  var error = new Error('Word-to-phoneme dependency not implemented: ' + reason);
  error.code = 'WORD_TO_PHONEMES_UNSUPPORTED'; error.reason = reason; throw error;
}
function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
}
function copyWords(words) {
  return words.map(function (word) { return { flags: word.flags >>> 0, start: word.start,
    prePause: word.prePause, sourceix: word.sourceix, length: word.length }; });
}

// The caller supplies the same word and list sessions throughout the clause.
// Separate local prePause from the original global pre_pause: embedded breaks
// update the latter even though TranslateWord2's parameter has the same C name.
export function createWordToPhonemesSession(services, table, list, profile, initial) {
  if (!services || !services.wordTranslation || !list || typeof list.appendWord !== 'function') throw new TypeError('Expected word and phoneme-list services');
  if (!table || table.index !== 80 || table.name !== 'en-us') throw new TypeError('Expected en-us phoneme table');
  if (!profile || !Number.isInteger(profile.combineWords)) throw new TypeError('Expected generated clause profile');
  var wordsService = services.wordTranslation, settings = initial || {};
  var embeddedRead = integer(settings.embeddedRead === undefined ? 0 : settings.embeddedRead, 0, 250, 'embedded read');
  var optionEmphasis = integer(settings.optionEmphasis === undefined ? 0 : settings.optionEmphasis, -2147483648, 2147483647, 'emphasis');
  var wordPhonemes = new Uint8Array(0);
  function setState(patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('Expected word-to-phoneme state patch');
    var read = patch.embeddedRead === undefined ? embeddedRead : integer(patch.embeddedRead, 0, 250, 'embedded read');
    var emphasis = patch.optionEmphasis === undefined ? optionEmphasis : integer(patch.optionEmphasis, -2147483648, 2147483647, 'emphasis');
    var phonemes = patch.wordPhonemes === undefined ? wordPhonemes : patch.wordPhonemes;
    if (!(phonemes instanceof Uint8Array) || phonemes.length >= 200 || phonemes.indexOf(0) >= 0) throw new RangeError('Invalid current word phonemes');
    embeddedRead = read; optionEmphasis = emphasis; wordPhonemes = new Uint8Array(phonemes);
  }
  setState(settings);
  function state() { return { embeddedRead: embeddedRead, optionEmphasis: optionEmphasis, wordPhonemes: wordPhonemes.slice() }; }
  function consumeEmbedded() {
    var commands = list.state(), current = wordsService.state(), command;
    if (embeddedRead >= commands.embeddedIndex) unsupported('embedded-read-outside-written-list');
    do {
      command = commands.embeddedList[embeddedRead++];
      var value = (command | 0) >> 8;
      switch (command & 31) {
        case 9: current.optionSayas = value; break;
        case 13: optionEmphasis = value; break;
        case 12: current.prePause = value === 0 ? 0 : (current.prePause + value) | 0; break;
      }
    } while (!(command & 128) && embeddedRead < commands.embeddedIndex);
    wordsService.setState({ optionSayas: current.optionSayas, prePause: current.prePause });
  }
  function translate(input, options) {
    var opts = options || {};
    if (!(input instanceof Uint8Array)) throw new TypeError('Expected original word backing buffer');
    var offset = integer(opts.offset, 3, input.length - 1, 'word offset');
    if (!Array.isArray(opts.words) || opts.words.length > 300) throw new TypeError('Expected original WORD_TAB rows');
    var rows = copyWords(opts.words), wordIndex = integer(opts.wordIndex === undefined ? 0 : opts.wordIndex, 0, rows.length - 1, 'word index');
    var remaining = integer(opts.remaining === undefined ? rows.length - wordIndex : opts.remaining, 0, rows.length - wordIndex, 'remaining words');
    var prePause = integer(opts.prePause === undefined ? rows[wordIndex].prePause : opts.prePause, -2147483648, 2147483647, 'word prepause');
    var buffer = new Uint8Array(input), row = rows[wordIndex], wordFlags = row.flags, flags = 0, pitchRaised = 0;
    var clauseEnd = opts.clauseEnd;
    var clauseRelation = opts.clauseEndRelation === undefined ? 'in-source' : opts.clauseEndRelation;
    if (!['in-source', 'unrelated', 'before-source', 'after-source'].includes(clauseRelation)) throw new TypeError('Invalid clause-end relation');
    if (clauseEnd !== undefined) integer(clauseEnd, offset, buffer.length, 'clause end offset');
    function finish() { return { flags: flags >>> 0, buffer: buffer, words: rows, phonemes: wordPhonemes.slice(), state: state() }; }
    if (wordFlags & F.FLAG_EMBEDDED) {
      row.flags = (row.flags & ~F.FLAG_EMBEDDED) >>> 0;
      list.setState({ embeddedFlag: C.SFLAG_EMBEDDED }); consumeEmbedded();
    }
    if (list.length() >= 998) return finish();
    if (buffer[offset] === 0 || (wordFlags & F.FLAG_DELETE_WORD)) {
      list.appendEmbeddedWordEnd(); wordPhonemes = new Uint8Array(0); return finish();
    }
    if (list.length() >= 991) return finish();
    var current = wordsService.state();
    if (current.prepauseTimeout > 0) wordsService.setState({ prepauseTimeout: current.prepauseTimeout - 1 });
    if ((current.optionSayas & 240) === 16 && !(wordFlags & F.FLAG_FIRST_WORD)) prePause += 4;
    if (wordFlags & F.FLAG_FIRST_UPPER) {
      var commands = list.state();
      if (current.optionCapitals > 2 && commands.embeddedIndex < 244) {
        if (commands.embeddedFlag) commands.embeddedList[commands.embeddedIndex - 1] &= ~128;
        pitchRaised = current.optionCapitals === 3 ? 20 : current.optionCapitals;
        commands.embeddedList[commands.embeddedIndex++] = C.EMBED_P + 64 + 128 + (pitchRaised << 8);
        list.setState({ embeddedList: commands.embeddedList, embeddedIndex: commands.embeddedIndex, embeddedFlag: C.SFLAG_EMBEDDED });
      }
    }
    function translateAt(at, index, count, wordOut) {
      wordsService.setState({ clauseEndRelation: clauseRelation });
      if (clauseRelation !== 'in-source') wordsService.setState({ clauseEnd: 0 });
      else if (clauseEnd !== undefined) wordsService.setState({ clauseEnd: Math.max(0, clauseEnd - at) });
      var translated = wordsService.translate(buffer, { operation: 'withBounds', offset: at, words: rows.slice(index), remaining: count,
        wordOut: wordOut, anyStressedWords: list.state().anyStressedWords, initialPhonemes: wordPhonemes });
      buffer.set(translated.bufferAfter);
      for (var i = 0; i < translated.wordsAfter.length; i++) rows[index + i] = translated.wordsAfter[i];
      row = rows[wordIndex]; wordPhonemes = translated.phonemes;
      if (typeof translated.anyStressedWords === 'boolean') list.setState({ anyStressedWords: translated.anyStressedWords });
      return translated.flags >>> 0;
    }
    if (wordFlags & F.FLAG_PHONEMES) {
      if (buffer[offset] === 95 && buffer[offset + 1] === 94 && buffer[offset + 2] === 95) unsupported('explicit-language-switch');
      wordPhonemes = encodePhonemes(buffer.subarray(offset), table).phonemes; flags = F.FLAG_FOUND;
    } else {
      var copyEnd = offset;
      while (copyEnd < buffer.length && buffer[copyEnd] !== 32 && buffer[copyEnd] && copyEnd - offset < 160) copyEnd++;
      var originalWord = buffer.slice(offset, copyEnd);
      flags = translateAt(offset, wordIndex, remaining, true);
      if (flags & F.FLAG_SPELLWORD) { buffer.set(originalWord, offset); return finish(); }
      if ((flags & F.FLAG_COMBINE) && remaining > 1 && !(rows[wordIndex + 1].flags & F.FLAG_PHONEMES)) {
        var next = offset;
        while (next < buffer.length && buffer[next] !== 32) next++;
        if (next + 1 >= buffer.length) unsupported('combined-word-buffer-bounds');
        var combine = iswAlpha(readForward(buffer, next + 1).codepoint), flags2 = 0;
        if (combine) {
          var saved = wordPhonemes.slice(); flags2 = translateAt(next + 1, wordIndex + 1, remaining - 1, false);
          if ((flags2 & F.FLAG_WAS_UNPRONOUNCABLE) || wordPhonemes[0] === C.phonSWITCH) combine = false;
          if ((profile.combineWords & 256) && !(flags2 & F.FLAG_ALT_TRANS)) combine = false;
          if ((profile.combineWords & 512) && (rows[wordIndex + 1].flags & F.FLAG_LAST_WORD)) combine = false;
          if (!combine) wordPhonemes = saved;
        }
        if (combine) {
          buffer[next] = 45; row.flags = (row.flags & ~F.FLAG_ALL_UPPER) >>> 0;
          flags = translateAt(offset, wordIndex, remaining, false);
          var syllables = 0;
          for (var p = 0; p < wordPhonemes.length; p++) {
            var phoneme = table.entries[wordPhonemes[p]];
            if (!phoneme) unsupported('combined-word-invalid-phoneme');
            if (phoneme.type === 2) syllables++;
          }
          if (profile.combineWords > 0 && syllables > (profile.combineWords & 31)) {
            buffer[next] = 32; flags = translateAt(offset, wordIndex, remaining, false);
          } else {
            if (flags === 0) flags = flags2;
            flags = (flags | F.FLAG_SKIPWORDS) >>> 0; services.dictionary.setState({ skipWords: 1 });
          }
        }
      }
      if (wordPhonemes[0] === C.phonSWITCH) unsupported('alternate-translator');
      current = wordsService.state();
      if (!(wordFlags & F.FLAG_HYPHEN)) {
        if ((flags & F.FLAG_PAUSE1) && prePause < 1) prePause = 1;
        if ((flags & F.FLAG_PREPAUSE) && !(wordFlags & (F.FLAG_LAST_WORD | F.FLAG_FIRST_WORD))) {
          if (wordIndex === 0) unsupported('prepause-previous-word-not-supplied');
          if (!(rows[wordIndex - 1].flags & F.FLAG_FIRST_WORD) && current.prepauseTimeout === 0) {
            if (prePause < 4) prePause = 4;
            wordsService.setState({ prepauseTimeout: 3 });
          }
        }
      }
      if (optionEmphasis >= 3 && prePause < 1) prePause = 1;
    }
    current = wordsService.state();
    list.setState({ prevDictFlags0: current.prevDictFlags0, prevDictFlags1: current.prevDictFlags1,
      endStressedVowel: current.endStressedVowel, optionCapitals: current.optionCapitals });
    var appended = list.appendWord(wordPhonemes, { dictionaryFlags: flags >>> 0, wordFlags: wordFlags,
      sourceIndex: row.sourceix, wordLength: row.length, wordBytes: buffer.subarray(offset), prePause: prePause, pitchRaised: pitchRaised });
    flags = appended.flags; wordPhonemes = appended.phonemes;
    var after = list.state();
    wordsService.setState({ prevDictFlags0: after.prevDictFlags0, prevDictFlags1: after.prevDictFlags1, endStressedVowel: after.endStressedVowel });
    return finish();
  }
  return { translate: translate, state: state, setState: setState, consumeEmbedded: consumeEmbedded };
}
