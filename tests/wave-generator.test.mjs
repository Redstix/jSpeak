import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaveGenerator } from '../src/core/wave-generator.js';

test('pause and marker commands produce the original silent PCM length', () => {
  const generator = createWaveGenerator();
  const commands = [
    { type: 5, a: 0 },
    { type: 5, a: 154 },
    { type: 5, a: 0 },
    { type: 1290, a: 0, b: 0 }
  ];
  const result = generator.synthesize(commands);
  assert.equal(result.sampleRate, 22050);
  assert.equal(result.samples.length, 154);
  assert.deepEqual(Array.from(result.samples), new Array(154).fill(0));
});

test('pause generation resumes across bounded PCM chunks', () => {
  const generator = createWaveGenerator();
  const output = new Int16Array(10);
  const first = generator.fill([{ type: 5, a: 12 }, { type: 10, a: 0 }], output);
  assert.equal(first.produced, 10);
  assert.equal(first.finished, false);
  assert.equal(first.resume, true);
  const second = generator.fill([{ type: 5, a: 12 }, { type: 10, a: 0 }], output);
  assert.equal(second.produced, 2);
  assert.equal(second.finished, true);
  assert.equal(second.resume, false);
});

test('synthesized PCM is identical for different bounded chunk sizes', () => {
  const commands = [
    { type: 5, a: 123 },
    { type: 10, a: 0 }
  ];
  const expected = createWaveGenerator().synthesize(commands, { chunkSize: 4096 }).samples;
  for (const chunkSize of [1, 7, 64, 1323]) {
    assert.deepEqual(createWaveGenerator().synthesize(commands, { chunkSize }).samples, expected);
  }
});

test('PCM working buffers do not grow with output duration', () => {
  const generator = createWaveGenerator();
  const before = generator.bufferProfile();
  const output = new Int16Array(64);
  for (let produced = 0; produced < 100000;) {
    const result = generator.fill([{ type: 5, a: 100000 }, { type: 10, a: 0 }], output);
    produced += result.produced;
    if (result.finished) break;
  }
  assert.deepEqual(generator.bufferProfile(), before);
  assert.equal(generator.bufferProfile().outputLengthDependent, false);
});

test('profile-unused wave commands fail explicitly', () => {
  const generator = createWaveGenerator();
  for (const type of [1, 2, 11, 13, 14, 15, 16]) {
    assert.throws(() => generator.synthesize([{ type, a: 0 }]),
      error => error.code === 'WAVE_GENERATOR_UNSUPPORTED' && error.reason === 'command-' + type);
  }
});
