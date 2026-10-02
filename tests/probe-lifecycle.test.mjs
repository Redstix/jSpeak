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

function mount() {
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
  for (const method of ['get', 'writeArrayBuffer', 'readArrayBuffer', 'delete']) {
    file[method] = request => { (requests[method] ||= []).push(request); };
  }
  const context = {
    ...probe, ...tone, ...scratch,
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

test('resource matrix records per-case failures and continues to completion', () => {
  const app = mount();
  app.page.checkFile();
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[1].success({});
  app.requests.readArrayBuffer[2].fail('invalid file type', 202);
  assert.match(app.result('包内 .bin'), /FAIL 202 invalid file type/);
  assert.match(app.result('包内 .dat'), /FAIL verify/);
  assert.match(app.result('资源对照'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('resource timeout advances once and ignores late result', () => {
  const app = mount();
  app.page.checkFile();
  const old = app.requests.readArrayBuffer[0];
  app.fire(3000);
  old.fail('late', 202);
  assert.equal(app.requests.readArrayBuffer.length, 2);
  assert.match(app.result('包内 .bin'), /timeout/);
  app.page.stopAll();
  assert.equal(app.timers.size, 0);
});

test('timeout stops work, records failure and ignores late audio events', () => {
  const app = mount();
  app.page.playTone();
  const ended = app.audio.onended;
  app.fire(10000);
  assert.match(app.result('音频'), /FAIL timeout/);
  ended();
  assert.match(app.result('音频'), /FAIL timeout/);
  assert.equal(app.audio.onended, null);
  assert.equal(app.timers.size, 0);
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

test('generated playback requires write and verified readback before playing', () => {
  const app = mount();
  app.page.playGenerated();
  for (let i = 0; i < 63; i++) app.fire(1);
  assert.equal(app.plays(), 0);
  app.requests.get[0].fail('missing', 301);
  const write = app.requests.writeArrayBuffer[0];
  assert.equal(write.buffer.length, 64044);
  write.success();
  assert.equal(app.plays(), 0);
  app.requests.readArrayBuffer[0].success({ buffer: write.buffer.slice() });
  assert.equal(app.plays(), 1);
  assert.match(app.audio.src, /^internal:\/\/files\/jspeak-probe-020-.*\.wav$/);
  assert.equal(app.requests.delete, undefined);
  app.audio.onended();
  assert.match(app.result('JS双音'), /ENDED/);
  assert.equal(app.requests.delete.length, 1);
  app.requests.delete[0].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
});

test('cancelled write never plays, prevents concurrent scratch I/O and deletes after return', () => {
  const app = mount();
  app.page.checkInternal();
  app.requests.get[0].fail('missing', 301);
  app.page.stopAll();
  app.page.playGenerated();
  assert.match(app.result('JS双音'), /^BUSY/);
  assert.equal(app.timers.size, 0);
  app.requests.writeArrayBuffer[0].success();
  assert.equal(app.plays(), 0);
  assert.equal(app.requests.readArrayBuffer, undefined);
  app.requests.delete[0].success();
  app.page.playGenerated();
  assert.equal(app.timers.size, 2);
});
