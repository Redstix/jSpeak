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
const TXT = readFileSync(new URL('../apps/vela-probe/src/common/test.txt', import.meta.url));
const TXT_TEXT = TXT.toString('ascii');
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

test('per-row timeout advances the matrix and late callbacks are ignored', () => {
  const app = mount();
  app.page.checkFileApi();
  const late = app.requests.readText[0];
  app.fire(3000);
  assert.match(app.result('B1 readText .txt'), /FAIL timeout 3s/);
  late.fail('late', 202);
  assert.match(app.result('B1 readText .txt'), /FAIL timeout 3s/);
  assert.equal(app.requests.readArrayBuffer.length, 1);
  app.page.stopAll();
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

test('file API matrix happy path records all seven rows and cleans both internal files', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].success({ text: TXT_TEXT });
  assert.match(app.result('B1 readText .txt'), new RegExp('PASS len=512 hash=' + probe.TEST_TXT_TEXT_HASH));
  app.requests.readArrayBuffer[0].success({ buffer: TXT.slice() });
  assert.match(app.result('B2 readAB .txt'), new RegExp('PASS bytes=512 hash=' + probe.TEST_TXT_BYTES_HASH));
  app.requests.access[0].success({ exists: true });
  assert.match(app.result('B3 access .bin'), /PASS exists=true/);
  app.requests.get[0].fail('missing', 301);
  assert.equal(app.requests.copy.length, 1);
  assert.equal(app.requests.copy[0].srcUri, '/common/probe.bin');
  assert.match(app.requests.copy[0].dstUri, /^internal:\/\/files\/jspeak-probe-030-.*-c\.bin$/);
  const dst = app.requests.copy[0].dstUri;
  app.requests.copy[0].success();
  assert.match(app.result('B4 copy→internal'), new RegExp('PASS ' + dst));
  app.requests.readArrayBuffer[1].success({ buffer: PROBE_BIN.slice() });
  assert.match(app.result('B5 copy读回'), new RegExp('PASS hash=' + probe.PROBE_BIN_HASH));
  assert.equal(app.requests.delete[0].uri, dst);
  app.requests.delete[0].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
  app.requests.readArrayBuffer[2].success({ buffer: PROBE_BIN.slice() });
  assert.match(app.result('B6 大写 /Common'), new RegExp('PASS bytes=65536 hash=' + probe.PROBE_BIN_HASH));
  app.requests.get[1].fail('missing', 301);
  const write = app.requests.writeArrayBuffer[0];
  assert.equal(write.buffer.length, 65536);
  for (let i = 0; i < write.buffer.length; i++) assert.equal(write.buffer[i], i & 255);
  write.success();
  assert.match(app.result('B7 scratch write'), /PASS 65536 bytes/);
  app.requests.readArrayBuffer[3].success({ buffer: write.buffer.slice() });
  assert.match(app.result('B7 scratch read'), /PASS 65536 bytes verified/);
  const partial = app.requests.readArrayBuffer[4];
  assert.equal(partial.position, 1024);
  assert.equal(partial.length, 2048);
  partial.success({ buffer: write.buffer.slice(1024, 3072) });
  assert.match(app.result('B7 internal部分读'), new RegExp('PASS hash=' + probe.SLICE_HASH));
  assert.match(app.result('文件判别'), /^DONE/);
  assert.equal(app.requests.delete.length, 2);
  app.requests.delete[1].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
  assert.equal(app.timers.size, 0);
});

