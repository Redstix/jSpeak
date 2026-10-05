import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

async function load(name) {
  const source = readFileSync(new URL('../apps/vela-probe/src/' + name + '.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const probe = await load('probe');
const tone = await load('tone');
const scratch = await load('scratch-file');
let stamp;
try { stamp = await load('build-stamp'); } catch { stamp = { BUILD_STAMP: 'STAMP-MISSING' }; }
const BIN_TXT = new Uint8Array(readFileSync(new URL('../apps/vela-probe/src/common/bin.txt', import.meta.url)));
const BIG_TXT = new Uint8Array(readFileSync(new URL('../apps/vela-probe/src/common/big.txt', import.meta.url)));
const PROBE_BIN = new Uint8Array(readFileSync(new URL('../apps/vela-probe/src/common/probe.bin', import.meta.url)));

function mount(options) {
  const ux = readFileSync(new URL('../apps/vela-probe/src/pages/index/index.ux', import.meta.url), 'utf8');
  const script = ux.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =');
  const timers = new Map();
  let nextId = 0;
  let now = 1000;
  let deviceRequest;
  const requests = {};
  let stops = 0;
  let plays = 0;
  const audio = { stop() { stops++; }, play() { plays++; } };
  const file = {};
  const methods = ['get', 'writeArrayBuffer', 'readArrayBuffer', 'delete', 'readText', 'access', 'copy'];
  for (const method of methods) {
    if (options && options.omit && options.omit.includes(method)) continue;
    file[method] = request => { (requests[method] ||= []).push(request); };
  }
  const context = {
    ...probe, ...tone, ...scratch, ...stamp,
    audio,
    file,
    device: { getInfo(request) { deviceRequest = request; } },
    computeSlice(seed, count) { now += 2; return probe.computeSlice(seed, count); },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: { now: () => now },
    Math
  };
  vm.runInNewContext(script, context);
  const page = context.component;
  page.results = Array.from(page.private.results);
  page.onInit();
  return {
    page, audio, timers, requests,
    deviceRequest: () => deviceRequest,
    stops: () => stops,
    plays: () => plays,
    result: label => page.results.find(row => row.label === label)?.value,
    fire(delay) {
      const pair = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(pair, 'Missing timer: ' + delay);
      const [id, timer] = pair;
      timers.delete(id);
      now += delay;
      timer.fn();
    }
  };
}

test('cancelled device callback cannot overwrite a new result', () => {
  const app = mount();
  app.page.checkDevice();
  const oldRequest = app.deviceRequest();
  app.page.stopAll();
  oldRequest.success({ model: 'late' });
  assert.equal(app.result('设备'), 'CANCELLED');
  assert.match(app.result('会话'), /STOPPED/);
  assert.equal(app.timers.size, 0);
});

test('first terminal callback wins and releases watchdog', () => {
  const app = mount();
  app.page.checkDevice();
  const request = app.deviceRequest();
  request.success({ model: 'test', osVersionName: '1', platformVersionCode: 1200 });
  const result = app.result('设备');
  request.fail('late failure', 300);
  assert.equal(app.result('设备'), result);
  assert.equal(app.timers.size, 0);
});

test('version header embeds the build stamp', () => {
  const app = mount();
  assert.match(app.result('UI / 版本'), /^READY 0\.3\.1 B\d{6}T\d{6} \/ API1200 target$/);
});

test('load matrix happy path records all six rows, verifies both copies and cleans up', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].success({ buffer: BIN_TXT.slice() });
  assert.match(app.result('C1 bin.txt直读'), new RegExp('PASS len=65536 hash=' + probe.PROBE_BIN_HASH));
  app.requests.readArrayBuffer[1].success({ buffer: BIG_TXT.slice() });
  assert.match(app.result('C2 big.txt直读'), new RegExp('PASS len=262144 hash=' + probe.BIG_TXT_HASH));
  const partial = app.requests.readArrayBuffer[2];
  assert.equal(partial.position, 1024);
  assert.equal(partial.length, 2048);
  partial.success({ buffer: BIN_TXT.slice(1024, 3072) });
  assert.match(app.result('C3 包内部分读'), new RegExp('PASS hash=' + probe.SLICE_HASH));
  app.requests.get[0].fail('missing', 301);
  assert.equal(app.requests.copy.length, 1);
  assert.equal(app.requests.copy[0].srcUri, '/common/bin.txt');
  assert.match(app.requests.copy[0].dstUri, /^internal:\/\/files\/jspeak-probe-031-.*-1-c1\.bin$/);
  const dstC4 = app.requests.copy[0].dstUri;
  app.requests.copy[0].success();
  assert.match(app.result('C4 copy'), new RegExp('PASS ' + dstC4));
  app.requests.readArrayBuffer[3].success({ buffer: BIN_TXT.slice() });
  assert.match(app.result('C4 读回'), new RegExp('PASS hash=' + probe.PROBE_BIN_HASH));
  assert.match(app.result('C4 copy .txt源'), new RegExp('PASS hash=' + probe.PROBE_BIN_HASH));
  assert.equal(app.requests.delete[0].uri, dstC4);
  app.requests.delete[0].success();
  assert.match(app.result('C4 清理'), /^PASS/);
  app.requests.get[1].fail('missing', 301);
  assert.equal(app.requests.copy.length, 2);
  assert.equal(app.requests.copy[1].srcUri, '/common/probe.bin');
  assert.match(app.requests.copy[1].dstUri, /^internal:\/\/files\/jspeak-probe-031-.*-2-c2\.bin$/);
  const dstC5 = app.requests.copy[1].dstUri;
  app.requests.copy[1].success();
  assert.match(app.result('C5 copy'), new RegExp('PASS ' + dstC5));
  app.requests.readArrayBuffer[4].success({ buffer: PROBE_BIN.slice() });
  assert.match(app.result('C5 读回'), new RegExp('PASS hash=' + probe.PROBE_BIN_HASH));
  assert.equal(app.requests.delete[1].uri, dstC5);
  app.requests.delete[1].success();
  assert.match(app.result('C5 清理'), /^PASS/);
  app.requests.access[0].success({ exists: true });
  assert.match(app.result('C6 access .txt'), /PASS exists=true/);
  assert.match(app.result('装载判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('load matrix records failures per row and C4 failure does not skip C5', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  assert.match(app.result('C1 bin.txt直读'), /FAIL 202 invalid file type/);
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  assert.match(app.result('C2 big.txt直读'), /FAIL 202/);
  app.requests.readArrayBuffer[2].fail('invalid file type', 202);
  assert.match(app.result('C3 包内部分读'), /FAIL 202/);
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].fail('InternalError: invalid parameter', 'JS');
  assert.match(app.result('C4 copy .txt源'), /FAIL copy JS InternalError: invalid parameter/);
  assert.equal(app.requests.delete[0].uri, app.requests.copy[0].dstUri);
  app.requests.delete[0].fail('missing', 301);
  assert.match(app.result('C4 清理'), /leftover: internal:/);
  assert.match(app.result('C5 copy .bin源'), /RUNNING/);
  app.requests.get[1].fail('missing', 301);
  app.requests.copy[1].fail('invalid file type', 202);
  assert.match(app.result('C5 copy .bin源'), /FAIL copy 202 invalid file type/);
  app.requests.delete[1].success();
  assert.match(app.result('C5 清理'), /^PASS/);
  app.requests.access[0].fail('InternalError: invalid parameter :path', '');
  assert.match(app.result('C6 access .txt'), /InternalError: invalid parameter :path/);
  assert.match(app.result('装载判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('missing copy/access members are caught per row and C4 failure does not skip C5', () => {
  const app = mount({ omit: ['copy', 'access'] });
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].success({ buffer: BIN_TXT.slice() });
  app.requests.readArrayBuffer[1].success({ buffer: BIG_TXT.slice() });
  app.requests.readArrayBuffer[2].success({ buffer: BIN_TXT.slice(1024, 3072) });
  app.requests.get[0].fail('missing', 301);
  assert.match(app.result('C4 copy .txt源'), /UNSUPPORTED copy/);
  assert.equal(app.requests.delete[0].uri, app.requests.get[0].uri);
  app.requests.delete[0].fail('missing', 301);
  assert.match(app.result('C4 清理'), /leftover: internal:/);
  app.requests.get[1].fail('missing', 301);
  assert.match(app.result('C5 copy .bin源'), /UNSUPPORTED copy/);
  app.requests.delete[1].success();
  assert.match(app.result('C6 access .txt'), /FAIL TypeError.*access/);
  assert.match(app.result('装载判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('C4 read-back hash mismatch records failure and still removes the copy', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].success({ buffer: BIN_TXT.slice() });
  app.requests.readArrayBuffer[1].success({ buffer: BIG_TXT.slice() });
  app.requests.readArrayBuffer[2].success({ buffer: BIN_TXT.slice(1024, 3072) });
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].success();
  const wrong = BIN_TXT.slice(); wrong[0] ^= 1;
  app.requests.readArrayBuffer[3].success({ buffer: wrong });
  assert.match(app.result('C4 读回'), /FAIL hash 不符 len=65536/);
  assert.match(app.result('C4 copy .txt源'), /FAIL hash 不符/);
  assert.equal(app.requests.delete[0].uri, app.requests.copy[0].dstUri);
  app.requests.delete[0].success();
  assert.match(app.result('C4 清理'), /^PASS/);
  app.requests.get[1].fail('missing', 301);
  app.requests.copy[1].success();
  app.requests.readArrayBuffer[4].success({ buffer: PROBE_BIN.slice() });
  assert.match(app.result('C5 读回'), new RegExp('PASS hash=' + probe.PROBE_BIN_HASH));
  app.requests.delete[1].success();
  app.requests.access[0].success({ exists: false });
  assert.match(app.result('C6 access .txt'), /PASS exists=false/);
  assert.match(app.result('装载判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('per-row timeout advances the load matrix and late callbacks are ignored', () => {
  const app = mount();
  app.page.checkLoad();
  const late = app.requests.readArrayBuffer[0];
  app.fire(3000);
  assert.match(app.result('C1 bin.txt直读'), /FAIL timeout 3s/);
  late.fail('late', 202);
  assert.match(app.result('C1 bin.txt直读'), /FAIL timeout 3s/);
  assert.equal(app.requests.readArrayBuffer.length, 2);
  app.fire(5000);
  assert.match(app.result('C2 big.txt直读'), /FAIL timeout 5s/);
  app.page.stopAll();
  assert.equal(app.timers.size, 0);
});

test('cancel during copy waits for the in-flight callback then deletes the copy product', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  app.requests.readArrayBuffer[2].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  app.page.stopAll();
  assert.match(app.result('装载判别'), /CANCELLED/);
  assert.equal(app.requests.delete, undefined);
  app.requests.copy[0].success();
  assert.equal(app.requests.delete.length, 1);
  assert.equal(app.requests.delete[0].uri, app.requests.copy[0].dstUri);
  app.requests.delete[0].success();
  assert.match(app.result('C4 清理'), /^PASS/);
  assert.equal(app.timers.size, 0);
});

test('cancel during read-back deletes the copy product and ignores the late verify', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  app.requests.readArrayBuffer[2].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].success();
  const read = app.requests.readArrayBuffer[3];
  app.page.stopAll();
  assert.equal(app.requests.delete.length, 1);
  assert.equal(app.requests.delete[0].uri, app.requests.copy[0].dstUri);
  read.success({ buffer: BIN_TXT.slice() });
  assert.match(app.result('C4 读回'), /WAITING/);
  app.requests.delete[0].success();
  assert.match(app.result('C4 清理'), /^PASS/);
  assert.equal(app.timers.size, 0);
});

test('in-flight copy I/O blocks a new run with BUSY', () => {
  const app = mount();
  app.page.checkLoad();
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  app.requests.readArrayBuffer[2].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  app.page.checkLoad();
  assert.match(app.result('装载判别'), /^BUSY/);
  app.requests.copy[0].success();
  assert.equal(app.requests.delete.length, 1);
  app.requests.delete[0].success();
  assert.match(app.result('C4 清理'), /^PASS/);
});

test('hide/destroy cancel compute and clear playback callbacks', () => {
  for (const lifecycle of ['onHide', 'onDestroy']) {
    const app = mount();
    app.page.checkCompute();
    assert.equal(app.timers.size, 2);
    app.page[lifecycle]();
    assert.equal(app.timers.size, 0);
    assert.equal(app.audio.onplay, null);
    assert.ok(app.stops() >= 2);
  }
});

test('compute reports pure time separately and verifies checksum after 32 slices', () => {
  const app = mount();
  app.page.checkCompute();
  for (let i = 0; i < 32; i++) app.fire(10);
  assert.match(app.result('计算'), /DONE 65536 ops/);
  assert.match(app.result('计算 #1'), /PASS hash=437906867/);
  assert.match(app.result('计算 #1 分片'), /sum=64ms; max=2ms; firstWait=10ms/);
  assert.match(app.result('计算 #1 后续等待'), /p50=10ms; p95=10ms; max=10ms/);
  assert.equal(app.timers.size, 0);
});
