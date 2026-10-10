import { createUnicodeOracle } from '../oracle/unicode.mjs';
import { jsDecode } from '../build-unicode/verify.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const modes = ['c-string', 'nul-terminated', 'bounded'];
const fields = ['codepoint', 'peekBefore', 'offsetBefore', 'offsetAfter', 'remainingBefore', 'consumedBytes', 'eofBefore', 'eofAfter'];
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const dependencyPaths = ['../../src/core/unicode.js', '../../data/unicode/tables.js', '../../data/unicode/manifest.json', '../build-unicode/verify.mjs', './unicode-decode-predicate.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dependencySnapshot = () => dependencyPaths.map(relative => ({ path: relative, sha256: hash(readFileSync(new URL(relative, import.meta.url))) }));
const loadedDependencies = dependencySnapshot();
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== expected.slice().sort().join('|')) throw new Error('Invalid decoder schema keys');
}
function envelope(value, request) {
  keys(value, ['schemaVersion', 'reference', 'request', 'decode', 'classifications']);
  keys(value.reference, ['upstreamCommit', 'traceFingerprint', 'helperFingerprint', 'profile']);
  keys(value.request, ['utf8Hex', 'termination', 'classify', 'dotlessI']);
  if (value.schemaVersion !== 1 || value.reference.profile !== 'utf8-unicode-v1' ||
      !/^[0-9a-f]{40}$/.test(value.reference.upstreamCommit) ||
      !/^[0-9a-f]{64}$/.test(value.reference.traceFingerprint) || !/^[0-9a-f]{64}$/.test(value.reference.helperFingerprint) ||
      value.request.utf8Hex !== request.utf8Hex || value.request.termination !== request.termination ||
      value.request.dotlessI !== false || !Array.isArray(value.request.classify) || value.request.classify.length ||
      !Array.isArray(value.classifications) || value.classifications.length) throw new Error('Invalid C Unicode oracle envelope');
}

// Structural/state validity is checked before interpreting any disagreement.
// This deliberately targets differences between valid decoder observations.
export function validateDecodeObservation(value, bytes, termination) {
  keys(value, ['inputByteLength', 'bufferByteLength', 'steps', 'terminal']);
  let length = bytes.length;
  if (termination === 'nul-terminated') length++;
  else if (termination === 'c-string') { const nul = bytes.indexOf(0); length = (nul < 0 ? bytes.length : nul) + 1; }
  if (value.inputByteLength !== bytes.length || value.bufferByteLength !== length ||
      !Array.isArray(value.steps) || value.steps.length > length) throw new Error('Invalid decoder schema lengths');
  let offset = 0;
  for (const step of value.steps) {
    keys(step, fields);
    if (!uint32(step.codepoint) || step.peekBefore !== step.codepoint || step.offsetBefore !== offset ||
        !Number.isInteger(step.offsetAfter) || step.offsetAfter <= offset || step.offsetAfter > length ||
        step.consumedBytes !== step.offsetAfter - offset || step.remainingBefore !== length - offset ||
        step.eofBefore !== false || step.eofAfter !== (step.offsetAfter === length)) throw new Error('Invalid decoder schema/cursor state');
    offset = step.offsetAfter;
  }
  keys(value.terminal, ['offset', 'eof', 'peek', 'getcSupported']);
  if (offset !== length || value.terminal.offset !== length || value.terminal.eof !== true ||
      value.terminal.peek !== 0 || value.terminal.getcSupported !== false) throw new Error('Invalid decoder terminal schema');
  return value;
}

// oracle/decode injection is a test seam, not CLI configuration. Normal callers
// select only termination and use the provenance-checked fixed C helper.
export function createUnicodeDecodePredicate({ termination = 'c-string', oracle, decode = jsDecode } = {}) {
  if (!modes.includes(termination)) throw new Error('Unknown UTF-8 termination mode');
  const invoke = oracle ?? createUnicodeOracle();
  let boundReference = null;
  const predicate = (bytes, context = {}) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 65536) throw new RangeError('Unicode predicate requires <=65536 input bytes');
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Unicode predicate aborted');
    // Invocation/build/JSON failures propagate. A nonzero child exit is not a bug signature.
    const request = { utf8Hex: Buffer.from(bytes).toString('hex'), termination };
    const expected = invoke(request);
    envelope(expected, request);
    if (!isDeepStrictEqual(dependencySnapshot(), loadedDependencies)) throw new Error('Unicode JS dependency changed during reduction');
    if (boundReference && !isDeepStrictEqual(boundReference, expected.reference)) throw new Error('Unicode C reference changed during reduction');
    if (!boundReference) boundReference = { ...expected.reference };
    const reference = validateDecodeObservation(expected.decode, bytes, termination);
    const actual = validateDecodeObservation(decode(Uint8Array.from(bytes), termination), bytes, termination);
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Unicode predicate aborted');
    let field = null;
    if (reference.steps.length !== actual.steps.length) field = 'steps.length';
    else {
      for (let i = 0; i < reference.steps.length && !field; i++) {
        for (const key of fields) if (reference.steps[i][key] !== actual.steps[i][key]) { field = 'steps.' + key; break; }
      }
    }
    return field ? { status: 'fail', category: 'semantic', signature: 'unicode-decode/' + termination + '/' + field } : { status: 'pass' };
  };
  Object.defineProperty(predicate, 'metadata', { get: () => boundReference ? {
    schemaVersion: 1, kind: 'unicode-decode-predicate', termination,
    testInjection: oracle !== undefined || decode !== jsDecode,
    reference: { ...boundReference }, javascript: loadedDependencies.map(item => ({ ...item }))
  } : null });
  return predicate;
}

let defaultPredicate;
export default function unicodeDecodePredicate(bytes, context) {
  if (!defaultPredicate) defaultPredicate = createUnicodeDecodePredicate();
  return defaultPredicate(bytes, context);
}
Object.defineProperty(unicodeDecodePredicate, 'metadata', { get: () => defaultPredicate?.metadata ?? null });