test('file API matrix records 202 failures per row, skips B5 after failed copy and still finishes', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].fail('invalid file type', 202);
  assert.match(app.result('B1 readText .txt'), /FAIL 202 invalid file type/);
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  assert.match(app.result('B2 readAB .txt'), /FAIL 202/);
  app.requests.access[0].fail('invalid file type', 202);
  assert.match(app.result('B3 access .bin'), /FAIL 202/);
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].fail('invalid file type', 202);
  assert.match(app.result('B4 copy→internal'), /FAIL copy 202 invalid file type/);
  assert.match(app.requests.delete[0].uri, /-c\.bin$/);
  app.requests.delete[0].fail('missing', 301);
  assert.match(app.result('临时文件清理'), /leftover: internal:/);
  assert.match(app.result('B5 copy读回'), /SKIPPED/);
  assert.equal(app.requests.readArrayBuffer.length, 2);
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  assert.match(app.result('B6 大写 /Common'), /FAIL 202/);
  app.requests.get[1].fail('missing', 301);
  app.requests.writeArrayBuffer[0].fail('invalid file type', 202);
  assert.match(app.result('B7 internal部分读'), /FAIL write 202 invalid file type/);
  assert.equal(app.requests.delete.length, 2);
  app.requests.delete[1].success();
  assert.match(app.result('文件判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('missing file API members are caught per row without interrupting the matrix', () => {
  const app = mount({ omit: ['readText', 'access', 'copy'] });
  app.page.checkFileApi();
  assert.match(app.result('B1 readText .txt'), /FAIL TypeError.*readText/);
  app.requests.readArrayBuffer[0].success({ buffer: TXT.slice() });
  assert.match(app.result('B3 access .bin'), /FAIL TypeError.*access/);
  app.requests.get[0].fail('missing', 301);
  assert.match(app.result('B4 copy→internal'), /UNSUPPORTED copy/);
  assert.match(app.result('B5 copy读回'), /SKIPPED/);
  app.requests.readArrayBuffer[1].fail('not found', 301);
  assert.match(app.result('B6 大写 /Common'), /FAIL 301/);
  app.requests.get[1].fail('missing', 301);
  app.requests.writeArrayBuffer[0].success();
  app.requests.readArrayBuffer[2].success({ buffer: app.requests.writeArrayBuffer[0].buffer.slice() });
  app.requests.readArrayBuffer[3].success({ buffer: app.requests.writeArrayBuffer[0].buffer.slice(1024, 3072) });
  assert.match(app.result('B7 internal部分读'), /PASS hash=/);
  assert.match(app.result('文件判别'), /^DONE/);
  assert.equal(app.timers.size, 0);
});

test('B5 records hash mismatch and still removes the copied file', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].success({ text: TXT_TEXT });
  app.requests.readArrayBuffer[0].success({ buffer: TXT.slice() });
  app.requests.access[0].success({ exists: true });
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].success();
  const wrong = PROBE_BIN.slice(); wrong[0] ^= 1;
  app.requests.readArrayBuffer[1].success({ buffer: wrong });
  assert.match(app.result('B5 copy读回'), /FAIL hash 不符 len=65536/);
  assert.equal(app.requests.delete[0].uri, app.requests.copy[0].dstUri);
  app.requests.delete[0].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
  app.page.stopAll();
  assert.equal(app.timers.size, 0);
});

test('cancel during copy waits for the in-flight callback then deletes the copy product', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.access[0].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  const dst = app.requests.copy[0].dstUri;
  app.page.stopAll();
  assert.match(app.result('文件判别'), /CANCELLED/);
  assert.equal(app.requests.delete, undefined);
  app.requests.copy[0].success();
  assert.equal(app.requests.delete.length, 1);
  assert.equal(app.requests.delete[0].uri, dst);
  app.requests.delete[0].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
  assert.equal(app.timers.size, 0);
});

test('cancel during B7 scratch write deletes the scratch file without a partial read', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.access[0].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  app.requests.copy[0].fail('invalid file type', 202);
  app.requests.delete[0].success();
  app.requests.readArrayBuffer[1].fail('invalid file type', 202);
  app.requests.get[1].fail('missing', 301);
  app.page.stopAll();
  assert.equal(app.requests.writeArrayBuffer.length, 1);
  assert.equal(app.requests.delete.length, 1);
  app.requests.writeArrayBuffer[0].success();
  assert.equal(app.requests.delete.length, 2);
  assert.equal(app.requests.readArrayBuffer.length, 2);
  app.requests.delete[1].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
  assert.equal(app.timers.size, 0);
});

test('in-flight file API I/O blocks a new run with BUSY', () => {
  const app = mount();
  app.page.checkFileApi();
  app.requests.readText[0].fail('invalid file type', 202);
  app.requests.readArrayBuffer[0].fail('invalid file type', 202);
  app.requests.access[0].fail('invalid file type', 202);
  app.requests.get[0].fail('missing', 301);
  app.page.checkFileApi();
  assert.match(app.result('文件判别'), /^BUSY/);
  app.requests.copy[0].success();
  assert.equal(app.requests.delete.length, 1);
  app.requests.delete[0].success();
  assert.match(app.result('临时文件清理'), /^PASS/);
});
