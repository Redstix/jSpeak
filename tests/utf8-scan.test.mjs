import test from 'node:test';
import assert from 'node:assert/strict';
import { readForward, readBackward } from '../src/core/utf8-scan.js';

test('UTF-8 scanner follows C byte widths and backward pointer convention', () => {
  const bytes = Uint8Array.of(32, 0xc3, 0xa9, 0xe7, 0x95, 0x8c, 0xf0, 0x9f, 0x98, 0x80, 0);
  assert.deepEqual(readForward(bytes, 1), { codepoint: 0xe9, bytes: 2, start: 1 });
  assert.deepEqual(readForward(bytes, 3), { codepoint: 0x754c, bytes: 3, start: 3 });
  assert.deepEqual(readBackward(bytes, 9), { codepoint: 0x1f600, bytes: 4, start: 6 });
  assert.deepEqual(readBackward(bytes, 5), { codepoint: 0x754c, bytes: 3, start: 3 });
  assert.deepEqual(readForward(bytes, 10), { codepoint: 0, bytes: 1, start: 10 });
});

test('UTF-8 scanner skips continuation prefixes without adding them to C return width', () => {
  const bytes = Uint8Array.of(65, 0x80, 0xbf, 66, 0);
  assert.deepEqual(readForward(bytes, 1), { codepoint: 66, bytes: 1, start: 3 });
  assert.deepEqual(readBackward(bytes, 2), { codepoint: 65, bytes: 1, start: 0 });
});

test('common.c scanner deliberately preserves permissive malformed-byte semantics', () => {
  for (const [bytes, codepoint, width] of [
    [[0xc0, 0x80, 0], 0, 2],
    [[0xc2, 0x41, 0], 129, 2],
    [[0xe1, 0x80, 0], 64, 2],
    [[0xc2, 0], 2, 1],
    [[0xed, 0xa0, 0x80, 0], 0xd800, 3],
    [[0xf7, 0xbf, 0xbf, 0xbf, 0], 0x1fffff, 4],
    [[0xf8, 0], 0xf8, 1],
    [[0xff, 0], 0xff, 1]
  ]) assert.deepEqual(readForward(Uint8Array.from(bytes), 0), { codepoint, bytes: width, start: 0 });
});

test('scanner rejects C-undefined backing reads rather than inventing padding', () => {
  assert.throws(() => readForward([65], 0), TypeError);
  for (const offset of [-1, 0.5, 1, NaN]) assert.throws(() => readForward(Uint8Array.of(0), offset), RangeError);
  assert.throws(() => readBackward(Uint8Array.of(0x80), 0), RangeError);
  assert.throws(() => readForward(Uint8Array.of(0x80), 0), RangeError);
  assert.throws(() => readForward(Uint8Array.of(0xc2), 0), RangeError);
});
