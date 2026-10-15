// Port of synthdata.c:LoadPhData/SelectPhonemeTable and dictionary.c:DecodePhonemes.
// Copyright (C) 2005-2015 Jonathan Duddington. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt. The adapter supplies original phontab bytes.

export var PHONEME_TABLE_LIMIT = 150;
export var PHONEME_RECORD_BYTES = 16;

function byteInput(bytes, label) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected ' + label + ' Uint8Array');
}
function indexIn(index, length, label) {
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new RangeError('Invalid ' + label);
}

export function createPhonemeTables(bytes) {
  byteInput(bytes, 'phontab');
  var data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var cursor = 0;
  function requireBytes(count) {
    if (count > bytes.length - cursor) throw new RangeError('Truncated phontab at byte ' + cursor);
  }
  requireBytes(4);
  var count = bytes[0];
  if (count < 1 || count > PHONEME_TABLE_LIMIT) throw new RangeError('Invalid phontab table count');
  cursor = 4; // The remaining three header bytes are ignored by LoadPhData.
  var tables = [];
  for (var index = 0; index < count; index++) {
    requireBytes(36);
    var recordCount = bytes[cursor], includes = bytes[cursor + 1];
    cursor += 4;
    var name = '', terminated = false;
    for (var i = 0; i < 32; i++) {
      if (bytes[cursor + i] === 0) { terminated = true; break; }
      name += String.fromCharCode(bytes[cursor + i]);
    }
    if (!terminated) throw new Error('Phoneme table name lacks bounded NUL terminator');
    cursor += 32;
    requireBytes(recordCount * PHONEME_RECORD_BYTES);
    var records = [];
    for (var r = 0; r < recordCount; r++, cursor += PHONEME_RECORD_BYTES) {
      records.push(Object.freeze({
        mnemonic: data.getUint32(cursor, true), phflags: data.getUint32(cursor + 4, true),
        program: data.getUint16(cursor + 8, true), code: bytes[cursor + 10], type: bytes[cursor + 11],
        startType: bytes[cursor + 12], endType: bytes[cursor + 13], stdLength: bytes[cursor + 14], lengthMod: bytes[cursor + 15]
      }));
    }
    tables.push(Object.freeze({ index: index, name: name, includes: includes, records: Object.freeze(records) }));
  }
  // includes is one-based: zero has no parent; N means table N - 1.
  var visiting = new Uint8Array(count);
  function validateIncludes(index) {
    if (visiting[index] === 2) return;
    if (visiting[index] === 1) throw new Error('Phoneme table inheritance cycle');
    visiting[index] = 1;
    var parent = tables[index].includes;
    if (parent > count) throw new RangeError('Phoneme table parent outside table count');
    if (parent > 0) validateIncludes(parent - 1);
    visiting[index] = 2;
  }
  for (var t = 0; t < count; t++) validateIncludes(t);
  Object.freeze(tables);
  var selections = [];
  function select(index) {
    indexIn(index, tables.length, 'phoneme table index');
    if (selections[index]) return selections[index];
    var entries = new Array(256).fill(null);
    var highestCode = 0;
    function addTable(tableIndex) {
      var table = tables[tableIndex];
      if (table.includes > 0) addTable(table.includes - 1);
      for (var i = 0; i < table.records.length; i++) {
        var record = table.records[i];
        entries[record.code] = record;
        if (record.code > highestCode) highestCode = record.code;
      }
    }
    addTable(index);
    // C n_phoneme_tab is one past the maximum code, including gaps. An empty
    // table still reports 1 because SelectPhonemeTable starts its maximum at 0.
    selections[index] = Object.freeze({ index: index, name: tables[index].name, nPhonemes: highestCode + 1, entries: Object.freeze(entries) });
    return selections[index];
  }
  return Object.freeze({ tables: tables, consumedBytes: cursor, select: select });
}

