// Bounded port of synthdata.c:LookupSpect and synthesize.c:Generate command
// queue construction for the fixed en-us profile. GPL-3.0-or-later.
// Copyright (C) 2005-2014 Jonathan Duddington. See
// licenses/espeak-ng/COPYING.txt.

const C = Object.freeze({
  WCMD_KLATT: 1, WCMD_KLATT2: 2, WCMD_SPECT: 3, WCMD_SPECT2: 4,
  WCMD_PAUSE: 5, WCMD_WAVE: 6, WCMD_WAVE2: 7, WCMD_AMPLITUDE: 8,
  WCMD_PITCH: 9, WCMD_MARKER: 10, WCMD_EMBEDDED: 12,
  WCMD_FMT_AMPLITUDE: 14,
  FRFLAG_KLATT: 1, FRFLAG_VOWEL_CENTRE: 2, FRFLAG_LEN_MOD: 4,
  FRFLAG_BREAK_LF: 8, FRFLAG_BREAK: 16, FRFLAG_FORMANT_RATE: 32,
  FRFLAG_MODULATE: 64, FRFLAG_DEFER_WAV: 128,
  FRFLAG_LEN_MOD2: 0x4000, FRFLAG_COPIED: 0x8000,
  pd_DONTLENGTHEN: 4, N_SEQ_FRAMES: 12, N_PEAKS: 9,
});
const FORMANT_RATE = [240, 170, 170, 170, 170, 170];

export const DEFAULT_EN_US_VOICE = Object.freeze({
  pitchBase: 290816, pitchRange: 4104, flutter: 64, roughness: 2, echoDelay: 0,
  echoAmp: 0, nHarmonicPeaks: 5, peakShape: 0, voicing: 64, formantFactor: 256,
  consonantAmp: 90, consonantAmpv: 100, sampleRate: 22050,
  freq: [256, 256, 256, 256, 256, 256, 256, 256, 256],
  height: [260, 256, 240, 232, 200, 200, 256, 256, 256],
  width: [294, 256, 256, 320, 342, 342, 256, 256, 256],
  freqadd: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  freq2: [256, 256, 256, 256, 256, 256, 256, 256, 256],
  height2: [260, 256, 240, 232, 200, 200, 256, 256, 256],
  breath: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  breathw: [0, 200, 200, 400, 400, 400, 600, 600, 600],
  toneAdjust: (() => {
    const points = [600, 170, 1200, 135, 2000, 110, 3000, 110, 8000, 0];
    const result = new Array(1000).fill(0);
    let frequency = 0, height = points[1];
    for (let point = 0; point < 10; point += 2) {
      const nextFrequency = Math.trunc(points[point] / 8), nextHeight = points[point + 1];
      if (nextFrequency - frequency > 0) {
        for (let index = frequency; index < nextFrequency; index++) {
          result[index] = height + Math.trunc(((index - frequency) * (nextHeight - height)) / (nextFrequency - frequency));
        }
      }
      frequency = nextFrequency; height = nextHeight;
    }
    return result;
  })(),
});
export const DEFAULT_22050_VOICE = DEFAULT_EN_US_VOICE;
export const DEFAULT_CMN_VOICE = Object.freeze({
  ...DEFAULT_EN_US_VOICE,
  formantFactor: 254,
  toneAdjust: (() => {
    const points = [600, 170, 1200, 135, 2000, 110, 3000, 110, 8000, 110];
    const result = new Array(1000).fill(0);
    let frequency = 0, height = points[1];
    for (let point = 0; point < 10; point += 2) {
      const nextFrequency = Math.trunc(points[point] / 8), nextHeight = points[point + 1];
      if (nextFrequency - frequency > 0) {
        for (let index = frequency; index < nextFrequency; index++) {
          result[index] = height + Math.trunc(((index - frequency) * (nextHeight - height)) / (nextFrequency - frequency));
        }
      }
      frequency = nextFrequency; height = nextHeight;
    }
    return result;
  })(),
});

function divide(value, divisor) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new RangeError('Invalid command-plan division');
  }
  return Math.trunc(value / divisor);
}

