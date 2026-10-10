import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { config, traceBuild, referenceBuild } from './trace-build-info.mjs';
import { characterNamesBinary, characterNamesReferenceBinary, validateCharacterNamesBuild } from './character-names-build-info.mjs';
export function createCharacterNamesOracle() {
  const build = validateCharacterNamesBuild();
  const reference = { upstreamCommit: config.commit, traceFingerprint: build.trace.fingerprint, helperFingerprint: build.fingerprint, dataFingerprint: build.trace.stamp.reference.dataFingerprint, profile: 'character-names-en-us-v1' };
  return (entries, options = {}) => {
    assert(Array.isArray(entries) && entries.length <= 4095, 'Expected bounded character-name batch');
    const input = Buffer.alloc(8 + entries.length * 12);input.writeUInt32LE(0x314e434a, 0);input.writeUInt32LE(entries.length, 4);
    entries.forEach((entry, index) => {
      assert(entry && Object.keys(entry).every(key => ['codepoint', 'only', 'reset'].includes(key)), 'Invalid character-name request');
      assert(Number.isInteger(entry.codepoint) && entry.codepoint >= 0 && entry.codepoint <= 0xffffffff && typeof entry.only === 'boolean');
      assert(entry.reset === undefined || typeof entry.reset === 'boolean');
      input.writeUInt32LE(entry.codepoint, 8 + index * 12);input.writeUInt32LE(Number(entry.only), 12 + index * 12);input.writeUInt32LE(Number(entry.reset || false), 16 + index * 12);
    });
    const result = JSON.parse(execFileSync(options.reference ? characterNamesReferenceBinary : characterNamesBinary, [options.reference ? referenceBuild : traceBuild],
      { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', JSPEAK_TRACE_FILE: '' } }));
    return { schemaVersion: 1, reference, request: entries, result };
  };
}
export function createLetterNamesOracle() {
  const build = validateCharacterNamesBuild();
  const reference = { upstreamCommit: config.commit, traceFingerprint: build.trace.fingerprint, helperFingerprint: build.fingerprint, dataFingerprint: build.trace.stamp.reference.dataFingerprint, profile: 'letter-names-en-us-v1' };
  return (entries, options = {}) => {
    assert(Array.isArray(entries) && entries.length <= 4095, 'Expected bounded letter-name batch');
    const input = Buffer.alloc(8 + entries.length * 16);input.writeUInt32LE(0x314c434a, 0);input.writeUInt32LE(entries.length, 4);
    entries.forEach((entry, index) => {
      assert(entry && Object.keys(entry).every(key => ['codepoint', 'nextLetter', 'control', 'reset'].includes(key)), 'Invalid letter-name request');
      assert(Number.isInteger(entry.codepoint) && entry.codepoint >= 0 && entry.codepoint <= 0xffffffff);
      const next = entry.nextLetter ?? -1, control = entry.control ?? 0;
      assert(Number.isInteger(next) && next >= -1 && next <= 255 && Number.isInteger(control) && control >= 0 && control <= 0x7fffffff);
      assert(entry.reset === undefined || typeof entry.reset === 'boolean');
      input.writeUInt32LE(entry.codepoint, 8 + index * 16);input.writeInt32LE(next, 12 + index * 16);input.writeUInt32LE(control, 16 + index * 16);input.writeUInt32LE(Number(entry.reset || false), 20 + index * 16);
    });
    const result = JSON.parse(execFileSync(options.reference ? characterNamesReferenceBinary : characterNamesBinary, [options.reference ? referenceBuild : traceBuild],
      { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', JSPEAK_TRACE_FILE: '' } }));
    return { schemaVersion: 1, reference, request: entries, result };
  };
}