export function selectPhonemeTable(bytes, targetIndex) {
  byteInput(bytes, 'phontab');
  indexIn(targetIndex, bytes.length >= 4 ? bytes[0] : 0, 'phoneme table index');
  if (bytes.length < 4 || bytes[0] < 1 || bytes[0] > PHONEME_TABLE_LIMIT) throw new RangeError('Invalid phontab table count');
  const count = bytes[0];
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recordCounts = new Uint8Array(count);
  const includesValues = new Uint8Array(count);
  const recordOffsets = new Uint32Array(count);
  let cursor = 4;
  for (let index = 0; index < count; index++) {
    if (36 > bytes.length - cursor) throw new RangeError('Truncated phontab at byte ' + cursor);
    recordCounts[index] = bytes[cursor];
    includesValues[index] = bytes[cursor + 1];
    recordOffsets[index] = cursor + 36;
    cursor = recordOffsets[index] + recordCounts[index] * PHONEME_RECORD_BYTES;
    if (cursor > bytes.length) throw new RangeError('Truncated phontab at byte ' + recordOffsets[index]);
  }

  const chain = [];
  const visiting = new Uint8Array(count);
  let current = targetIndex;
  while (true) {
    if (visiting[current] === 1) throw new Error('Phoneme table inheritance cycle');
    visiting[current] = 1;
    chain.push(current);
    const includes = includesValues[current];
    if (includes === 0) break;
    if (includes > count) throw new RangeError('Phoneme table parent outside table count');
    current = includes - 1;
  }

  const entries = new Array(256).fill(null);
  let highestCode = 0;
  let name = '';
  for (let chainIndex = chain.length - 1; chainIndex >= 0; chainIndex--) {
    const index = chain[chainIndex];
    const recordCount = recordCounts[index];
    const tableCursor = recordOffsets[index];
    const nameCursor = tableCursor - 32;
    if (nameCursor < 0 || nameCursor + 32 > bytes.length) throw new RangeError('Truncated phontab name at byte ' + nameCursor);
    let terminated = false;
    if (index === targetIndex) {
      name = '';
      for (let i = 0; i < 32; i++) {
        if (bytes[nameCursor + i] === 0) { terminated = true; break; }
        name += String.fromCharCode(bytes[nameCursor + i]);
      }
      if (!terminated) throw new Error('Phoneme table name lacks bounded NUL terminator');
    } else {
      terminated = false;
      for (let i = 0; i < 32; i++) {
        if (bytes[nameCursor + i] === 0) { terminated = true; break; }
      }
      if (!terminated) throw new Error('Phoneme table name lacks bounded NUL terminator');
    }
    for (let r = 0; r < recordCount; r++) {
      const recordCursor = tableCursor + r * PHONEME_RECORD_BYTES;
      const record = Object.freeze({
        mnemonic: data.getUint32(recordCursor, true), phflags: data.getUint32(recordCursor + 4, true),
        program: data.getUint16(recordCursor + 8, true), code: bytes[recordCursor + 10], type: bytes[recordCursor + 11],
        startType: bytes[recordCursor + 12], endType: bytes[recordCursor + 13], stdLength: bytes[recordCursor + 14], lengthMod: bytes[recordCursor + 15]
      });
      entries[record.code] = record;
      if (record.code > highestCode) highestCode = record.code;
    }
  }
  return Object.freeze({ index: targetIndex, name: name, nPhonemes: highestCode + 1, entries: Object.freeze(entries) });
}

// Input is a C string of unsigned phoneme codes. The virtual terminal NUL lets
// dictionary slices omit their terminator without exposing unrelated backing.
export function decodePhonemes(codes, selectedTable) {
  byteInput(codes, 'phoneme codes');
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  var output = [];
  for (var index = 0; index < codes.length;) {
    var code = codes[index++];
    if (code === 0) break;
    if (code === 255) continue;
    var ph = selectedTable.entries[code];
    if (ph === null) continue;
    if (ph.type === 1 && ph.stdLength <= 4 && ph.program === 0) {
      if (ph.stdLength > 1) output.push(ph.stdLength === 4 ? 39 : 44);
    } else {
      var mnemonic = ph.mnemonic;
      while ((mnemonic & 0xff) !== 0) { output.push(mnemonic & 0xff); mnemonic >>>= 8; }
      if (code === 21) {
        // dictionary.c uses C-locale isalpha, not Unicode alphabetic properties.
        while (index < codes.length && ((codes[index] >= 65 && codes[index] <= 90) || (codes[index] >= 97 && codes[index] <= 122))) output.push(codes[index++]);
      }
    }
  }
  return Uint8Array.from(output);
}
