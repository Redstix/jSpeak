import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../apps/vela-probe/src/probe.js', import.meta.url), 'utf8');
const { capabilities, computeSlice, validateResource, timingSummary, hashBytes, PROBE_BIN_HASH, TEST_TXT_TEXT_HASH, TEST_TXT_BYTES_HASH, SLICE_HASH, BIG_TXT_HASH } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

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

test('timing separates initial 381ms wait from subsequent scheduling gaps', () => {
  const result = timingSummary(Array(32).fill(2), [381, ...Array(31).fill(10)]);
  assert.equal(result.computeMs, 64);
  assert.equal(result.maxSliceMs, 2);
  assert.equal(result.firstWaitMs, 381);
  assert.equal(result.gapMedianMs, 10);
  assert.equal(result.gapP95Ms, 10);
  assert.equal(result.gapMaxMs, 10);
  assert.throws(() => timingSummary([], []), /32 slices/);
});

test('hashBytes uses the computeSlice core, is deterministic and hashes char codes', () => {
  assert.equal(hashBytes(Uint8Array.of(0), 0, 1, 1), computeSlice(1, 1));
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  assert.equal(hashBytes(bytes, 0, 4096, 1), hashBytes(bytes, 0, 4096, 1));
  assert.notEqual(hashBytes(bytes, 0, 4096, 1), hashBytes(bytes, 0, 4095, 1));
  assert.equal(hashBytes('AB', 0, 2, 1), hashBytes(Uint8Array.of(65, 66), 0, 2, 1));
});

test('embedded hash constants match the real packaged files', () => {
  const bin = readFileSync(new URL('../apps/vela-probe/src/common/probe.bin', import.meta.url));
  const txt = readFileSync(new URL('../apps/vela-probe/src/common/test.txt', import.meta.url));
  assert.equal(bin.length, 65536);
  assert.equal(hashBytes(bin, 0, 65536, 1), PROBE_BIN_HASH);
  assert.equal(txt.length, 512);
  for (const byte of txt) assert.ok(byte < 128, 'test.txt must stay pure ASCII');
  assert.equal(hashBytes(txt, 0, 512, 1), TEST_TXT_BYTES_HASH);
  assert.equal(hashBytes(txt.toString('ascii'), 0, 512, 1), TEST_TXT_TEXT_HASH);
});

test('test.txt content is deterministic 64-column padding lines', () => {
  const txt = readFileSync(new URL('../apps/vela-probe/src/common/test.txt', import.meta.url)).toString('ascii');
  assert.equal(txt.length, 512);
  for (let n = 0; n < 8; n++) {
    const line = txt.slice(n * 64, (n + 1) * 64);
    assert.equal(line.length, 64);
    assert.ok(line.startsWith('jspeak-probe-030 line ' + String(n).padStart(2, '0') + ' padding '), line);
    assert.ok(line.endsWith('#'.repeat(31)), line);
  }
});

test('SLICE_HASH locks the B7 partial read window of the packaged pattern', () => {
  const bin = readFileSync(new URL('../apps/vela-probe/src/common/probe.bin', import.meta.url));
  const pattern = new Uint8Array(65536);
  for (let i = 0; i < pattern.length; i++) pattern[i] = i & 255;
  assert.equal(hashBytes(pattern, 1024, 3072, 1), SLICE_HASH);
  assert.equal(hashBytes(bin, 1024, 3072, 1), SLICE_HASH);
});

test('bin.txt bytes match probe.bin by construction and lock the same constants', () => {
  const binTxt = readFileSync(new URL('../apps/vela-probe/src/common/bin.txt', import.meta.url));
  const bin = readFileSync(new URL('../apps/vela-probe/src/common/probe.bin', import.meta.url));
  assert.equal(binTxt.length, 65536);
  assert.equal(Buffer.compare(binTxt, bin), 0);
  assert.equal(hashBytes(binTxt, 0, 65536, 1), PROBE_BIN_HASH);
  assert.equal(hashBytes(binTxt, 1024, 3072, 1), SLICE_HASH);
});

test('BIG_TXT_HASH locks the real 256 KiB big.txt payload', () => {
  const big = readFileSync(new URL('../apps/vela-probe/src/common/big.txt', import.meta.url));
  assert.equal(big.length, 262144);
  assert.equal(hashBytes(big, 0, 262144, 1), BIG_TXT_HASH);
});

test('build stamp exists with the bounded deterministic format', () => {
  const stamp = readFileSync(new URL('../apps/vela-probe/src/build-stamp.js', import.meta.url), 'utf8');
  const match = stamp.match(/BUILD_STAMP = '(B\d{6}T\d{6})'/);
  assert.ok(match, 'build-stamp.js must export BUILD_STAMP as B<yyMMdd>T<HHmmss>');
  assert.equal(match[1].length, 14);
});
