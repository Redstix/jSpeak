import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProbe, fakeClock, memoryFile, wavFixture } from './helpers/probe.mjs';
const { createWavProbe, validateOracleWav } = await loadProbe('wav-file');
const DEST = 'internal://files/test-owned.wav';

function setup(options = {}, byteLength = 40044) {
  const clock = fakeClock(); const fixture = wavFixture(byteLength);
  const fs = memoryFile(clock, { [fixture.asset.dataUri]: fixture.bytes }, options);
  const rows = new Map(); const errors = []; const ready = []; const cleaned = [];
  const hooks = { row: (name, value) => rows.set(name, value), error: value => errors.push(value),
    ready: value => ready.push(value), cleanup: value => cleaned.push(value) };
  return { clock, fixture, fs, rows, errors, ready, cleaned,
    job(mode) { return createWavProbe(fs.file, fixture.asset, mode, DEST, hooks, clock.env); } };
}

test('A1 append/position/buffered verify all bytes before ready and clean only owned file', () => {
  for (const mode of ['append', 'position', 'buffered']) {
    const app = setup(); const job = app.job(mode); job.start(); app.clock.drain();
    assert.deepEqual(app.errors, []); assert.deepEqual(app.ready, [DEST]);
    assert.deepEqual(app.fs.files.get(DEST), app.fixture.bytes);
    assert.match(app.rows.get('readback'), /^PASS all 40044 bytes equal/);
    const writes = app.fs.requests.filter(row => row.method === 'writeArrayBuffer');
    assert.equal(writes.length, mode === 'buffered' ? 1 : 5);
    assert.ok(writes.every(row => row.args.buffer instanceof Uint8Array));
    if (mode !== 'buffered') {
      assert.ok(writes.every(row => row.args.buffer.length <= 16384));
      assert.equal(writes[1].args.append, mode === 'append');
      assert.equal(writes[1].args.position, mode === 'append' ? undefined : 44);
      assert.equal(writes.at(-1).args.position, 0);
      assert.equal(writes.at(-1).args.append, false);
    }
    job.cancel(); app.clock.drain();
    assert.equal(app.fs.files.has(DEST), false); assert.equal(app.fs.files.has(app.fixture.asset.dataUri), true);
    assert.deepEqual(app.cleaned, ['PASS removed owned file']);
  }
});

test('whole-backing bridge hypothesis reproduces the two 0.4.0 OCR lengths', () => {
  for (const [mode, expectedLength] of [['append', 139316], ['position', 79236]]) {
    const app = setup({ wholeBackingWrite: true }, 46424);
    const source = app.fixture.bytes;
    const requests = [{ buffer: new Uint8Array(44), append: false, position: 0 }];
    for (let offset = 44; offset < source.length; offset += 16384) {
      requests.push({ buffer: source.subarray(offset, Math.min(offset + 16384, source.length)),
        append: mode === 'append', position: mode === 'append' ? undefined : offset });
    }
    requests.push({ buffer: source.subarray(0, 44), append: false, position: 0 });
    for (const request of requests) {
      app.fs.file.writeArrayBuffer({ uri: DEST, ...request, success() {}, fail() { assert.fail('unexpected write failure'); } });
      app.clock.drain();
    }
    assert.equal(app.fs.files.get(DEST).length, expectedLength);
  }
});

test('A1 writes exact backing stores even when the native bridge ignores view boundaries', () => {
  for (const mode of ['append', 'position', 'buffered']) {
    const app = setup({ wholeBackingWrite: true }, 46424);
    const job = app.job(mode); job.start(); app.clock.drain();
    assert.deepEqual(app.errors, []); assert.deepEqual(app.ready, [DEST]);
    assert.deepEqual(app.fs.files.get(DEST), app.fixture.bytes);
    const writes = app.fs.requests.filter(row => row.method === 'writeArrayBuffer');
    for (const { args } of writes) {
      assert.equal(args.buffer.byteOffset, 0);
      assert.equal(args.buffer.byteLength, args.buffer.buffer.byteLength);
    }
    assert.deepEqual(writes.map(row => row.args.buffer.length), mode === 'buffered' ? [46424] : [44, 16384, 16384, 13612, 44]);
    assert.match(app.rows.get('write'), /^ACK/);
    job.cancel(); app.clock.drain(); assert.equal(app.fs.files.has(DEST), false);
  }
});

test('A1 header overwrite truncation is detected and never reaches playback', () => {
  const app = setup({ truncate: true }); app.job('append').start(); app.clock.drain();
  assert.match(app.errors[0], /readback len=44 expected=40044/);
  assert.deepEqual(app.ready, []); assert.equal(app.fs.files.has(DEST), false);
});

