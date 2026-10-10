import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { referenceBuild } from './trace-build-info.mjs';
import { rulesBinary, validateRulesBuild } from './rules-build-info.mjs';
export function createRulesOracle() {
  const identity = validateRulesBuild();
  return function oracle(requests = []) {
    assert(Array.isArray(requests) && requests.length <= 16384, 'Invalid rules batch');
    const normalized = requests.map(value => {
      let { wordHex, bufferHex = null, offset = null, wordFlags = 0, dictFlags = null, phonemesHex = '', phSize = 200, endPhonemesEnabled = true, dictCondition = 72, expectVerb = 0, prePause = 0, repeatCount = 0, prefixHex = null } = value;
      if (bufferHex === null) {
        assert(offset === null, 'Rule offset requires full buffer');
        assert(typeof wordHex === 'string' && wordHex.length <= 8192 && /^(?:[0-9a-f]{2})*$/.test(wordHex), 'Invalid rules word hex');
      } else {
        assert(typeof bufferHex === 'string' && bufferHex.length <= 16384 && /^(?:[0-9a-f]{2})*$/.test(bufferHex), 'Invalid rules buffer hex');
        const buffer = Buffer.from(bufferHex, 'hex');
        assert(Number.isInteger(offset) && offset >= 1 && offset < buffer.length, 'Invalid rules buffer offset');
        assert(prefixHex === null, 'Rule full buffer already provides prefix');
        const end = buffer.indexOf(0, offset); assert(end >= offset, 'Rule full buffer requires terminating NUL');
        const expected = buffer.subarray(offset, end).toString('hex');
        assert(wordHex === undefined || wordHex === expected, 'Rule word differs from full source'); wordHex = expected;
      }
      assert(typeof phonemesHex === 'string' && phonemesHex.length < phSize * 2 && /^(?:[0-9a-f]{2})*$/.test(phonemesHex), 'Invalid initial phonemes');
      for (const number of [wordFlags, dictCondition]) assert(Number.isInteger(number) && number >= 0 && number <= 0xffffffff);
      assert(dictFlags === null || (Array.isArray(dictFlags) && dictFlags.length === 2 && dictFlags.every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)));
      assert(Number.isInteger(phSize) && phSize >= 1 && phSize <= 200);
      assert(typeof endPhonemesEnabled === 'boolean');
      assert(prefixHex === null || (typeof prefixHex === 'string' && /^[0-9a-f]{4}$/.test(prefixHex)), 'Invalid two-byte rule prefix');
      if (prefixHex !== null) {
        const prefix = Buffer.from(prefixHex, 'hex');
        for (let i = 0; i < 2; i++) assert(!(prefix[i] >= 0xc0 && prefix[i] <= 0xf7) || (prefix[i] <= 0xdf && i === 0 && (prefix[1] & 0xc0) === 0x80), 'Prefix UTF-8 lead crosses the word boundary');
      }
      for (const number of [expectVerb, prePause, repeatCount]) assert(Number.isInteger(number) && number >= 0 && number <= 0x7fffffff);
      return { wordHex, bufferHex, offset, wordFlags, dictFlags, phonemesHex, phSize, endPhonemesEnabled, dictCondition, expectVerb, prePause, repeatCount, prefixHex };
    });
    const input = normalized.map(row => `${row.wordFlags} ${row.dictFlags === null ? 0 : 1} ${row.dictFlags?.[0] ?? 0} ${row.dictFlags?.[1] ?? 0} ${Number(row.endPhonemesEnabled)} ${row.phSize} ${row.dictCondition} ${row.expectVerb} ${row.prePause} ${row.repeatCount} ${row.bufferHex ?? (row.wordHex || '-')} ${row.phonemesHex || '-'} ${row.prefixHex ?? '-'} ${row.offset ?? -1}\n`).join('');
    assert.deepEqual(validateRulesBuild(), identity, 'Rules helper changed during session');
    const response = JSON.parse(execFileSync(rulesBinary, [path.join(referenceBuild, 'espeak-ng-data')], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 40 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }));
    assert.equal(response.results.length, requests.length);
    return { schemaVersion: 1, reference: { fingerprint: identity.fingerprint, dictionarySha256: identity.stamp.inputs.dictionarySha256, phontabSha256: identity.stamp.inputs.phontabSha256 }, requests: normalized, ...response };
  };
}

export function createRulesAppendOracle() {
  const identity = validateRulesBuild();
  return function oracle(requests = []) {
    assert(Array.isArray(requests) && requests.length <= 16384, 'Invalid append batch');
    const normalized = requests.map(({ phonemesHex = '', addedHex = '', capacity = 200, wordVowelCount = 0, wordStressedCount = 0, prePause = 0 }) => {
      for (const hex of [phonemesHex, addedHex]) assert(typeof hex === 'string' && hex.length <= 800 && /^(?:[0-9a-f]{2})*$/.test(hex), 'Invalid append bytes');
      assert(Number.isInteger(capacity) && capacity >= 1 && capacity <= 200);
      for (const value of [wordVowelCount, wordStressedCount, prePause]) assert(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff);
      return { phonemesHex, addedHex, capacity, wordVowelCount, wordStressedCount, prePause };
    });
    const input = normalized.map(row => `A ${row.capacity} ${row.wordVowelCount} ${row.wordStressedCount} ${row.prePause} ${row.phonemesHex || '-'} ${row.addedHex || '-'}\n`).join('');
    assert.deepEqual(validateRulesBuild(), identity, 'Rules helper changed during session');
    const response = JSON.parse(execFileSync(rulesBinary, [path.join(referenceBuild, 'espeak-ng-data')], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 40 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }));
    assert.equal(response.results.length, requests.length);
    return { schemaVersion: 1, reference: { fingerprint: identity.fingerprint, dictionarySha256: identity.stamp.inputs.dictionarySha256, phontabSha256: identity.stamp.inputs.phontabSha256 }, requests: normalized, ...response };
  };
}
