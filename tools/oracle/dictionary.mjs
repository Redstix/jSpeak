import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { config, traceBuild, referenceBuild } from './trace-build-info.mjs';
import { dictionaryBinary, dictionaryReferenceBinary, validateDictionaryBuild } from './dictionary-build-info.mjs';
const fields = ['repeats', 'endFlags', 'wordFlags', 'flags0', 'flags1', 'dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags', 'clauseTerminator', 'clauseEnd', 'withWord'];
export function normalizeDictionaryRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected dictionary request');
  for (const key of Object.keys(value)) if (!['operation', 'utf8Hex', 'native', 'words', ...fields].includes(key)) throw new Error(`Unknown dictionary field ${key}`);
  const operation = value.operation ?? 'lookup';
  if (!['profile', 'transpose', 'lookup'].includes(operation)) throw new Error('Unknown dictionary operation');
  const utf8Hex = value.utf8Hex ?? '';
  if (typeof utf8Hex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(utf8Hex) || utf8Hex.length > 8192) throw new Error('Expected lowercase hex, up to 4096 bytes');
  if (operation === 'transpose' && utf8Hex.length > 318) throw new Error('Transpose input exceeds 159 bytes');
  const request = { operation, utf8Hex, repeats: 1, endFlags: 0, wordFlags: 0, flags0: 0, flags1: 0, dictCondition: 72, expectVerb: 0, expectVerbS: 0, expectNoun: 0, expectPast: 0, prevDictFlags: 0, clauseTerminator: 0, clauseEnd: utf8Hex.length / 2, withWord: 0 };
  for (const name of fields) if (value[name] !== undefined) {
    if (!Number.isInteger(value[name]) || value[name] < 0 || value[name] > 0xffffffff) throw new Error(`Invalid dictionary ${name}`);
    request[name] = value[name];
  }
  if (request.repeats < 1 || request.repeats > 16 || request.clauseEnd > utf8Hex.length / 2 || request.withWord > 1) throw new Error('Dictionary request outside bounded limits');
  request.native = value.native ?? true;
  if (typeof request.native !== 'boolean') throw new Error('Expected native boolean');
  request.words = value.words ?? [];
  if (!Array.isArray(request.words) || request.words.length > 300) throw new Error('Expected bounded WORD_TAB entries');
  request.words = request.words.map(entry => {
    if (!entry || Object.keys(entry).sort().join(',') !== 'flags,length' || !Number.isInteger(entry.flags) || entry.flags < 0 || entry.flags > 0xffffffff || !Number.isInteger(entry.length) || entry.length < 0 || entry.length > 255) throw new Error('Invalid WORD_TAB entry');
    return { flags: entry.flags, length: entry.length };
  });
  return request;
}
export function createDictionaryOracle() {
  const build = validateDictionaryBuild();
  const run = (operation, input, reference) => JSON.parse(execFileSync(reference ? dictionaryReferenceBinary : dictionaryBinary,
    [operation, reference ? referenceBuild : traceBuild], { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, JSPEAK_TRACE_FILE: '', LC_ALL: 'C' } }));
  const profile = run('profile', Buffer.alloc(0), false);
  assert.deepEqual(profile, run('profile', Buffer.alloc(0), true));
  const reference = { upstreamCommit: config.commit, traceFingerprint: build.trace.fingerprint, helperFingerprint: build.fingerprint, dataFingerprint: build.trace.stamp.reference.dataFingerprint, profile: 'dictionary-en-us-v1' };
  return (value, options = {}) => {
    const request = normalizeDictionaryRequest(value);
    let input = Buffer.from(request.utf8Hex, 'hex');
    if (request.operation === 'lookup') {
      const header = Buffer.alloc(72); header.writeUInt32LE(0x3244494a, 0); header.writeUInt32LE(input.length, 4);
      fields.forEach((name, i) => header.writeUInt32LE(request[name], 8 + i * 4));
      header.writeUInt32LE(Number(request.native), 64); header.writeUInt32LE(request.words.length, 68);
      const words = Buffer.alloc(request.words.length * 8);
      request.words.forEach((entry, i) => { words.writeUInt32LE(entry.flags, i * 8); words.writeUInt32LE(entry.length, i * 8 + 4); });
      input = Buffer.concat([header, input, words]);
    }
    return { schemaVersion: 1, reference: structuredClone(reference), profile: structuredClone(profile), request,
      result: run(request.operation, input, options.reference ?? false) };
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/dictionary.mjs < request.json');
    const bytes = readFileSync(0); if (bytes.length > 4 * 1024 * 1024) throw new Error('Dictionary JSON input exceeds 4 MiB');
    const value = JSON.parse(bytes);
    if (Array.isArray(value) && value.length > 1024) throw new Error('Dictionary batch exceeds 1024 requests');
    const oracle = createDictionaryOracle();
    console.log(JSON.stringify(Array.isArray(value) ? value.map(request => oracle(request)) : oracle(value)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
