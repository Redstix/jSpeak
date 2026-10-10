// Pinned phonemelist.c:MakePhonemeList after the pre-VM preparation boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington;
// 2015-2016, 2020 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import {
  PHONEME_LIST_FIELDS, createPhonemeData, createPhonemeInterpreter,
  createPhonemeListBuffer, createWordPhonemeData
} from './phoneme-interpreter.js';
import { PHONEME_PREPARE_PROFILE } from '../../data/phoneme-prepare/profile.js';

export var MAKE_PHONEME_LIST_PROFILE = Object.freeze({ ...PHONEME_PREPARE_PROFILE });
const C = Object.freeze({
  phonPAUSE: 9, phonPAUSE_SHORT: 10, phonPAUSE_NOLINK: 11, phonPAUSE_VSHORT: 23,
  phonPAUSE_LONG: 24, phonSWITCH: 21, SFLAG_EMBEDDED: 2, SFLAG_SYLLABLE: 4,
  SFLAG_LENGTHEN: 8, SFLAG_SWITCHED_LANG: 32, PITCHfall: 0, S_NO_DIM: 2,
  phPAUSE: 0, phVOWEL: 2, phLIQUID: 3, phNASAL: 8, phVSTOP: 5, phVFRICATIVE: 7,
  phPREVOICE: 1 << 25, START_OF_WORD: 1, END_OF_CLAUSE: 2, START_OF_SENTENCE: 4,
  START_OF_CLAUSE: 8
});
const FIELD_NAMES = Object.keys(PHONEME_LIST_FIELDS);

function unsupported(reason) {
  const error = new Error('MakePhonemeList dependency not implemented: ' + reason);
  error.code = 'MAKE_PHONEME_LIST_UNSUPPORTED'; error.reason = reason; throw error;
}

function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
}

function copyRow(list, from, to) {
  for (const field of FIELD_NAMES) list[field][to] = list[field][from];
}

function clearRow(list, index) {
  for (const field of FIELD_NAMES) list[field][index] = 0;
}

