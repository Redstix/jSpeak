import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../apps/vela-probe/src/probe.js', import.meta.url), 'utf8');
const { capabilities, computeSlice, validateResource } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('probe capability semantics pass on Node (not a device result)', () => {
  assert.equal(capabilities().length, 4);
  for (const result of capabilities()) assert.equal(result.value, 'PASS', result.label);
});

test('compute result is independent of slice boundaries', () => {
  const full = computeSlice(1, 4096);
  assert.equal(computeSlice(computeSlice(1, 2048), 2048), full);
  assert.equal(computeSlice(1, 0), 1);
  assert.throws(() => computeSlice(1, 4097), /slice count/);
  assert.throws(() => computeSlice(1, -1), /slice count/);
  assert.throws(() => computeSlice(1, NaN), /slice count/);
});

test('resource verification rejects wrong length and corruption', () => {
  const bytes = new Uint8Array(65536);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  assert.equal(validateResource(bytes), true);
  bytes[100] = 0;
  assert.equal(validateResource(bytes), false);
  assert.equal(validateResource(new Uint8Array(4)), false);
  assert.equal(validateResource(null), false);
});
