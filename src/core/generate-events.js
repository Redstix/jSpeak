// High-level port of pinned synthesize.c:Generate event boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.
import { createPhonemeData, createPhonemeInterpreter, createWordPhonemeData } from './phoneme-interpreter.js';

export var GENERATE_EVENT_CONSTANTS = Object.freeze({
  phPAUSE: 0, phVOWEL: 2, phLIQUID: 3, phSTOP: 4, phVSTOP: 5,
  phFRICATIVE: 6, phVFRICATIVE: 7, phNASAL: 8,
  SFLAG_EMBEDDED: 2, SFLAG_SYLLABLE: 4, SFLAG_LENGTHEN: 8,
  SFLAG_SEQCONTINUE: 1, phPREVOICE: 1 << 25, phTRILL: 1 << 7,
  SFLAG_NEXT_PAUSE: 0x2000,
  PHLIST_START_OF_WORD: 1, PHLIST_START_OF_SENTENCE: 4,
  pd_FMT: 0, pd_WAV: 1, pd_VWLSTART: 2, pd_VWLEND: 3, pd_ADDWAV: 4,
  pd_DONTLENGTHEN: 4, pd_FORNEXTPH: 2, i_PAUSE_BEFORE: 7, i_SET_LENGTH: 10,
  EMBED_S: 2, EMBED_I: 7, EMBED_M: 10, EMBED_U: 11,
  EVENT_WORD: 1, EVENT_SENTENCE: 2, EVENT_MARK: 3, EVENT_PLAY: 4, EVENT_END: 5
});
const C = GENERATE_EVENT_CONSTANTS;
const CANONICAL_ENVELOPE = Object.freeze([
  0, 0, 2, 2, 4, 5, 6, 7, 8, 8,
  10, 10, 12, 12, 14, 14, 16, 16, 18, 18
]);

function unsupported(reason) {
  const error = new Error('Generate event dependency not implemented: ' + reason);
  error.code = 'GENERATE_EVENTS_UNSUPPORTED'; error.reason = reason; throw error;
}

function integer(value, name) {
  if (!Number.isInteger(value)) throw new TypeError('Invalid ' + name);
  return value;
}

function canonicalEnvelope(index) {
  if (!Number.isInteger(index) || index < 0 || index >= CANONICAL_ENVELOPE.length) throw new RangeError('Invalid envelope index');
  return CANONICAL_ENVELOPE[index];
}

