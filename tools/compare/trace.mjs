import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const fail = (where, message) => { throw new Error(`${where}: ${message}`); };
function object(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'expected object');
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) fail(where, `expected exactly fields ${keys.join(', ')}`);
}
function integer(value, min, max, where) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(where, `expected integer ${min}..${max}`);
}
const u32 = (v, p) => integer(v, 0, 0xffffffff, p);
const i32 = (v, p) => integer(v, -0x80000000, 0x7fffffff, p);
const u16 = (v, p) => integer(v, 0, 65535, p);
const u8 = (v, p) => integer(v, 0, 255, p);
function string(v, p) { if (typeof v !== 'string') fail(p, 'expected string'); }
function hex(v, p, length) { string(v, p); if (!/^(?:[0-9a-f]{2})*$/.test(v) || (length && v.length !== length)) fail(p, 'expected lowercase hex bytes'); }
function array(v, p) { if (!Array.isArray(v)) fail(p, 'expected array'); }

export function validateTrace(trace) {
  object(trace, ['schemaVersion', 'stage', 'caseId', 'reference', 'input', 'initialState', 'events', 'finalState'], '$');
  if (trace.schemaVersion !== 1) fail('$.schemaVersion', 'unsupported schema');
  if (trace.stage !== 'frontend-observations-v1') fail('$.stage', 'unsupported observation stage');
  string(trace.caseId, '$.caseId');
  const r = trace.reference;
  object(r, ['upstreamCommit', 'buildFingerprint', 'dataFingerprint', 'observationPatchSha256', 'profile'], '$.reference');
  hex(r.upstreamCommit, '$.reference.upstreamCommit', 40);
  for (const k of ['buildFingerprint', 'dataFingerprint', 'observationPatchSha256']) hex(r[k], `$.reference.${k}`, 64);
  object(r.profile, ['voice', 'speed', 'pitch', 'amplitude', 'inputEncoding', 'randomSeed'], '$.reference.profile');
  const supported = { voice: 'en-us', speed: 175, pitch: 50, amplitude: 100, inputEncoding: 'UTF-8', randomSeed: 1 };
  for (const k of Object.keys(supported)) if (r.profile[k] !== supported[k]) fail(`$.reference.profile.${k}`, 'unsupported profile');
  object(trace.input, ['utf8Hex'], '$.input'); hex(trace.input.utf8Hex, '$.input.utf8Hex');
  object(trace.initialState, ['process', 'randomSeed'], '$.initialState');
  if (trace.initialState.process !== 'fresh-cli' || trace.initialState.randomSeed !== 1) fail('$.initialState', 'unsupported replay state');
  array(trace.events, '$.events');
  let clauseCount = 0;
  let phase = 'decode';
  trace.events.forEach((event, index) => {
    const p = `$.events[${index}]`;
    if (!event || event.seq !== index) fail(p + '.seq', 'sequence must equal zero-based event index');
    const base = ['seq', 'kind'];
    switch (event.kind) {
      case 'decode':
        object(event, [...base, 'codepoint', 'remainingBefore', 'consumedBytes'], p);
        u32(event.codepoint, p + '.codepoint'); u32(event.remainingBefore, p + '.remainingBefore'); u32(event.consumedBytes, p + '.consumedBytes');
        if (event.consumedBytes > event.remainingBefore) fail(p, 'decoder consumed beyond input');
        break;
      case 'clause':
        object(event, [...base, 'startCharacter', 'startWord', 'terminator', 'tone', 'charixTop', 'sourceHex', 'charix'], p);
        if (phase !== 'decode') fail(p, 'previous clause observations are incomplete');
        phase = 'clause'; clauseCount++;
        for (const k of ['startCharacter', 'startWord', 'terminator', 'charixTop']) u32(event[k], `${p}.${k}`);
        i32(event.tone, p + '.tone'); hex(event.sourceHex, p + '.sourceHex'); array(event.charix, p + '.charix');
        if (event.charix.length !== event.charixTop + 1) fail(p, 'charix length must be charixTop + 1');
        event.charix.forEach((v, i) => integer(v, -32768, 32767, `${p}.charix[${i}]`));
        break;
      case 'words':
        object(event, [...base, 'bufferHex', 'items'], p);
        if (phase !== 'clause') fail(p, 'words must follow clause'); phase = 'words';
        hex(event.bufferHex, p + '.bufferHex'); array(event.items, p + '.items');
        event.items.forEach((w, i) => {
          const q = `${p}.items[${i}]`; object(w, ['flags', 'start', 'prePause', 'sourceix', 'length'], q);
          u32(w.flags, q + '.flags'); u16(w.start, q + '.start'); u8(w.prePause, q + '.prePause'); u16(w.sourceix, q + '.sourceix'); u8(w.length, q + '.length');
          if (w.start > event.bufferHex.length / 2) fail(q + '.start', 'word start exceeds buffer');
        });
        break;
      case 'phonemes-before-list': {
        object(event, [...base, 'initialTable', 'postPauseMs', 'startSentence', 'items'], p);
        if (phase !== 'words') fail(p, 'phoneme list must follow words'); phase = 'decode';
        u8(event.initialTable, p + '.initialTable'); i32(event.postPauseMs, p + '.postPauseMs');
        if (typeof event.startSentence !== 'boolean') fail(p + '.startSentence', 'expected boolean');
        array(event.items, p + '.items');
        let table = event.initialTable;
        event.items.forEach((ph, i) => {
          const q = `${p}.items[${i}]`; object(ph, ['table', 'code', 'stress', 'sourceix', 'synthflags', 'switchTo'], q);
          for (const k of ['table', 'code', 'stress']) u8(ph[k], `${q}.${k}`);
          for (const k of ['sourceix', 'synthflags']) u16(ph[k], `${q}.${k}`);
          integer(ph.switchTo, -1, 255, q + '.switchTo');
          if (ph.table !== table) fail(q + '.table', 'inconsistent phoneme table chain');
          if (ph.switchTo >= 0) table = ph.switchTo;
        });
        break;
      }
      default: fail(p + '.kind', 'unknown event kind');
    }
  });
  if (phase !== 'decode') fail('$.events', 'incomplete final clause');
  object(trace.finalState, ['eventCount', 'clauseCount'], '$.finalState');
  if (trace.finalState.eventCount !== trace.events.length || trace.finalState.clauseCount !== clauseCount) fail('$.finalState', 'counts do not match observed events');
  return trace;
}

