// Port of pinned wavegen.c for the fixed en-us PCM profile.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.
import {
  envelopeData, flutterTable, modulationTable, peakShape1, peakShape2,
  pitchAdjust, sinTable, waveMult,
} from './wavegen-data.js';

export var WAVE_GENERATOR_CONSTANTS = Object.freeze({
  WCMD_KLATT: 1, WCMD_KLATT2: 2, WCMD_SPECT: 3, WCMD_SPECT2: 4,
  WCMD_PAUSE: 5, WCMD_WAVE: 6, WCMD_WAVE2: 7, WCMD_AMPLITUDE: 8,
  WCMD_PITCH: 9, WCMD_MARKER: 10, WCMD_VOICE: 11, WCMD_EMBEDDED: 12,
  WCMD_MBROLA_DATA: 13, WCMD_FMT_AMPLITUDE: 14, WCMD_SONIC_SPEED: 15,
  WCMD_PHONEME_ALIGNMENT: 16, N_ECHO_BUF: 5500, N_PEAKS: 9,
  N_LOWHARM: 30, MAX_HARMONIC: 400, N_FLUTTER: 368, N_WAVEMULT: 128,
});
const C = WAVE_GENERATOR_CONSTANTS;

const EMBEDDED_DEFAULT = [0, 50, 175, 100, 50, 0, 0, 0, 175, 0, 0, 0, 0, 0, 0];
const EMBEDDED_MAX = [0, 0x7fff, 2000, 300, 99, 99, 99, 0, 2000, 0, 0, 0, 0, 4, 0];
const AMP_EMPHASIS = [16, 16, 10, 16, 22];
const GLOTTAL_REDUCE_1 = [0x30, 0x30, 0x40, 0x50];
const GLOTTAL_REDUCE_2 = [0x90, 0xa0, 0xb0, 0xc0];

function unsupported(reason) {
  const error = new Error('Wave generator dependency not implemented: ' + reason);
  error.code = 'WAVE_GENERATOR_UNSUPPORTED'; error.reason = reason; throw error;
}

function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
}

function commandInteger(value, name) {
  return integer(value, -0x80000000, 0x7fffffff, name);
}

function add32(a, b) { return (a + b) | 0; }
function mul32(a, b) { return Math.imul(a, b); }
function toInt32(value) {
  if (!Number.isFinite(value)) unsupported('integer-cast-from-non-finite');
  const truncated = Math.trunc(value);
  if (truncated < -0x80000000 || truncated > 0x7fffffff) return -0x80000000;
  return truncated | 0;
}

function toPcm16(value) {
  const wrapped = value & 0xffff;
  return wrapped > 0x7fff ? wrapped - 0x10000 : wrapped;
}

function signedByte(value) {
  return value > 127 ? value - 256 : value;
}

function commandOffset(command) {
  if (command.b === null || command.b === undefined) return 0;
  if (typeof command.b === 'number') return command.b;
  if (typeof command.b === 'object' && Number.isInteger(command.b.phondataOffset)) return command.b.phondataOffset;
  throw new TypeError('Invalid wave data offset');
}

function integerArray(value, length, minimum, maximum, name) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError('Invalid ' + name);
  return value.map(item => integer(item, minimum, maximum, name + ' item'));
}

function copyVoice(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Expected voice state');
  const voice = {
    pitchBase: commandInteger(value.pitchBase, 'voice pitch base'),
    pitchRange: commandInteger(value.pitchRange, 'voice pitch range'),
    flutter: commandInteger(value.flutter, 'voice flutter'),
    roughness: commandInteger(value.roughness, 'voice roughness'),
    echoDelay: commandInteger(value.echoDelay, 'voice echo delay'),
    echoAmp: commandInteger(value.echoAmp, 'voice echo amplitude'),
    nHarmonicPeaks: integer(value.nHarmonicPeaks, 0, 8, 'voice harmonic peak count'),
    peakShape: integer(value.peakShape, 0, 1, 'voice peak shape'),
    voicing: commandInteger(value.voicing, 'voice voicing'),
    formantFactor: commandInteger(value.formantFactor, 'voice formant factor'),
    consonantAmp: commandInteger(value.consonantAmp, 'voice consonant amplitude'),
    consonantAmpv: commandInteger(value.consonantAmpv, 'voice voiced consonant amplitude'),
    sampleRate: integer(value.sampleRate, 1, 192000, 'voice sample rate'),
  };
  const names = ['freq', 'height', 'width', 'freqadd', 'freq2', 'height2', 'breath', 'breathw'];
  for (const name of names) {
    voice[name] = integerArray(value[name], C.N_PEAKS, -0x80000000, 0x7fffffff, 'voice ' + name);
  }
  voice.toneAdjust = integerArray(value.toneAdjust, 1000, 0, 255, 'voice tone adjust');
  return voice;
}

function parseFrame(value, name) {
  if (value && Number.isInteger(value.frameIndex)) {
    if (!Array.isArray(value.frames)) throw new TypeError('Missing ' + name + ' table');
    value = value.frames[value.frameIndex];
  }
  if (!value || typeof value !== 'object') throw new TypeError('Invalid ' + name);
  return {
    frflags: integer(value.frflags, -32768, 32767, name + ' flags'),
    ffreq: integerArray(value.ffreq, 7, -32768, 32767, name + ' formant frequency'),
    length: integer(value.length, 0, 255, name + ' length'),
    rms: integer(value.rms, 0, 255, name + ' rms'),
    fheight: integerArray(value.fheight, 8, 0, 255, name + ' formant height'),
    fwidth: integerArray(value.fwidth, 6, 0, 255, name + ' formant width'),
    fright: integerArray(value.fright, 3, 0, 255, name + ' right width'),
  };
}

