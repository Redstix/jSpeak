// Pinned phonemelist.c:MakePhonemeList through its pre-VM boundary.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington;
// 2015-2016 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { PHONEME_PREPARE_PROFILE, VOICE_PHONEME_REPLACEMENTS, PHONEME_PREPARE_CONSTANTS as C } from '../../data/phoneme-prepare/profile.js';
export { PHONEME_PREPARE_PROFILE };
var BYTE_COLUMNS = ['phcode', 'stresslevel', 'wordstress', 'tonePh'];
var SHORT_COLUMNS = ['sourceix', 'synthflags'];
var COLUMNS = BYTE_COLUMNS.concat(SHORT_COLUMNS);
function unsupported(reason) {
  var error = new Error('Phoneme-list preparation dependency not implemented: ' + reason);
  error.code = 'PHONEME_PREPARE_UNSUPPORTED'; error.reason = reason; throw error;
}
function cloneList(input, capacity) {
  if (!input || !Number.isInteger(input.length) || input.length < 3 || input.length > capacity) throw new RangeError('Invalid first-stage phoneme-list count');
  var list = { length: input.length };
  for (var i = 0; i < COLUMNS.length; i++) {
    var name = COLUMNS[i], Type = i < 4 ? Uint8Array : Uint16Array;
    if (!(input[name] instanceof Type) || input[name].length !== capacity) throw new TypeError('Expected complete first-stage column: ' + name);
    list[name] = new Type(input[name]);
  }
  return list;
}
export function preparePhonemeList(input, table, profile) {
  if (!table || table.index !== 80 || table.name !== 'en-us') throw new TypeError('Expected original en-us phoneme table');
  if (!profile) throw new TypeError('Expected explicit initialized preparation profile');
  var keys = Object.keys(PHONEME_PREPARE_PROFILE);
  for (var k = 0; k < keys.length; k++) if (profile[keys[k]] !== PHONEME_PREPARE_PROFILE[keys[k]]) throw new Error('Unsupported preparation profile: ' + keys[k]);
  var list = cloneList(input, profile.capacity), count = list.length;
  if (list.phcode[count - 2] !== C.phonPAUSE || list.phcode[count - 1] !== C.phonPAUSE) throw new RangeError('Original caller must append two terminating pauses');
  var endSourceIndex = list.sourceix[count - 1], maximum = 0, j;
  for (j = count - 3; j >= 0; j--) {
    if ((list.stresslevel[j] & 0x7f) > maximum) maximum = list.stresslevel[j] & 0x7f;
    if (list.sourceix[j] !== 0) break;
  }
  if (maximum < 4) while (--j >= 0) {
    if (list.synthflags[j] & C.SFLAG_PROMOTE_STRESS) { list.stresslevel[j] = 4; break; }
    if (list.stresslevel[j] >= 4) break;
  }

  var deleted = 0, selected = profile.phonemeTable, deletedSource = -1;
  for (j = 0; j < count; j++) {
    if (selected !== profile.phonemeTable) list.synthflags[j] |= C.SFLAG_SWITCHED_LANG;
    if (deleted > 0) {
      for (var name of COLUMNS) list[name][j - deleted] = list[name][j];
      if (deletedSource !== -1) { list.sourceix[j - deleted] = deletedSource; deletedSource = -1; }
    }
    if (list.phcode[j] === C.phonSWITCH) {
      if (!(list.synthflags[j] & C.SFLAG_EMBEDDED) &&
          (list.tonePh[j] === selected || list.phcode[j + 1] === C.phonSWITCH ||
           (list.phcode[j + 1] === C.phonPAUSE && list.phcode[j + 2] === C.phonSWITCH))) {
        if (deletedSource === -1 && list.sourceix[j] !== 0) deletedSource = list.sourceix[j];
        deleted++;
      } else {
        selected = list.tonePh[j];
        if (selected !== profile.phonemeTable) unsupported('phoneme-table-switch');
      }
    }
  }
  list.length -= deleted;
  if (profile.regressiveVoicing !== 0) unsupported('regressive-voicing');

  var working = { count: 0 };
  for (var byteName of BYTE_COLUMNS.concat(['type'])) working[byteName] = new Uint8Array(profile.capacity);
  for (var shortName of SHORT_COLUMNS.concat(['phonemeId'])) working[shortName] = new Uint16Array(profile.capacity);
  var next = null; deletedSource = -1;
  for (j = 0; j < list.length && working.count < profile.capacity; j++) {
    if (deletedSource !== -1) { list.sourceix[j] = deletedSource; deletedSource = -1; }
    if (list.phcode[j] === C.phonSWITCH && list.tonePh[j] !== profile.phonemeTable) unsupported('phoneme-table-switch');
    if (!(list.synthflags[j] & C.SFLAG_SWITCHED_LANG)) {
      if (j < list.length - 1) next = table.entries[list.phcode[j + 1]];
      var wordEnd = j === list.length - 1 || list.sourceix[j + 1] !== 0 || (next !== null && next.type === 0);
      for (var r = 0; r < VOICE_PHONEME_REPLACEMENTS.length; r++) {
        var replacement = VOICE_PHONEME_REPLACEMENTS[r];
        if (list.phcode[j] !== replacement.oldPhoneme) continue;
        var flags = replacement.flags;
        if ((flags & 1) && !wordEnd) continue;
        if ((flags & 2) && (list.stresslevel[j] & 7) > 3) continue;
        if ((flags & 4) && list.sourceix[j] === 0) continue;
        list.phcode[j] = replacement.newPhoneme;
        var changed = table.entries[list.phcode[j]];
        if (list.stresslevel[j] > 1 && changed !== null && (changed.phflags & C.phUNSTRESSED)) list.stresslevel[j] = 0;
        break;
      }
      if (list.phcode[j] === 0) { deletedSource = list.sourceix[j]; continue; }
    }
    var ph = table.entries[list.phcode[j]];
    if (ph === null) { deletedSource = list.sourceix[j]; continue; }
    for (var column of COLUMNS) working[column][working.count] = list[column][j];
    working.type[working.count] = ph.type; working.phonemeId[working.count] = ph.code + 1; working.count++;
  }
  var bodyLength = working.count - 2;
  for (j = 0; j < bodyLength;) {
    if (working.sourceix[j]) {
      var wordStress = 0, nextWord = j;
      while (nextWord < bodyLength) {
        if (working.stresslevel[nextWord] > wordStress) wordStress = working.stresslevel[nextWord];
        nextWord++;
        if (working.sourceix[nextWord]) break;
      }
      for (var at = j; at < nextWord; at++) working.wordstress[at] = wordStress;
      j = nextWord;
    } else j++;
  }
  // Original code changes this pointer before entering the VM loop; phcode remains unchanged.
  working.phonemeId[0] = C.phonPAUSE + 1;
  return { list2: list, working: working, bodyLength: bodyLength, endSourceIndex: endSourceIndex, selectedTableIndex: profile.phonemeTable };
}
