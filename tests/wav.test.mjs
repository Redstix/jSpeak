import test from 'node:test';
import assert from 'node:assert/strict';
import { readWav } from '../tools/compare/wav.mjs';

function wav(samples = [-32768, 0, 32767]) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => b.writeInt16LE(sample, 44 + 2 * i));
  return b;
}

test('WAV parser preserves signed samples and rate', () => {
  const result = readWav(wav());
  assert.equal(result.sampleRate, 22050);
  assert.deepEqual([...result.samples], [-32768, 0, 32767]);
  assert.equal(readWav(wav([])).samples.length, 0);
});

test('WAV parser supports nonzero byteOffset', () => {
  const bytes = wav();
  const padded = Buffer.concat([Buffer.alloc(3), bytes, Buffer.alloc(7)]);
  assert.deepEqual([...readWav(padded.subarray(3, 3 + bytes.length)).samples], [-32768, 0, 32767]);
});

test('WAV parser rejects truncated RIFF or chunks', () => {
  assert.throws(() => readWav(wav().subarray(0, 10)), /Truncated/);
  assert.throws(() => readWav(wav().subarray(0, 44)), /size mismatch/);
  const bytes = wav(); bytes.writeUInt32LE(10000, 40);
  assert.throws(() => readWav(bytes), /Truncated chunk/);
});

test('WAV parser rejects incompatible formats', () => {
  const bytes = wav(); bytes.writeUInt16LE(2, 22);
  assert.throws(() => readWav(bytes), /PCM16 mono/);
  bytes.write('RIFX');
  assert.throws(() => readWav(bytes), /Not RIFF/);
});
