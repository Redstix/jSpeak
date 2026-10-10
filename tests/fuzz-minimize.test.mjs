import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { minimizeBytes } from '../tools/fuzz/minimize-bytes.mjs';

const fail = (signature = 'planted-marker', category = 'semantic') => ({ status: 'fail', category, signature });
const pass = { status: 'pass' };
const marker = bytes => Buffer.from(bytes).includes(Buffer.from([0, 127])) ? fail() : pass;

test('deterministic deletion reduction preserves planted NUL bug and reaches one-minimal bytes', async () => {
  const input = Uint8Array.of(9, 8, 7, 0, 127, 6, 5, 4);
  const first = await minimizeBytes(input, marker);
  const second = await minimizeBytes(input, marker);
  assert.deepEqual(first, second);
  assert.deepEqual(first.bytes, Uint8Array.of(0, 127));
  assert.deepEqual(marker(first.bytes), fail());
  assert.equal(first.reason, 'one-minimal'); assert.ok(first.accepted > 0);
  assert.deepEqual(input, Uint8Array.of(9, 8, 7, 0, 127, 6, 5, 4));
});

test('failure category and signature must both match the initial failure', async () => {
  const input = Uint8Array.of(1, 2);
  for (const alternate of [fail('other'), fail('same', 'trace')]) {
    const result = await minimizeBytes(input, bytes => bytes.length === 2 ? fail('same') : alternate);
    assert.deepEqual(result.bytes, input); assert.equal(result.accepted, 0);
  }
});

test('attempt budgets include baseline and return the same last verified failure', async () => {
  const input = Uint8Array.of(9, 0, 127, 8);
  const one = await minimizeBytes(input, marker, { maxAttempts: 1 });
  assert.equal(one.attempts, 1); assert.equal(one.reason, 'attempt-budget'); assert.deepEqual(one.bytes, input);
  const a = await minimizeBytes(input, marker, { maxAttempts: 3 });
  const b = await minimizeBytes(input, marker, { maxAttempts: 3 });
  assert.deepEqual(a, b); assert.equal(a.attempts, 3); assert.deepEqual(marker(a.bytes), fail());
});

test('passing input, infrastructure classifications and thrown predicate errors are refused', async () => {
  await assert.rejects(minimizeBytes(Uint8Array.of(1), () => pass), /does not reproduce/);
  await assert.rejects(minimizeBytes(Uint8Array.of(1), () => fail('ENOENT', 'infrastructure')), /infrastructure errors must throw/);
  await assert.rejects(minimizeBytes(Uint8Array.of(1), () => true), /Predicate must return/);
  const missing = new Error('ENOENT oracle executable');
  await assert.rejects(minimizeBytes(Uint8Array.of(1), () => { throw missing; }), error => error === missing);
  await assert.rejects(minimizeBytes(Uint8Array.of(1), bytes => {
    if (bytes.length) return fail(); throw missing;
  }), error => error === missing);
});

test('empty and all-byte inputs are preserved without Unicode interpretation by default', async () => {
  const empty = await minimizeBytes(new Uint8Array(), () => fail());
  assert.equal(empty.bytes.length, 0); assert.equal(empty.attempts, 1); assert.equal(empty.reason, 'one-minimal');
  const raw = await minimizeBytes(Uint8Array.of(255, 192, 0, 128), bytes => bytes.includes(0) ? fail() : pass);
  assert.deepEqual(raw.bytes, Uint8Array.of(0));
});

test('valid UTF-8 mode deletes complete encodings and rejects malformed initial input', async () => {
  const input = Buffer.from('xé\0界y');
  const encoded = Buffer.from('é');
  const result = await minimizeBytes(input, bytes => Buffer.from(bytes).includes(encoded) ? fail() : pass, { validUtf8: true });
  assert.deepEqual(Buffer.from(result.bytes), encoded); assert.equal(result.unit, 'utf8-scalars');
  await assert.rejects(minimizeBytes(Uint8Array.of(0xc0, 0xaf), () => fail(), { validUtf8: true }), /encoded data/);
});

test('predicate mutation cannot rewrite candidate or caller bytes', async () => {
  const input = Uint8Array.of(1, 2);
  const result = await minimizeBytes(input, bytes => { const length = bytes.length; bytes.fill(99); return length === 2 ? fail() : pass; });
  assert.deepEqual(input, Uint8Array.of(1, 2)); assert.deepEqual(result.bytes, input);
});

test('candidate timeout aborts work and returns last verified input; baseline timeout throws', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = Uint8Array.of(1);
  let signal;
  const pending = minimizeBytes(input, (bytes, context) => {
    if (bytes.length) return fail();
    signal = context.signal; return new Promise(() => {});
  }, { predicateTimeoutMs: 1000, timeoutMs: 60000 });
  for (let i = 0; i < 20 && !signal; i++) await Promise.resolve();
  assert.ok(signal); t.mock.timers.tick(1000);
  const result = await pending;
  assert.equal(result.reason, 'predicate-timeout'); assert.equal(signal.aborted, true); assert.deepEqual(result.bytes, input);
  const baseline = minimizeBytes(input, () => new Promise(() => {}), { timeoutMs: 60000, predicateTimeoutMs: 60000 });
  t.mock.timers.tick(60000);
  await assert.rejects(baseline, /time-budget/);
});

test('invalid capacities and oversized input are rejected before invoking predicate', async () => {
  for (const options of [{ maxAttempts: 0 }, { maxInputBytes: 1 }, { timeoutMs: NaN }, { predicateTimeoutMs: -1 }, { validUtf8: 'yes' }]) {
    let calls = 0;
    await assert.rejects(minimizeBytes(Uint8Array.of(1, 2), () => { calls++; return fail(); }, options));
    assert.equal(calls, 0);
  }
});

test('CLI executes explicit predicate module, writes replay bytes, and refuses output overwrite', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jspeak-minimize-'));
  try {
    const input = path.join(directory, 'input.bin'), predicate = path.join(directory, 'predicate.mjs'), output = path.join(directory, 'result.json');
    writeFileSync(input, Buffer.from([1, 0, 2]));
    writeFileSync(predicate, "const predicate = bytes => bytes.includes(0) ? {status:'fail',category:'trace',signature:'planted-null'} : {status:'pass'}; predicate.metadata = {fixture:true}; export default predicate;\n");
    const args = [path.resolve('tools/fuzz/minimize.mjs'), '--input', input, '--predicate', predicate, '--output', output];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.input.utf8Hex, '00'); assert.equal(report.failure.signature, 'planted-null');
    assert.deepEqual(report.predicate.metadata, { fixture: true }); assert.match(report.predicate.sha256, /^[0-9a-f]{64}$/);
    assert.equal(spawnSync(process.execPath, args, { timeout: 10000 }).status, 1);
    const oversized = spawnSync(process.execPath, [...args.slice(0, -1), path.join(directory, 'large.json'), '--max-input-bytes', '2'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(oversized.status, 1); assert.match(oversized.stderr, /within maxInputBytes/);
    const broken = path.join(directory, 'broken.mjs'); writeFileSync(broken, "throw new Error('missing oracle build');\n");
    const failed = spawnSync(process.execPath, [args[0], '--input', input, '--predicate', broken, '--output', path.join(directory, 'bad.json')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(failed.status, 1); assert.match(failed.stderr, /missing oracle build/);
  } finally { rmSync(directory, { recursive: true }); }
});
