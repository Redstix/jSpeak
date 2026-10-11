import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createEnglishSynthesizer } from '../src/core/english-synthesis.js';

const reference = 'build/oracle';
const available = existsSync(new URL(`../${reference}/espeak-ng-data/en_dict`, import.meta.url));

test('fixed en-us text adapter produces bounded PCM WAV', { skip: !available }, async () => {
  const bytes = path => new Uint8Array(readFileSync(new URL(`../${path}`, import.meta.url)));
  const synthesizer = createEnglishSynthesizer({
    dictionaryBytes: bytes(`${reference}/espeak-ng-data/en_dict`),
    dictionaryManifest: JSON.parse(readFileSync(new URL('../data/dictionary/manifest.json', import.meta.url))),
    phontabBytes: bytes(`${reference}/espeak-ng-data/phontab`),
    phonindexBytes: bytes(`${reference}/espeak-ng-data/phonindex`),
    phondataBytes: bytes(`${reference}/espeak-ng-data/phondata`),
  });
  const result = await synthesizer.synthesizeWav('Hello world.', callback => callback());
  assert.equal(result.pcm.length > 0, true);
  assert.equal(result.wav.length, 44 + result.pcm.length * 2);
  const view = new DataView(result.wav.buffer);
  assert.equal(String.fromCharCode(...result.wav.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(result.stats.clauseCount, 1);
  assert.throws(() => synthesizer.synthesize('x'.repeat(64 * 1024 + 1)), /bounded profile/);
});