function clonePrepared(prepared, table, capacity) {
  if (!prepared || !prepared.working || !Number.isInteger(prepared.working.count)) throw new TypeError('Expected prepared phoneme list');
  const working = prepared.working, count = integer(working.count, 3, capacity, 'working count');
  const list = createPhonemeListBuffer(capacity);
  list.count = count;
  for (let i = 0; i < count; i++) {
    list.synthflags[i] = working.synthflags[i];
    list.phcode[i] = working.phcode[i];
    list.stresslevel[i] = working.stresslevel[i];
    list.sourceix[i] = working.sourceix[i];
    list.wordstress[i] = working.wordstress[i];
    list.tonePh[i] = working.tonePh[i];
    list.type[i] = working.type[i];
    list.phonemeId[i] = working.phcode[i] + 1;
  }
  if (!table || !Array.isArray(table.entries) || table.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  return list;
}

function reinterpretPhoneme(vm, list, index, ph, oldPh, wordData, phdata, reduce) {
  if (ph.type === C.phVOWEL) {
    list.synthflags[index] |= C.SFLAG_SYLLABLE;
    if (oldPh.type !== C.phVOWEL) list.stresslevel[index] = 0;
  } else list.synthflags[index] &= ~C.SFLAG_SYLLABLE;
  vm.interpret(list, index, { start: 0, control: 0x100, translator: true, reduce, wordData }, phdata);
}

export function createPhonemeListMaker(phonindexBytes, selectedTable, profile) {
  if (!(phonindexBytes instanceof Uint8Array) || (phonindexBytes.length & 1) || phonindexBytes.length < 2) throw new TypeError('Expected complete phonindex bytes');
  if (!selectedTable || selectedTable.index !== 80 || selectedTable.name !== 'en-us') throw new TypeError('Expected original en-us phoneme table');
  const supplied = profile || MAKE_PHONEME_LIST_PROFILE;
  const keys = Object.keys(MAKE_PHONEME_LIST_PROFILE);
  for (const key of keys) if (supplied[key] !== MAKE_PHONEME_LIST_PROFILE[key]) throw new Error('Unsupported MakePhonemeList profile: ' + key);
  if (supplied.regressiveVoicing !== 0 || supplied.vowelPause !== 0 || supplied.wordGap !== 0 || supplied.optionWordgap !== 0) {
    unsupported('nonzero-prosody-option');
  }
  const vm = createPhonemeInterpreter(phonindexBytes, selectedTable);
  const capacity = supplied.capacity;
  const output = createPhonemeListBuffer(capacity);

  function make(prepared, options) {
    const opts = options || {};
    const postPause = integer(opts.postPause === undefined ? 0 : opts.postPause, 0, 0xffffffff, 'post pause');
    const startSentence = opts.startSentence === undefined ? false : !!opts.startSentence;
    const reduce = integer(opts.reduce === undefined ? 0 : opts.reduce, 0, 0xffffffff, 'reduce');
    const list = clonePrepared(prepared, selectedTable, capacity);
    const bodyLength = integer(prepared.bodyLength, 1, capacity - 2, 'body length');
    const endSourceIndex = integer(prepared.endSourceIndex, 0, 0xffff, 'end source index');
    const wordData = createWordPhonemeData();
    const phdata = createPhonemeData();
    let ix = 0, insertPh = 0, wordStart = 1, startOfClause = true, sentenceStart = startSentence, unstressCount = 0;

    for (let j = 0; insertPh || (j < bodyLength && ix < capacity - 3); j++) {
      let inserted = false, deleted = false, ph = null, next = null;
      if (insertPh !== 0) {
        if (j <= 0) unsupported('phoneme-insertion-at-start');
        next = selectedTable.entries[list.phcode[j]];
        j--;
        if (j > 0) {
          let from = wordStart > 0 ? wordStart-- : 2;
          if (from < 1) from = 1;
          for (let k = from; k <= j; k++) copyRow(list, k, k - 1);
        }
        clearRow(list, j);
        list.phcode[j] = insertPh;
        list.phonemeId[j] = insertPh + 1;
        ph = selectedTable.entries[insertPh];
        if (!ph) unsupported('inserted-invalid-phoneme');
        list.type[j] = ph.type;
        insertPh = 0;
        inserted = true;
      } else {
        if (list.sourceix[j] !== 0) wordStart = j;
        ph = selectedTable.entries[list.phcode[j]];
        if (!ph) continue;
        list.phonemeId[j] = list.phcode[j] + 1;
        list.type[j] = ph.type;
        if (list.phcode[j] === C.phonSWITCH) unsupported('phoneme-table-switch');
        next = selectedTable.entries[list.phcode[j + 1]] || null;
        list.phonemeId[j + 1] = list.phcode[j + 1] + 1;
        list.type[j + 1] = next ? next.type : 0;
      }

      vm.interpret(list, j, { start: 0, control: 0x100, translator: true, reduce, wordData }, phdata);

      let alternative = phdata.param[2];
      if (alternative > 0) {
        const changed = selectedTable.entries[alternative];
        if (!changed) unsupported('changed-next-invalid-phoneme');
        list.phcode[j + 1] = alternative;
        list.phonemeId[j + 1] = alternative + 1;
        list.type[j + 1] = changed.type;
        next = changed;
      }

      alternative = phdata.param[3];
      if (alternative > 0 && !inserted) {
        const oldPh = ph, changed = selectedTable.entries[alternative];
        if (!changed) unsupported('inserted-invalid-phoneme');
        insertPh = list.phcode[j];
        ph = changed;
        list.phcode[j] = alternative;
        list.phonemeId[j] = alternative + 1;
        list.type[j] = changed.type;
        reinterpretPhoneme(vm, list, j, ph, oldPh, wordData, phdata, reduce);
      }

      alternative = phdata.param[1];
      if (alternative > 0) {
        const oldPh = ph, changed = selectedTable.entries[alternative];
        if (!changed) unsupported('changed-invalid-phoneme');
        ph = changed;
        list.phcode[j] = alternative;
        list.phonemeId[j] = alternative + 1;
        list.type[j] = changed.type;
        if (alternative === 1) deleted = true;
        else reinterpretPhoneme(vm, list, j, ph, oldPh, wordData, phdata, reduce);
      }

      if (ph.type === C.phVOWEL && !deleted) {
        if (list.stresslevel[j] <= 1) {
          unstressCount++;
          if (supplied.stressFlags & 0x08) {
            for (let at = j + 1; at < list.count; at++) {
              const rowPh = selectedTable.entries[list.phcode[at]];
              if (!rowPh || rowPh.type === C.phPAUSE) break;
              if (rowPh.type === C.phVOWEL) {
                if (list.stresslevel[at] <= 1) {
                  if (list.wordstress[j] < 4) list.stresslevel[j] = 0;
                  if (list.wordstress[at] < 4) list.stresslevel[at] = 0;
                }
                break;
              }
            }
          } else if (unstressCount > 1 && (unstressCount & 1) === 0) {
            if ((supplied.stressFlags & C.S_NO_DIM) || (list.wordstress[j] > 3 && list.sourceix[j + 1] !== 0)) unstressCount = 1;
            else list.stresslevel[j] = 0;
          }
        } else unstressCount = 0;
      }

      if ((list.synthflags[j + 1] & C.SFLAG_LENGTHEN) && j > 0 && next && [6, 7, 8, 3].includes(next.type)) {
        insertPh = next.code;
        list.synthflags[j + 1] ^= C.SFLAG_LENGTHEN;
      }

      if (list.sourceix[j + 1] !== 0 && !inserted && ix > 0) {
        const gap = supplied.wordGap & 7;
        if (gap !== 0 && (gap > 1 || (insertPh !== C.phonPAUSE_SHORT && insertPh !== C.phonPAUSE_NOLINK))) {
          insertPh = [0, C.phonPAUSE_VSHORT, C.phonPAUSE_SHORT, C.phonPAUSE, C.phonPAUSE_LONG, 0, C.phonPAUSE_LONG, C.phonPAUSE_LONG][gap];
        }
        if (supplied.optionWordgap > 0) insertPh = C.phonPAUSE_LONG;
      }

      if (insertPh === 0 && phdata.param[4] !== 0) insertPh = phdata.param[4];

      if (!deleted) {
        output.phcode[ix] = ph.code;
        output.phonemeId[ix] = ph.code + 1;
        output.type[ix] = ph.type;
        output.env[ix] = C.PITCHfall;
        output.synthflags[ix] = list.synthflags[j];
        output.stresslevel[ix] = list.stresslevel[j] & 15;
        output.wordstress[ix] = list.wordstress[j];
        output.tonePh[ix] = list.tonePh[j];
        output.tonePhId[ix] = list.tonePh[j] !== 0 && (list.synthflags[j] & C.SFLAG_SWITCHED_LANG) ? list.tonePh[j] + 1 : 0;
        output.sourceix[ix] = 0;
        output.newword[ix] = 0;
        if (list.sourceix[j] !== 0) {
          output.sourceix[ix] = list.sourceix[j];
          output.newword[ix] = C.START_OF_WORD;
          if (sentenceStart) { output.newword[ix] |= C.START_OF_SENTENCE; sentenceStart = false; }
          if (startOfClause) { output.newword[ix] |= C.START_OF_CLAUSE; startOfClause = false; }
        }
        output.length[ix] = phdata.param[10] * 2;
        if (ph.code === C.phonPAUSE_LONG && supplied.optionWordgap > 0 && list.sourceix[j + 1] !== 0) {
          output.phcode[ix] = C.phonPAUSE_SHORT;
          output.length[ix] = supplied.optionWordgap * 14;
          const pause = selectedTable.entries[C.phonPAUSE_SHORT];
          output.type[ix] = pause ? pause.type : 0;
        }
        if (ph.type === C.phVOWEL || ph.type === C.phLIQUID || ph.type === C.phNASAL ||
            ph.type === C.phVSTOP || ph.type === C.phVFRICATIVE || (ph.phflags & C.phPREVOICE)) {
          output.length[ix] = 128;
          output.env[ix] = C.PITCHfall;
        }
        output.prepause[ix] = 0;
        output.amp[ix] = 20;
        output.pitch1[ix] = 255;
        output.pitch2[ix] = 255;
        ix++;
      }
    }

    output.newword[ix] = C.END_OF_CLAUSE;
    output.phcode[ix] = C.phonPAUSE;
    output.type[ix] = C.phPAUSE;
    output.length[ix] = postPause;
    output.sourceix[ix] = endSourceIndex;
    output.synthflags[ix] = 0;
    output.prepause[ix] = 0;
    output.phonemeId[ix] = C.phonPAUSE + 1;
    ix++;

    output.newword[ix] = 0;
    output.phcode[ix] = C.phonPAUSE;
    output.type[ix] = C.phPAUSE;
    output.length[ix] = 0;
    output.sourceix[ix] = 0;
    output.synthflags[ix] = 0;
    output.prepause[ix] = 0;
    output.phonemeId[ix] = C.phonPAUSE_SHORT + 1;
    ix++;

    output.count = ix;
    return { list: output, count: ix };
  }

  return { make: make, profile: Object.freeze({ ...supplied }) };
}
