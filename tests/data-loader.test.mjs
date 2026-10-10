import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProbe, fakeClock, memoryFile, descriptor, manifestFixture } from './helpers/probe.mjs';
const { createDataProbe } = await loadProbe('data-loader');
const { checkRange, asBytes } = await loadProbe('probe-io');

function setup(options = {}) {
  const clock = fakeClock();
  const small = Uint8Array.from({ length: 8193 }, (_, i) => i & 255);
  const big = Uint8Array.from({ length: 266777 }, (_, i) => (i * 17 + 31) & 255);
  const en = descriptor('en_dict', small);
  const phon = descriptor('phondata', big, [
    { id: 'cross', position: 32767, length: 2048 },
    { id: 'high', position: 262145, length: 2048 },
    { id: 'tail', position: big.length - 9, length: 9 }
  ]);
  const assets = manifestFixture([en, phon]);
  const fs = memoryFile(clock, { [en.uri]: small, [phon.uri]: big }, options);
  const rows = new Map(); const completed = []; const errors = [];
  const hooks = { row: (name, value) => rows.set(name, value), done: value => completed.push(value), error: value => errors.push(value) };
  return { clock, assets, fs, rows, completed, errors, hooks,
    job(mode) { return createDataProbe(fs.file, assets, mode, hooks, clock.env); } };
}

test('D1 whole verifies real-size reads and reports separate bounded costs', () => {
  const app = setup(); app.job('whole').start(); app.clock.drain();
  assert.match(app.rows.get('D1 whole phondata'), /PASS len=266777 hash32=/);
  assert.match(app.rows.get('D1 whole 计量'), /io=\d+ms hash=\d+ms assemble=0ms total=\d+ms maxHashCopy=\d+ms livePeak=266777B; heap不可测/);
  assert.match(app.completed[0], /^PASS/); assert.deepEqual(app.errors, []);
});

test('D1 scans every page, crosses page boundary, reads above 256KiB and observes exact EOF', () => {
  const app = setup(); app.job('scan').start(); app.clock.drain();
  assert.match(app.rows.get('D1 scan phondata'), /PASS pages=9 verifiedBytes=266777/);
  for (const range of ['cross', 'high', 'tail']) assert.match(app.rows.get('D1 phondata ' + range), /^PASS/);
  assert.equal(app.rows.get('D1 phondata EOF'), 'PASS empty at exact EOF');
  const high = app.fs.requests.find(row => row.args.position === 262145);
  assert.equal(high.args.length, 2048);
  assert.match(app.rows.get('D1 scan 计量'), /livePeak=32768B/);
});

test('D1 modes keep distinct metrics instead of overwriting a previous run summary', () => {
  const app = setup();
  app.job('whole').start(); app.clock.drain();
  const first = app.rows.get('D1 whole 计量');
  app.job('assemble').start(); app.clock.drain();
  assert.equal(app.rows.get('D1 whole 计量'), first);
  assert.match(app.rows.get('D1 assemble 计量'), /livePeak=/);
  assert.equal(app.rows.has('D1 计量'), false);
});

test('D1 residency and assembly hold verified candidate bytes simultaneously then release', () => {
  for (const mode of ['resident', 'assemble']) {
    const app = setup(); app.job(mode).start(); app.clock.drain();
    assert.match(app.completed[0], new RegExp('PASS; verifiedResident=' + app.assets.totalDataBytes + 'B; buffers released'));
    assert.match(app.rows.get('D1 ' + mode + ' phondata'), /^PASS/);
  }
});

test('D1 corrupt or short file fails its row without suppressing the independent next file', () => {
  const app = setup({ corruptRead: args => args.uri === '/common/espeak/en_dict.txt' });
  app.job('whole').start(); app.clock.drain();
  assert.match(app.rows.get('D1 whole en_dict'), /^FAIL hash32=/);
  assert.match(app.rows.get('D1 whole phondata'), /^PASS/);
  assert.match(app.completed[0], /^FAIL 1项/);
});

test('D1 cancel/timeout retains pending native I/O state and ignores late duplicate callbacks', () => {
  for (const timeout of [false, true]) {
    const app = setup(); let request;
    app.fs.file.readArrayBuffer = args => { request = args; };
    const job = app.job('whole'); job.start();
    if (timeout) app.clock.step(15000); else job.cancel();
    assert.equal(job.isPending(), true);
    request.success({ buffer: new Uint8Array(8193) }); request.fail('late', 300);
    assert.equal(job.isPending(), false); assert.equal(app.clock.timers.size, 0);
    assert.equal(app.completed.length, 0);
    assert.equal(app.errors.length, timeout ? 1 : 0);
  }
});

test('D1 rejects unknown manifest version and malformed ranges before reading', () => {
  const app = setup(); app.assets.schemaVersion = 999; app.job('whole').start();
  assert.match(app.errors[0], /incompatible data manifest/); assert.equal(app.fs.requests.length, 0);
  for (const [size, position, length] of [[5, -1, 1], [5, 4, 2], [5, 0, NaN], [NaN, 0, 0], [Infinity, 0, 0]]) {
    assert.throws(() => checkRange(size, position, length), /bounds/);
  }
  assert.doesNotThrow(() => checkRange(5, 5, 0));
  const bytes = new Uint8Array(4); assert.equal(asBytes({ buffer: bytes }), bytes);
  assert.equal(asBytes({ buffer: bytes.buffer }).length, 4);
});

test('D1 detects APIs ignoring offset/length and records raw EOF error separately', () => {
  const app = setup();
  app.fs.file.readArrayBuffer = args => app.clock.env.later(() => {
    const bytes = app.fs.files.get(args.uri);
    if (args.position === bytes.length) args.fail('position at EOF rejected', 300);
    else args.success({ buffer: bytes.slice() });
  }, 1);
  app.job('scan').start(); app.clock.drain();
  assert.match(app.rows.get('D1 scan phondata'), /FAIL page=0.*length=266777 expected=32768/);
  assert.match(app.rows.get('D1 en_dict EOF'), /OBSERVED 300 position at EOF rejected/);
  assert.match(app.completed[0], /^FAIL/);
});

test('D1 preflights checksum contracts, duplicate identities and ranges even for whole reads', () => {
  for (const change of [
    manifest => { manifest.magic = 'WRONG_MAGIC'; },
    manifest => { manifest.scope = 'wrong'; },
    manifest => { manifest.hash32Spec.seed = 1; },
    manifest => { manifest.pageBytes = 7; },
    manifest => { manifest.upstreamCommit = 'bad'; },
    manifest => { manifest.files.push(manifest.files[0]); manifest.totalDataBytes += manifest.files[0].byteLength; },
    manifest => { manifest.files[1].uri = manifest.files[0].uri; },
    manifest => { manifest.files[0].pages[0].position = 1; },
    manifest => { manifest.files[1].windows[0].length = manifest.files[1].byteLength; }
  ]) {
    const app = setup(); change(app.assets); app.job('whole').start();
    assert.equal(app.errors.length, 1); assert.equal(app.fs.requests.length, 0);
    assert.equal(app.completed.length, 0);
  }
});
