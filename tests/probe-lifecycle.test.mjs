import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadProbe, descriptor, wavFixture, manifestFixture } from './helpers/probe.mjs';
const dataProbe = await loadProbe('data-loader');
const wavProbe = await loadProbe('wav-file');
const tiny = Uint8Array.from({ length: 8193 }, (_, i) => i & 255);
const enAsset = descriptor('en_dict', tiny);
const audioFixture = wavFixture();
const DATA_ASSETS = { ...manifestFixture([enAsset]), closureComplete: false, audio: audioFixture.asset };

async function load(name) {
  const source = readFileSync(new URL('../apps/vela-probe/src/' + name + '.js', import.meta.url), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const probe = await load('probe');
let stamp;
try { stamp = await load('build-stamp'); } catch { stamp = { BUILD_STAMP: 'STAMP-MISSING' }; }

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
    ...probe, ...stamp, DATA_ASSETS,
    audio,
    file,
    device: { getInfo(request) { deviceRequest = request; } },
    computeSlice(seed, count) { now += 2; return probe.computeSlice(seed, count); },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: { now: () => now },
    Math
  };
  const environment = { now: () => now, later: context.setTimeout, clear: context.clearTimeout };
  context.createDataProbe = (file, assets, mode, hooks) => dataProbe.createDataProbe(file, assets, mode, hooks, environment);
  context.createWavProbe = (file, asset, mode, uri, hooks) => wavProbe.createWavProbe(file, asset, mode, uri, hooks, environment);
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
  assert.match(app.result('UI / 版本'), /^READY 0\.4\.1 B\d{6}T\d{6} \/ API1200 target$/);
});

test('D1 cancelled native read blocks replacement until callback and ignores late results', () => {
  const app = mount();
  app.page.checkLoad();
  const previous = app.requests.readArrayBuffer[0];
  app.page.checkScan();
  assert.match(app.result('D1 scan'), /^BUSY/);
  assert.equal(app.requests.readArrayBuffer.length, 1);
  previous.success({ buffer: tiny });
  assert.match(app.result('D1 whole'), /CANCELLED/);
  app.page.checkLoad();
  assert.equal(app.requests.readArrayBuffer.length, 2);
  previous.fail('late', 300);
  assert.equal(app.result('D1 whole'), 'RUNNING');
  app.page.stopAll();
});

test('D1 timeout reports failure but native operation still blocks new runs', () => {
  const app = mount(); app.page.checkLoad();
  app.fire(15000);
  assert.match(app.result('D1 whole'), /FAIL.*timeout.*native I\/O still pending/);
  app.page.checkLoad(); assert.match(app.result('D1 whole'), /^BUSY/);
  app.requests.readArrayBuffer[0].fail('late', 300);
  app.page.checkLoad(); assert.equal(app.requests.readArrayBuffer.length, 2);
  app.page.stopAll();
});

test('D1 finishing clears timers and reports scoped memory measurement', () => {
  const app = mount(); app.page.checkResident();
  app.requests.readArrayBuffer[0].success({ buffer: tiny });
  for (let n = 0; n < 4; n++) app.fire(10);
  assert.match(app.result('D1 resident'), /PASS; verifiedResident=8193B; buffers released/);
  assert.match(app.result('D1 resident 计量'), /heap不可测/);
  assert.equal(app.timers.size, 0);
});

test('A1 requires explicit action, verifies source, and ignores stale playback events after hide', () => {
  const app = mount(); assert.equal(app.plays(), 0);
  app.page.playPackaged(); assert.equal(app.plays(), 0);
  app.requests.readArrayBuffer[0].success({ buffer: audioFixture.bytes });
  for (let n = 0; n < 10; n++) app.fire(10);
  assert.equal(app.plays(), 1); assert.equal(app.audio.src, DATA_ASSETS.audio.uri);
  const late = app.audio.onended;
  app.audio.onplay(); assert.match(app.result('A1 packaged 播放'), /EVENT onplay/);
  app.page.onHide(); late();
  assert.equal(app.result('A1 packaged'), 'CANCELLED');
  assert.equal(app.timers.size, 0); assert.equal(app.audio.onended, null);
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
