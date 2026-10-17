import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makePcmWav,
  parsePcmWav
} from '../tools/build-vela-tts-profiles/build.mjs';

test('Vela TTS ships only full JS synthesis en and cmn profiles', () => {
  const en = JSON.parse(readFileSync(new URL('../apps/vela-tts/profiles/a/manifest.json', import.meta.url)));
  const cmn = JSON.parse(readFileSync(new URL('../apps/vela-tts/profiles/cmn/manifest.json', import.meta.url)));
  assert.equal(en.package, 'org.jspeak.tts');
  assert.equal(en.versionName, '0.6.0-en');
  assert.equal(en.versionCode, 17);
  assert.equal(en.config.jspeakProfile.variant, 'A');
  assert.equal(en.config.jspeakProfile.language, 'en-us');
  assert.equal(en.config.jspeakProfile.runtime, 'full-js-synthesis');
  assert.equal(en.config.jspeakProfile.sampleRate, 22050);
  assert.equal(cmn.package, 'org.jspeak.tts');
  assert.equal(cmn.versionName, '0.6.0-cmn');
  assert.equal(cmn.versionCode, 18);
  assert.equal(cmn.config.jspeakProfile.variant, 'A');
  assert.equal(cmn.config.jspeakProfile.language, 'cmn');
  assert.equal(cmn.config.jspeakProfile.runtime, 'full-js-synthesis');
  assert.equal(cmn.config.jspeakProfile.sampleRate, 22050);
  assert.equal(cmn.config.jspeakProfile.actionReadBytes, 2295161);
  const page = readFileSync(new URL('../apps/vela-tts/profiles/a/page.ux', import.meta.url), 'utf8');
  assert.equal(page.includes('DATA_ASSETS.versionName'), true);
  assert.equal(page.includes('common/jspeak'), false);
  assert.equal(page.includes('11025'), false);
  assert.equal(page.includes('5512'), false);
  const onInit = page.match(/onInit\(\) \{([\s\S]*?)\n  \}/);
  assert.equal(Boolean(onInit), true);
  assert.equal(onInit[1].includes('readArrayBuffer'), false);
  assert.equal(onInit[1].includes('createTtsSession'), false);
});

test('WAV helpers preserve canonical mono PCM16 output', () => {
  const samples = Int16Array.from([0, 100, -200, 300, -400, 500, -600]);
  const wav = makePcmWav(samples, 22050);
  const parsed = parsePcmWav(wav);
  assert.equal(parsed.samples.length, 7);
  assert.equal(parsed.sampleRate, 22050);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.deepEqual([...parsed.samples], [...samples]);
});
