// Port of pinned eSpeak NG translate.c through the words observation boundary.
// Copyright (C) 2005-2015 Jonathan Duddington; (C) 2015-2017 Reece H. Dunn.
// GPL-3.0-or-later; see licenses/espeak-ng/COPYING.txt.
import {
  writeUtf8CodePoint, iswAlnum, iswDigit, iswLower, iswUpper,
  isAlpha, isSpace, bracketIndex, toLowerCodePoint,
  isEmoji, isEmojiModifier, isEmojiTag, isRegionalIndicator
} from './unicode.js';
import { CLAUSE } from './clause-type.js';
import { readForward, readBackward } from './utf8-scan.js';
import { createTextCharacterSession, alphabetFromChar, shouldSplitIdeographs } from './text-character.js';
import { createEmbeddedSession, SAYAS } from './embedded.js';

export var WORD_FLAGS = Object.freeze({
  ALL_UPPER: 0x1, FIRST_UPPER: 0x2, HAS_PLURAL: 0x4, PHONEMES: 0x8,
  LAST_WORD: 0x10, EMBEDDED: 0x40, HYPHEN: 0x80, NOSPACE: 0x100,
  FIRST_WORD: 0x200, FOCUS: 0x400, EMPHASIZED: 0x800,
  HYPHEN_AFTER: 0x4000, HAS_DOT: 0x10000, COMMA_AFTER: 0x20000,
  MULTIPLE_SPACES: 0x40000, CHAR_REPLACED: 0x200000
});

