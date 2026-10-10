import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhonemeTables, decodePhonemes } from '../src/core/phoneme-table.js';

function fixture(tables) {
  const bytes = new Uint8Array(4 + tables.reduce((sum, table) => sum + 36 + table.records.length * 16, 0));
  const view = new DataView(bytes.buffer);
  bytes[0] = tables.length;
  let cursor = 4;
  for (const [index, table] of tables.entries()) {
    bytes[cursor] = table.records.length; bytes[cursor + 1] = table.includes || 0;
    bytes[cursor + 4] = 65 + index; cursor += 36;
    for (const record of table.records) {
      view.setUint32(cursor, record.mnemonic || 0, true);
      view.setUint32(cursor + 4, record.phflags || 0, true);
      view.setUint16(cursor + 8, record.program || 0, true);
      bytes.set([record.code, record.type || 0, record.startType || 0, record.endType || 0, record.stdLength || 0, record.lengthMod || 0], cursor + 10);
      cursor += 16;
    }
  }
  return bytes;
}

test('phontab preserves inherited record identity, override order and sparse high-water count', () => {
  const tables = createPhonemeTables(fixture([
    { records: [{ code: 3, mnemonic: 65, phflags: 0x80000001, program: 0x1234, startType: 6, endType: 7, stdLength: 8, lengthMod: 9 }, { code: 9, mnemonic: 66 }] },
    { includes: 1, records: [{ code: 3, mnemonic: 67 }, { code: 3, mnemonic: 68 }] },
    { records: [{ code: 1, mnemonic: 90 }] },
    { records: [] }
  ]));
  const base = tables.select(0), child = tables.select(1), independent = tables.select(2);
  assert.equal(base.nPhonemes, 10);
  assert.equal(child.nPhonemes, 10);
  assert.equal(child.entries[9], base.entries[9]);
  assert.equal(child.entries[3], tables.tables[1].records[1]);
  assert.equal(child.entries[3].mnemonic, 68);
  assert.equal(independent.nPhonemes, 2);
  assert.equal(independent.entries[9], null);
  assert.equal(tables.select(3).nPhonemes, 1);
  assert.equal(tables.select(1), child);
  assert.deepEqual(base.entries[3], { mnemonic: 65, phflags: 0x80000001, program: 0x1234, code: 3, type: 0, startType: 6, endType: 7, stdLength: 8, lengthMod: 9 });
  assert(Object.isFrozen(child.entries) && Object.isFrozen(child.entries[3]));
});

test('phontab parser rejects bounded-read violations, invalid parents and cycles', () => {
  const valid = fixture([{ records: [{ code: 1, mnemonic: 65 }] }]);
  for (const length of [0, 3, 4, 39, valid.length - 1]) assert.throws(() => createPhonemeTables(valid.slice(0, length)));
  for (const count of [0, 151, 255]) { const bytes = valid.slice(); bytes[0] = count; assert.throws(() => createPhonemeTables(bytes), /count/); }
  const noNameNul = valid.slice(); noNameNul.fill(65, 8, 40);
  assert.throws(() => createPhonemeTables(noNameNul), /name/);
  assert.throws(() => createPhonemeTables(fixture([{ includes: 2, records: [] }])), /parent/);
  assert.throws(() => createPhonemeTables(fixture([{ includes: 1, records: [] }])), /cycle/);
  assert.throws(() => createPhonemeTables(fixture([{ includes: 2, records: [] }, { includes: 1, records: [] }])), /cycle/);
  assert.throws(() => createPhonemeTables([]), TypeError);
  const tables = createPhonemeTables(valid);
  for (const index of [-1, 0.5, 1, NaN]) assert.throws(() => tables.select(index), RangeError);
});

test('DecodePhonemes retains stress special cases, program exceptions, holes and byte terminators', () => {
  const table = createPhonemeTables(fixture([{ records: [
    { code: 1, mnemonic: 65, type: 1, stdLength: 1 },
    { code: 2, mnemonic: 66, type: 1, stdLength: 2 },
    { code: 3, mnemonic: 67, type: 1, stdLength: 3 },
    { code: 4, mnemonic: 68, type: 1, stdLength: 4 },
    { code: 5, mnemonic: 69, type: 1, stdLength: 5 },
    { code: 6, mnemonic: 0x64636261, type: 1, stdLength: 4, program: 1 },
    { code: 255, mnemonic: 70 }
  ] }])).select(0);
  assert.deepEqual(decodePhonemes(Uint8Array.of(1, 2, 3, 4, 5, 6, 99, 255, 0, 6), table), Uint8Array.of(44, 44, 39, 69, 97, 98, 99, 100));
  assert.deepEqual(decodePhonemes(Uint8Array.of(6), table), Uint8Array.of(97, 98, 99, 100));
  assert.deepEqual(decodePhonemes(new Uint8Array(), table), new Uint8Array());
});

test('DecodePhonemes copies ASCII alphabetic language names only for a present switch record', () => {
  const make = records => createPhonemeTables(fixture([{ records }])).select(0);
  const table = make([{ code: 21, mnemonic: 0x7c }, { code: 45, mnemonic: 0x2b }, { code: 101, mnemonic: 0x45 }, { code: 110, mnemonic: 0x4e }]);
  assert.deepEqual(decodePhonemes(Uint8Array.of(21, 101, 110, 45, 0), table), Uint8Array.of(124, 101, 110, 43));
  const missing = make([{ code: 101, mnemonic: 0x45 }, { code: 110, mnemonic: 0x4e }]);
  assert.deepEqual(decodePhonemes(Uint8Array.of(21, 101, 110, 0), missing), Uint8Array.of(69, 78));
  assert.deepEqual(decodePhonemes(Uint8Array.of(255, 101, 0), missing), Uint8Array.of(69));
});
