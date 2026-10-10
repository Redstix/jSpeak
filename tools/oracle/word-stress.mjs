import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { referenceBuild } from './trace-build-info.mjs';
import { wordStressBinary, validateWordStressBuild } from './word-stress-build-info.mjs';
export function createWordStressOracle() {
  const identity = validateWordStressBuild();
  return function oracle(requests = []) {
    assert(Array.isArray(requests) && requests.length <= 16384, 'Invalid word-stress batch');
    const normalized = requests.map(value => {
      const { kind = 'set', phonemesHex, dictionaryFlags = null, tonic = -1, control = 0, stressedSyllable = 0, prevLastStress = 0 } = value;
      assert(kind === 'set' || kind === 'get');
      assert(typeof phonemesHex === 'string' && phonemesHex.length <= 398 && /^(?:[0-9a-f]{2})*$/.test(phonemesHex));
      assert(dictionaryFlags === null || (Number.isInteger(dictionaryFlags) && dictionaryFlags >= 0 && dictionaryFlags <= 0xffffffff));
      assert(Number.isInteger(tonic) && tonic >= -1 && tonic <= 6);
      assert(Number.isInteger(control) && control >= 0 && control <= 0x7fffffff);
      assert(Number.isInteger(stressedSyllable) && stressedSyllable >= 0 && stressedSyllable <= 99);
      assert(Number.isInteger(prevLastStress) && prevLastStress >= -0x80000000 && prevLastStress <= 0x7fffffff);
      return { kind, phonemesHex, dictionaryFlags, tonic, control, stressedSyllable, prevLastStress };
    });
    const input = normalized.map(row => `${row.kind === 'set' ? 1 : 0} ${row.dictionaryFlags === null ? 0 : 1} ${row.dictionaryFlags ?? 0} ${row.tonic} ${row.control} ${row.stressedSyllable} ${row.prevLastStress} ${row.phonemesHex || '-'}\n`).join('');
    assert.deepEqual(validateWordStressBuild(), identity, 'Word-stress helper changed during session');
    const response = JSON.parse(execFileSync(wordStressBinary, [path.join(referenceBuild, 'espeak-ng-data')], { input, encoding: 'utf8', timeout: 30000, maxBuffer: 40 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }));
    assert.equal(response.results.length, requests.length);
    return { schemaVersion: 1, reference: { fingerprint: identity.fingerprint, phontabSha256: identity.stamp.inputs.phontabSha256 }, requests: normalized, ...response };
  };
}