// Fixed en-us profile. Replacement state belongs to the session, not each word.
export function createClauseTokenizer(options) {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Expected tokenizer options object');
  var opts = options || {};
  var keys = Object.keys(opts);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === 'embedded') continue;
    if (keys[i] !== 'voice' || opts.voice !== 'en-us') throw new Error('Unsupported tokenizer profile option: ' + keys[i]);
  }
  var embedded = opts.embedded === undefined ? createEmbeddedSession() : opts.embedded;
  if (!embedded || typeof embedded.consume !== 'function' || typeof embedded.beginClause !== 'function' || typeof embedded.state !== 'function') throw new TypeError('Expected embedded session');
  var characters = createTextCharacterSession();
  var fault = null;
  function state() { return characters.state(); }
  function unsupported(reason, codepoint, sourceIndex) {
    var error = new Error('Tokenizer unsupported: ' + reason);
    error.name = 'UnsupportedTokenizerError'; error.code = 'TOKENIZER_UNSUPPORTED';
    error.reason = reason; error.codepoint = codepoint; error.sourceIndex = sourceIndex;
    error.state = state(); fault = error; throw error;
  }
  function tokenize(clause) {
    if (fault) throw fault;
    if (!clause || !(clause.source instanceof Uint8Array) || !(clause.charix instanceof Int16Array)) throw new TypeError('Expected ReadClause source and charix typed arrays');
    if (!Number.isInteger(clause.charixTop) || clause.charixTop < 0 || clause.charixTop > 800 || clause.charix.length !== clause.charixTop + 1 || clause.source.length > 839) throw new RangeError('Invalid ReadClause buffer bounds');
    if (!Number.isInteger(clause.terminator) || clause.terminator < 0 || clause.terminator > 0xffffffff) throw new RangeError('Invalid clause terminator');
    if (clause.voiceChange && clause.voiceChange.length) unsupported('voice-change', 0, 0);
    var before = state();
    embedded.beginClause();
    var embeddedBefore = embedded.state();
    var source = new Uint8Array(844);
    source.set(clause.source);
    var charix = new Int16Array(804);
    charix.set(clause.charix);
    charix[clause.charixTop + 1] = 0;
    charix[clause.charixTop + 2] = 0x7fff;
    charix[clause.charixTop + 3] = 0;
    // Four extra slots permit detecting a C backing-buffer overflow before returning.
    var sbuf = new Uint8Array(804);
    var flags = new Uint32Array(300);
    var starts = new Uint16Array(300);
    var prePauses = new Uint8Array(300);
    var sourceIndices = new Uint16Array(300);
    var lengths = new Uint8Array(300);
    var ix = 3, c = 0, cc = 0, sourceIndex = 0, sourceIndexWord = 0;
    var prevIn = 32, prevOut = 32, prevInSave = 0, nextIn = 0, nextInNbytes = 0;
    var charInserted = 0, prePause = 0, prePauseAdd = 0;
    var allUpperCase = WORD_FLAGS.ALL_UPPER, alphaCount = 0, letterCount = 0;
    var finished = false, singleQuoted = false, phonemeMode = false;
    var wordFlags = 0, nextWordFlags = 0, wordCount = 0;
    var spaceInserted = false, decimalSepCount = false;
    var j, k;
    function calcWordLength(start, word) {
      var at = start;
      while (at < clause.charixTop && charix[at] <= 0) at++;
      sourceIndices[word] = charix[at];
      var length = 0;
      while (charix[at] !== 0) {
        if (at >= charix.length) throw new RangeError('ReadClause charix terminator missing');
        if (charix[at++] !== -1) length++;
      }
      return length;
    }
    sbuf[1] = 32; sbuf[2] = 32;
    starts[0] = ix;
    lengths[0] = calcWordLength(sourceIndex, 0);
    while (!finished && ix < 799) {
      var prevOut2 = prevOut;
      prevOut = readBackward(sbuf, ix - 1).codepoint;
      // tone_numbers=0, so a preceding number is not reclassified as alphabetic.
      if (prevInSave !== 0) { prevIn = prevInSave; prevInSave = 0; }
      else if (sourceIndex > 0) prevIn = readBackward(source, sourceIndex - 1).codepoint;
      var prevSourceIndex = sourceIndex;
      if (charInserted) { c = charInserted; charInserted = 0; }
      else {
        var decoded = readForward(source, sourceIndex);
        cc = decoded.codepoint; sourceIndex += decoded.bytes; c = cc;
      }
      if (c === 0) { finished = true; c = 32; nextIn = 32; nextInNbytes = 0; }
      else { var nextDecoded = readForward(source, sourceIndex); nextIn = nextDecoded.codepoint; nextInNbytes = nextDecoded.bytes; }
      if (c === 1) {
        var commandStart = sourceIndex - 1;
        if (prevIn !== 32) { c = 32; prevInSave = c; sourceIndex--; }
        else {
          sourceIndex = embedded.consume(source, sourceIndex).sourceIndex;
          prevInSave = prevIn;
          for (var blank = commandStart; blank < sourceIndex; blank++) source[blank] = 32;
          sourceIndex = commandStart;
          continue;
        }
      }
      if (embedded.sayasMode() === SAYAS.KEY && c !== 32) {
        if (prevIn === 32 && nextIn === 32) embedded.setSingleCharacterMode();
        c = toLowerCodePoint(c, false);
      }
      if (phonemeMode) {
        allUpperCase = WORD_FLAGS.PHONEMES;
        if (c === 93 && nextIn === 93) { phonemeMode = false; sourceIndex++; c = 32; }
      } else if ((embedded.sayasMode() & 0xf0) === SAYAS.DIGITS) {
        if (iswDigit(c)) {
          if (embedded.incrementDigits() > (embedded.sayasMode() & 15)) { c = 32; spaceInserted = true; embedded.resetDigits(); }
        } else {
          embedded.resetDigits();
          if (iswDigit(prevOut)) { c = 32; spaceInserted = true; }
        }
      } else if ((embedded.sayasMode() & 0x10) === 0) {
        if (c === 0x92 || c === 0xb4 || c === 0x2019 || c === 0x2032) c = 39;
        if ((c === 0x2018 || c === 63) && isAlpha(prevOut) && isAlpha(nextIn)) c = 39;
        if (c === 0x530) { c = 32; wordFlags |= WORD_FLAGS.FOCUS; }
        if (c === 0x557) { c = 32; wordFlags |= WORD_FLAGS.COMMA_AFTER; }
        var translated = characters.translate(source, sourceIndex, prevIn, c, nextIn, charInserted, wordFlags);
        c = translated.codepoint; charInserted = translated.insert; wordFlags = translated.wordFlags;
        if (c === 8 || c === 0xfe0e || c === 0xfe0f) continue;
        if (charInserted) nextIn = charInserted;
        if (!isAlpha(c) && !isSpace(c) && c !== 39) {
          if (isAlpha(prevOut)) {
            if (c === 0x200d && isEmoji(prevOut) && isEmoji(nextIn)) {
              // Preserve the joiner inside an emoji dictionary token.
            } else if (isEmojiTag(c) && isEmoji(prevOut)) {
              // Preserve the first tag; subsequent tags have non-alpha prevOut.
            } else { c = 32; spaceInserted = true; }
          }
        }
        if (iswDigit(prevOut)) {
          if (!iswDigit(c) && c !== 46 && c !== 44 && c !== 32) { c = 32; spaceInserted = true; }
        } else if (prevIn === 44) { if (c === 44) c = 32; }
        else decimalSepCount = false;
        if (c === 91 && (nextIn === 2 || nextIn === 91)) {
          phonemeMode = true; sourceIndex++; continue;
        }
        if (isAlpha(c)) {
          var emojiJoin = false, emojiBreak = false;
          alphaCount++;
          if (prevOut === 0x200d && isEmoji(c)) emojiJoin = !!isEmoji(readForward(sbuf, starts[wordCount]).codepoint);
          else if (isEmoji(c) && isEmoji(prevOut)) {
            if (isEmojiModifier(c)) {
              // A skin-tone modifier stays with the preceding emoji.
            } else if (isRegionalIndicator(c) && isRegionalIndicator(prevOut)) {
              var regionalCount = 0;
              j = ix;
              while (j > starts[wordCount]) {
                if (!isRegionalIndicator(readBackward(sbuf, j - 1).codepoint)) break;
                regionalCount++; j -= 4;
              }
              emojiBreak = (regionalCount & 1) === 0;
            } else emojiBreak = true;
          }
          var alphaC = alphabetFromChar(c), alphaPrev = alphabetFromChar(prevOut);
          var cForeign = alphaC !== null && alphaC.offset !== 0;
          var prevForeign = alphaPrev !== null && alphaPrev.offset !== 0;
          if (!emojiJoin && (emojiBreak || !isAlpha(prevOut) || shouldSplitIdeographs(c, prevOut) || isEmoji(c) !== isEmoji(prevOut) || cForeign !== prevForeign)) {
            if (prevOut !== 39) letterCount = 0;
            if (prevOut !== 32 && prevOut !== 39) {
              c = 32; spaceInserted = true;
              if (!bracketIndex(prevOut)) nextWordFlags |= WORD_FLAGS.NOSPACE;
            } else {
              if (iswUpper(c)) wordFlags |= WORD_FLAGS.FIRST_UPPER;
              if (prevOut === 32 && iswDigit(sbuf[ix - 2]) && !iswDigit(prevIn)) { sbuf[ix++] = 32; starts[wordCount]++; }
            }
          }
          if (c !== 32) letterCount++;
          // letter_bits_offset=0, CAPS_IN_WORD=0; UpperCaseInWord(en,...) returns 0.
          if (iswUpper(c)) {
            c = toLowerCodePoint(c, false);
            if (iswLower(prevIn)) {
              if (prevOut !== 32) { c = 32; spaceInserted = true; prevInSave = c; }
            } else if (c !== 32 && iswUpper(prevIn) && iswLower(nextIn)) {
              var next2In = readForward(source, sourceIndex + nextInNbytes).codepoint;
              if (prevOut !== 32 && isAlpha(next2In)) { c = 32; spaceInserted = true; prevInSave = c; nextWordFlags |= WORD_FLAGS.NOSPACE; }
            }
          } else {
            if (allUpperCase && letterCount > 2) {
              if (c === 115 && nextIn === 32) {
                c = 32; allUpperCase |= WORD_FLAGS.HAS_PLURAL;
                if (sbuf[ix - 1] === 39) sbuf[ix - 1] = 32;
              } else allUpperCase = 0;
            } else allUpperCase = 0;
          }
        } else if (c === 45) {
          if (!isSpace(prevIn) && isAlpha(nextIn)) {
            if (prevOut !== 32) { c = 32; spaceInserted = true; }
            else { wordFlags |= WORD_FLAGS.HYPHEN; if (wordCount > 0) flags[wordCount - 1] |= WORD_FLAGS.HYPHEN_AFTER; c = 32; }
          } else if (prevIn === 32 && nextIn === 32) { c = 32; prePauseAdd = 4; }
          else if (nextIn === 45) { sourceIndex++; c = 32; prePauseAdd = 4; }
          else if (prevOut === 32 && isAlpha(prevOut2) && !isAlpha(prevIn)) { sbuf[ix++] = 32; starts[wordCount]++; }
        } else if (c === 46) {
          if (prevOut === 46) { c = 32; spaceInserted = true; }
          else if (wordCount > 0 && !(flags[wordCount - 1] & WORD_FLAGS.NOSPACE) && isAlpha(prevIn)) {
            flags[wordCount - 1] |= WORD_FLAGS.HAS_DOT;
            if (isSpace(nextIn) || nextIn === 45) c = 32;
          }
        } else if (c === 39) {
          if (((prevIn === 46 && nextIn === 115) || iswAlnum(prevIn)) && isAlpha(nextIn)) singleQuoted = false;
          // APOSTROPHE=0 and char_plus_apostrophe is empty in the fixed en profile.
          else if (prevOut === 115 && singleQuoted === false) c = 32;
          else { singleQuoted = !!isSpace(prevOut); prePauseAdd = 4; c = 32; }
        } else if (c === 95) c = 32; // translate.c:breaks
        else if (iswDigit(c)) {
          if (prevOut !== 32 && !iswDigit(prevOut)) {
            if (prevOut !== 46) { c = 32; spaceInserted = true; }
            else decimalSepCount = true;
          } else if (prevOut === 32 && isAlpha(prevOut2) && !isAlpha(prevIn)) { sbuf[ix++] = 32; starts[wordCount]++; }
        }
      }
      if (isSpace(c)) {
        if (prevOut === 32) { wordFlags |= WORD_FLAGS.MULTIPLE_SPACES; continue; }
        if (cc === 9 || cc === 10) nextWordFlags |= WORD_FLAGS.MULTIPLE_SPACES;
        if (spaceInserted) {
          j = 0; k = sourceIndex - 1;
          while (k >= sourceIndexWord && charix[k] !== 0) { if (charix[k] > 0) j++; k--; }
          lengths[wordCount] = j;
        }
        sourceIndexWord = sourceIndex;
        sbuf[ix++] = 32;
        if (wordCount < 299 && ix > starts[wordCount]) {
          if (embedded.markWord()) flags[wordCount] |= WORD_FLAGS.EMBEDDED;
          if (alphaCount === 0) allUpperCase &= ~WORD_FLAGS.ALL_UPPER;
          prePauses[wordCount] = prePause;
          flags[wordCount] |= allUpperCase | wordFlags | embedded.wordEmphasis();
          if (prePause > 0) {
            for (j = ix; j > starts[wordCount]; j--) sbuf[j] = sbuf[j - 1];
            sbuf[j] = 32; starts[wordCount]++; ix++;
          }
          wordCount++; starts[wordCount] = ix; flags[wordCount] = 0;
          lengths[wordCount] = calcWordLength(sourceIndex, wordCount);
          wordFlags = nextWordFlags; nextWordFlags = 0; prePause = 0;
          allUpperCase = WORD_FLAGS.ALL_UPPER; alphaCount = 0;
        }
        if (spaceInserted) { sourceIndex = prevSourceIndex; charInserted = 0; spaceInserted = false; }
      } else if (ix < 796) ix += writeUtf8CodePoint(c, sbuf, ix);
      if (prePauseAdd > prePause) prePause = prePauseAdd;
      prePauseAdd = 0;
    }
    if (ix >= 800) unsupported('output-capacity-overflow', c, sourceIndex);
    if (wordCount === 0 && embedded.hasPending()) {
      embedded.markWord(false); flags[wordCount] |= WORD_FLAGS.EMBEDDED; wordCount = 1;
    }
    var bufferEnd = ix;
    sbuf[ix] = 0;
    prePauses[0] = 0; prePauses[wordCount] = 8;
    if (wordCount > 0) {
      ix = wordCount - 1;
      while (ix > 0 && bracketIndex(sbuf[starts[ix]])) ix--;
      flags[ix] |= WORD_FLAGS.LAST_WORD;
      if ((clause.terminator & CLAUSE.DOT_AFTER_LAST_WORD) && !(flags[wordCount - 1] & WORD_FLAGS.NOSPACE)) flags[wordCount - 1] |= WORD_FLAGS.HAS_DOT;
    }
    flags[0] |= WORD_FLAGS.FIRST_WORD;
    return {
      sbuf: sbuf.slice(0, bufferEnd), wordCount: wordCount,
      words: { flags: flags.slice(0, wordCount), start: starts.slice(0, wordCount), prePause: prePauses.slice(0, wordCount), sourceix: sourceIndices.slice(0, wordCount), length: lengths.slice(0, wordCount) },
      sentinel: { flags: flags[wordCount], start: starts[wordCount], prePause: prePauses[wordCount], sourceix: sourceIndices[wordCount], length: lengths[wordCount] },
      scanState: { sourceIndex: sourceIndex, sourceIndexWord: sourceIndexWord, finished: finished, wordFlags: wordFlags, nextWordFlags: nextWordFlags },
      embeddedStateBefore: embeddedBefore, embeddedStateAfter: embedded.state(),
      stateBefore: before, stateAfter: state()
    };
  }
  return { tokenize: tokenize, state: state };
}
