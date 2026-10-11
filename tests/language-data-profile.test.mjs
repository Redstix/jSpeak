import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLanguageDataProfile, LANGUAGE_DATA_PROFILES } from '../src/core/language-data-profile.js';

test('language data profiles coexist and can be selected independently', () => {
  const enUs = selectLanguageDataProfile('en-us');
  const cmn = selectLanguageDataProfile('cmn');
  assert.equal(enUs.voice, 'en-us');
  assert.equal(cmn.voice, 'cmn');
  assert.deepEqual(cmn.runtimeFiles, ['cmn_dict', 'intonations', 'lang/sit/cmn', 'phondata', 'phonindex', 'phontab']);
  assert.deepEqual(cmn.sourceInputs, ['dictsource/cmn_list', 'dictsource/cmn_rules', 'dictsource/cmn_emoji']);
  assert.equal(cmn.jsRuntimeStatus, 'unsupported');
  assert.ok(cmn.unsupportedReason.includes('cmn frontend/tone runtime'));
  assert.equal(Object.keys(LANGUAGE_DATA_PROFILES).length, 2);
});

test('unknown language identities fail explicitly instead of falling back', () => {
  assert.throws(() => selectLanguageDataProfile('zh'), /Unsupported language data profile: zh/);
  assert.throws(() => selectLanguageDataProfile('cmn-Latn-pinyin'), /Unsupported language data profile: cmn-Latn-pinyin/);
});
