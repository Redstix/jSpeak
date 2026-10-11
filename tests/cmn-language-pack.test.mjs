import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANDIDATES, PROFILE } from '../tools/build-language/build.mjs';

const corpus = JSON.parse(readFileSync(new URL('../tools/build-language/corpus.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../tools/build-language/source-lock.json', import.meta.url), 'utf8'));

test('cmn profile locks the actual upstream voice and compiled data identity', () => {
  assert.deepEqual(PROFILE, { voice: 'cmn', speed: 175, pitch: 50, amplitude: 100, inputEncoding: 'UTF-8' });
  assert.equal(lock.profile.voice, 'cmn');
  assert.equal(lock.files.length, 6);
  assert.deepEqual(lock.files.map(file => file.sourcePath), CANDIDATES.map(file => file.sourcePath));
  assert.ok(CANDIDATES.every(file => file.packagePath.endsWith('.txt')));
  assert.deepEqual(lock.sourceInputs.map(file => file.sourcePath), [
    'dictsource/cmn_list', 'dictsource/cmn_rules', 'dictsource/cmn_emoji'
  ]);
});

test('cmn differential corpus records exact and unsupported cases without silence', () => {
  assert.equal(corpus.length, 30);
  const exact = corpus.filter(row => row.classification.startsWith('exact'));
  const unsupported = corpus.filter(row => row.classification.startsWith('unsupported'));
  assert.equal(exact.length, 29);
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].id, '904-voice-switch-en-us');
  assert.equal(unsupported[0].classification, 'unsupported-dynamic-en-us-dictionary');
  for (const row of corpus) {
    assert.match(row.classification, /^(exact|exact-|unsupported-)/);
    assert.ok(row.text !== undefined || row.inputBytesHex !== undefined);
    assert.ok(!(row.text !== undefined && row.inputBytesHex !== undefined));
    if (row.repeat !== undefined) {
      assert.ok(Number.isInteger(row.repeat) && row.repeat > 0);
      assert.equal(typeof row.text, 'string');
    }
  }
});
