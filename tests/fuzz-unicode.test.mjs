import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { minimizeBytes } from '../tools/fuzz/minimize-bytes.mjs';
import { createUnicodeDecodePredicate } from '../tools/fuzz/unicode-decode-predicate.mjs';
import { jsDecode } from '../tools/build-unicode/verify.mjs';
import { unicodeBinary } from '../tools/oracle/unicode-build-info.mjs';

const fixtureOracle = request => ({ schemaVersion: 1, reference: { profile: 'utf8-unicode-v1',
  upstreamCommit: 'a'.repeat(40), traceFingerprint: 'b'.repeat(64), helperFingerprint: 'c'.repeat(64) },
  request: { ...request, classify: [], dotlessI: false }, classifications: [],
  decode: jsDecode(Buffer.from(request.utf8Hex, 'hex'), request.termination) });
function plantedDecode(bytes, termination) {
  const result = jsDecode(bytes, termination);
  for (const step of result.steps) if (step.codepoint === 65) { step.codepoint = 66; step.peekBefore = 66; }
  return result;
}

test('Unicode adapter matching valid observations pass; injected field error is reducible with stable signature', async () => {
  const normal = createUnicodeDecodePredicate({ oracle: fixtureOracle });
  assert.deepEqual(normal(Buffer.from('xxAyy')), { status: 'pass' });
  const planted = createUnicodeDecodePredicate({ oracle: fixtureOracle, decode: plantedDecode });
  const first = planted(Buffer.from('xxAyy'));
  assert.deepEqual(first, { status: 'fail', category: 'semantic', signature: 'unicode-decode/c-string/steps.codepoint' });
  const result = await minimizeBytes(Buffer.from('xxAyy'), planted);
  assert.equal(Buffer.from(result.bytes).toString('hex'), '41');
  assert.equal(result.failure.signature, first.signature);
  assert.equal(planted.metadata.reference.upstreamCommit, 'a'.repeat(40));
  assert.ok(planted.metadata.javascript.some(item => item.path.endsWith('/unicode.js') && /^[0-9a-f]{64}$/.test(item.sha256)));
  assert.equal(planted.metadata.testInjection, true);
});

test('Unicode adapter refuses invocation/schema errors and unsupported modes rather than shrinking them', async () => {
  const infrastructure = new Error('ENOENT fixed C helper');
  const missing = createUnicodeDecodePredicate({ oracle() { throw infrastructure; } });
  await assert.rejects(minimizeBytes(Buffer.from('A'), missing), error => error === infrastructure);
  const invalid = createUnicodeDecodePredicate({ oracle: fixtureOracle, decode(bytes, mode) {
    const value = jsDecode(bytes, mode); value.steps[0].offsetAfter = -1; return value;
  } });
  await assert.rejects(minimizeBytes(Buffer.from('A'), invalid), /schema\/cursor/);
  const malformed = createUnicodeDecodePredicate({ oracle: () => ({ schemaVersion: 2 }) });
  assert.throws(() => malformed(Buffer.from('A')), /schema|envelope/);
  assert.throws(() => createUnicodeDecodePredicate({ termination: 'guess', oracle: fixtureOracle }), /termination/);
  const controller = new AbortController(); controller.abort(infrastructure);
  assert.throws(() => createUnicodeDecodePredicate({ oracle: fixtureOracle })(Buffer.from('A'), { signal: controller.signal }), error => error === infrastructure);
  let calls = 0;
  const changedReference = createUnicodeDecodePredicate({ oracle(request) {
    const result = fixtureOracle(request); if (calls++) result.reference.helperFingerprint = 'd'.repeat(64); return result;
  }, decode: plantedDecode });
  await assert.rejects(minimizeBytes(Buffer.from('xA'), changedReference), /C reference changed/);
});

test('Unicode adapter preserves explicit NUL and bounded modes', () => {
  for (const termination of ['c-string', 'nul-terminated', 'bounded']) {
    const predicate = createUnicodeDecodePredicate({ termination, oracle: fixtureOracle });
    for (const hex of ['', '00', '410042', 'c2a9', 'efbfbd', 'e18041', 'ff']) assert.deepEqual(predicate(Buffer.from(hex, 'hex')), { status: 'pass' });
  }
});

test('real fixed C helper matches; deliberate JS field mutation is detected and minimized', {
  skip: existsSync(unicodeBinary) ? false : 'Build the fixed Unicode C helper to run this integration test'
}, async () => {
  const normal = createUnicodeDecodePredicate();
  assert.deepEqual(normal(Buffer.from('noise A tail')), { status: 'pass' });
  const planted = createUnicodeDecodePredicate({ decode: plantedDecode });
  const result = await minimizeBytes(Buffer.from('noise A tail'), planted, { predicateTimeoutMs: 5000, timeoutMs: 30000 });
  assert.equal(Buffer.from(result.bytes).toString('hex'), '41');
  assert.equal(result.failure.signature, 'unicode-decode/c-string/steps.codepoint');
});
