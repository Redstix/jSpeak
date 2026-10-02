import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePcm } from '../tools/compare/pcm.mjs';

const audio = (samples, sampleRate = 16000) => ({ samples: Int16Array.from(samples), sampleRate });

test('identical PCM is exact', () => {
  const result = comparePcm(audio([-123, 0, 321]), audio([-123, 0, 321]));
  assert.equal(result.exact, true);
  assert.equal(result.firstMismatch, null);
  assert.equal(result.rmsError, 0);
  assert.equal(result.normalizedCorrelation, 1);
});

test('deliberate one-sample error fails exact comparison', () => {
  const result = comparePcm(audio([0, 100, 0]), audio([0, 101, 0]));
  assert.equal(result.exact, false);
  assert.equal(result.firstMismatch, 1);
  assert.equal(result.maxAbsoluteError, 1);
  assert.equal(result.rmsError, Math.sqrt(1 / 3));
});

test('length mismatch fails even with an identical prefix', () => {
  const result = comparePcm(audio([1, 2]), audio([1, 2, 0]));
  assert.equal(result.exact, false);
  assert.equal(result.firstMismatch, 2);
  assert.equal(result.comparedSamples, 2);
  assert.equal(result.durationDifferenceSeconds, 1 / 16000);
});

test('empty and silent clips have undefined correlation, not NaN', () => {
  const empty = comparePcm(audio([]), audio([]));
  assert.equal(empty.exact, true);
  assert.equal(empty.rmsError, null);
  assert.equal(empty.normalizedCorrelation, null);
  const silent = comparePcm(audio([0, 0]), audio([0, 0]));
  assert.equal(silent.rmsError, 0);
  assert.equal(silent.normalizedCorrelation, null);
  assert.equal(comparePcm(audio([]), audio([0])).exact, false);
});

test('full PCM16 difference does not wrap', () => {
  const result = comparePcm(audio([-32768]), audio([32767]));
  assert.equal(result.maxAbsoluteError, 65535);
  assert.equal(result.rmsError, 65535);
  assert.equal(result.normalizedCorrelation, -1);
});

test('incompatible or invalid formats fail before comparing', () => {
  assert.throws(() => comparePcm(audio([1]), audio([1], 22050)), /Sample rates differ/);
  assert.throws(() => comparePcm(audio([], 0), audio([])), /positive integer/);
  assert.throws(() => comparePcm({ samples: [NaN], sampleRate: 16000 }, audio([])), /Int16Array/);
});
