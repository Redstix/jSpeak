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

test('unsupported wave commands fail explicitly', () => {
  const generator = createWaveGenerator();
  assert.throws(() => generator.synthesize([{ type: 9, a: 0 }]),
    error => error.code === 'WAVE_GENERATOR_UNSUPPORTED' && error.reason === 'command-9');
});
