import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../apps/vela-probe/src/scratch-file.js', import.meta.url), 'utf8');
const { scratchFile } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function fixture() {
  const requests = {};
  const events = [];
  const api = {};
  for (const method of ['get', 'writeArrayBuffer', 'readArrayBuffer', 'delete']) {
    api[method] = args => { (requests[method] ||= []).push(args); };
  }
  const bytes = new Uint8Array([1, 2, 3]);
  const uri = 'internal://files/jspeak-probe-test.bin';
  const job = scratchFile(api, uri, bytes, {
    stage: (stage, message) => events.push([stage, message]),
    ready: path => events.push(['ready', path]),
    error: (stage, message) => events.push(['error', stage, message]),
    cleanup: message => events.push(['cleanup', message])
  });
  return { requests, events, job, bytes, uri };
}

test('scratch checks nonexistence, writes bytes, verifies all bytes and releases only on cancel', () => {
  const f = fixture();
  f.job.start();
  assert.equal(f.job.isPending(), true);
  f.requests.get[0].fail('missing', 301);
  assert.equal(f.requests.writeArrayBuffer[0].buffer, f.bytes);
  f.requests.writeArrayBuffer[0].success();
  f.requests.readArrayBuffer[0].success({ buffer: f.bytes.slice() });
  assert.deepEqual(f.events.map(event => event[0]), ['write', 'read', 'ready']);
  assert.equal(f.requests.delete, undefined);
  assert.equal(f.job.isPending(), false);
  f.job.cancel();
  assert.equal(f.requests.delete[0].uri, f.uri);
  f.requests.delete[0].success();
  assert.equal(f.job.isPending(), false);
  f.job.cancel();
  assert.equal(f.requests.delete.length, 1);
});

test('existing target is never overwritten or deleted', () => {
  const f = fixture();
  f.job.start(); f.requests.get[0].success({ length: 3 });
  assert.equal(f.requests.writeArrayBuffer, undefined);
  assert.equal(f.requests.delete, undefined);
  assert.match(f.events[0][2], /EXISTS/);
});

test('cancelled in-flight write waits for completion then deletes without reading', () => {
  const f = fixture();
  f.job.start(); f.requests.get[0].fail('missing', 301);
  f.job.cancel();
  assert.equal(f.requests.delete, undefined);
  assert.equal(f.job.isPending(), true);
  f.requests.writeArrayBuffer[0].success();
  assert.equal(f.requests.readArrayBuffer, undefined);
  assert.equal(f.requests.delete.length, 1);
  assert.equal(f.events.length, 0);
});

test('cancelled read cannot report readiness and waits to delete', () => {
  const f = fixture();
  f.job.start(); f.requests.get[0].fail('missing', 301);
  f.requests.writeArrayBuffer[0].success(); f.job.cancel();
  assert.equal(f.requests.delete, undefined);
  f.requests.readArrayBuffer[0].success({ buffer: f.bytes });
  assert.equal(f.events.some(event => event[0] === 'ready'), false);
  assert.equal(f.requests.delete.length, 1);
});

test('cancellation during existence check never starts a write', () => {
  const f = fixture();
  f.job.start(); f.job.cancel(); f.requests.get[0].fail('missing', 301);
  assert.equal(f.requests.writeArrayBuffer, undefined);
  assert.equal(f.requests.delete, undefined);
  assert.equal(f.job.isPending(), false);
});

test('mismatched readback is failure, duplicate callbacks cannot change result', () => {
  const f = fixture();
  f.job.start(); f.requests.get[0].fail('missing', 301);
  f.requests.writeArrayBuffer[0].success();
  f.requests.readArrayBuffer[0].success({ buffer: new Uint8Array([1, 2, 4]) });
  f.requests.readArrayBuffer[0].success({ buffer: f.bytes });
  assert.equal(f.events.some(event => event[0] === 'ready'), false);
  assert.match(f.events.find(event => event[0] === 'error')[2], /byte mismatch/);
  f.requests.delete[0].fail('permission', 202);
  assert.match(f.events.at(-1)[1], /leftover: internal:/);
});

test('write failure cleans potential partial file and records stage', () => {
  const f = fixture();
  f.job.start(); f.requests.get[0].fail('missing', 301);
  f.requests.writeArrayBuffer[0].fail('invalid file type', 202);
  assert.deepEqual(f.events[0], ['error', 'write', '202 invalid file type']);
  assert.equal(f.requests.delete.length, 1);
});
