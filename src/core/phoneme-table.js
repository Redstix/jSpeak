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