test('A1 packaged action verifies source metadata/hash without writing a file', () => {
  const app = setup(); app.job('packaged').start(); app.clock.drain();
  assert.deepEqual(app.ready, ['/oracle.wav']);
  assert.equal(app.fs.requests.length, 1); assert.deepEqual(app.cleaned, []);
});

test('A1 rejects wrong sample rate and corruption before writes or playback', () => {
  const app = setup(); new DataView(app.fixture.bytes.buffer).setUint32(24, 16000, true);
  assert.throws(() => validateOracleWav(app.fixture.bytes, app.fixture.asset), /format/);
  app.job('buffered').start(); app.clock.drain();
  assert.deepEqual(app.ready, []); assert.equal(app.fs.requests.length, 1);
  const corrupt = setup({ corruptRead: () => true }); corrupt.job('buffered').start(); corrupt.clock.drain();
  assert.match(corrupt.errors[0], /source hash32/); assert.deepEqual(corrupt.ready, []);
});

test('A1 existing target is never overwritten or deleted', () => {
  const app = setup(); const original = Uint8Array.of(9, 8, 7); app.fs.files.set(DEST, original);
  const job = app.job('append'); job.start(); app.clock.drain(); job.cancel();
  assert.match(app.errors[0], /target exists/); assert.equal(app.fs.files.get(DEST), original);
  assert.equal(app.fs.requests.some(row => ['writeArrayBuffer', 'delete'].includes(row.method)), false);
});

test('A1 cancellation during native write waits for real callback before cleanup', () => {
  const app = setup(); let request;
  app.fs.file.writeArrayBuffer = args => { request = args; };
  const job = app.job('append'); job.start();
  while (!request) app.clock.step(Math.min(...[...app.clock.timers.values()].map(value => value.delay)));
  job.cancel(); assert.equal(job.isPending(), true); assert.equal(app.cleaned.length, 0);
  request.success({}); assert.equal(job.isPending(), true); // deletion now pending
  app.clock.drain(); assert.equal(job.isPending(), false); assert.deepEqual(app.ready, []);
  assert.deepEqual(app.cleaned, ['PASS removed owned file']);
  request.success({}); assert.equal(app.cleaned.length, 1);
});

test('A1 readback corruption and partial write failure clean their owned products', () => {
  for (const options of [
    { corruptRead: args => args.uri === DEST },
    { fail: (method, args) => method === 'writeArrayBuffer' && args.append }
  ]) {
    const app = setup(options); app.job('append').start(); app.clock.drain();
    assert.equal(app.errors.length, 1); assert.deepEqual(app.ready, []);
    assert.equal(app.fs.files.has(DEST), false); assert.equal(app.cleaned.length, 1);
  }
});

test('A1 timed-out write stays pending and repeated cancel preserves cleanup watchdog', () => {
  const app = setup(); let request;
  app.fs.file.writeArrayBuffer = args => { request = args; };
  let deletion;
  app.fs.file.delete = args => { deletion = args; };
  const job = app.job('append'); job.start();
  while (!request) app.clock.step(Math.min(...[...app.clock.timers.values()].map(value => value.delay)));
  app.clock.step(15000); assert.equal(job.isPending(), true);
  assert.match(app.errors[0], /writeArrayBuffer timeout/);
  request.fail('late failure', 300); assert.ok(deletion); assert.equal(job.isPending(), true);
  job.cancel(); app.clock.step(15000);
  assert.match(app.cleaned[0], /delete timeout; leftover:/);
  deletion.success(); assert.equal(job.isPending(), false);
  assert.equal(app.cleaned.at(-1), 'PASS removed owned file'); assert.deepEqual(app.ready, []);
});

test('A1 missing APIs fail explicitly; already-absent owned file is clean after write failure', () => {
  const missing = setup(); delete missing.fs.file.readArrayBuffer;
  missing.job('append').start();
  assert.match(missing.errors[0], /UNSUPPORTED readArrayBuffer/);
  assert.deepEqual(missing.ready, []);
  const app = setup(); delete app.fs.file.writeArrayBuffer;
  app.fs.file.delete = args => app.clock.env.later(() => args.fail('missing', 301), 1);
  app.job('append').start(); app.clock.drain();
  assert.match(app.errors[0], /UNSUPPORTED writeArrayBuffer/);
  assert.deepEqual(app.cleaned, ['PASS owned file already absent (301)']);
});