export function createGenerateEventPlanner(phonindexBytes, selectedTable, options) {
  if (!(phonindexBytes instanceof Uint8Array) || (phonindexBytes.length & 1) || phonindexBytes.length < 2) {
    throw new TypeError('Expected complete phonindex bytes');
  }
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) {
    throw new TypeError('Expected selected phoneme table');
  }
  const opts = options || {};
  const vm = createPhonemeInterpreter(phonindexBytes, selectedTable);
  function plan(list, count, embedded) {
    const wordData = createWordPhonemeData();
    if (!list || !Number.isInteger(count) || count < 1 || count > list.phcode.length) throw new RangeError('Invalid phoneme list bounds');
    const commands = embedded && Array.isArray(embedded.list) ? embedded.list : [];
    const events = [];
    let lastPitchCmd = -1, embeddedIndex = 0, wordCount = 0;
    const clauseStartChar = integer(opts.clauseStartChar === undefined ? 0 : opts.clauseStartChar, 'clause start char');
    const countCharacters = integer(opts.countCharacters === undefined ? 0 : opts.countCharacters, 'count characters');
    const countSentences = integer(opts.countSentences === undefined ? 0 : opts.countSentences, 'count sentences');
    const clauseStartWord = integer(opts.clauseStartWord === undefined ? 0 : opts.clauseStartWord, 'clause start word');

    function emit(event) { events.push(event); }
    function endPitch(voiceBreak) { emit({ kind: 'endPitch', voiceBreak }); }
    function doPause(length, control) {
      emit({ kind: 'pause', length, control });
      endPitch(1);
    }
    function doAmplitude(amp, envelope) { emit({ kind: 'amplitude', amp, envelope }); }
    function doPitch(envelope, pitch1, pitch2) {
      emit({ kind: 'pitch', envelope: canonicalEnvelope(envelope), pitch1, pitch2 });
      endPitch(0);
      lastPitchCmd = 1;
    }
    function doSample3(phdata, lengthMod, amp) {
      emit({ kind: 'sample3', soundAddr: phdata.soundAddr[C.pd_WAV], soundParam: phdata.soundParam[C.pd_WAV],
        lengthMod, amp, control: phdata.control, lengthModParam: phdata.param[C.i_SET_LENGTH] });
      endPitch(1);
    }
    function doSpect2(ph, which, fmtp, index, modulation) {
      emit({ kind: 'spect2', code: ph.code, type: ph.type, which, modulation,
        fmtAddr: fmtp.fmtAddr, fmtAmp: fmtp.fmtAmp, wavAddr: fmtp.wavAddr, wavAmp: fmtp.wavAmp,
        stdLength: fmtp.stdLength, fmtControl: fmtp.fmtControl, useVowelin: fmtp.useVowelin,
        transition0: fmtp.transition0, transition1: fmtp.transition1,
        fmt2Addr: fmtp.fmt2Addr, fmt2Lenadj: fmtp.fmt2Lenadj,
        lengthMod: list.length[index], synthflags: list.synthflags[index] });
    }
    function doMarker(type, charPosn, length, value) {
      emit({ kind: 'marker', type, charPosn, length, value });
    }
    function doEmbedded(sourceix) {
      emit({ kind: 'embedded', sourceix, index: embeddedIndex });
      let word;
      do {
        if (embeddedIndex >= commands.length) unsupported('embedded-command-bounds');
        word = commands[embeddedIndex++];
        const value = word >>> 8;
        const command = word & 0x7f;
        if (command === 0) return;
        switch (command & 0x1f) {
          case C.EMBED_S: unsupported('embedded-speed');
          case C.EMBED_I: unsupported('embedded-sound-icon');
          case C.EMBED_M:
            doMarker(C.EVENT_MARK, (sourceix & 0x7ff) + clauseStartChar, 0, value);
            break;
          case C.EMBED_U:
            doMarker(C.EVENT_PLAY, countCharacters + 1, 0, value);
            break;
          default:
            doPause(10, 0);
            break;
        }
      } while ((word & 0x80) === 0);
    }
    function interpret(index, control = 0, useWordData = true) {
      return vm.interpret(list, index, { start: 0, control, translator: false,
        wordData: useWordData ? wordData : null });
    }
    function emptyFmt() {
      return { fmtAddr: 0, fmtAmp: 0, wavAddr: 0, wavAmp: 0, stdLength: 0,
        fmtControl: 0, useVowelin: 0, transition0: 0, transition1: 0,
        fmt2Addr: 0, fmt2Lenadj: 0, fmtLength: 0 };
    }

    emit({ kind: 'generate.begin', resume: 0, count });
    doPause(0, 0);

    for (let ix = 1; ix < count && ix < 998; ix++) {
      const ph = selectedTable.entries[list.phonemeId[ix] - 1];
      if (!ph) unsupported('invalid-current-phoneme');
      const prevType = list.type[ix - 1], nextType = list.type[ix + 1], next2Type = list.type[ix + 2];
      const nextPh = selectedTable.entries[list.phcode[ix + 1]];
      if (!nextPh) unsupported('invalid-next-phoneme');
      emit({ kind: 'phoneme', index: ix, code: ph.code, type: list.type[ix],
        stress: list.stresslevel[ix], synthflags: list.synthflags[ix], length: list.length[ix],
        prepause: list.prepause[ix], amp: list.amp[ix], pitch1: list.pitch1[ix],
        pitch2: list.pitch2[ix], env: list.env[ix], newword: list.newword[ix] });

      if (list.synthflags[ix] & C.SFLAG_EMBEDDED) doEmbedded(list.sourceix[ix]);
      if (list.newword[ix]) {
        const sourceix = (list.sourceix[ix] & 0x7ff) + clauseStartChar;
        if (list.newword[ix] & C.PHLIST_START_OF_SENTENCE) doMarker(C.EVENT_SENTENCE, sourceix, 0, countSentences);
        if (list.newword[ix] & C.PHLIST_START_OF_WORD) doMarker(C.EVENT_WORD, sourceix, list.sourceix[ix] >>> 11, clauseStartWord + wordCount++);
      }
      if (list.prepause[ix] > 0 && !(ph.phflags & C.phPREVOICE)) doPause(list.prepause[ix], 1);

      if (list.type[ix] === C.phPAUSE) {
        doPause(list.length[ix], 0);
      } else if (list.type[ix] === C.phSTOP) {
        let released = false;
        if (nextType === C.phVOWEL) released = true;
        else if (!list.newword[ix + 1] && nextType === C.phLIQUID) released = true;
        if (!released) list.synthflags[ix] |= C.SFLAG_NEXT_PAUSE;
        if (ph.phflags & C.phPREVOICE) {
          const phdata = interpret(ix, 0x01);
          const fmtp = emptyFmt();
          fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
          fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
          if (lastPitchCmd < 0) {
            doAmplitude(list.amp[ix + 1], -1);
            doPitch(list.env[ix + 1], list.pitch1[ix + 1], list.pitch2[ix + 1]);
          }
          doSpect2(ph, 0, fmtp, ix, 0);
        }
        const phdata = interpret(ix, 0);
        phdata.control |= C.pd_DONTLENGTHEN;
        doSample3(phdata, 0, 0);
      } else if (list.type[ix] === C.phFRICATIVE) {
        const phdata = interpret(ix, 0);
        if (list.synthflags[ix] & C.SFLAG_LENGTHEN) doSample3(phdata, list.length[ix], 0);
        doSample3(phdata, list.length[ix], 0);
      } else if (list.type[ix] === C.phVSTOP) {
        const fmtp = emptyFmt();
        fmtp.fmtControl = C.pd_DONTLENGTHEN;
        let preVoiced = false;
        if (nextType === C.phVOWEL) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
          preVoiced = true;
        } else if (nextType === C.phLIQUID && !list.newword[ix + 1]) {
          doAmplitude(list.amp[ix + 1], -1);
          doPitch(list.env[ix + 1], list.pitch1[ix + 1], list.pitch2[ix + 1]);
          preVoiced = true;
        } else if (lastPitchCmd < 0) {
          doAmplitude(list.amp[ix + 1], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        }
        if (prevType === C.phVOWEL || (ph.phflags & C.phPREVOICE)) {
          const phdata = interpret(ix, 0x01);
          fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
          fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
          doSpect2(ph, 0, fmtp, ix, 0);
          if (list.synthflags[ix] & C.SFLAG_LENGTHEN) {
            doPause(25, 1);
            doSpect2(ph, 0, fmtp, ix, 0);
          }
        } else if (list.synthflags[ix] & C.SFLAG_LENGTHEN) doPause(50, 0);
        if (preVoiced) emit({ kind: 'startSyllable' });
        else list.synthflags[ix] |= C.SFLAG_NEXT_PAUSE;
        const phdata = interpret(ix, 0);
        fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        fmtp.wavAddr = phdata.soundAddr[C.pd_ADDWAV];
        fmtp.wavAmp = phdata.soundParam[C.pd_ADDWAV];
        doSpect2(ph, 0, fmtp, ix, 0);
        if (list.newword[ix] === 0 && list.newword[ix + 2] === 0) {
          if (nextType === C.phVFRICATIVE) doPause(20, 0);
          if (nextType === C.phFRICATIVE) doPause(12, 0);
        }
      } else if (list.type[ix] === C.phVFRICATIVE) {
        if (nextType === C.phVOWEL) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        } else if (nextType === C.phLIQUID) {
          doAmplitude(list.amp[ix + 1], -1);
          doPitch(list.env[ix + 1], list.pitch1[ix + 1], list.pitch2[ix + 1]);
        } else if (lastPitchCmd < 0) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        }
        if (nextType === C.phVOWEL || (nextType === C.phLIQUID && list.newword[ix + 1] === 0)) emit({ kind: 'startSyllable' });
        else list.synthflags[ix] |= C.SFLAG_NEXT_PAUSE;
        const phdata = interpret(ix, 0);
        const fmtp = emptyFmt();
        fmtp.stdLength = phdata.param[C.i_SET_LENGTH] * 2;
        fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        fmtp.wavAddr = phdata.soundAddr[C.pd_ADDWAV];
        fmtp.wavAmp = phdata.soundParam[C.pd_ADDWAV];
        if (list.synthflags[ix] & C.SFLAG_LENGTHEN) doSpect2(ph, 0, fmtp, ix, 0);
        doSpect2(ph, 0, fmtp, ix, 0);
      } else if (list.type[ix] === C.phNASAL) {
        const fmtp = emptyFmt();
        if (!(list.synthflags[ix] & C.SFLAG_SEQCONTINUE)) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        }
        const phdata = interpret(ix, 0);
        fmtp.stdLength = phdata.param[C.i_SET_LENGTH] * 2;
        fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        if (nextType === C.phVOWEL) {
          emit({ kind: 'startSyllable' });
          doSpect2(ph, 0, fmtp, ix, 0);
        } else if (prevType === C.phVOWEL && (list.synthflags[ix] & C.SFLAG_SEQCONTINUE)) {
          doSpect2(ph, 0, fmtp, ix, 0);
        } else {
          doSpect2(ph, 0, fmtp, ix, 0);
        }
      } else if (list.type[ix] === C.phLIQUID) {
        const fmtp = emptyFmt();
        let modulation = 0;
        if (ph.phflags & C.phTRILL) modulation = 5;
        if (!(list.synthflags[ix] & C.SFLAG_SEQCONTINUE)) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        }
        if (nextType === C.phVOWEL) emit({ kind: 'startSyllable' });
        const phdata = interpret(ix, 0);
        const pauseBefore = phdata.param[C.i_PAUSE_BEFORE] - list.prepause[ix];
        if (pauseBefore > 0) doPause(pauseBefore, 1);
        fmtp.stdLength = phdata.param[C.i_SET_LENGTH] * 2;
        fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        fmtp.wavAddr = phdata.soundAddr[C.pd_ADDWAV];
        fmtp.wavAmp = phdata.soundParam[C.pd_ADDWAV];
        doSpect2(ph, 0, fmtp, ix, modulation);
      } else if (list.type[ix] === C.phVOWEL) {
        const stress = list.stresslevel[ix] & 0xf;
        const fmtp = emptyFmt();
        const phdata = interpret(ix, 0);
        fmtp.stdLength = phdata.param[C.i_SET_LENGTH] * 2;
        let vowelstartPrev = 0;
        if (phdata.soundAddr[C.pd_VWLSTART] !== 0 && !(phdata.control & C.pd_FORNEXTPH)) {
          fmtp.fmtAddr = phdata.soundAddr[C.pd_VWLSTART];
          fmtp.fmtLength = phdata.soundParam[C.pd_VWLSTART];
        } else if (prevType !== C.phPAUSE) {
          const prevData = interpret(ix - 1, 0, false);
          if (prevData.soundAddr[C.pd_VWLSTART] !== 0 && (prevData.control & C.pd_FORNEXTPH)) {
            vowelstartPrev = 1;
            fmtp.fmtAddr = prevData.soundAddr[C.pd_VWLSTART];
            fmtp.fmt2Lenadj = prevData.soundParam[C.pd_VWLSTART];
          }
          fmtp.transition0 = prevData.vowelTransition[0];
          fmtp.transition1 = prevData.vowelTransition[1];
        }
        if (fmtp.fmtAddr === 0) {
          fmtp.useVowelin = 1;
          fmtp.fmtControl = 1;
          fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        }
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        if (list.tonePh[ix] !== 0) unsupported('tone-phoneme-envelope');
        emit({ kind: 'startSyllable' });
        let modulation = 2;
        if (stress <= 1) modulation = 1;
        else if (stress >= 7) modulation = 3;
        if (prevType === C.phVSTOP || prevType === C.phVFRICATIVE) {
          doAmplitude(list.amp[ix], -1);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
          doSpect2(ph, 1, fmtp, ix, modulation);
        } else if (prevType === C.phLIQUID || prevType === C.phNASAL) {
          doAmplitude(list.amp[ix], -1);
          doSpect2(ph, 1, fmtp, ix, modulation);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        } else if (vowelstartPrev) {
          doPitch(2, list.pitch2[ix] - 15, list.pitch2[ix]);
          doAmplitude(list.amp[ix] - 1, -1);
          doSpect2(ph, 1, fmtp, ix, modulation);
          doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
        } else {
          if (!(list.synthflags[ix] & C.SFLAG_SEQCONTINUE)) {
            doAmplitude(list.amp[ix], -1);
            doPitch(list.env[ix], list.pitch1[ix], list.pitch2[ix]);
          }
          doSpect2(ph, 1, fmtp, ix, modulation);
        }
        fmtp.fmtAddr = phdata.soundAddr[C.pd_FMT];
        fmtp.fmtAmp = phdata.soundParam[C.pd_FMT];
        fmtp.transition0 = 0;
        fmtp.transition1 = 0;
        if (phdata.soundAddr[C.pd_VWLEND] !== 0) {
          fmtp.fmt2Addr = phdata.soundAddr[C.pd_VWLEND];
          fmtp.fmt2Lenadj = phdata.soundParam[C.pd_VWLEND];
        } else if (nextType !== C.phPAUSE) {
          fmtp.fmt2Lenadj = 0;
          const nextData = interpret(ix + 1, 0, false);
          fmtp.useVowelin = 1;
          fmtp.transition0 = nextData.vowelTransition[2];
          fmtp.transition1 = nextData.vowelTransition[3];
          if (nextData.soundAddr[C.pd_VWLEND] !== 0) {
            fmtp.fmt2Addr = nextData.soundAddr[C.pd_VWLEND];
            fmtp.fmt2Lenadj = nextData.soundParam[C.pd_VWLEND];
          }
        }
        doSpect2(ph, 2, fmtp, ix, modulation);
      }
    }
    endPitch(1);
    emit({ kind: 'generate.end' });
    doMarker(C.EVENT_END, countCharacters, 0, countSentences);
    return events;
  }

  return { plan };
}
