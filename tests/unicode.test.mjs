import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as unicode from '../src/core/unicode.js';
import { UCD_RANGES, LOWER_CASE, UPPER_CASE, UNICODE_METADATA } from '../data/unicode/tables.js';

const bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
const points = (hex, termination) => Array.from(unicode.decodeUtf8(bytes(hex), { termination }));

test('C UTF-8 length modes retain their different NUL and exact-end behavior', () => {
  assert.deepEqual(points('410042', 'c-string'), [65, 0]);
  assert.deepEqual(points('410042', 'nul-terminated'), [65, 0, 66, 0]);
  assert.deepEqual(points('410042', 'bounded'), [65, 0, 66]);
  assert.deepEqual(points('', 'c-string'), [0]);
  assert.deepEqual(points('', 'bounded'), []);
  assert.deepEqual(points('c2a9', 'bounded'), [65533]);
  assert.deepEqual(points('c2a9', 'c-string'), [169, 0]);
  assert.deepEqual(points('c2a900', 'bounded'), [169, 0]);
});

test('malformed input follows pinned eSpeak decoding rather than standard replacement', () => {
  assert.deepEqual(points('c080', 'c-string'), [0, 0]);
  assert.deepEqual(points('eda080', 'c-string'), [0xd800, 0]);
  assert.deepEqual(points('efbfbd', 'c-string'), [26, 0]);
  assert.deepEqual(points('efbbbf', 'c-string'), [0xfeff, 0]);
  assert.deepEqual(points('f5808080', 'c-string'), [0xfffd, 0]);
  assert.deepEqual(points('80bf', 'c-string'), [0xfffd, 0xfffd, 0]);
  assert.deepEqual(points('e1804142', 'bounded'), [0xfffd, 65, 66]);
  assert.deepEqual(points('e18041', 'bounded'), [0xfffd]);
  assert.deepEqual(points('f09080', 'c-string'), [0xfffd]);
});

test('decoder peek preserves consumption and EOF cannot be read beyond', () => {
  const input = bytes('41e1804142');
  const decoder = unicode.createUtf8Decoder(input, { termination: 'bounded' });
  assert.equal(decoder.byteLength, 5);
  assert.equal(decoder.peek(), 65); assert.equal(decoder.offset(), 0); assert.equal(decoder.remaining(), 5);
  assert.equal(decoder.next(), 65); assert.equal(decoder.offset(), 1);
  assert.equal(decoder.peek(), 65533); assert.equal(decoder.offset(), 1);
  assert.equal(decoder.next(), 65533); assert.equal(decoder.offset(), 3);
  assert.equal(decoder.next(), 65); assert.equal(decoder.next(), 66);
  assert.equal(decoder.eof(), true); assert.equal(decoder.peek(), 0); assert.equal(decoder.remaining(), 0);
  assert.throws(() => decoder.next(), /EOF/);
});

test('UTF-8 output preserves C surrogate and out-of-range semantics with exact bounds', () => {
  const source = Uint32Array.from([0, 0x7f, 0x80, 0x7ff, 0x800, 0xd800, 0x10ffff, 0x110000, 0xffffffff]);
  assert.equal(Buffer.from(unicode.encodeUtf8(source)).toString('hex'), '007fc280dfbfe0a080eda080f48fbfbf2020');
  const target = Uint8Array.from([9, 9, 9, 9, 9, 9]);
  assert.equal(unicode.writeUtf8CodePoint(0x1f600, target, 1), 4);
  assert.deepEqual(Array.from(target), [9, 0xf0, 0x9f, 0x98, 0x80, 9]);
  const original = target.slice();
  assert.throws(() => unicode.writeUtf8CodePoint(0x1f600, target, 3), /bounds/);
  assert.deepEqual(target, original);
});

test('JS string boundary preserves lone surrogates and combines only valid UTF-16 pairs', () => {
  const text = 'Aé你😀\ud800X\udc00\0\ufeff';
  const cps = unicode.stringToCodePoints(text);
  assert.deepEqual(Array.from(cps), [65, 233, 0x4f60, 0x1f600, 0xd800, 88, 0xdc00, 0, 0xfeff]);
  assert.equal(unicode.codePointsToString(cps), text);
  assert.throws(() => unicode.codePointsToString(Uint32Array.of(0x110000)), /represented/);
  assert.deepEqual(Array.from(unicode.decodeUtf8(unicode.encodeUtf8(unicode.stringToCodePoints('\ufffd')))), [26, 0]);
});

