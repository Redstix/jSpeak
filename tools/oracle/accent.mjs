import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { config, referenceBuild } from './trace-build-info.mjs';
import { accentBinary, validateAccentBuild } from './accent-build-info.mjs';
const u32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
export function createAccentOracle() {
  const build = validateAccentBuild();
  const run = (mode, input = Buffer.alloc(0)) => JSON.parse(execFileSync(accentBinary, [mode, referenceBuild], { input, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JSPEAK_TRACE_FILE: '', LC_ALL: 'C' } }));
  const profile = run('profile');
  const reference = { upstreamCommit: config.commit, helperFingerprint: build.fingerprint, dataFingerprint: build.stamp.inputs.reference.dataFingerprint, profile: 'lookup-accented-letter-en-us-v1' };
  return value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected accent request');
    for (const key of Object.keys(value)) if (!['letters', 'dictCondition', 'accents'].includes(key)) throw new Error('Unknown accent field ' + key);
    const letters = value.letters ?? [], dictCondition = value.dictCondition ?? profile.dictCondition, accents = value.accents ?? profile.accents;
    if (!Array.isArray(letters) || letters.length > 16384 || !u32(dictCondition) || !u32(accents) || accents > 255) throw new Error('Invalid accent request bounds');
    const normalized = letters.map(entry => {
      if (typeof entry === 'number') entry = { codepoint: entry };
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Invalid accent letter');
      for (const key of Object.keys(entry)) if (!['codepoint', 'initialHex'].includes(key)) throw new Error('Unknown letter field ' + key);
      const initialHex = entry.initialHex ?? '';
      if (!u32(entry.codepoint) || typeof initialHex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(initialHex) || initialHex.length > 318) throw new Error('Invalid accent code point or initial bytes');
      return { codepoint: entry.codepoint, initialHex };
    });
    const parts = [], header = Buffer.alloc(12);
    header.writeUInt32LE(normalized.length); header.writeUInt32LE(dictCondition, 4); header.writeUInt32LE(accents, 8); parts.push(header);
    for (const entry of normalized) {
      const h = Buffer.alloc(8), bytes = Buffer.from(entry.initialHex, 'hex'); h.writeUInt32LE(entry.codepoint); h.writeUInt32LE(bytes.length, 4); parts.push(h, bytes);
    }
    return { schemaVersion: 1, reference: structuredClone(reference), profile: structuredClone(profile), request: { letters: normalized, dictCondition, accents }, result: run('lookup', Buffer.concat(parts)) };
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bytes = readFileSync(0); if (bytes.length > 8 * 1024 * 1024) throw new Error('Accent JSON exceeds 8 MiB');
    const value = JSON.parse(bytes), oracle = createAccentOracle();
    if (Array.isArray(value) && value.length > 1024) throw new Error('Accent batch exceeds 1024 requests');
    console.log(JSON.stringify(Array.isArray(value) ? value.map(request => oracle(request)) : oracle(value)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
