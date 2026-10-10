import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createUnicodeOracle, exportUnicodeTable, unpackUnicodeTableRow } from '../tools/oracle/unicode.mjs';
import { unicodeBinary } from '../tools/oracle/unicode-build-info.mjs';

const available = existsSync(unicodeBinary);
const options = { skip: available ? false : 'Build development C helper with node tools/oracle/build-unicode.mjs; mandatory selfcheck is tools/oracle/test-unicode.mjs' };
const oracle = available ? createUnicodeOracle() : null;
test('Unicode C oracle separates C-string truncation, explicit NUL and bounded length', options, () => {
  const points = termination => oracle({ utf8Hex: '610062c3a9', termination }).decode.steps.map(s => s.codepoint);
  assert.deepEqual(points('c-string'), [97, 0]);
  assert.deepEqual(points('nul-terminated'), [97, 0, 98, 233, 0]);
  assert.deepEqual(points('bounded'), [97, 0, 98, 65533]);
  assert.deepEqual(oracle({ utf8Hex: '', termination: 'bounded' }).decode.terminal, { offset: 0, eof: true, peek: 0, getcSupported: false });
});
test('Unicode C oracle records unusual fixed-source malformed and classification behavior', options, () => {
  assert.deepEqual(oracle({ utf8Hex: 'efbfbdeda080c080' }).decode.steps.map(s => s.codepoint), [26, 55296, 0, 0]);
  const rows = oracle({ classify: [73, 0xa0, 0x301, 0x966, 0x1f600, 0xd800, 0x110000], dotlessI: true }).classifications;
  assert.equal(rows[0].lower, 0x131); assert.equal(rows[0].ucdLower, 105);
  assert.equal(rows[1].isSpace, 0); assert.equal(rows[2].isAlpha, 1); assert.equal(rows[2].iswAlpha, 0);
  assert.equal(rows[3].isDigit, 1); assert.equal(rows[3].iswDigit, 0); assert.equal(rows[4].isAlpha, 1);
  assert.equal(rows[5].utf8Hex, 'eda080'); assert.equal(rows[6].utf8Hex, '20');
});
test('Unicode C oracle batch protocol preserves order, empty requests and repeatability', options, () => {
  const input = JSON.stringify([{ utf8Hex: '61' }, {}, { classify: [65, 97, 0xd800] }, { utf8Hex: 'ff' }]);
  const run = () => execFileSync(process.execPath, ['tools/oracle/unicode.mjs'], { input, encoding: 'utf8' });
  const result = run(); assert.equal(run(), result);
  const values = JSON.parse(result); assert.equal(values.length, 4);
  assert.equal(values[0].decode.steps[0].codepoint, 97); assert.equal(values[1].decode, null);
  assert.equal(values[2].classifications[2].codepoint, 0xd800); assert.equal(values[3].decode.steps[0].codepoint, 65533);
});
test('Unicode C oracle rejects unknown modes, invalid bytes/codepoints and over-limit inputs', options, () => {
  for (const request of [{ mode: 'utf16' }, { utf8Hex: '0' }, { utf8Hex: 'GG' }, { termination: 'utf16' }, { classify: [-1] }, { classify: [0x100000000] }, { classify: [NaN] }, { dotlessI: 1 }, { utf8Hex: '61'.repeat(65537) }, { classify: Array(65537).fill(1) }]) assert.throws(() => oracle(request));
  assert.notEqual(spawnSync(process.execPath, ['tools/oracle/unicode.mjs'], { input: JSON.stringify(Array(1025).fill({})) }).status, 0);
  assert.notEqual(spawnSync(unicodeBinary, ['decode', 'unknown'], { input: 'a' }).status, 0);
  assert.notEqual(spawnSync(unicodeBinary, ['classify', '0'], { input: Buffer.alloc(3) }).status, 0);
  assert.throws(() => exportUnicodeTable({ start: 0xffffffff, count: 2 }));
  assert.throws(() => unpackUnicodeTableRow(new Uint8Array(31), 0, 0));
});