test('eSpeak classifications distinguish added word symbols, spaces and decimal digits', () => {
  assert.equal(unicode.iswAlpha(0x301), 0); assert.equal(unicode.isAlpha(0x301), 1);
  assert.equal(unicode.isAlpha(0x1f600), 1); assert.equal(unicode.isEmoji(0x1f600), 1);
  assert.equal(unicode.isDigit(0x966), 1); assert.equal(unicode.iswDigit(0x966), 0);
  assert.equal(unicode.isDigit(0x660), 0); assert.equal(unicode.iswAlnum(0x660), 1);
  assert.equal(unicode.isSpace(0x2500), 1); assert.equal(unicode.iswSpace(0x2500), 0);
  assert.equal(unicode.isSpace(0xfffd), 1); assert.equal(unicode.isSpace(0xa0), 0);
  assert.equal(unicode.isSpace(0x2007), 0); assert.equal(unicode.isSpace(0x202f), 0);
  assert.equal(unicode.isSpace(0x2028), 1); assert.equal(unicode.isSpace(0), 0);
  assert.equal(unicode.isSpace2(1), 1); assert.equal(unicode.isSpace2(0), 0); assert.equal(unicode.isSpace2(33), 0);
  assert.equal(unicode.bracketIndex(40), 1); assert.equal(unicode.bracketIndex(41), 2);
  assert.equal(unicode.bracketIndex(0xe03c), 16); assert.equal(unicode.bracketIndex(0x2014), 1);
  assert.equal(unicode.isRegionalIndicator(0x1f1e6), 1); assert.equal(unicode.isRegionalIndicator(0x1f1e5), 0);
  assert.equal(unicode.isEmojiModifier(0x1f3fb), 1); assert.equal(unicode.isEmojiTag(0xe007f), 1);
});

test('simple case tables and dotless-I option preserve one-code-point mappings', () => {
  assert.equal(unicode.toLowerCodePoint(0x49), 0x69);
  assert.equal(unicode.toLowerCodePoint(0x49, true), 0x131);
  assert.equal(unicode.toLowerCodePoint(0x130), 0x69);
  assert.equal(unicode.toLowerCodePoint(0x10400), 0x10428);
  assert.equal(unicode.toUpperCodePoint(0xdf), 0xdf);
  assert.equal(unicode.toLowerCodePoint(0xffffffff), 0xffffffff);
  assert.equal(unicode.category(0xffffffff), 5);
  assert.equal(unicode.category(0x1fae0), 2); // unassigned in pinned Unicode 11
  const reused = {}; assert.equal(unicode.classifyCodePoint(0x49, true, reused), reused);
  assert.equal(reused.lower, 0x131); assert.equal(reused.ucdLower, 0x69);
});

test('generated table coverage, ordering, provenance and exact bytes are checked', () => {
  let next = 0;
  for (let i = 0; i < UCD_RANGES.length; i += 3) {
    assert.equal(UCD_RANGES[i], next); assert.ok(UCD_RANGES[i + 1] >= next);
    next = UCD_RANGES[i + 1] + 1;
    assert.ok((UCD_RANGES[i + 2] >>> 12) <= 30);
  }
  assert.equal(next, 0x110000);
  for (const table of [LOWER_CASE, UPPER_CASE]) for (let i = 0; i < table.length; i += 2) {
    if (i) assert.ok(table[i] > table[i - 2]);
    assert.notEqual(table[i], table[i + 1]); assert.ok(table[i + 1] <= 0x10ffff);
  }
  const manifest = JSON.parse(readFileSync(new URL('../data/unicode/manifest.json', import.meta.url), 'utf8'));
  const module = readFileSync(new URL('../data/unicode/tables.js', import.meta.url));
  assert.equal(createHash('sha256').update(module).digest('hex'), manifest.moduleSha256);
  assert.equal(UNICODE_METADATA.upstreamCommit, JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url))).commit);
  assert.equal(UNICODE_METADATA.sourceFingerprint, manifest.sourceFingerprint);
});

test('long input produces exact-sized arrays and boundary conversion remains bounded', () => {
  const text = 'A😀\u0301'.repeat(32768);
  const cps = unicode.stringToCodePoints(text);
  assert.equal(cps.length, 98304); assert.equal(cps.byteLength, 98304 * 4);
  assert.equal(unicode.codePointsToString(cps), text);
  const decoded = unicode.decodeUtf8(unicode.encodeUtf8(cps));
  assert.equal(decoded.length, cps.length + 1); assert.equal(decoded.buffer.byteLength, decoded.length * 4);
  assert.deepEqual(decoded.subarray(0, cps.length), cps); assert.equal(decoded.at(-1), 0);
});

test('invalid argument types, options and capacities fail explicitly', () => {
  for (const cp of [-1, 0.5, NaN, Infinity, 0x100000000, '65']) assert.throws(() => unicode.isAlpha(cp), /uint32/);
  assert.throws(() => unicode.createUtf8Decoder('abc'), /Uint8Array/);
  assert.throws(() => unicode.createUtf8Decoder(bytes(''), { encoding: 'AUTO' }), /Unsupported encoding/);
  assert.throws(() => unicode.createUtf8Decoder(bytes(''), 'UTF-16'), /options object/);
  assert.throws(() => unicode.createUtf8Decoder(bytes(''), []), /options object/);
  assert.throws(() => unicode.createUtf8Decoder(bytes(''), { fatal: true }), /Unsupported decoder option/);
  assert.throws(() => unicode.createUtf8Decoder(bytes(''), { termination: 'guess' }), /termination/);
  assert.throws(() => unicode.toLowerCodePoint(65, 'yes'), /boolean/);
  assert.throws(() => unicode.encodeUtf8([65]), /Uint32Array/);
  assert.throws(() => unicode.stringToCodePoints(null), /string/);
});
