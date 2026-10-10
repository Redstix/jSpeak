// Port of pinned eSpeak NG readclause.c, fixed en-us plain UTF-8 profile.
// Copyright (C) 2005-2015 Jonathan Duddington; (C) 2015-2017 Reece H. Dunn.
// GPL-3.0-or-later; see licenses/espeak-ng/COPYING.txt.
import {
  createUtf8Decoder, writeUtf8CodePoint, iswAlnum, iswAlpha, iswUpper,
  iswLower, iswSpace, iswDigit, iswPunct, isAlpha, bracketIndex
} from './unicode.js';
import { CLAUSE, clauseTypeFromCodePoint } from './clause-type.js';

export var READ_CLAUSE_PROFILE = Object.freeze({
  voice: 'en-us', encoding: 'UTF-8', termination: 'c-string', capacity: 800,
  translatorName: 25966, charsIgnore: Object.freeze([173, 1, 8204, 1, 0, 0]),
  numbers: 16779328, lowercaseSentence: false,
  optionSsml: 0, optionPhonemeInput: 256, optionLineLength: 0,
  optionPunctuation: 0, optionCapitals: 0, sayasMode: 0, silence: 0
});

// Options select only the already implemented profile. They never enable a
// partially implemented upstream mode. Input bytes remain borrowed/immutable.
export function createClauseReader(bytes, options) {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Expected ReadClause options object');
  var opts = options || {};
  var keys = Object.keys(opts);
  for (var o = 0; o < keys.length; o++) {
    var key = keys[o];
    if (key === 'dictionary') continue;
    if ((key !== 'voice' && key !== 'encoding' && key !== 'capacity') || opts[key] !== READ_CLAUSE_PROFILE[key]) throw new Error('Unsupported ReadClause profile option: ' + key);
  }
  var dictionary = opts.dictionary;
  if (dictionary !== undefined && (!dictionary || typeof dictionary.lookupCharName !== 'function' || typeof dictionary.resetRepeat !== 'function' || typeof dictionary.state !== 'function')) throw new TypeError('Expected ReadClause dictionary service');
  var decoder = createUtf8Decoder(bytes, { encoding: 'UTF-8', termination: 'c-string' });
  var ungotChar = 0;
  var ungotChar2 = 0;
  var countCharacters = -1;
  var clauseUpperCount = 0;
  var clauseLowerCount = 0;
  var phonemesRepeatCount = null; // C has not initialized this field before the first ReadClause reset.
  var nextIndex = 0;
  var finished = false;
  var fault = null;
  var optionPunctuation = 0;
  var punctuationList = [];
  function controlState() { return { optionPunctuation: optionPunctuation, punctuationList: punctuationList.slice() }; }
  function eof() { return ungotChar !== 0 ? false : decoder.eof(); }
  function getC() {
    if (ungotChar !== 0) { var saved = ungotChar; ungotChar = 0; return saved; }
    countCharacters++;
    return decoder.next();
  }
  function ungetC(cp) { ungotChar = cp; }
  function state() {
    return {
      decoderOffset: decoder.offset(), decoderRemaining: decoder.remaining(), decoderEof: decoder.eof(),
      decoderPeek: decoder.peek(), logicalEof: eof(), countCharacters: countCharacters,
      clauseUpperCount: clauseUpperCount, clauseLowerCount: clauseLowerCount,
      phonemesRepeatCount: phonemesRepeatCount !== null && dictionary ? dictionary.state().repeatCount : phonemesRepeatCount
    };
  }
  function unsupported(reason, codepoint) {
    var error = new Error('ReadClause unsupported: ' + reason);
    error.name = 'UnsupportedReadClauseError'; error.code = 'READ_CLAUSE_UNSUPPORTED';
    error.reason = reason; error.codepoint = codepoint; error.clauseIndex = nextIndex;
    error.state = state();
    fault = error;
    throw error;
  }
  function next() {
    if (fault) throw fault;
    if (finished) throw new RangeError('ReadClause session already returned CLAUSE_EOF');
    var before = state();
    var startCharacter = Math.max(0, countCharacters);
    // Upstream TranslateClause caller reserves source[800+40], charix[800+4].
    var source = new Uint8Array(840);
    var charix = new Int16Array(804);
    var charixTop = 0;
    var c1 = 32;
    var cprev = 32;
    var cNext = 0;
    var ix = 0;
    var lineLength = 0;
    var phonemeMode = 0;
    var anyAlnum = false;
    var punctData = 0;
    var stressedWord = false;
    var tone = 0;
    phonemesRepeatCount = 0;
    if (dictionary) dictionary.resetRepeat();
    clauseUpperCount = 0;
    clauseLowerCount = 0;
    var c2 = ungotChar2 !== 0 ? ungotChar2 : eof() ? 0 : getC();
    function terminate(lookahead) {
      if (ix + 2 > source.length) unsupported('control-capacity-overflow', c1);
      source[ix] = 32; source[ix + 1] = 0;
      if (lookahead !== null) ungetC(lookahead);
    }
    function result(terminator) {
      var length = 0;
      while (length < source.length && source[length] !== 0) length++;
      var record = {
        index: nextIndex++, startCharacter: startCharacter,
        source: source.slice(0, length), charix: charix.slice(0, charixTop + 1), charixTop: charixTop,
        terminator: terminator, tone: tone, voiceChange: new Uint8Array(0),
        stateBefore: before, stateAfter: state()
      };
      if ((terminator & CLAUSE.TYPE_EOF) !== 0) finished = true;
      return record;
    }
    function announcePunctuation(endClause) {
      // Fixed en has no configured soundicons, LOPT_ANNOUNCE_PUNCT=0 and
      // initial embedded_value[EMBED_S]=175. Queuing commands does not apply
      // synthesis speed changes at this direct ReadClause/tokenizer boundary.
      if (!dictionary) unsupported('punctuation-name-dictionary', c1);
      var name = null;
      try {
        if (c1 === 46 && endClause && c2 !== 46) {
          if (typeof dictionary.lookupSpecial !== 'function') unsupported('punctuation-special-dictionary', c1);
          name = dictionary.lookupSpecial(new Uint8Array([95, 46, 112]));
          if (name !== null && (!(name instanceof Uint8Array))) throw new TypeError('ReadClause dictionary must return UTF-8 Uint8Array or null');
          if (name !== null && name.length >= 30) unsupported('punctuation-special-capacity', c1);
        }
        if (name === null) name = dictionary.lookupCharName(c1, false);
      } catch (error) {
        if (['CHARACTER_NAME_UNSUPPORTED', 'ACCENT_UNSUPPORTED', 'DICTIONARY_RULES_UNSUPPORTED', 'LETTER_NAME_UNSUPPORTED'].indexOf(error.code) >= 0) unsupported('character-name-' + error.reason, c1);
        throw error;
      }
      if (!(name instanceof Uint8Array)) throw new TypeError('ReadClause dictionary must return UTF-8 Uint8Array');
      if (name.length >= 74) unsupported('punctuation-name-capacity', c1);
      var buf = new Uint8Array(200);
      var length = 0;
      function append(bytes) {
        if (length + bytes.length >= buf.length) unsupported('punctuation-announcement-capacity', c1);
        buf.set(bytes, length); length += bytes.length;
      }
      function appendByte(byte) {
        if (length + 1 >= buf.length) unsupported('punctuation-announcement-capacity', c1);
        buf[length++] = byte;
      }
      function appendName() { appendByte(32); append(name); }
      if (ix === 0 || !endClause) {
        var count = 1;
        while (!eof() && c2 === c1 && c1 !== 60) { count++; c2 = getC(); }
        if (endClause) ungetC(c2);
        if (count === 1) appendName();
        else if (count < 4) {
          append(new Uint8Array([1, 43, 49, 48, 83]));
          while (count-- > 0) appendName();
          append(new Uint8Array([32, 1, 45, 49, 48, 83]));
        } else {
          appendName(); appendByte(32);
          var digits = new Uint8Array(10);
          var digitCount = 0;
          do { digits[digitCount++] = 48 + count % 10; count = Math.floor(count / 10); } while (count);
          while (digitCount) appendByte(digits[--digitCount]);
          appendName();
        }
      } else {
        // Preserve both lookahead slots: Eof() deliberately ignores the second.
        ungotChar2 = c1; ungetC(c2); appendByte(32);
      }
      var initialIx = ix;
      if (ix + length + 1 > source.length) unsupported('dictionary-output-capacity', c1);
      source.set(buf.subarray(0, length), ix); ix += length; source[ix] = 0;
      if (!endClause) return -1;
      if (c1 === 45) return CLAUSE.NONE;
      var attributes = clauseTypeFromCodePoint(c1);
      var shortPause = (attributes & CLAUSE.INTONATION_TYPE) === 0x1000 ? CLAUSE.SHORTCOMMA : CLAUSE.SHORTFALL;
      if (initialIx > 0) {
        if ((attributes & ~CLAUSE.OPTIONAL_SPACE_AFTER) === CLAUSE.SEMICOLON) return CLAUSE.SHORTFALL;
        return shortPause;
      }
      return attributes & CLAUSE.TYPE_SENTENCE ? attributes : shortPause;
    }
    while (!eof() || ungotChar !== 0 || ungotChar2 !== 0) {
      var cprev2 = cprev;
      cprev = c1;
      c1 = c2;
      c2 = eof() ? 32 : getC();
      ungotChar2 = 0;
      if (c1 === 1) {
        if (c2 === 86) {
          source[ix++] = 0;
          while (!eof() && !iswSpace(c1 = getC()) && ix < 799) source[ix++] = c1;
          source[ix++] = 0;
          return result(CLAUSE.VOICE);
        } else if (c2 === 66) {
          if (ix + 4 > source.length) unsupported('control-capacity-overflow', c1);
          source[ix] = 32; source[ix + 1] = 32; source[ix + 2] = 32; source[ix + 3] = 0;
          ix += 3;
          if (!eof() && (c2 = getC()) === 48) optionPunctuation = 0;
          else {
            optionPunctuation = 1; punctuationList = [];
            if (c2 !== 49) {
              while (!eof() && !iswSpace(c2) && punctuationList.length < 59) {
                punctuationList.push(c2); c2 = getC();
                if (ix >= source.length) unsupported('control-capacity-overflow', c1);
                source[ix++] = 32;
              }
              optionPunctuation = 2;
            }
          }
          if (!eof()) c2 = getC();
          continue;
        }
      }
      lineLength++;
      // chars_ignore_default has deletion pairs only; langopts.replace_chars is separate.
      if (c1 === 173 || c1 === 8204) continue;
      if (iswAlnum(c1)) anyAlnum = true;
      else {
        if (stressedWord) {
          stressedWord = false; c1 = 0x530; ungetC(c2); c2 = 32;
        }
        if (c1 === 0xf0b) c1 = 32;
        if (c1 === 0xd4d && c2 === 0x200d) c1 = 0xd4e;
        if (c1 === 0xdca && c2 === 0x200d && !eof()) c2 = getC();
      }
      if (iswUpper(c1)) clauseUpperCount++;
      else if (iswAlpha(c1)) clauseLowerCount++;
      // CheckPhonemeMode, with the actual CLI espeakPHONEMES flag enabled.
      if (phonemeMode > 0) phonemeMode--;
      else if (c1 === 91 && c2 === 91) phonemeMode = -1;
      else if (c1 === 93 && c2 === 93) phonemeMode = 2;
      if (c1 === 10) {
        var paragraphs = 0;
        while (!eof() && iswSpace(c2)) {
          if (c2 === 10) paragraphs++;
          c2 = getC();
        }
        if (paragraphs > 0) {
          terminate(c2);
          if (paragraphs > 3) paragraphs = 3;
          return result(CLAUSE.PARAGRAPH - 30 + 30 * paragraphs);
        }
        // option_linelength=0: the original positive line-length branch is unreachable.
        lineLength = 0;
      }
      var announcedPunctuation = 0;
      if (phonemeMode === 0) {
        var isEndClause = false;
        if (c1 === 46 && c2 === 46) {
          while (!eof() && (cNext = getC()) === 46) { c1 = 0x2026; c2 = 32; }
          if (c1 === 0x2026) c2 = cNext;
          else ungetC(cNext);
        }
        punctData = clauseTypeFromCodePoint(c1);
        if (punctData !== CLAUSE.NONE) {
          // These are combined pause/type bit masks, deliberately not enums.
          if (punctData & (CLAUSE.QUESTION | CLAUSE.EXCLAMATION)) {
            while (!eof() && (clauseTypeFromCodePoint(c2) & (CLAUSE.QUESTION | CLAUSE.EXCLAMATION))) {
              cNext = getC(); c2 = cNext;
            }
          }
          if (punctData & CLAUSE.PUNCTUATION_IN_WORD) {
            stressedWord = true; tone = (punctData >>> 12) & 15;
            continue;
          }
          if (iswSpace(c2) || (punctData & CLAUSE.OPTIONAL_SPACE_AFTER) || bracketIndex(c2) || c2 === 63 || eof() || c2 === 1) isEndClause = true;
        }
        if (c1 === 0xe03c) c1 = 60;
        if (optionPunctuation && iswPunct(c1) && (optionPunctuation === 1 || punctuationList.indexOf(c1) !== -1)) {
          phonemesRepeatCount = 0;
          if (dictionary) dictionary.resetRepeat();
          var announcementTerminator = announcePunctuation(isEndClause);
          if (announcementTerminator >= 0) return result(announcementTerminator);
          announcedPunctuation = c1;
        }
        // option_punctuation=0 still reaches LookupCharName for ellipsis.
        if ((punctData & CLAUSE.SPEAK_PUNCTUATION_NAME) && announcedPunctuation === 0) {
          if (!dictionary) unsupported('punctuation-name-dictionary', c1);
          var spokenName = dictionary.lookupCharName(c1, true);
          if (!(spokenName instanceof Uint8Array)) throw new TypeError('ReadClause dictionary must return UTF-8 Uint8Array');
          if (ix + spokenName.length + 1 > source.length) unsupported('dictionary-output-capacity', c1);
          source.set(spokenName, ix); source[ix + spokenName.length] = 0;
          if (spokenName.length) { ix += spokenName.length; announcedPunctuation = c1; punctData &= ~CLAUSE.INTONATION_TYPE; }
        }
        if (isEndClause) {
          var newlineCount = 0;
          cNext = c2;
          if (iswSpace(cNext)) {
            while (!eof() && iswSpace(cNext)) {
              if (cNext === 10) newlineCount++;
              cNext = getC();
            }
          }
          if (c1 === 46 && newlineCount < 2) punctData |= CLAUSE.DOT_AFTER_LAST_WORD;
          if (newlineCount === 0) {
            if (c1 === 46 && cNext === 39 && decoder.peek() === 115) isEndClause = false;
            // en numbers=NUM_HUNDRED_AND|NUM_ROMAN|NUM_1900: no NUM_ORDINAL_DOT.
            if (c1 === 46) {
              if (iswLower(cNext)) isEndClause = false; // lowercase_sentence=false
              if (!anyAlnum) { c1 = 32; isEndClause = false; }
            } else if (!anyAlnum) isEndClause = false;
          }
          if (isEndClause) {
            terminate(cNext);
            if (iswDigit(cprev) && !isAlpha(cNext)) punctData &= ~CLAUSE.DOT_AFTER_LAST_WORD;
            if (newlineCount > 1) {
              if (punctData === CLAUSE.QUESTION || punctData === CLAUSE.EXCLAMATION) return result(punctData + 35);
              return result(CLAUSE.PARAGRAPH);
            }
            return result(punctData);
          } else if (!eof() && iswSpace(c2)) ungetC(cNext);
        }
      }
      // C also replaces a decoded NUL when announced_punctuation is zero.
      if (c1 === announcedPunctuation) {
        if (bracketIndex(c1)) c1 = 0xe028;
        else if (c1 !== 45) c1 = 32;
      }
      var j = ix + 1;
      if (c1 === 0xe03c) c1 = 60;
      var encodedWidth = c1 < 128 || c1 >= 0x110000 ? 1 : c1 < 2048 ? 2 : c1 < 65536 ? 3 : 4;
      if (ix + encodedWidth >= charix.length || ix + encodedWidth > source.length) unsupported('control-capacity-overflow', c1);
      ix += writeUtf8CodePoint(c1, source, ix);
      if (!iswSpace(c1) && !bracketIndex(c1)) {
        charix[ix] = countCharacters - startCharacter;
        while (j < ix) charix[j++] = -1;
      }
      charixTop = ix;
      if ((ix > 725 && !isAlpha(c1) && !iswDigit(c1)) || ix >= 796) {
        terminate(c2);
        return result(CLAUSE.NONE);
      }
    }
    if (stressedWord) ix += writeUtf8CodePoint(0x530, source, ix);
    terminate(null);
    return result(CLAUSE.EOF);
  }
  return {
    next: next, state: state, controlState: controlState,
    hasMore: function () { return !finished && !fault; }
  };
}
