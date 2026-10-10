import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { config, referenceBuild } from './trace-build-info.mjs';
import { wordBinary, wordSafetyBinary, validateWordBuild } from './word-build-info.mjs';
export const wordStateFields = ['dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags0', 'prevDictFlags1', 'clauseTerminator', 'clauseEnd',
  'clauseLowerCount', 'clauseUpperCount', 'prePause', 'prevLastStress', 'prepauseTimeout', 'endStressedVowel', 'wordVowelCount', 'wordStressedCount', 'repeatCount', 'skipWords', 'optionSayas', 'optionCapitals', 'optionToneFlags'];
const uintFields = new Set(['dictCondition', 'prevDictFlags0', 'prevDictFlags1', 'clauseTerminator', 'clauseEnd', 'optionToneFlags']);
const u32 = v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const i32 = v => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;
function object(v, fields, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('Expected ' + label + ' object');
  for (const key of Object.keys(v)) if (!fields.includes(key)) throw new Error('Unknown ' + label + ' field ' + key);
}
function hex(value, limit, label) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(value) || value.length / 2 > limit) throw new Error('Invalid ' + label + ' lowercase hex or byte limit');
  return value;
}
export function normalizeWordRequest(value) {
  object(value, ['operation', 'utf8Hex', 'prefixHex', 'bufferHex', 'offset', 'words', 'remaining', 'wordOut', 'anyStressedWords', 'alphabetCodepoint', 'initialPhonemesHex', 'state'], 'word request');
  const operation = value.operation ?? 'word3';
  if (!['word', 'word3', 'withBounds'].includes(operation)) throw new Error('Unknown word operation');
  let source, utf8Hex, prefixHex, bufferHex, offset;
  if (value.bufferHex !== undefined) {
    bufferHex = hex(value.bufferHex, 8192, 'bufferHex'); const buffer = Buffer.from(bufferHex, 'hex');
    offset = value.offset ?? 3;
    if (!Number.isInteger(offset) || offset < 3 || offset >= buffer.length) throw new Error('Invalid full buffer offset');
    const end = buffer.indexOf(0, offset); source = buffer.subarray(offset, end < 0 ? buffer.length : end);
    utf8Hex = source.toString('hex'); prefixHex = buffer.subarray(offset - 2, offset).toString('hex');
    if (value.utf8Hex !== undefined && value.utf8Hex !== utf8Hex) throw new Error('utf8Hex differs from full buffer source');
    if (value.prefixHex !== undefined && value.prefixHex !== prefixHex) throw new Error('prefixHex differs from full buffer prefix');
  } else {
    utf8Hex = hex(value.utf8Hex, 4096, 'utf8Hex'); source = Buffer.from(utf8Hex, 'hex');
    prefixHex = hex(value.prefixHex ?? '0020', 2, 'prefixHex');
    if (prefixHex.length !== 4) throw new Error('prefixHex must contain exactly two preceding bytes');
    offset = 3; if (value.offset !== undefined && value.offset !== offset) throw new Error('offset requires a full buffer');
    bufferHex = '00' + prefixHex + utf8Hex;
  }
  if (source.length < 1 || source.length > 4096 || source.includes(0) || source.at(-1) !== 32) throw new Error('Word source must be nonempty, NUL-free and space-terminated');
  const initialPhonemesHex = hex(value.initialPhonemesHex ?? '', 199, 'initialPhonemesHex');
  const words = value.words ?? [{}];
  if (!Array.isArray(words) || words.length > 300) throw new Error('Invalid bounded WORD_TAB array');
  const normalizedWords = words.map(value => {
    const fields = ['flags', 'start', 'prePause', 'sourceix', 'length']; object(value, fields, 'WORD_TAB');
    const row = Object.fromEntries(fields.map(key => [key, value[key] ?? 0]));
    for (const key of fields) if (!u32(row[key])) throw new Error('Invalid WORD_TAB ' + key);
    if (row.start > 65535 || row.sourceix > 65535 || row.prePause > 255 || row.length > 255) throw new Error('WORD_TAB exceeds original field widths');
    return row;
  });
  const remaining = value.remaining ?? (operation === 'word' ? 0 : words.length), wordOut = value.wordOut ?? true;
  const anyStressedWords = value.anyStressedWords ?? false, alphabetCodepoint = value.alphabetCodepoint ?? null;
  if (!u32(remaining) || remaining > words.length || typeof wordOut !== 'boolean' || typeof anyStressedWords !== 'boolean' || (alphabetCodepoint !== null && !u32(alphabetCodepoint))) throw new Error('Invalid word bounds or boolean context');
  if ((operation === 'word' || operation === 'withBounds') && wordOut && !words.length) throw new Error('Replacement wrapper needs nonnull WORD_TAB');
  if (operation === 'word' && (remaining !== 0 || alphabetCodepoint !== null || anyStressedWords)) throw new Error('Public TranslateWord needs nonnull WORD_TAB for replacement recursion and exposes no remaining/alphabet/any-stressed override');
  const incoming = value.state ?? {}; object(incoming, [...wordStateFields, 'repeatHex'], 'word state');
  const state = Object.fromEntries(wordStateFields.map(key => [key, key === 'dictCondition' ? 72 : key === 'clauseEnd' ? source.length - 1 : 0]));
  for (const key of wordStateFields) if (incoming[key] !== undefined) {
    if (!(uintFields.has(key) ? u32(incoming[key]) : i32(incoming[key]))) throw new Error('Invalid word state ' + key);
    state[key] = incoming[key];
  }
  if (state.clauseEnd > source.length) throw new Error('clauseEnd outside supplied word source');
  state.repeatHex = hex(incoming.repeatHex ?? '', 19, 'repeatHex');
  return { operation, utf8Hex, prefixHex, bufferHex, offset, words: normalizedWords, remaining, wordOut, anyStressedWords, alphabetCodepoint, initialPhonemesHex, state };
}
export function createWordOracle() {
  const build = validateWordBuild();
  const run = (mode, input = Buffer.alloc(0)) => JSON.parse(execFileSync(wordBinary, [mode, referenceBuild], { input, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JSPEAK_TRACE_FILE: '', JSPEAK_WORD_TRACE_FILE: '', LC_ALL: 'C' } }));
  const profile = run('profile');
  const reference = { upstreamCommit: config.commit, helperFingerprint: build.fingerprint, dataFingerprint: build.stamp.inputs.reference.dataFingerprint, profile: 'direct-word-en-us-v1' };
  return value => {
    const request = normalizeWordRequest(value);
    const values = [request.bufferHex.length / 2, request.offset, request.words.length, request.remaining, Number(request.wordOut), Number(request.anyStressedWords), request.alphabetCodepoint ?? 0xffffffff,
      request.initialPhonemesHex.length / 2, request.state.repeatHex.length / 2, ...wordStateFields.map(key => request.state[key])];
    const header = Buffer.alloc(values.length * 4); values.forEach((v, i) => header.writeUInt32LE(v >>> 0, i * 4));
    const words = Buffer.alloc(request.words.length * 20);
    request.words.forEach((word, i) => ['flags', 'start', 'prePause', 'sourceix', 'length'].forEach((key, j) => words.writeUInt32LE(word[key], i * 20 + j * 4)));
    const input = Buffer.concat([header, Buffer.from(request.bufferHex, 'hex'), Buffer.from(request.initialPhonemesHex, 'hex'), Buffer.from(request.state.repeatHex, 'hex'), words]);
    const envelope = { schemaVersion: 1, reference: structuredClone(reference), profile: structuredClone(profile), request };
    try {
      execFileSync(wordSafetyBinary, [request.operation, referenceBuild], { input, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, JSPEAK_TRACE_FILE: '', JSPEAK_WORD_TRACE_FILE: '', LC_ALL: 'C', ASAN_OPTIONS: 'detect_leaks=0:abort_on_error=1' } });
    } catch (error) {
      const stderr = String(error.stderr || '');
      const frame = stderr.match(/\[(\d+),\s*\d+\) 'text'.*Memory access at offset (\d+) underflows this variable/);
      if (stderr.includes('ERROR: AddressSanitizer: stack-buffer-overflow') &&
          /in utf8_in2 .*\/common\.c:138/.test(stderr) && /in MatchRule .*\/dictionary\.c:1967/.test(stderr) &&
          frame && Number(frame[2]) === Number(frame[1]) - 1) {
        return { ...envelope, status: 'undefined-upstream-behavior', diagnostic: { code: 'WORD_SOURCE_UNDERFLOW', sanitizer: 'AddressSanitizer',
          kind: 'stack-buffer-overflow', source: 'src/libespeak-ng/common.c', line: 138, callerSource: 'src/libespeak-ng/dictionary.c', callerLine: 1967, relativeIndex: -1 }, result: null };
      }
      throw error;
    }
    return { ...envelope, status: 'ok', diagnostic: null, result: run(request.operation, input) };
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/word.mjs < request-or-batch.json');
    const bytes = readFileSync(0); if (bytes.length > 8 * 1024 * 1024) throw new Error('Word JSON exceeds 8 MiB');
    const value = JSON.parse(bytes), oracle = createWordOracle();
    if (Array.isArray(value) && value.length > 1024) throw new Error('Word batch exceeds 1024 requests');
    console.log(JSON.stringify(Array.isArray(value) ? value.map(request => oracle(request)) : oracle(value)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
