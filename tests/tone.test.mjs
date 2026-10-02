import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWav } from '../tools/compare/wav.mjs';
const source = readFileSync(new URL('../apps/vela-probe/src/tone.js', import.meta.url), 'utf8');
const { createTone } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('device tone produces valid 2s PCM16 in 63 bounded slices', () => {
  const tone = createTone();
  assert.equal(tone.bytes.length, 64044);
  for (let i = 0; i < 62; i++) assert.equal(tone.renderSlice(), false);
  assert.equal(tone.renderSlice(), true);
  const snapshot = tone.bytes.slice();
  assert.equal(tone.renderSlice(), true);
  assert.deepEqual(tone.bytes, snapshot);
  const { sampleRate, samples } = readWav(tone.bytes);
  assert.equal(sampleRate, 16000);
  assert.equal(samples.length, 32000);
  assert.ok(samples.every(sample => Math.abs(sample) <= 2400));
  assert.ok(samples.subarray(12800, 19200).every(sample => sample === 0));
  assert.equal(samples[0], 0);
  assert.equal(samples[31999], 0);
  // Count positive-going zero crossings in 0.5s steady-tone regions.
  const crossings = (start, end) => {
    let n = 0;
    for (let i = start; i < end; i++) if (samples[i] <= 0 && samples[i + 1] > 0) n++;
    return n;
  };
  assert.ok(Math.abs(crossings(1600, 9600) - 330) <= 1);
  assert.ok(Math.abs(crossings(20800, 28800) - 440) <= 1);
});
