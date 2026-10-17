// Pinned translate.c clause orchestration through the pre-MakePhonemeList boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2015 Jonathan Duddington;
// 2015-2017 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { PHONEMIZER_PROFILE } from '../../data/phonemizer/profile.js';
import { DICTIONARY_CONSTANTS as F } from '../../data/dictionary/profile.js';
import { createEnglishWordServices } from './word-services.js';
import { createClauseReader } from './read-clause.js';
import { createClauseTokenizer } from './tokenize-clause.js';
import { createEmbeddedSession } from './embedded.js';
import { createPhonemeListSession, PHONEME_LIST_PROFILE } from './phoneme-list.js';
import { createWordToPhonemesSession } from './word-to-phonemes.js';
import { CLAUSE } from './clause-type.js';
import { readForward } from './utf8-scan.js';

function unsupported(reason) {
  var error = new Error('Clause translation dependency not implemented: ' + reason);
  error.code = 'CLAUSE_TRANSLATION_UNSUPPORTED'; error.reason = reason; throw error;
}
function space(value) { return value === 32 || (value >= 9 && value <= 13); }
function digit(value) { return value >= 48 && value <= 57; }
function rowsFromTokenizer(tokenized) {
  var rows = [], columns = tokenized.words;
  for (var i = 0; i < tokenized.wordCount; i++) rows.push({ flags: columns.flags[i], start: columns.start[i],
    prePause: columns.prePause[i], sourceix: columns.sourceix[i], length: columns.length[i] });
  rows.push({ ...tokenized.sentinel }); return rows;
}