function firstDifference(expected, actual, path) {
  if (expected === actual) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null || Array.isArray(expected) !== Array.isArray(actual)) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected)) {
    const end = Math.min(expected.length, actual.length);
    for (let i = 0; i < end; i++) { const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`); if (diff) return diff; }
    return expected.length === actual.length ? null : { path: path + '.length', expected: expected.length, actual: actual.length };
  }
  if (expected && typeof expected === 'object') {
    if (Object.hasOwn(expected, 'kind') && expected.kind !== actual.kind) return { path: path + '.kind', expected: expected.kind, actual: actual.kind };
    for (const key of Object.keys(expected).sort()) { const diff = firstDifference(expected[key], actual[key], `${path}.${key}`); if (diff) return diff; }
    return null;
  }
  return { path, expected, actual };
}

export function compareTraces(expected, actual) {
  validateTrace(expected); validateTrace(actual);
  for (const key of ['schemaVersion', 'stage', 'caseId', 'reference', 'input', 'initialState']) {
    const diff = firstDifference(expected[key], actual[key], '$.' + key);
    if (diff) return { equal: false, kind: 'incompatible', ...diff };
  }
  const diff = firstDifference(expected.events, actual.events, '$.events') || firstDifference(expected.finalState, actual.finalState, '$.finalState');
  return diff ? { equal: false, kind: 'semantic', ...diff } : { equal: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node tools/compare/trace.mjs expected.json actual.json');
    const result = compareTraces(...process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8'))));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.equal ? 0 : 1;
  } catch (error) { console.error(JSON.stringify({ equal: false, kind: 'invalid', error: error.message })); process.exitCode = 2; }
}
