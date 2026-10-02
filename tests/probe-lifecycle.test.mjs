import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function mount() {
  const ux = readFileSync(new URL('../apps/vela-probe/src/pages/index/index.ux', import.meta.url), 'utf8');
  const script = ux.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =');
  const timers = new Map();
  let nextId = 0;
  let deviceRequest;
  let fileRequest;
  let stops = 0;
  const audio = { stop() { stops++; }, play() {} };
  const context = {
    audio,
    device: { getInfo(request) { deviceRequest = request; } },
    file: { readArrayBuffer(request) { fileRequest = request; } },
    capabilities: () => [],
    computeSlice: (seed, count) => seed + count,
    validateResource: data => data && data.length === 65536,
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date,
    Math
  };
  vm.runInNewContext(script, context);
  const page = context.component;
  page.results = Array.from(page.private.results);
  page.onInit();
  return {
    page, audio, timers,
    deviceRequest: () => deviceRequest,
    fileRequest: () => fileRequest,
    stops: () => stops,
    result: label => page.results.find(row => row.label === label)?.value,
    fire(delay) {
      const [id, timer] = [...timers].find(([, timer]) => timer.delay === delay);
      timers.delete(id);
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

test('file callback handles corrupt or missing buffer as failure', () => {
  const app = mount();
  app.page.checkFile();
  app.fileRequest().success({});
  assert.match(app.result('资源'), /^FAIL/);
});

test('timeout stops work, records failure and ignores late events', () => {
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

test('compute terminates after exactly 32 bounded slices', () => {
  const app = mount();
  app.page.checkCompute();
  for (let i = 0; i < 32; i++) app.fire(10);
  assert.match(app.result('计算'), /DONE 65536 ops/);
  assert.equal(app.timers.size, 0);
});