function toInt16(value) {
  return value > 0x7fff ? value - 0x10000 : value;
}
function signedFlags(value) {
  return toInt16(value & 0xffff);
}

function copyVoice(value) {
  if (!value || value.sampleRate !== 22050) throw new TypeError('Expected fixed 22050Hz voice state');
  return value;
}

function readFrame(data, base, offset, frameCache) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const at = base + offset;
  if (frameCache.has(at)) return frameCache.get(at);
  const frame = {
    frflags: view.getInt16(at, true), length: data[at + 16], rms: data[at + 17],
    fheight: [], fwidth: [], fright: [],
  };
  for (let i = 0; i < 7; i++) frame['ffreq' + i] = view.getInt16(at + 2 + i * 2, true);
  frame.ffreq = Array.from({ length: 7 }, (_, i) => frame['ffreq' + i]);
  for (let i = 0; i < 8; i++) frame.fheight.push(data[at + 18 + i]);
  for (let i = 0; i < 6; i++) frame.fwidth.push(data[at + 26 + i]);
  for (let i = 0; i < 3; i++) frame.fright.push(data[at + 32 + i]);
  frameCache.set(at, frame);
  return frame;
}

function readSpectrum(data, address, frameCache) {
  if (address <= 0 || address + 4 > data.length) throw new RangeError('Spectrum address outside phondata');
  const base = address + 4;
  const count = Math.min(data[address + 2], C.N_SEQ_FRAMES);
  const first = readFrame(data, base, 0, frameCache);
  const klatt = (first.frflags & C.FRFLAG_KLATT) !== 0;
  const stride = klatt ? 64 : 44;
  const frames = [];
  for (let i = 0; i < count; i++) frames.push(readFrame(data, base, i * stride, frameCache));
  return frames;
}