function createPeak() {
  return { freq: 0, height: 0, left: 0, right: 0, freq1: 0, height1: 0, left1: 0, right1: 0,
    freqInc: 0, heightInc: 0, leftInc: 0, rightInc: 0 };
}

function createResonator() { return { a: 0, b: 0, c: 0, x1: 0, x2: 0 }; }

export function createWaveGenerator(options) {
  const opts = options || {};
  const sampleRate = integer(opts.sampleRate === undefined ? 22050 : opts.sampleRate, 1, 192000, 'sample rate');
  if (sampleRate !== 22050) unsupported('sample-rate-profile');
  const phondataBytes = opts.phondataBytes;
  if (phondataBytes !== undefined && !(phondataBytes instanceof Uint8Array)) throw new TypeError('Expected phondata Uint8Array');
  const wvoice = opts.voice === undefined ? null : copyVoice(opts.voice);
  if (wvoice && wvoice.sampleRate !== sampleRate) throw new RangeError('Voice sample rate differs from generator sample rate');

  const peaks = Array.from({ length: C.N_PEAKS }, createPeak);
  const peakHarmonic = new Int32Array(C.N_PEAKS);
  const peakHeight = new Int32Array(C.N_PEAKS);
  const echoBuffer = new Int16Array(C.N_ECHO_BUF);
  const hspect = [new Int32Array(C.MAX_HARMONIC), new Int32Array(C.MAX_HARMONIC)];
  const harmInc = new Int32Array(C.N_LOWHARM);
  const breathResonators = Array.from({ length: C.N_PEAKS }, createResonator);
  const embeddedValue = EMBEDDED_DEFAULT.slice();

  let generalAmplitude = opts.generalAmplitude === undefined ? 55 : integer(opts.generalAmplitude, 0, 0x7fffffff, 'general amplitude');
  let consonantAmp = opts.consonantAmp === undefined ? 23 : integer(opts.consonantAmp, 0, 0x7fffffff, 'consonant amplitude');
  let optionHarmonic1 = 10;
  let flutterAmp = 64;
  let phaseIncFactor = Math.trunc(0x8000000 / sampleRate);
  let flutterInc = Math.trunc(64 * sampleRate / sampleRate);
  let minusPiT = -Math.PI / sampleRate;
  let twoPiT = -2 * minusPiT;
  let hswitch = 0;
  let harmspectIndex = 0;
  let maxh = 0, maxh2 = 0;
  let agc = 256;
  let hSwitchSign = 0;
  let cycleCount = 0;
  let amplitude2 = 0;
  let echoHead = 0, echoTail = 0, echoAmplitude = 0, echoLength = 0, echoComplete = 0;
  let voicing = 64;
  let nsamples = 0;
  let modulationType = 0;
  let glottalFlag = 0;
  let glottalReduce = 0;
  let samplecount = 0;
  let samplecountStart = 0;
  let endWave = 0;
  let wavephase = 0x7fffffff;
  let phaseinc = 0;
  let cycleSamples = 0;
  let cbytes = 0;
  let hfFactor = 0;
  let flutterIndex = 0;
  let wavemultMax = Math.min(C.N_WAVEMULT, Math.trunc(sampleRate * 60 / 12800));
  let wavemultOffset = Math.trunc(wavemultMax / 2);
  const pkShape = wvoice && wvoice.peakShape === 0 ? peakShape1 : peakShape2;
  let commandIndex = 0;
  let resume = false;
  let pauseSamples = 0, waveSamples = 0, waveIndex = 0;
  const wdata = {
    pitchEnv: envelopeData[0], pitch: 0, pitchIx: 0, pitchInc: 0, pitchBase: 0, pitchRange: 0,
    mixWaveBase: 0, mixWaveOffset: 0, mixWaveIndex: 0, mixWaveMax: 0, nMixWavefile: 0,
    mixWaveScale: 0, mixWaveAmp: 0, amplitude: 32, amplitudeV: 0, amplitudeFmt: 100,
  };
  let ampIx = 0, ampInc = 0, amplitudeEnv = null;
  let randomState = 1;

  function resetRandom(seed) {
    randomState = seed >>> 0;
    nextRandom(0, 1);
  }

  function nextRandom(minimum, maximum) {
    let product = randomState % 0x7fffffff;
    let multiplier = 1103515245 % 0x7fffffff;
    const modulus = 0x7fffffff;
    while (multiplier) {
      if (multiplier & 1) product = (product + randomState) % modulus;
      randomState = (randomState * 2) % modulus;
      multiplier = multiplier >>> 1;
    }
    randomState = (product + 12345) % modulus;
    return randomState % (maximum - minimum + 1) - minimum;
  }

  function getAmplitude() {
    const amp = Math.trunc(embeddedValue[3] * 55 / 100);
    generalAmplitude = Math.trunc(amp * AMP_EMPHASIS[embeddedValue[13]] / 16);
    return generalAmplitude;
  }

  function setPitchFormants() {
    if (!wvoice) return;
    let pitchValue = embeddedValue[1];
    if (pitchValue > 101) pitchValue = 101;
    let factor = 256;
    if (pitchValue > 50) factor = add32(256, Math.trunc(mul32(25, pitchValue - 50) / 50));
    for (let ix = 0; ix <= 5; ix++) wvoice.freq[ix] = Math.trunc(wvoice.freq2[ix] * factor / 256);
    factor = embeddedValue[6] * 3;
    wvoice.height[0] = Math.trunc(wvoice.height2[0] * (256 - factor * 2) / 256);
    wvoice.height[1] = Math.trunc(wvoice.height2[1] * (256 - factor) / 256);
  }

  function setEcho() {
    if (!wvoice) return;
    voicing = wvoice.voicing;
    let delay = wvoice.echoDelay;
    let amp = wvoice.echoAmp;
    if (delay >= C.N_ECHO_BUF) delay = C.N_ECHO_BUF - 1;
    if (amp > 100) amp = 100;
    echoBuffer.fill(0);
    echoTail = 0;
    if (embeddedValue[5] > 0) {
      amp = embeddedValue[5];
      delay = 130;
    }
    if (delay === 0) amp = 0;
    echoHead = Math.trunc(delay * sampleRate / 1000);
    echoLength = echoHead;
    if (amp === 0) echoLength = 0;
    if (amp > 20) echoLength = echoHead * 2;
    echoAmplitude = amp;
    generalAmplitude = getAmplitude();
    generalAmplitude = Math.trunc(generalAmplitude * (500 - amp) / 500);
  }

  function setVoice() {
    if (!wvoice) return;
    consonantAmp = Math.trunc(wvoice.consonantAmp * 26 / 100);
    if (sampleRate <= 11000) {
      consonantAmp *= 2;
      optionHarmonic1 = 6;
    }
    setEcho();
    setPitchFormants();
  }

  function setWithRange0(value, maximum) {
    if (value < 0) return 0;
    return value > maximum ? maximum : value;
  }

  function setEmbedded(control, value) {
    const command = control & 0x1f;
    let sign = 0;
    if ((control & 0x60) === 0x60) sign = -1;
    else if ((control & 0x60) === 0x40) sign = 1;
    if (command < EMBEDDED_DEFAULT.length) {
      embeddedValue[command] = sign === 0 ? value : embeddedValue[command] + value * sign;
      embeddedValue[command] = setWithRange0(embeddedValue[command], EMBEDDED_MAX[command]);
    }
    if (command === 6 || command === 1) {
      if (command === 6) setEcho();
      setPitchFormants();
    } else if (command === 3 || command === 13) getAmplitude();
    else if (command === 5) setEcho();
  }

  function setPitch2(pitch1, pitch2) {
    if (pitch1 > pitch2) [pitch1, pitch2] = [pitch2, pitch1];
    let pitchValue = embeddedValue[1];
    if (pitchValue > 101) pitchValue = 101;
    pitchValue -= embeddedValue[6];
    if (pitchValue < 0) pitchValue = 0;
    const base = Math.trunc(wvoice.pitchBase * pitchAdjust[pitchValue] / 128);
    const range = Math.trunc(wvoice.pitchRange * embeddedValue[4] / 50);
    const adjustedBase = base - (range - wvoice.pitchRange) * 18;
    wdata.pitchBase = add32(adjustedBase, Math.trunc(pitch1 * range / 2));
    wdata.pitchRange = add32(add32(adjustedBase, Math.trunc(pitch2 * range / 2)), -wdata.pitchBase);
  }

  function setPitch(length, env, pitch1, pitch2) {
    if (!wvoice) return;
    wdata.pitchEnv = env || envelopeData[0];
    wdata.pitchIx = 0;
    wdata.pitchInc = length === 0 ? 0 : Math.trunc(256 * 128 * 64 / length);
    setPitch2(pitch1, pitch2);
    wdata.pitch = add32(Math.imul(wdata.pitchEnv[0], wdata.pitchRange) >> 8, wdata.pitchBase);
    flutterAmp = wvoice.flutter;
  }

  function setAmplitude(length, env, value) {
    if (!wvoice) return;
    ampIx = 0;
    ampInc = length === 0 ? 0 : Math.trunc(256 * 128 * 64 / length);
    wdata.amplitude = Math.trunc(value * generalAmplitude / 16);
    wdata.amplitudeV = Math.trunc(wdata.amplitude * wvoice.consonantAmpv * 15 / 100);
    amplitudeEnv = env;
  }

  function setSynth(length, modulation, frame1, frame2) {
    if (!wvoice) return;
    endWave = 1;
    modulationType = modulation & 0xff;
    glottalFlag = 0;
    if (modulation & 0x400) {
      glottalFlag = 3;
      glottalReduce = GLOTTAL_REDUCE_1[(modulation >> 8) & 3];
    }
    if (modulation & 0x800) {
      glottalFlag = 4;
      glottalReduce = GLOTTAL_REDUCE_2[(modulation >> 8) & 3];
    }
    for (let qix = commandIndex + 1; qix < currentCommands.length; qix++) {
      const type = currentCommands[qix].type & 0xff;
      if (type === C.WCMD_SPECT) { endWave = 0; break; }
      if (type === C.WCMD_WAVE || type === C.WCMD_PAUSE) break;
    }
    let length2 = add32(length, 32) & ~0x3f;
    if (length2 === 0) length2 = 64;
    samplecountStart = samplecount;
    nsamples = add32(nsamples, length2);
    const length4 = Math.trunc(length2 / 4);
    peaks[7].freq = mul32(7800, wvoice.freq[7]) + mul32(wvoice.freqadd[7], 256) << 8;
    peaks[8].freq = mul32(9000, wvoice.freq[8]) + mul32(wvoice.freqadd[8], 256) << 8;
    for (let ix = 0; ix < 8; ix++) {
      if (ix < 7) {
        peaks[ix].freq1 = add32(mul32(frame1.ffreq[ix], wvoice.freq[ix]), mul32(wvoice.freqadd[ix], 256)) << 8;
        peaks[ix].freq = toInt32(peaks[ix].freq1);
        const next = add32(mul32(frame2.ffreq[ix], wvoice.freq[ix]), mul32(wvoice.freqadd[ix], 256)) << 8;
        peaks[ix].freqInc = (next - peaks[ix].freq1) * 16 / length4;
      }
      peaks[ix].height1 = mul32(frame1.fheight[ix], wvoice.height[ix]) << 6;
      peaks[ix].height = toInt32(peaks[ix].height1);
      const nextHeight = mul32(frame2.fheight[ix], wvoice.height[ix]) << 6;
      peaks[ix].heightInc = (nextHeight - peaks[ix].height1) * 64 / length2;
      if (ix <= 5 && ix <= wvoice.nHarmonicPeaks) {
        peaks[ix].left1 = mul32(frame1.fwidth[ix], wvoice.width[ix]) << 10;
        peaks[ix].left = toInt32(peaks[ix].left1);
        const nextLeft = mul32(frame2.fwidth[ix], wvoice.width[ix]) << 10;
        peaks[ix].leftInc = (nextLeft - peaks[ix].left1) * 64 / length2;
        if (ix < 3) {
          peaks[ix].right1 = mul32(frame1.fright[ix], wvoice.width[ix]) << 10;
          peaks[ix].right = toInt32(peaks[ix].right1);
          const nextRight = mul32(frame2.fright[ix], wvoice.width[ix]) << 10;
          peaks[ix].rightInc = (nextRight - peaks[ix].right1) * 64 / length2;
        } else peaks[ix].right = peaks[ix].left;
      }
    }
  }

  function setResonator(resonator, freq, bandwidth, initialize) {
    if (initialize) { resonator.x1 = 0; resonator.x2 = 0; }
    const x = Math.exp(minusPiT * bandwidth);
    resonator.c = -(x * x);
    resonator.b = x * Math.cos(twoPiT * freq) * 2;
    resonator.a = 1 - resonator.b - resonator.c;
  }

  function initBreath() {
    for (let ix = 0; ix < C.N_PEAKS; ix++) setResonator(breathResonators[ix], 2000, 200, true);
  }

  function applyResonator(resonator, input) {
    const output = resonator.a * input + resonator.b * resonator.x1 + resonator.c * resonator.x2;
    resonator.x2 = resonator.x1;
    resonator.x1 = output;
    return output;
  }

  function setBreath() {
    if (!wvoice || wvoice.breath[0] === 0) return;
    for (let pk = 1; pk < C.N_PEAKS; pk++) {
      if (wvoice.breath[pk] !== 0) setResonator(breathResonators[pk], peaks[pk].freq >> 16, wvoice.breathw[pk], false);
    }
  }

  function applyBreath() {
    if (!wvoice) return 0;
    let value = 0;
    const noise = nextRandom(-0x2000, 0x1fff);
    for (let ix = 1; ix < C.N_PEAKS; ix++) {
      const amp = wvoice.breath[ix];
      if (amp !== 0) {
        const scaledAmp = mul32(amp, peaks[ix].height >> 14);
        value = add32(value, toInt32(applyResonator(breathResonators[ix], noise) * scaledAmp));
      }
    }
    return value;
  }

  function peaksToHarmspect(pitch, htab, control) {
    if (!wvoice) return 1;
    let hmax = Math.trunc((peaks[wvoice.nHarmonicPeaks].freq + peaks[wvoice.nHarmonicPeaks].right) / pitch);
    if (hmax >= C.MAX_HARMONIC) hmax = C.MAX_HARMONIC - 1;
    const hmaxSamplerate = Math.trunc(Math.trunc(sampleRate * 19 / 40 << 16) / pitch);
    if (hmax > hmaxSamplerate) hmax = hmaxSamplerate;
    for (let h = 0; h <= hmax; h++) htab[h] = 0;
    let pk = 0;
    for (; pk <= wvoice.nHarmonicPeaks; pk++) {
      const peak = peaks[pk];
      const fp = peak.freq;
      if (peak.height === 0 || fp === 0) continue;
      const fhi = peak.freq + peak.right;
      let h = Math.trunc((peak.freq - peak.left) / pitch) + 1;
      if (h <= 0) h = 1;
      let f = mul32(pitch, h);
      for (; f < fp; f = add32(f, pitch)) {
        const denominator = peak.left >> 8;
        if (denominator === 0) unsupported('zero-formant-width');
        const shapeIndex = Math.trunc((fp - f) / denominator);
        if (shapeIndex < 0 || shapeIndex >= pkShape.length) unsupported('formant-shape-index');
        if (h >= C.MAX_HARMONIC) unsupported('harmonic-spectrum-capacity');
        htab[h] = add32(htab[h], mul32(pkShape[shapeIndex], peak.height));
        h++;
      }
      for (; f < fhi; f = add32(f, pitch)) {
        const denominator = peak.right >> 8;
        if (denominator === 0) unsupported('zero-formant-width');
        const shapeIndex = Math.trunc((f - fp) / denominator);
        if (shapeIndex < 0 || shapeIndex >= pkShape.length) unsupported('formant-shape-index');
        if (h >= C.MAX_HARMONIC) unsupported('harmonic-spectrum-capacity');
        htab[h] = add32(htab[h], mul32(pkShape[shapeIndex], peak.height));
        h++;
      }
    }
    const bass = peaks[1].height * 10;
    const bassStep = Math.trunc((1000 << 16) / pitch);
    let y = bass;
    if (bassStep > 0) {
      const decrement = Math.trunc(y / bassStep);
      let h = 1;
      while (y > 0) {
        if (h >= C.MAX_HARMONIC) unsupported('harmonic-spectrum-capacity');
        htab[h] = add32(htab[h], y);
        h++;
        y -= decrement;
      }
    }
    for (; pk < C.N_PEAKS; pk++) {
      const height = peaks[pk].height >> 14;
      peakHeight[pk] = Math.trunc(height * height * 5 / 2);
      if (control === 0) peakHarmonic[pk] = Math.trunc(peaks[pk].freq / pitch);
      if (peakHarmonic[pk] >= hmaxSamplerate) peakHeight[pk] = 0;
    }
    let f = 0;
    for (let h = 0; h <= hmax; h++, f = add32(f, pitch)) {
      let value = htab[h] >> 15;
      htab[h] = mul32(value, value) >> 8;
      const ix = f >>> 19;
      if (ix < 1000) htab[h] = mul32(htab[h], wvoice.toneAdjust[ix]) >> 13;
    }
    const first = mul32(htab[1], optionHarmonic1);
    htab[1] = Math.trunc(first / 8);
    if ((control & 1) !== 0) {
      for (let h = 1; h < C.N_LOWHARM; h++) harmInc[h] = Math.trunc((htab[h] - hspect[harmspectIndex][h]) >> 3);
    }
    return hmax;
  }

  function advanceParameters() {
    if (!wvoice) return;
    wdata.pitchIx = add32(wdata.pitchIx, wdata.pitchInc);
    let ix = wdata.pitchIx >> 8;
    if (ix > 127) ix = 127;
    let x = Math.imul(wdata.pitchEnv[ix], wdata.pitchRange);
    wdata.pitch = add32(x >> 8, wdata.pitchBase);
    if (flutterIndex >= C.N_FLUTTER * 64) flutterIndex = 0;
    x = mul32(flutterTable[flutterIndex >> 6] - 0x80, flutterAmp);
    flutterIndex += flutterInc;
    wdata.pitch = add32(wdata.pitch, x);
    if (wdata.pitch < 102400) wdata.pitch = 102400;
    if (samplecount === samplecountStart) return;
    let peakIx;
    for (peakIx = 0; peakIx <= wvoice.nHarmonicPeaks; peakIx++) {
      const peak = peaks[peakIx];
      peak.freq1 += peak.freqInc;
      peak.freq = toInt32(peak.freq1);
      peak.height1 += peak.heightInc;
      peak.height = Math.max(0, toInt32(peak.height1));
      peak.left1 += peak.leftInc;
      peak.left = toInt32(peak.left1);
      if (peakIx < 3) {
        peak.right1 += peak.rightInc;
        peak.right = toInt32(peak.right1);
      } else peak.right = peak.left;
    }
    for (; peakIx < 8; peakIx++) {
      const peak = peaks[peakIx];
      if (peakIx < 7) {
        peak.freq1 += peak.freqInc;
        peak.freq = toInt32(peak.freq1);
      }
      peak.height1 += peak.heightInc;
      peak.height = Math.max(0, toInt32(peak.height1));
    }
  }

  function playSilence(length, output, outputOffset) {
    nsamples = 0;
    samplecount = 0;
    wavephase = 0x7fffffff;
    if (length === 0) return 0;
    if (!resume) pauseSamples = length;
    let produced = 0;
    while (pauseSamples-- > 0) {
      const value = (echoBuffer[echoTail++] * echoAmplitude) >> 8;
      if (echoTail >= C.N_ECHO_BUF) echoTail = 0;
      output[outputOffset + produced++] = toPcm16(value);
      echoBuffer[echoHead++] = toPcm16(value);
      if (echoHead >= C.N_ECHO_BUF) echoHead = 0;
      if (outputOffset + produced >= output.length) {
        resume = true;
        return produced;
      }
    }
    resume = false;
    return produced;
  }

  function playWave(length, dataOffset, scale, amplitude, output, outputOffset) {
    if (!phondataBytes) unsupported('phondata-bytes');
    if (dataOffset < 0 || dataOffset >= phondataBytes.length) throw new RangeError('Wave data offset outside phondata');
    if (!resume) {
      waveSamples = length;
      waveIndex = 0;
    }
    nsamples = 0;
    samplecount = 0;
    let produced = 0;
    while (waveSamples-- > 0) {
      const at = dataOffset + waveIndex;
      if (at >= phondataBytes.length) throw new RangeError('Wave data outside phondata');
      let value;
      if (scale === 0) {
        if (at + 1 >= phondataBytes.length) throw new RangeError('Wave data outside phondata');
        value = phondataBytes[at] + signedByte(phondataBytes[at + 1]) * 256;
        waveIndex += 2;
      } else {
        value = Math.imul(signedByte(phondataBytes[at]), scale);
        waveIndex += 1;
      }
      value = Math.imul(value, Math.imul(consonantAmp, generalAmplitude)) >> 10;
      value = Math.trunc(Math.imul(value, amplitude) / 32);
      value = add32(value, (echoBuffer[echoTail++] * echoAmplitude) >> 8);
      if (echoTail >= C.N_ECHO_BUF) echoTail = 0;
      value = Math.max(-32768, Math.min(32767, value));
      output[outputOffset + produced++] = toPcm16(value);
      echoBuffer[echoHead++] = toInt32(Math.trunc(Math.imul(value, 3) / 4));
      if (echoHead >= C.N_ECHO_BUF) echoHead = 0;
      if (outputOffset + produced >= output.length) {
        resume = true;
        return produced;
      }
    }
    resume = false;
    return produced;
  }

  function readMixSample() {
    const at = wdata.mixWaveBase + wdata.mixWaveOffset + wdata.mixWaveIndex;
    if (at < 0 || at + (wdata.mixWaveScale === 0 ? 1 : 0) >= phondataBytes.length) throw new RangeError('Mixed wave data outside phondata');
    let sample;
    if (wdata.mixWaveScale === 0) {
      sample = phondataBytes[at] + signedByte(phondataBytes[at + 1]) * 256;
      wdata.mixWaveIndex += 2;
    } else {
      sample = Math.imul(signedByte(phondataBytes[at]), wdata.mixWaveScale);
      wdata.mixWaveIndex += 1;
    }
    if (wdata.mixWaveIndex + wdata.mixWaveOffset >= wdata.mixWaveMax) {
      wdata.mixWaveOffset -= Math.trunc(wdata.mixWaveMax * 3 / 4);
    }
    return sample;
  }

  function playSpect(length, modulation, frame1, frame2, output, outputOffset) {
    if (!wvoice) unsupported('voice-state');
    if (!resume) setSynth(length, modulation, frame1, frame2);
    const sin = sinTable;
    const spectrumPool = hspect;
    const peakHarmonicTable = peakHarmonic;
    const peakHeightTable = peakHeight;
    const echoSamples = echoBuffer;
    let produced = 0;
    for (;;) {
      if (endWave === 0 && samplecount === nsamples) {
        resume = false;
        return produced;
      }
      if ((samplecount & 0x3f) === 0) {
        if (samplecount === 0) {
          hswitch = 0;
          harmspectIndex = 0;
          maxh2 = peaksToHarmspect(wdata.pitch << 4, hspect[0], 0);
          amplitude2 = Math.trunc(Math.imul(Math.imul(wdata.amplitude, wdata.pitch >> 8), wdata.amplitudeFmt) / 80000);
          hSwitchSign = Math.trunc(890 / (wdata.pitch >> 12));
        } else advanceParameters();
        phaseinc = mul32(wdata.pitch >> 7, phaseIncFactor);
        cycleSamples = Math.trunc(sampleRate / (wdata.pitch >> 12));
        hfFactor = wdata.pitch >> 11;
        maxh = maxh2;
        harmspectIndex = hswitch;
        hswitch ^= 1;
        maxh2 = peaksToHarmspect(wdata.pitch << 4, hspect[hswitch], 1);
        setBreath();
      } else if ((samplecount & 7) === 0) {
        const spectrum = spectrumPool[harmspectIndex];
        for (let h = 1; h < C.N_LOWHARM && h <= maxh2 && h <= maxh; h++) {
          spectrum[h] = add32(spectrum[h], harmInc[h]);
        }
        if (agc < 256) agc++;
      }
      samplecount = add32(samplecount, 1);
      if (wavephase > 0) {
        wavephase = add32(wavephase, phaseinc);
        if (wavephase < 0) {
          cbytes = wavemultOffset - Math.trunc(cycleSamples / 2);
          if (samplecount > nsamples) {
            resume = false;
            return produced;
          }
          cycleCount++;
          for (let pk = wvoice.nHarmonicPeaks + 1; pk < C.N_PEAKS; pk++) {
            peakHarmonic[pk] = Math.trunc((Math.trunc(peaks[pk].freq / Math.imul(wdata.pitch, 8)) + 1) / 2);
          }
          amplitude2 = Math.trunc(Math.imul(Math.imul(wdata.amplitude, wdata.pitch >> 8), wdata.amplitudeFmt) / 80000);
          if (glottalFlag > 0) {
            if (glottalFlag === 3) {
              if (nsamples - samplecount < cycleSamples * 2) {
                glottalFlag = 2;
                amplitude2 = Math.trunc(amplitude2 * glottalReduce / 256);
              }
            } else if (glottalFlag === 4) {
              glottalFlag = 2;
              amplitude2 = Math.trunc(amplitude2 * glottalReduce / 256);
            } else glottalFlag--;
          }
          if (amplitudeEnv !== null) {
            let ix = ampIx >> 8;
            if (ix > 127) ix = 127;
            amplitude2 = Math.trunc(amplitude2 * amplitudeEnv[ix] / 128);
          }
          let modnPeriod = 0;
          if (wvoice.roughness < modulationTable.length) {
            const packed = modulationTable[wvoice.roughness][modulationType];
            const modnAmp = packed & 0xf;
            modnPeriod = packed >> 4;
            if (modnPeriod !== 0) {
              if (modnPeriod === 0xf) {
                amplitude2 = Math.trunc(amplitude2 * modnAmp / 16);
                modulationType = 0;
              } else if (cycleCount % modnPeriod === 0) amplitude2 = Math.trunc(amplitude2 * modnAmp / 16);
            }
          }
        }
      } else wavephase = add32(wavephase, phaseinc);
      const waveph = (wavephase >> 16) & 0xffff;
      let total = 0;
      cbytes = add32(cbytes, 1);
      if (cbytes >= 0 && cbytes < wavemultMax) {
        const spectrum = spectrumPool[harmspectIndex];
        for (let pk = wvoice.nHarmonicPeaks + 1; pk < C.N_PEAKS; pk++) {
          const theta = mul32(peakHarmonicTable[pk], waveph) & 0xffff;
          total = add32(total, mul32(sin[theta >> 5], peakHeightTable[pk]));
        }
        total = mul32(Math.trunc(total / hfFactor), waveMult[cbytes]);
      }
      const spectrum = spectrumPool[harmspectIndex];
      let theta = waveph;
      let h = 1;
      for (; h <= hSwitchSign; h++) {
        total = add32(total, mul32(sin[theta >> 5], spectrum[h]));
        theta = (theta + waveph) & 0xffff;
      }
      while (h <= maxh) {
        total = add32(total, -mul32(sin[theta >> 5], spectrum[h]));
        theta = (theta + waveph) & 0xffff;
        h++;
      }
      if (voicing !== 64) total = mul32(total >> 6, voicing);
      if (wvoice.breath[0]) total = add32(total, applyBreath());
      let z2 = 0;
      if (wdata.mixWaveIndex < wdata.nMixWavefile) {
        const sample = readMixSample();
        z2 = Math.imul(sample, wdata.amplitudeV) >> 10;
        z2 = Math.trunc(Math.imul(z2, wdata.mixWaveAmp) / 32);
      }
      let z1 = add32(z2, ((total >> 8) * amplitude2 >> 13));
      const echo = echoSamples[echoTail++] * echoAmplitude;
      z1 = add32(z1, echo >> 8);
      if (echoTail >= C.N_ECHO_BUF) echoTail = 0;
      let z = mul32(z1, agc) >> 8;
      if (z >= 32768 || z <= -32768) {
        if (z1 === 0) unsupported('automatic-gain-division-by-zero');
        const ov = Math.trunc(8388608 / z1) - 1;
        if (ov < agc) agc = ov;
        z = mul32(z1, agc) >> 8;
      }
      output[outputOffset + produced++] = toPcm16(z);
      echoSamples[echoHead++] = toPcm16(z);
      if (echoHead >= C.N_ECHO_BUF) echoHead = 0;
      if (outputOffset + produced >= output.length) {
        resume = true;
        return produced;
      }
    }
  }

  let currentCommands = [];

  function envelopeFromCommand(command, required) {
    if (command.b === null || command.b === undefined) {
      if (required) throw new TypeError('Missing pitch envelope');
      return null;
    }
    const index = command.b.envelope;
    if (!Number.isInteger(index) || index < 0 || index >= envelopeData.length) throw new TypeError('Invalid envelope index');
    return envelopeData[index];
  }

  function dispatch(command, output, outputOffset) {
    const type = command.type & 0xff;
    if (type === C.WCMD_PAUSE) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'pause length');
      if (!resume) echoComplete = add32(echoComplete, -length);
      wdata.nMixWavefile = 0;
      wdata.amplitudeFmt = 100;
      return playSilence(length, output, outputOffset);
    }
    if (type === C.WCMD_WAVE) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'wave length');
      const packed = commandInteger(command.c === undefined ? 0 : command.c, 'wave parameters');
      echoComplete = echoLength;
      wdata.nMixWavefile = 0;
      return playWave(length, commandOffset(command), packed & 0xff, packed >> 8, output, outputOffset);
    }
    if (type === C.WCMD_WAVE2) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'mixed wave length');
      const packed = commandInteger(command.c === undefined ? 0 : command.c, 'mixed wave parameters');
      wdata.mixWaveAmp = packed >> 8;
      wdata.mixWaveScale = packed & 0xff;
      wdata.nMixWavefile = length & 0xffff;
      wdata.mixWaveMax = (length >> 16) & 0xffff;
      if (wdata.mixWaveScale === 0) {
        wdata.nMixWavefile *= 2;
        wdata.mixWaveMax *= 2;
      }
      wdata.mixWaveIndex = 0;
      wdata.mixWaveBase = commandOffset(command);
      wdata.mixWaveOffset = 0;
      return 0;
    }
    if (type === C.WCMD_SPECT || type === C.WCMD_SPECT2) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'spect length');
      if (type === C.WCMD_SPECT2) wdata.nMixWavefile = 0;
      echoComplete = echoLength;
      const frame1 = parseFrame(command.b, 'first spectrum frame');
      const frame2 = parseFrame(command.c, 'second spectrum frame');
      return playSpect(length & 0xffff, length >> 16, frame1, frame2, output, outputOffset);
    }
    if (type === C.WCMD_AMPLITUDE) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'amplitude length');
      setAmplitude(length, envelopeFromCommand(command, false), commandInteger(command.c, 'amplitude value'));
      return 0;
    }
    if (type === C.WCMD_PITCH) {
      const length = commandInteger(command.a === undefined ? 0 : command.a, 'pitch length');
      const packed = commandInteger(command.c, 'pitch parameters');
      setPitch(length, envelopeFromCommand(command, true), packed >> 16, packed & 0xffff);
      return 0;
    }
    if (type === C.WCMD_EMBEDDED) {
      setEmbedded(commandInteger(command.a, 'embedded control'), commandInteger(command.b, 'embedded value'));
      return 0;
    }
    if (type === C.WCMD_MARKER) return 0;
    unsupported('command-' + type);
  }

  function fill(commands, output, fillOptions) {
    if (!Array.isArray(commands)) throw new TypeError('Expected wave command array');
    if (!(output instanceof Int16Array)) throw new TypeError('Expected PCM16 output array');
    if (output.length === 0) throw new RangeError('PCM output chunk must not be empty');
    const options = fillOptions || {};
    const commandCount = options.commandCount === undefined
      ? commands.length
      : integer(options.commandCount, 'command count');
    if (commandCount < 0 || commandCount > commands.length) {
      throw new RangeError('Wave command count is outside the command array');
    }
    const startIndex = options.commandIndex === undefined
      ? commandIndex
      : integer(options.commandIndex, 'command index');
    if (startIndex < 0 || startIndex > commandCount) {
      throw new RangeError('Wave command index is outside the command window');
    }
    commandIndex = startIndex;
    currentCommands = commands;
    let produced = 0;
    while (commandIndex < commandCount && produced < output.length) {
      const command = commands[commandIndex];
      if (!command || typeof command !== 'object') throw new TypeError('Invalid wave command');
      commandInteger(command.type, 'command type');
      produced += dispatch(command, output, produced);
      if (resume) return { produced, finished: false, commandIndex, resume: true };
      commandIndex++;
    }
    if (commandIndex >= commandCount && produced < output.length && echoComplete > 0) {
      produced += playSilence(echoComplete, output, produced);
      if (resume) return { produced, finished: false, commandIndex, resume: true };
      echoComplete = 0;
    }
    const finished = commandIndex >= commandCount;
    if (finished) resume = false;
    return { produced, finished, commandIndex, resume };
  }

  function reset() {
    commandIndex = 0;
    resume = false;
    pauseSamples = 0;
    waveSamples = 0;
    waveIndex = 0;
    echoComplete = 0;
    nsamples = 0;
    samplecount = 0;
    samplecountStart = 0;
    wavephase = 0x7fffffff;
    phaseinc = 0;
    cycleSamples = 0;
    cbytes = 0;
    hfFactor = 0;
    flutterIndex = 0;
    hswitch = 0;
    harmspectIndex = 0;
    maxh = 0;
    maxh2 = 0;
    agc = 256;
    hSwitchSign = 0;
    cycleCount = 0;
    amplitude2 = 0;
    modulationType = 0;
    glottalFlag = 0;
    glottalReduce = 0;
    endWave = 0;
    ampIx = 0;
    ampInc = 0;
    amplitudeEnv = null;
    echoBuffer.fill(0);
    hspect[0].fill(0);
    hspect[1].fill(0);
    harmInc.fill(0);
    peakHarmonic.fill(0);
    peakHeight.fill(0);
    for (const peak of peaks) Object.assign(peak, createPeak());
    for (const resonator of breathResonators) Object.assign(resonator, createResonator());
    embeddedValue.splice(0, EMBEDDED_DEFAULT.length, ...EMBEDDED_DEFAULT);
    wdata.pitchEnv = envelopeData[0];
    wdata.pitch = 0;
    wdata.pitchIx = 0;
    wdata.pitchInc = 0;
    wdata.pitchBase = 0;
    wdata.pitchRange = 0;
    wdata.mixWaveBase = 0;
    wdata.mixWaveOffset = 0;
    wdata.mixWaveIndex = 0;
    wdata.mixWaveMax = 0;
    wdata.nMixWavefile = 0;
    wdata.mixWaveScale = 0;
    wdata.mixWaveAmp = 0;
    wdata.amplitude = 32;
    wdata.amplitudeV = 0;
    wdata.amplitudeFmt = 100;
    generalAmplitude = opts.generalAmplitude === undefined ? 55 : generalAmplitude;
    consonantAmp = opts.consonantAmp === undefined ? 23 : consonantAmp;
    optionHarmonic1 = 10;
    flutterAmp = 64;
    voicing = 64;
    echoHead = 0;
    echoTail = 0;
    echoAmplitude = 0;
    echoLength = 0;
    if (wvoice) setVoice();
    initBreath();
    resetRandom(opts.randomSeed === undefined ? 1 : opts.randomSeed);
  }

  function synthesize(commands, synthesizeOptions) {
    const synthesizeOpts = synthesizeOptions || {};
    const chunkSize = integer(synthesizeOpts.chunkSize === undefined ? 4096 : synthesizeOpts.chunkSize, 1, 0x1000000, 'chunk size');
    reset();
    const work = new Int16Array(chunkSize);
    const chunks = [];
    let total = 0;
    for (;;) {
      const result = fill(commands, work);
      if (result.produced > 0) {
        chunks.push(work.slice(0, result.produced));
        total += result.produced;
      }
      if (result.finished) break;
      if (!result.resume) throw new Error('Wave generator made no progress');
    }
    const samples = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return { samples, sampleRate };
  }

  reset();
  return {
    fill,
    synthesize,
    reset,
    state: () => ({ sampleRate, commandIndex, resume, echoHead, echoTail, echoAmplitude, echoComplete }),
    bufferProfile: () => ({
      echoBufferSamples: C.N_ECHO_BUF,
      harmonicSpectraSamples: C.MAX_HARMONIC * 2,
      lowHarmonicIncrements: C.N_LOWHARM,
      synthChunkSamples: 4096,
      outputLengthDependent: false,
    }),
  };
}
