// First slice of pinned wavegen.c: pause and marker commands to PCM16.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.

export var WAVE_GENERATOR_CONSTANTS = Object.freeze({
  WCMD_PAUSE: 5,
  WCMD_WAVE: 6,
  WCMD_MARKER: 10,
  N_ECHO_BUF: 5500
});
const C = WAVE_GENERATOR_CONSTANTS;

function unsupported(reason) {
  const error = new Error('Wave generator dependency not implemented: ' + reason);
  error.code = 'WAVE_GENERATOR_UNSUPPORTED'; error.reason = reason; throw error;
}

function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
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

export function createWaveGenerator(options) {
  const opts = options || {};
  const sampleRate = integer(opts.sampleRate === undefined ? 22050 : opts.sampleRate, 1, 192000, 'sample rate');
  const phondataBytes = opts.phondataBytes;
  if (phondataBytes !== undefined && !(phondataBytes instanceof Uint8Array)) throw new TypeError('Expected phondata Uint8Array');
  const generalAmplitude = integer(opts.generalAmplitude === undefined ? 55 : opts.generalAmplitude, 0, 0x7fffffff, 'general amplitude');
  const consonantAmp = integer(opts.consonantAmp === undefined ? 23 : opts.consonantAmp, 0, 0x7fffffff, 'consonant amplitude');
  const echoBuffer = new Int16Array(C.N_ECHO_BUF);
  let echoHead = 0, echoTail = 0, echoAmplitude = 0;
  let pauseSamples = 0, waveSamples = 0, waveIndex = 0, commandIndex = 0, resume = false;

  function playSilence(length, output, outputOffset) {
    if (length === 0) return 0;
    if (!resume) pauseSamples = length;
    let produced = 0;
    while (pauseSamples-- > 0) {
      const value = (echoBuffer[echoTail++] * echoAmplitude) >> 8;
      if (echoTail >= C.N_ECHO_BUF) echoTail = 0;
      const sample = toPcm16(value);
      output[outputOffset + produced++] = sample;
      echoBuffer[echoHead++] = toPcm16(value);
      if (echoHead >= C.N_ECHO_BUF) echoHead = 0;
      if (pauseSamples < 0) {
        resume = false;
        return produced;
      }
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
        value = signedByte(phondataBytes[at]) * scale;
        waveIndex += 1;
      }
      value = (value * consonantAmp * generalAmplitude) >> 10;
      value = Math.trunc(value * amplitude / 32);
      value += (echoBuffer[echoTail++] * echoAmplitude) >> 8;
      if (echoTail >= C.N_ECHO_BUF) echoTail = 0;
      value = Math.max(-32768, Math.min(32767, value));
      const sample = toPcm16(value);
      output[outputOffset + produced++] = sample;
      echoBuffer[echoHead++] = Math.trunc(value * 3 / 4);
      if (echoHead >= C.N_ECHO_BUF) echoHead = 0;
      if (waveSamples < 0) {
        resume = false;
        return produced;
      }
      if (outputOffset + produced >= output.length) {
        resume = true;
        return produced;
      }
    }
    resume = false;
    return produced;
  }

  function fill(commands, output) {
    if (!Array.isArray(commands)) throw new TypeError('Expected wave command array');
    if (!(output instanceof Int16Array)) throw new TypeError('Expected PCM16 output array');
    let produced = 0;
    while (commandIndex < commands.length && produced < output.length) {
      const command = commands[commandIndex];
      if (!command || typeof command !== 'object') throw new TypeError('Invalid wave command');
      const type = integer(command.type, -2147483648, 0xffffffff, 'command type') & 0xff;
      if (type === C.WCMD_PAUSE) {
        const length = integer(command.a === undefined ? 0 : command.a, 0, 0x7fffffff, 'pause length');
        produced += playSilence(length, output, produced);
        if (resume) return { produced, finished: false, commandIndex, resume: true };
        commandIndex++;
      } else if (type === C.WCMD_WAVE) {
        const length = integer(command.a === undefined ? 0 : command.a, 0, 0x7fffffff, 'wave length');
        const packed = integer(command.c === undefined ? 0 : command.c, 0, 0xffffffff, 'wave parameters');
        const scale = packed & 0xff;
        const amplitude = packed >>> 8;
        produced += playWave(length, commandOffset(command), scale, amplitude, output, produced);
        if (resume) return { produced, finished: false, commandIndex, resume: true };
        commandIndex++;
      } else if (type === C.WCMD_MARKER) {
        commandIndex++;
      } else {
        unsupported('command-' + type);
      }
    }
    const finished = commandIndex >= commands.length;
    if (finished) resume = false;
    return { produced, finished, commandIndex, resume };
  }

  function synthesize(commands) {
    commandIndex = 0;
    resume = false;
    pauseSamples = 0;
    waveSamples = 0;
    waveIndex = 0;
    let total = 0;
    for (const command of commands) {
      if (!command || typeof command !== 'object') throw new TypeError('Invalid wave command');
      const type = integer(command.type, -2147483648, 0xffffffff, 'command type') & 0xff;
      if (type === C.WCMD_PAUSE) total += integer(command.a === undefined ? 0 : command.a, 0, 0x7fffffff, 'pause length');
      else if (type === C.WCMD_WAVE) total += integer(command.a === undefined ? 0 : command.a, 0, 0x7fffffff, 'wave length');
      else if (type !== C.WCMD_MARKER) unsupported('command-' + type);
    }
    const output = new Int16Array(total);
    let filled = 0;
    while (filled < output.length) {
      const result = fill(commands, output.subarray(filled));
      filled += result.produced;
      if (!result.finished && !result.resume) throw new Error('Wave generator made no progress');
    }
    return { samples: output, sampleRate };
  }

  return { fill, synthesize, state: () => ({ sampleRate, commandIndex, resume, echoHead, echoTail, echoAmplitude }) };
}
