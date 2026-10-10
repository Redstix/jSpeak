import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { referenceBuild } from './trace-build-info.mjs';
import { phonemeTableBinary, validatePhonemeTableBuild } from './phoneme-table-build-info.mjs';

export function createPhonemeTableOracle() {
  const identity = validatePhonemeTableBuild();
  return function oracle({ index = 80, decode = [] } = {}) {
    assert(Number.isInteger(index) && index >= 0 && index < 150, 'Invalid phoneme table index');
    assert(Array.isArray(decode) && decode.length <= 2048, 'Invalid bounded decode cases');
    for (const value of decode) assert(typeof value === 'string' && value.length <= 16384 && /^(?:[0-9a-f]{2})*$/.test(value), 'Invalid decode hex');
    assert.deepEqual(validatePhonemeTableBuild(), identity, 'Phoneme-table oracle changed during session');
    const result = JSON.parse(execFileSync(phonemeTableBinary, [path.join(referenceBuild, 'espeak-ng-data'), String(index)], {
      input: decode.map(value => value + '\n').join(''), encoding: 'utf8', timeout: 30000, maxBuffer: 40 * 1024 * 1024
    }));
    assert.equal(result.index, index);
    assert.equal(result.entries.length, 256);
    assert.equal(result.decoded.length, decode.length);
    return { schemaVersion: 1, reference: { fingerprint: identity.fingerprint, phontabSha256: identity.stamp.inputs.phontabSha256 }, request: { index, decode }, result };
  };
}
