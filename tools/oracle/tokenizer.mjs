import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { config } from './trace-build-info.mjs';
import { tokenizerBinary, tokenizerBuild, validateTokenizerBuild } from './tokenizer-build-info.mjs';

const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const int32 = value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, label) {
  if (!object(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field ${key}`);
}
function hex(value, label) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(value) || value.length > 65536 * 2) throw new Error(`${label} must be lowercase hex, at most 65536 bytes`);
  return value;
}
function list(value, label, normalize) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16384) throw new Error(`${label} must contain at most 16384 entries`);
  return value.map(normalize);
}
function normalizeRequest(value) {
  fields(value, ['utf8Hex', 'scans', 'translations', 'splits', 'alphabets'], 'tokenizer request');
  return {
    ...(value.utf8Hex === undefined ? {} : { utf8Hex: hex(value.utf8Hex, 'utf8Hex') }),
    scans: list(value.scans, 'scans', entry => {
      fields(entry, ['bytesHex', 'offset', 'backwards'], 'scan');
      const bytesHex = hex(entry.bytesHex, 'bytesHex');
      const offset = entry.offset ?? 0, backwards = entry.backwards ?? false;
      if (!uint32(offset) || offset > bytesHex.length / 2 || typeof backwards !== 'boolean') throw new Error('Invalid scan offset/backwards');
      if (backwards) {
        const bytes = Buffer.from(bytesHex, 'hex');
        let i = offset;
        while ((bytes[i] & 0xc0) === 0x80) {
          if (i === 0) throw new Error('Backward scanner would leave buffer');
          i--;
        }
      }
      return { bytesHex, offset, backwards };
    }),
    translations: list(value.translations, 'translations', entry => {
      fields(entry, ['sourceHex', 'nextOffset', 'prevIn', 'codepoint', 'nextIn', 'insert', 'wordFlags'], 'translation');
      const sourceHex = hex(entry.sourceHex ?? '', 'sourceHex');
      const nextOffset = entry.nextOffset ?? 0, prevIn = entry.prevIn ?? 0, nextIn = entry.nextIn ?? 0;
      const insert = entry.insert ?? 0, wordFlags = entry.wordFlags ?? 0;
      if (!uint32(nextOffset) || nextOffset > sourceHex.length / 2 || !int32(prevIn) || !uint32(entry.codepoint) || !uint32(nextIn) || !int32(insert) || !uint32(wordFlags)) throw new Error('Invalid translation integer or source offset');
      return { sourceHex, nextOffset, prevIn, codepoint: entry.codepoint, nextIn, insert, wordFlags };
    }),
    splits: list(value.splits, 'splits', entry => {
      fields(entry, ['codepoint', 'previous'], 'split');
      const previous = entry.previous ?? 0;
      if (!uint32(entry.codepoint) || !uint32(previous)) throw new Error('Invalid split code point');
      return { codepoint: entry.codepoint, previous };
    }),
    alphabets: list(value.alphabets, 'alphabets', codepoint => {
      if (!uint32(codepoint)) throw new Error('Invalid alphabet code point');
      return codepoint;
    })
  };
}
function frame(entries, row) {
  const parts = [];
  let length = 4;
  const words = values => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => bytes.writeUInt32LE(value >>> 0, i * 4));
    return bytes;
  };
  parts.push(words([entries.length]));
  for (const entry of entries) {
    const { values, blob } = row(entry);
    length += values.length * 4 + (blob ? blob.length / 2 : 0);
    if (length > 16 * 1024 * 1024) throw new Error('Primitive frame exceeds 16 MiB');
    parts.push(words(values));
    if (blob) parts.push(Buffer.from(blob, 'hex'));
  }
  return Buffer.concat(parts, length);
}
function run(mode, input = Buffer.alloc(0)) {
  try {
    return JSON.parse(execFileSync(tokenizerBinary, [mode, tokenizerBuild], {
      input, timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JSPEAK_TRACE_FILE: '', LC_ALL: 'C', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=0' }
    }).toString('utf8'));
  } catch (cause) {
    // A nonzero exit alone never establishes undefined behavior. Recognize the
    // compiler's precise bounds diagnosis in the one instrumented source file.
    const match = cause.stderr?.toString('utf8').match(/\/src\/libespeak-ng\/translate\.c:(\d+):(\d+): runtime error: index (-?\d+) out of bounds for type '([^'\n]+)'/);
    if (mode === 'tokenize' && match) {
      const error = new Error('Original tokenizer array access is undefined', { cause });
      error.code = 'TOKENIZER_BOUNDS_UNDEFINED';
      error.diagnostic = { code: error.code, source: 'src/libespeak-ng/translate.c', line: Number(match[1]), column: Number(match[2]), index: Number(match[3]), arrayType: match[4] };
      throw error;
    }
    throw cause;
  }
}
export function createTokenizerOracle() {
  const build = validateTokenizerBuild();
  const profile = run('profile');
  const reference = { upstreamCommit: config.commit, helperFingerprint: build.fingerprint,
    dataFingerprint: build.stamp.reference.dataFingerprint, profile: 'first-clause-tokenizer-en-us-v1' };
  return value => {
    const request = normalizeRequest(value);
    let readClause = null, words = null, state = null, status = 'ok', diagnostic = null;
    let embeddedStateBefore = null, embeddedStateAfter = null, controlState = null;
    if (request.utf8Hex !== undefined) {
      try {
        const result = run('tokenize', Buffer.from(request.utf8Hex, 'hex'));
        assert.deepEqual(result.profile, profile, 'Tokenizer initial profile changed');
      ({ readClause, words, state } = result);
        ({ embeddedStateBefore, embeddedStateAfter, controlState } = result);
      } catch (error) {
        if (error.code !== 'TOKENIZER_BOUNDS_UNDEFINED') throw error;
        status = 'undefined-upstream-behavior'; diagnostic = error.diagnostic;
      }
    }
    const scans = request.scans.length ? run('scan', frame(request.scans, e => ({ values: [e.bytesHex.length / 2, e.offset, Number(e.backwards)], blob: e.bytesHex }))) : [];
    const translations = request.translations.length ? run('translate', frame(request.translations, e => ({ values: [e.sourceHex.length / 2, e.nextOffset, e.prevIn, e.codepoint, e.nextIn, e.insert, e.wordFlags], blob: e.sourceHex }))) : [];
    const splits = request.splits.length ? run('split', frame(request.splits, e => ({ values: [e.codepoint, e.previous] }))) : [];
    const alphabets = request.alphabets.length ? run('alphabet', frame(request.alphabets, cp => ({ values: [cp] }))) : [];
    return { schemaVersion: 1, status, diagnostic, reference: structuredClone(reference), request, profile: structuredClone(profile), readClause, words, state, embeddedStateBefore, embeddedStateAfter, controlState, scans, translations, splits, alphabets };
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/tokenizer.mjs < request-or-batch.json');
    const bytes = readFileSync(0);
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Tokenizer JSON batch exceeds 32 MiB');
    const value = JSON.parse(bytes.toString('utf8'));
    if (Array.isArray(value) && value.length > 1024) throw new Error('Tokenizer batch exceeds 1024 requests');
    const oracle = createTokenizerOracle();
    console.log(JSON.stringify(Array.isArray(value) ? value.map(request => oracle(request)) : oracle(value)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