// Numeric first-stage phonemes only. This internal API deliberately ends before
// MakePhonemeList and does not claim the public phonemizer or final mnemonics.
export function createEnglishClauseTranslation(input, dictionary, table, options) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Expected UTF-8 input bytes');
  var opts = options || {}, trace = opts.trace;
  if (trace !== undefined && typeof trace !== 'function') throw new TypeError('Expected trace callback');
  for (var key of Object.keys(opts)) if (key !== 'trace' && key !== 'profile') throw new TypeError('Unsupported clause translation option: ' + key);
  var profile = opts.profile;
  if (profile !== undefined && (profile === null || typeof profile !== 'object' || profile.voice !== table.name)) throw new TypeError('Clause profile differs from selected table');
  var services = createEnglishWordServices(dictionary, table, {
    ruleProfile: profile && profile.ruleProfile,
    ruleData: profile && profile.ruleData,
    stressProfile: profile && profile.wordStressProfile,
    wordTranslationProfile: profile && profile.wordTranslationProfile,
    initialState: profile && profile.wordTranslationProfile ? { dictCondition: profile.wordTranslationProfile.dictCondition } : undefined
  });
  var embedded = createEmbeddedSession();
  var reader = createClauseReader(input, { dictionary: services.characterNames, voice: table.name });
  var tokenizer = createClauseTokenizer({ embedded: embedded, voice: table.name,
    profile: profile ? { ...profile.textCharacterProfile, replacementBytes: profile.replacementBytes } : undefined });
  var list = createPhonemeListSession(table, profile ? profile.phonemeListProfile : PHONEME_LIST_PROFILE);
  var words = createWordToPhonemesSession(services, table, list, profile ? profile.phonemizerProfile : PHONEMIZER_PROFILE);
  var countWords = 0, countSentences = 0, maxClausePause = 0, newSentence = true, fault = null, emptyInput = input.length === 0;
  function state() { return { countWords: countWords, countSentences: countSentences, maxClausePause: maxClausePause,
    newSentence: newSentence, reader: reader.state(), word: services.wordTranslation.state(), word2: words.state() }; }
  function next() {
    if (fault) throw fault;
    try { return nextClause(); }
    catch (error) { fault = error; throw error; }
  }
  function nextClause() {
    services.wordTranslation.setState({ prePause: 0 });
    list.setState({ anyStressedWords: false, embeddedIndex: 0 });
    words.setState({ embeddedRead: 0 });
    var startWord = countWords + 1, clause = reader.next(), terminator = clause.terminator;
    var tone = clause.tone === 0 ? (terminator & CLAUSE.INTONATION_TYPE) >> 12 : clause.tone;
    var clausePause = (terminator & CLAUSE.PAUSE) * 10;
    if (terminator & CLAUSE.PAUSE_LONG) clausePause *= 32;
    var first = 0;
    while (first < clause.source.length && space(clause.source[first])) first++;
    var startSentence;
    if (first === clause.source.length) {
      clausePause = Math.max(0, clausePause - maxClausePause);
      if (newSentence) terminator |= CLAUSE.TYPE_SENTENCE;
      maxClausePause += clausePause; startSentence = false;
    } else { maxClausePause = clausePause; startSentence = newSentence; }
    if (startSentence) countSentences++;
    services.wordTranslation.setState({ clauseTerminator: terminator, clauseLowerCount: clause.stateAfter.clauseLowerCount,
      clauseUpperCount: clause.stateAfter.clauseUpperCount, prevLastStress: 0, prepauseTimeout: 0,
      expectVerb: 0, expectVerbS: 0, expectNoun: 0, expectPast: 0, repeatCount: 0,
      endStressedVowel: 0, prevDictFlags0: 0, prevDictFlags1: 0 });
    list.beginClause();
    var tokenized = tokenizer.tokenize({ ...clause, terminator: terminator });
    var buffer = new Uint8Array(800); buffer.set(tokenized.sbuf);
    var rows = rowsFromTokenizer(tokenized), wordCount = tokenized.wordCount, clauseEnd = tokenized.sbuf.length - 1;
    var commands = list.state().embeddedList;
    commands.set(tokenized.embeddedStateAfter.list);
    list.setState({ embeddedIndex: tokenized.embeddedStateAfter.embeddedIx, embeddedList: commands });
    if (trace) trace('clause.words', { clause: clause, tokenized: tokenized, buffer: buffer.slice(), words: rows.map(row => ({ ...row })),
      list: list.snapshot(), state: state(), clauseEnd: clauseEnd, terminator: terminator, clausePause: clausePause, tone: tone, startSentence: startSentence });
    var lastFlags = 0;
    function translateWord(source, offset, wordRows, index, remaining, pause, relation, observerIndex = index, subIndex = 0) {
      services.wordTranslation.setState({ clauseEndRelation: relation === 'clause' ? 'in-source' : 'after-source' });
      services.wordTranslation.setState({ clauseEnd: relation === 'clause' ? Math.max(0, clauseEnd - offset) : 0 });
      if (trace) trace('word2.enter', { buffer: source.slice(), offset: offset, words: wordRows.map(row => ({ ...row })),
        wordIndex: observerIndex, rowIndex: index, subIndex: subIndex, remaining: remaining, prePause: pause, relation: relation, state: state(), list: list.snapshot() });
      var result = words.translate(source, { offset: offset, words: wordRows, wordIndex: index, remaining: remaining, prePause: pause,
        clauseEnd: relation === 'clause' ? clauseEnd : undefined, clauseEndRelation: relation === 'clause' ? 'in-source' : 'after-source' });
      if (trace) trace('word2.exit', { result: result, state: state(), list: list.snapshot() });
      return result;
    }
    for (var ix = 0; ix < wordCount && list.length() < 991; ix++) {
      countWords++;
      var offset = rows[ix].start, nDigits = 0;
      while (digit(buffer[offset + nDigits])) nDigits++;
      // Fixed en break_numbers is BREAK_THOUSANDS; no regrouping-before-split.
      if (nDigits > 4 && nDigits <= 32) {
        var numberBuffer = new Uint8Array(150), numRows = [], pw = offset, pn = 3, nx = nDigits;
        numberBuffer.fill(32, 0, 3);
        if (nDigits > PHONEMIZER_PROFILE.maxDigits || buffer[offset] === 48) rows[ix].flags |= F.FLAG_INDIVIDUAL_DIGITS;
        while (pn < 130 && numRows.length < 298) {
          var c = buffer[pw++];
          if (!digit(c) && c !== PHONEMIZER_PROFILE.decimalSep) break;
          numberBuffer[pn++] = c; nx--;
          if (nx > 0 && (PHONEMIZER_PROFILE.breakNumbers & (1 << nx))) {
            numRows.push({ ...rows[ix] });
            if (PHONEMIZER_PROFILE.thousandsSep !== 32) numberBuffer[pn++] = PHONEMIZER_PROFILE.thousandsSep;
            numberBuffer[pn++] = 32;
            if (!(rows[ix].flags & F.FLAG_INDIVIDUAL_DIGITS)) {
              if (PHONEMIZER_PROFILE.breakNumbers & (1 << (nx - 1))) { numberBuffer[pn++] = 48; numberBuffer[pn++] = 48; }
              if (PHONEMIZER_PROFILE.breakNumbers & (1 << (nx - 2))) numberBuffer[pn++] = 48;
            }
          }
        }
        pw--;
        var groups = numRows.length;
        numRows.push({ ...rows[ix] }, { ...rows[ix + 1] });
        for (var nr = 1; nr <= groups; nr++) numRows[nr].flags = (numRows[nr].flags & ~(F.FLAG_MULTIPLE_SPACES | F.FLAG_EMBEDDED)) >>> 0;
        for (var tail = 0; tail < 16 && buffer[pw + tail]; tail++) numberBuffer[pn + tail] = buffer[pw + tail];
        var nw = 0; pw = 3;
        while (pw < pn && nw < 300) {
          var part = translateWord(numberBuffer, pw, numRows, nw, numRows.length - nw, rows[ix].prePause, 'number-split', ix, nw);
          numberBuffer = part.buffer; numRows = part.words; lastFlags = part.flags; nw++;
          while (pw < pn && numberBuffer[pw++] !== 32) { /* original group boundary */ }
          rows[ix].prePause = 0;
        }
      }
      else {
        services.wordTranslation.setState({ prePause: 0 });
        var translated = translateWord(buffer, offset, rows, ix, wordCount - ix, rows[ix].prePause, 'clause');
        buffer = translated.buffer; rows = translated.words; lastFlags = translated.flags;
        var globalPause = services.wordTranslation.state().prePause;
        if (globalPause > rows[ix + 1].prePause) {
          rows[ix + 1].prePause = globalPause & 255; services.wordTranslation.setState({ prePause: 0 });
        }
        if (lastFlags & F.FLAG_SPELLWORD) {
          var at = offset;
          while (buffer[at] !== 32) {
            if (!buffer[at] || at >= buffer.length) unsupported('spelling-word-buffer-bounds');
            var source = new Uint8Array(150); source.fill(32, 1, 10);
            var decoded = readForward(buffer, at); source.set(buffer.subarray(at, at + decoded.bytes), 3);
            var spelled = translateWord(source, 3, rows, ix, wordCount - ix, 0, 'spell-retry', ix, at - offset);
            rows = spelled.words; at += decoded.bytes;
          }
        }
        if ((lastFlags & (F.FLAG_ALLOW_DOT | F.FLAG_NEEDS_DOT)) && ix === wordCount - 1 - services.dictionary.state().skipWords && (terminator & CLAUSE.DOT_AFTER_LAST_WORD)) {
          clausePause = 10; tone = 4;
        }
      }
      if (lastFlags & F.FLAG_SKIPWORDS) {
        var skip = services.dictionary.state().skipWords;
        while (skip > 0) {
          if (skip >= wordCount - ix) { skip = 0; break; }
          rows[ix + skip].flags = (rows[ix + skip].flags | F.FLAG_DELETE_WORD) >>> 0; skip--;
        }
        services.dictionary.setState({ skipWords: skip });
      }
    }
    if (words.state().embeddedRead < list.state().embeddedIndex) words.consumeEmbedded();
    list.finishClause(tokenized.scanState.sourceIndex);
    if (reader.state().logicalEof && (wordCount === 0 || PHONEMIZER_PROFILE.cliOptionEndpause === 0)) clausePause = 10;
    if (wordCount === 0) services.wordTranslation.setState({ clauseEnd: 0, clauseEndRelation: 'before-source' });
    else services.wordTranslation.setState({ clauseEnd: Math.max(0, clauseEnd - 3), clauseEndRelation: 'in-source' });
    var output = { index: clause.index, startWord: startWord, startCharacter: clause.startCharacter, terminator: terminator,
      tone: tone, clausePause: clausePause, startSentence: startSentence, source: clause.source, buffer: buffer,
      words: rows, wordCount: wordCount, sourceIndex: tokenized.scanState.sourceIndex, phonemes: list.snapshot(), state: state() };
    if (trace) trace('clause.before-phonemelist', output);
    newSentence = !!(terminator & CLAUSE.TYPE_SENTENCE);
    return output;
  }
  return { next: next, hasMore: function () { return !fault && !emptyInput && reader.hasMore() && !reader.state().decoderEof; }, state: state };
}