export function createWaveCommandPlanner(phondataBytes, selectedTable, options) {
  const data = phondataBytes;
  if (!(data instanceof Uint8Array)) throw new TypeError('Expected complete phondata Uint8Array');
  if (!selectedTable || !Array.isArray(selectedTable.entries)) throw new TypeError('Expected selected phoneme table');
  const voice = copyVoice(options && options.voice);
  const speed = {
    pauseFactor: 193, clausePauseFactor: 193, minPause: 5, wavFactor: 211,
    lenmodFactor: 110, lenmod2Factor: 100, minSampleLen: 450,
  };
  let queue = [], framePool = [], framePoolIndex = -1, framesBuf = [];
  const frameCache = new Map();
  let pitchLength = 0, ampLength = 0, lastPitchCommand = -1, lastAmpCommand = -1;
  let lastFrame = null, lastQueueCommand = -1, waveFlag = 0;
  let syllableStart = 0, syllableEnd = 0, syllableCentre = -1, modnFlags = 0;
  let fmtAmplitude = 0;
  let beginning = false;

  function reset() {
    queue = []; framePool = []; framePoolIndex = -1;
    pitchLength = 0; ampLength = 0; lastPitchCommand = -1; lastAmpCommand = -1;
    lastFrame = null; lastQueueCommand = -1; waveFlag = 0;
    syllableStart = 0; syllableEnd = 0; syllableCentre = -1; modnFlags = 0;
    fmtAmplitude = 0; beginning = true;
  }

  function copyFrame(frame) {
    if ((frame.frflags & C.FRFLAG_COPIED) !== 0) return frame;
    framePoolIndex = (framePoolIndex + 1) % 170;
    const copy = { ...frame, ffreq: frame.ffreq.slice(), fheight: frame.fheight.slice(),
      fwidth: frame.fwidth.slice(), fright: frame.fright.slice(),
      frflags: signedFlags((frame.frflags & ~C.FRFLAG_COPIED) | C.FRFLAG_COPIED), length: 0 };
    framePool[framePoolIndex] = copy;
    return copy;
  }

  function setRms(frame, newRms) {
    if (frame.rms === 0) return;
    let x = Math.trunc((newRms * 64) / frame.rms);
    if (x >= 200) x = 199;
    const sqrtTable = [0, 64, 90, 110, 128, 143, 156, 169, 181, 192, 202, 212, 221, 230, 239, 247,
      256, 263, 271, 278, 286, 293, 300, 306, 313, 320, 326, 332, 338, 344, 350, 356, 362, 367, 373,
      378, 384, 389, 394, 399, 404, 409, 414, 419, 424, 429, 434, 438, 443, 448, 452, 457, 461, 465,
      470, 474, 478, 483, 487, 491, 495, 499, 503, 507, 512, 515, 519, 523, 527, 531, 535, 539, 543,
      546, 550, 554, 557, 561, 565, 568, 572, 576, 579, 583, 586, 590, 593, 596, 600, 603, 607, 610,
      613, 617, 620, 623, 627, 630, 633, 636, 640, 643, 646, 649, 652, 655, 658, 662, 665, 668, 671,
      674, 677, 680, 683, 686, 689, 692, 695, 698, 701, 704, 706, 709, 712, 715, 718, 721, 724, 726,
      729, 732, 735, 738, 741, 743, 746, 749, 751, 754, 757, 759, 762, 765, 768, 770, 773, 775, 778,
      781, 783, 786, 789, 791, 794, 796, 799, 801, 804, 807, 809, 812, 814, 817, 820, 822, 825, 827,
      829, 832, 834, 836, 839, 841, 844, 846, 849, 851, 853, 856, 858, 861, 863, 865, 868, 870, 872,
      874, 877, 879, 881, 883, 886, 888, 891, 893, 895, 897, 900, 902];
    x = sqrtTable[x];
    for (let i = 0; i < 8; i++) frame.fheight[i] = Math.trunc((frame.fheight[i] * x) / 512);
  }

  function reduceHf(frame, level) {
    for (let i = 2; i < 8; i++) frame.fheight[i] = Math.trunc((frame.fheight[i] * level) / 100);
  }

  function vowelCloseness(frame) {
    const f1 = frame.ffreq[1];
    if (f1 < 300) return 3;
    if (f1 < 400) return 2;
    return f1 < 500 ? 1 : 0;
  }

  function duplicateLastFrame(frames, length) {
    frames[frames.length - 1].length = length;
    const copy = copyFrame(frames[frames.length - 1].frame);
    copy.frflags = signedFlags((copy.frflags & ~C.FRFLAG_COPIED) | C.FRFLAG_COPIED);
    frames.push({ frame: copy, frflags: copy.frflags, length: 0 });
    return copy;
  }

  function adjustFormants(frame, target, min, max, f1Adj, f3Adj, hfReduce, flags) {
    target = Math.trunc((target * voice.formantFactor) / 256);
    let x = Math.trunc((target - frame.ffreq[2]) / 2);
    if (x > max) x = max;
    if (x < min) x = min;
    frame.ffreq[2] += x;
    frame.ffreq[3] += f3Adj;
    if (flags & 0x20) f3Adj = -f3Adj;
    frame.ffreq[4] += f3Adj;
    frame.ffreq[5] += f3Adj;
    if (f1Adj === 1) {
      x = 235 - frame.ffreq[1];
      if (x < -100) x = -100;
      if (x > -60) x = -60;
      frame.ffreq[1] += x;
    } else if (f1Adj === 2) {
      x = 235 - frame.ffreq[1];
      if (x < -300) x = -300;
      if (x > -150) x = -150;
      frame.ffreq[1] += x; frame.ffreq[0] += x;
    } else if (f1Adj === 3) {
      x = 100 - frame.ffreq[1];
      if (x < -400) x = -400;
      frame.ffreq[1] += x; frame.ffreq[0] += x;
    }
    reduceHf(frame, hfReduce);
  }

  function formantTransition(frames, data1, data2, otherPhoneme, which) {
    if (frames.length < 2) return 0;
    let len = (data1 & 0x3f) * 2, rms = (data1 >> 6) & 0x3f, flags = data1 >> 12;
    const f2 = (data2 & 0x3f) * 50;
    const f2Min = (((data2 >> 6) & 0x1f) - 15) * 50;
    const f2Max = (((data2 >> 11) & 0x1f) - 15) * 50;
    const f3Adj = (((data2 >> 16) & 0x1f) - 15) * 50;
    const f3Amp = ((data2 >> 21) & 0x1f) * 8;
    const f1 = (data2 >> 26) & 7;
    const vcolour = data2 >> 29;
    if (otherPhoneme && otherPhoneme.mnemonic === (0x3f | (0x3f << 8))) flags |= 8;
    let frame = null;
    if (which === 1) {
      frame = copyFrame(frames[0].frame);
      frames[0].frame = frame;
      frames[0].length = len > 0 ? len : 50;
      frames[0].frflags |= C.FRFLAG_LEN_MOD2;
      frame.frflags = signedFlags(frame.frflags | C.FRFLAG_LEN_MOD2);
      const nextRms = frames[1].frame.rms;
      if (f2 !== 0) {
        if (rms & 0x20) setRms(frame, Math.trunc((nextRms * (rms & 0x1f)) / 30));
        adjustFormants(frame, f2, f2Min, f2Max, f1, f3Adj, f3Amp, flags);
        if ((rms & 0x20) === 0) setRms(frame, rms * 2);
      } else if (flags & 8) setRms(frame, Math.trunc((nextRms * 24) / 32));
      else setRms(frame, 128);
      if (flags & 8) modnFlags = 0x800 + (vowelCloseness(frame) << 8);
    } else {
      rms *= 2;
      if (f2 !== 0 || flags !== 0) {
        if (flags & 8) {
          frame = copyFrame(frames[frames.length - 1].frame);
          frames[frames.length - 1].frame = frame;
          rms = 160;
          modnFlags = 0x400 + (vowelCloseness(frame) << 8);
        } else {
          frame = duplicateLastFrame(frames, len);
        }
        setRms(frame, rms);
        const colours = [[243, 272, 256, 256, 256], [256, 256, 240, 240, 240]];
        if (vcolour > 0 && vcolour <= 2) {
          for (const row of frames) {
            const copy = copyFrame(row.frame);
            row.frame = copy;
            for (let formant = 1; formant <= 5; formant++) {
              copy.ffreq[formant] = Math.trunc((copy.ffreq[formant] * colours[vcolour - 1][formant - 1]) / 256);
            }
          }
        }
      }
    }
    if (frame) {
      if (flags & 4) frame.frflags = signedFlags(frame.frflags | C.FRFLAG_FORMANT_RATE);
      if (flags & 2) frame.frflags = signedFlags(frame.frflags | C.FRFLAG_BREAK);
    }
    return flags & 16 ? len : 0;
  }

  function lookupSpect(event) {
    const original = readSpectrum(data, event.fmtAddr, frameCache);
    const frames = [];
    for (let i = 0; i < C.N_SEQ_FRAMES; i++) {
      if (!framesBuf[i]) framesBuf[i] = { frame: null, frflags: 0, length: 0 };
      frames.push(framesBuf[i]);
    }
    for (let i = 0; i < original.length; i++) {
      frames[i].frame = original[i]; frames[i].frflags = original[i].frflags; frames[i].length = original[i].length;
    }
    let nf = original.length;
    let seqLenAdjust = (event.fmt2Lenadj || 0) + (event.fmtLength || 0);
    let breakAt = -1;
    for (let i = 0; i < nf; i++) if (frames[i].frame && frames[i].frame.frflags & C.FRFLAG_VOWEL_CENTRE) breakAt = i;
    if (breakAt > 0) {
      if (event.which === 1) nf = breakAt + 1;
      else { frames.splice(0, breakAt); nf -= breakAt; }
    }
    if (event.type === 2 && event.fmt2Addr === 0 && event.useVowelin) {
      seqLenAdjust += formantTransition(frames, event.transition0, event.transition1, null, event.which);
    }
    let length1 = 0;
    const nf1 = nf - 1;
    for (let i = 0; i < nf1; i++) length1 += frames[i].length;
    if (event.fmt2Addr !== 0) {
      const second = readSpectrum(data, event.fmt2Addr, frameCache);
      nf--;
      while (nf + second.length > frames.length) frames.push({ frame: null, frflags: 0, length: 0 });
      for (let i = 0; i < second.length; i++) {
        frames[nf].length = second[i].length;
        if (i > 0) { frames[nf].frame = second[i]; frames[nf].frflags = second[i].frflags; }
        nf++;
      }
    }
    if (length1 > 0) {
      let lengthFactor;
      if (event.which === 2) {
        let lengthStd = event.stdLength + seqLenAdjust - 45;
        if (lengthStd < 10) lengthStd = 10;
        if (event.synthflags & 8) lengthStd += selectedTable.entries[2].stdLength * 2;
        lengthFactor = Math.trunc((lengthStd * 256) / length1);
        for (let i = 0; i < nf1; i++) frames[i].length = Math.trunc((frames[i].length * lengthFactor) / 256);
      } else {
        if (event.which === 1) {
          if (event.fmtControl === 1 && event.stdLength < 130) {
            frames[0].length = Math.trunc((frames[0].length * event.stdLength) / 130);
          }
        } else if (event.stdLength > 0) seqLenAdjust += event.stdLength - length1;
        if (seqLenAdjust !== 0) {
          lengthFactor = Math.trunc(((length1 + seqLenAdjust) * 256) / length1);
          for (let i = 0; i < nf1; i++) frames[i].length = Math.trunc((frames[i].length * lengthFactor) / 256);
        }
      }
    }
    return frames.slice(0, nf);
  }

  function smoothSpect() {
    if (syllableStart === syllableEnd) return;
    if (syllableCentre < 0 || syllableCentre === syllableStart) { syllableStart = syllableEnd; return; }
    let frame = queue[syllableCentre].b, frame2 = frame;
    for (let ix = syllableCentre - 1;; ix--) {
      const q = queue[ix];
      if (!q || (q.type & 0xff) === C.WCMD_PAUSE || (q.type & 0xff) === C.WCMD_WAVE) break;
      if ((q.type & 0xff) <= C.WCMD_SPECT2) {
        const len = q.a & 0xffff;
        if (q.c === frame) { q.c = frame2; } else break;
        frame = frame2 = q.b;
        let modified = false;
        if (frame2.frflags & C.FRFLAG_BREAK) break;
        let allowedLen = len;
        if (frame2.frflags & C.FRFLAG_FORMANT_RATE) allowedLen = Math.trunc((allowedLen * 12) / 10);
        for (let pk = 0; pk < 6; pk++) {
          if ((frame2.frflags & C.FRFLAG_BREAK_LF) && pk < 3) continue;
          const f1 = q.c.ffreq[pk], f2 = frame2.ffreq[pk], diff = f2 - f1;
          let allowed = diff > 0 ? f1 * 2 + f2 : f1 + f2 * 2;
          allowed = Math.trunc((allowed * FORMANT_RATE[pk]) / 3000);
          allowed = Math.trunc((allowed * allowedLen) / 256);
          if (diff > allowed) {
            if (!modified) { frame2 = copyFrame(frame2); modified = true; }
            frame2.ffreq[pk] = q.c.ffreq[pk] + allowed;
            q.b = frame2;
          } else if (diff < -allowed) {
            if (!modified) { frame2 = copyFrame(frame2); modified = true; }
            frame2.ffreq[pk] = q.c.ffreq[pk] - allowed;
            q.b = frame2;
          }
        }
      }
      if (ix === syllableStart || ix <= 0) break;
    }
    frame = null; frame2 = null;
    for (let ix = syllableCentre;; ix++) {
      const q = queue[ix];
      if (!q || (q.type & 0xff) === C.WCMD_PAUSE || (q.type & 0xff) === C.WCMD_WAVE) break;
      if ((q.type & 0xff) <= C.WCMD_SPECT2) {
        const len = q.a & 0xffff;
        if (frame !== null) {
          if (q.b === frame) { q.b = frame2; } else break;
        }
        frame = frame2 = q.c;
        let modified = false;
        if (q.b.frflags & C.FRFLAG_BREAK) break;
        let allowedLen = len;
        if (q.b.frflags & C.FRFLAG_FORMANT_RATE) allowedLen = Math.trunc((allowedLen * 6) / 5);
        for (let pk = 0; pk < 6; pk++) {
          const f1 = q.b.ffreq[pk], f2 = frame.ffreq[pk], diff = f2 - f1;
          let allowed = diff > 0 ? f1 * 2 + f2 : f1 + f2 * 2;
          allowed = Math.trunc((allowed * FORMANT_RATE[pk]) / 3000);
          allowed = Math.trunc((allowed * allowedLen) / 256);
          if (diff > allowed) {
            if (!modified) { frame2 = copyFrame(frame); modified = true; }
            frame2.ffreq[pk] = q.b.ffreq[pk] + allowed;
            q.c = frame2;
          } else if (diff < -allowed) {
            if (!modified) { frame2 = copyFrame(frame); modified = true; }
            frame2.ffreq[pk] = q.b.ffreq[pk] - allowed;
            q.c = frame2;
          }
        }
      }
      if (ix + 1 === syllableEnd) break;
    }
    syllableStart = syllableEnd;
  }

  function push(type, a, b, c) {
    if (queue.length >= 170) throw new Error('Generate command queue capacity exceeded');
    queue.push({ type, a, b: b === undefined ? null : b, c: c === undefined ? null : c });
    return queue.length - 1;
  }

  function endPitch(voiceBreak) {
    if (pitchLength > 0 && lastPitchCommand >= 0 && queue[lastPitchCommand].a === 0) {
      queue[lastPitchCommand].a = pitchLength;
      pitchLength = 0;
    }
    if (voiceBreak) {
      lastQueueCommand = -1; lastFrame = null;
      syllableEnd = queue.length;
      smoothSpect();
      syllableCentre = -1;
    }
  }

  function endAmplitude() {
    if (ampLength > 0 && queue[lastAmpCommand] && queue[lastAmpCommand].a === 0) {
      queue[lastAmpCommand].a = ampLength;
      ampLength = 0;
    }
  }

  function pauseMs(length, control) {
    let ms = Math.trunc((length * (control === 0 ? speed.clausePauseFactor : speed.wavFactor)) / 256);
    return ms < speed.minPause ? speed.minPause : ms;
  }

  function doPause(length, control) {
    let samples = 0;
    if (length !== 0) {
      let ms = pauseMs(length, control);
      samples = Math.trunc((ms * 22050) / 1000);
    }
    endPitch(1);
    push(C.WCMD_PAUSE, samples);
    lastFrame = null;
    if (fmtAmplitude !== 0) { push(C.WCMD_FMT_AMPLITUDE, fmtAmplitude); fmtAmplitude = 0; }
  }

  function doAmplitude(amp, envelope, envelopeBytes) {
    const commandEnvelope = envelopeBytes ? { envelopeBytes } : envelope === null || envelope === -1 ? null : { envelope };
    lastAmpCommand = push(C.WCMD_AMPLITUDE, 0, commandEnvelope, amp);
    ampLength = 0;
  }

  function doPitch(envelope, pitch1, pitch2, envelopeBytes) {
    endPitch(0);
    if (pitch1 === 255 && !envelopeBytes) { pitch1 = 55; pitch2 = 76; envelope = 0; }
    const commandEnvelope = envelopeBytes ? { envelopeBytes } : { envelope };
    lastPitchCommand = push(C.WCMD_PITCH, 0, commandEnvelope, ((pitch1 << 16) + pitch2) >>> 0);
    pitchLength = 0;
    if (pitch2 < 0) pitch2 = 0;
  }

  function doMarker(type, charPosn, length, value) {
    push(C.WCMD_MARKER + (type << 8), (charPosn & 0xffffff) | (length << 24), null, value);
  }

  function doSample2(address, which, stdLengthInput, control, lengthMod, amp) {
    const index = address & 0x7fffff;
    if (index + 3 >= data.length) throw new RangeError('Wave address outside phondata');
    const wavLengthRaw = data[index] + data[index + 1] * 256;
    const wavScale = data[index + 2];
    if (wavLengthRaw === 0) return 0;
    let minLength = speed.minSampleLen;
    if (wavScale === 0) minLength *= 2;
    let stdLength = stdLengthInput;
    if (stdLength > 0) {
      stdLength = Math.trunc((stdLength * 22050) / 1000);
      if (wavScale === 0) stdLength *= 2;
      const adjusted = Math.trunc((minLength * stdLength) / wavLengthRaw);
      if (adjusted > minLength) minLength = adjusted;
    } else stdLength = wavLengthRaw;
    if (lengthMod > 0) stdLength = Math.trunc((stdLength * lengthMod) / 256);
    let length = Math.trunc((stdLength * speed.wavFactor) / 256);
    if (control & C.pd_DONTLENGTHEN && length > stdLength) length = stdLength;
    if (length < minLength) length = minLength;
    let wavLength = wavLengthRaw;
    if (wavScale === 0) { length = Math.trunc(length / 2); wavLength = Math.trunc(wavLength / 2); }
    if (amp < 0) return length;
    const len4 = Math.trunc(wavLength / 4);
    let offset = index + 4;
    if (which & 0x100) {
      lastQueueCommand = push(C.WCMD_WAVE2, length | (wavLength << 16), offset, wavScale + (amp << 8));
      return length;
    }
    let x;
    if (length > wavLength) { x = len4 * 3; length -= x; }
    else { x = length; length = 0; }
    lastQueueCommand = push(C.WCMD_WAVE, x, offset, wavScale + (amp << 8));
    while (length > len4 * 3) {
      x = wavScale === 0 ? len4 * 2 : len4;
      lastQueueCommand = push(C.WCMD_WAVE, len4 * 2, offset + x, wavScale + (amp << 8));
      length -= len4 * 2;
    }
    if (length > 0) {
      x = wavLength - length;
      if (wavScale === 0) x *= 2;
      lastQueueCommand = push(C.WCMD_WAVE, length, offset + x, wavScale + (amp << 8));
    }
    return length;
  }

  function doSample3(event) {
    endPitch(1);
    let amp2 = event.amp === -1 ? -1 : event.soundParam || 0;
    if (event.amp !== -1) {
      if (amp2 === 0) amp2 = 100;
      amp2 = Math.trunc((amp2 * 32) / 100);
    }
    if (!event.soundAddr) return 0;
    const length = doSample2(event.soundAddr, 2, (event.lengthModParam || 0) * 2, event.control, event.lengthMod, amp2);
    lastFrame = null;
    return length;
  }

  function doSpect2(event) {
    if (event.fmtAddr === 0) return 0;
    let lengthMod = event.lengthMod || 256;
    let lengthMin = Math.trunc(22050 / 70);
    const phoneme = selectedTable.entries[event.code];
    if (event.which === 2 && phoneme && ((phoneme.stdLength >= 130) || (event.synthflags & 8) || (phoneme.phflags & (1 << 21)))) lengthMin *= 2;
    if (event.which === 1) {
      const previousType = null;
      if (event.type === 3 || previousType === 3 || previousType === 8) lengthMod = Math.max(lengthMod, 0);
    }
    modnFlags = 0;
    const frames = lookupSpect(event);
    if (!frames.length) return 0;
    if (event.fmtAmp !== fmtAmplitude) {
      push(C.WCMD_FMT_AMPLITUDE, event.fmtAmp);
      fmtAmplitude = event.fmtAmp;
    }
    let frame1 = frames[0].frame;
    let wcmdSpect = C.WCMD_SPECT;
    if (event.wavAddr === 0) {
      if (waveFlag) { wcmdSpect = C.WCMD_SPECT2; waveFlag = 0; }
    }
    if (lastFrame && ((lastFrame.length < 2 || (lastFrame.frflags & C.FRFLAG_VOWEL_CENTRE)) &&
        !(lastFrame.frflags & C.FRFLAG_BREAK))) {
      const target = queue[lastQueueCommand];
      target.c = frame1;
      if (lastFrame.frflags & C.FRFLAG_BREAK_LF) {
        const copy = copyFrame(frame1);
        copy.frflags = signedFlags(copy.frflags | C.FRFLAG_BREAK_LF);
        for (let ix = 3; ix < 8; ix++) {
          if (ix < 7) copy.ffreq[ix] = lastFrame.ffreq[ix];
          copy.fheight[ix] = lastFrame.fheight[ix];
        }
        target.c = copy;
      }
    }
    if (event.type === 2 && event.which === 2) {
      smoothSpect();
      syllableCentre = queue.length;
    }
    const frameLengths = [0];
    let lengthSum = 0;
    for (let i = 1; i < frames.length; i++) {
      let factor = lengthMod;
      if (frames[i - 1].frflags & C.FRFLAG_LEN_MOD) {
        factor = Math.trunc((lengthMod * (256 - speed.lenmodFactor) + 256 * speed.lenmodFactor) / 256);
      } else if (frames[i - 1].frflags & C.FRFLAG_LEN_MOD2) {
        factor = Math.trunc((lengthMod * (256 - speed.lenmod2Factor) + 256 * speed.lenmod2Factor) / 256);
      }
      const len = Math.trunc((Math.trunc((frames[i - 1].length * 22050) / 1000) * factor) / 256);
      frameLengths[i] = len; lengthSum += len;
    }
    if (lengthSum > 0 && lengthSum < lengthMin) {
      for (let i = 1; i < frames.length; i++) frameLengths[i] = Math.trunc((frameLengths[i] * lengthMin) / lengthSum);
    }
    let totalLen = 0;
    for (let i = 1; i < frames.length; i++) {
      const frame2 = frames[i].frame;
      if (event.wavAddr !== 0 && !(frame1.frflags & C.FRFLAG_DEFER_WAV)) {
        const amp = event.wavAmp === 0 ? 32 : Math.trunc((event.wavAmp * 32) / 100);
        doSample2(event.wavAddr, event.which + 0x100, 0, event.fmtControl, 0, amp);
        waveFlag = 1; event.wavAddr = 0;
      }
      let modulation = event.modulation;
      if (frame1.frflags & C.FRFLAG_MODULATE) modulation = 6;
      if (i === frames.length - 1 && (modnFlags & 0xf00)) modulation |= modnFlags;
      const len = frameLengths[i];
      pitchLength += len; ampLength += len;
      if (len === 0) { lastFrame = null; frame1 = frame2; }
      else {
        lastQueueCommand = push(wcmdSpect, len + (modulation << 16), frame1, frame2);
        lastFrame = frame1 = frame2;
        totalLen += len;
      }
    }
    if (event.which !== 1 && fmtAmplitude !== 0) {
      push(C.WCMD_FMT_AMPLITUDE, fmtAmplitude);
      fmtAmplitude = 0;
    }
    return totalLen;
  }

  function process(events) {
    reset();
    if (!events || !Array.isArray(events) || events.length > 100000) throw new RangeError('Invalid high-level event plan');
    for (const event of events) {
      if (event.kind === 'generate.begin') {
        doPause(0, 0); continue;
      }
      if (event.kind === 'pause') {
        if (beginning && event.length === 0 && event.control === 0) { beginning = false; continue; }
        beginning = false;
        doPause(event.length, event.control);
      } else if (event.kind === 'amplitude') {
        beginning = false;
        doAmplitude(event.amp, event.envelope, event.envelopeBytes);
      }
      else if (event.kind === 'pitch') doPitch(event.envelope, event.pitch1, event.pitch2, event.envelopeBytes);
      else if (event.kind === 'endPitch') endPitch(event.voiceBreak ? 1 : 0);
      else if (event.kind === 'sample3') doSample3(event);
      else if (event.kind === 'spect2') doSpect2({ ...event });
      else if (event.kind === 'phoneme') endAmplitude();
      else if (event.kind === 'startSyllable') { if (syllableEnd === syllableStart) syllableEnd = queue.length; }
      else if (event.kind === 'marker') doMarker(event.type, event.charPosn, event.length, event.value);
    }
    if (!queue.length) throw new Error('Empty command plan');
    return queue.map(item => ({ ...item }));
  }

  return { process, speedProfile: () => ({ ...speed }) };
}
