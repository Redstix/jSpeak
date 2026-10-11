import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  audioQualityMetrics,
  downsampleWav,
  makePcmWav,
  parsePcmWav
} from '../tools/build-vela-tts-profiles/build.mjs';

test('Vela TTS profile manifests define distinct install identities', () => {
  const expected = {
    a: { versionName: '0.5.1-a', versionCode: 8, runtime: 'full-js-synthesis' },
    b: { versionName: '0.5.1-b', versionCode: 9, runtime: 'precomputed-playback', sampleRate: 11025 },
    c: { versionName: '0.5.1-c', versionCode: 10, runtime: 'precomputed-playback', sampleRate: 5512 }
  };
  for (const [variant, row] of Object.entries(expected)) {
    const manifest = JSON.parse(readFileSync(new URL(`../apps/vela-tts/profiles/${variant}/manifest.json`, import.meta.url)));
    assert.equal(manifest.package, 'org.jspeak.tts');
    assert.equal(manifest.versionName, row.versionName);
    assert.equal(manifest.versionCode, row.versionCode);
    assert.equal(manifest.config.jspeakProfile.runtime, row.runtime);
    if (row.sampleRate) assert.equal(manifest.config.jspeakProfile.sampleRate, row.sampleRate);
  }
});

test('profile downsample keeps PCM16 and creates exact half/quarter sample budgets', () => {
  const originalSamples = Int16Array.from([0, 100, -200, 300, -400, 500, -600]);
  const original = makePcmWav(originalSamples, 22050);
  const half = downsampleWav(original, 2, 11025);
  const quarter = downsampleWav(original, 4, 5512);
  assert.equal(parsePcmWav(original).samples.length, 7);
  assert.equal(parsePcmWav(half).samples.length, 4);
  assert.equal(parsePcmWav(quarter).samples.length, 2);
  assert.equal(parsePcmWav(half).bitsPerSample, 16);
  assert.equal(parsePcmWav(quarter).bitsPerSample, 16);
  assert.equal(parsePcmWav(half).sampleRate, 11025);
  assert.equal(parsePcmWav(quarter).sampleRate, 5512);
  assert.deepEqual([...parsePcmWav(half).samples], [50, 50, 50, -600]);
  assert.deepEqual([...parsePcmWav(quarter).samples], [50, -167]);
});

test('reduced Vela pages have no synthesis or file I/O startup path', () => {
  for (const variant of ['b', 'c']) {
    const page = readFileSync(new URL(`../apps/vela-tts/profiles/${variant}/page.ux`, import.meta.url), 'utf8');
    assert.equal(page.includes("@system.file"), false);
    assert.equal(page.includes('createEnglishSynthesizer'), false);
    assert.equal(page.includes('readArrayBuffer'), false);
    assert.equal(page.includes("audio.src = '/common/jspeak/audio.wav'"), true);
  }
  const page = readFileSync(new URL('../apps/vela-tts/profiles/a/page.ux', import.meta.url), 'utf8');
  const onInit = page.match(/onInit\(\) \{([\s\S]*?)\n  \}/);
  assert.equal(Boolean(onInit), true);
  assert.equal(onInit[1].includes('readArrayBuffer'), false);
  assert.equal(onInit[1].includes('createTtsSession'), false);
});

test('downsample quality report is numeric and loss-aware', () => {
  const original = makePcmWav(Int16Array.from([1000, 2000, 3000, 4000, -4000, -3000]), 22050);
  const reduced = downsampleWav(original, 2, 11025);
  const metrics = audioQualityMetrics(original, reduced, 2);
  assert.equal(metrics.sampleCountRatio, 0.5);
  assert.equal(metrics.sampleCountRatio, 0.5);
  assert.equal(metrics.nyquistHz, 5512.5);
  assert.equal(metrics.boxFilterGainAtNyquistDb, -3.01);
  assert.equal(typeof metrics.reconstructionSnrDb, 'number');
  assert.equal(metrics.reconstructionPeakError > 0, true);
});
