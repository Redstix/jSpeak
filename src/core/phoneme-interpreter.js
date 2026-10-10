// Port of pinned synthdata.c:InterpretPhoneme and its condition helpers.
// Copyright (C) 2005-2014 Jonathan Duddington. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt. Compiled phonindex bytes are supplied by the adapter.

export var PHONEME_LIST_FIELDS = Object.freeze({
  synthflags: 16, phcode: 8, stresslevel: 8, sourceix: 16, wordstress: 8, tonePh: 8,
  phonemeId: 16, tonePhId: 16, length: 32, env: 8, type: 8, prepause: 8, amp: 8,
  newword: 8, pitch1: 8, pitch2: 8, stdLength: 8, phontabAddr: 32, soundParam: -32
});
var FIELD_NAMES = Object.keys(PHONEME_LIST_FIELDS);
var INSTRUCTION_WORDS = [0, 1, 0, 0, 1, 1, 0, 1, 1, 2, 4, 0, 0, 0, 0, 0];
function fail(reason) {
  var error = new Error('Unsupported phoneme instruction execution: ' + reason);
  error.name = 'UnsupportedPhonemeInterpreterError'; error.code = 'PHONEME_INTERPRETER_UNSUPPORTED'; error.reason = reason; throw error;
}
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + name);
  return value;
}
export function createPhonemeListBuffer(capacity) {
  integer(capacity, 1, 1001, 'phoneme list capacity');
  var list = {};
  for (var i = 0; i < FIELD_NAMES.length; i++) {
    var key = FIELD_NAMES[i], width = PHONEME_LIST_FIELDS[key];
    list[key] = width === 8 ? new Uint8Array(capacity) : width === 16 ? new Uint16Array(capacity) : width === 32 ? new Uint32Array(capacity) : new Int32Array(capacity);
  }
  return list;
}
export function createPhonemeData() {
  return { control: 0, param: new Int32Array(16), soundAddr: new Int32Array(5), soundParam: new Int32Array(5),
    vowelTransition: new Int32Array(4), pitchEnv: 0, ampEnv: 0, ipa: new Uint8Array(18) };
}
export function createWordPhonemeData() { return { prevVowel: createPhonemeListBuffer(1) }; }

export function createPhonemeInterpreter(bytes, selectedTable) {
  if (!(bytes instanceof Uint8Array) || (bytes.length & 1) || bytes.length < 2) throw new TypeError('Expected complete little-endian phonindex bytes');
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  // Own one immutable bytecode copy. Programs retain original 16-bit word offsets.
  var program = new Uint16Array(bytes.length / 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (var p = 0; p < program.length; p++) program[p] = view.getUint16(p * 2, true);
  var entries = selectedTable.entries, returns = new Int32Array(10);
  function word(pc) { if (pc < 0 || pc >= program.length) fail('program-bounds'); return program[pc]; }
  function resolve(list, index) {
    var id = list.phonemeId[index];
    if (id === 0) return null;
    if (id > 256) fail('phoneme-table-reference');
    return entries[id - 1];
  }
  function numWords(pc) {
    var instruction = word(pc), type = instruction >>> 12;
    if (INSTRUCTION_WORDS[type] > 0) return INSTRUCTION_WORDS[type];
    if (type === 0) return ((instruction & 0xf00) >>> 8) === 13 ? (((instruction & 255) + 1) >> 1) + 1 : 1;
    if (type === 6) { var sub = (instruction & 0xf00) >>> 9; return sub === 5 || sub === 6 ? 12 : 1; }
    if (type === 2 || type === 3) { var which = instruction & 0xf00; return which === 0x600 || which === 0xd00 ? 2 : 1; }
    var next = word(pc + 2);
    return next >>> 12 === 15 ? 4 : next === 2 ? 3 : 2;
  }
  function interpret(list, index, options, output) {
    options = options || {}; output = output || createPhonemeData();
    if (!list || !(list.phcode instanceof Uint8Array)) throw new TypeError('Expected phoneme list columns');
    var capacity = list.phcode.length;
    for (var f = 0; f < FIELD_NAMES.length; f++) {
      var key = FIELD_NAMES[f], width = PHONEME_LIST_FIELDS[key];
      var ctor = width === 8 ? Uint8Array : width === 16 ? Uint16Array : width === 32 ? Uint32Array : Int32Array;
      if (!(list[key] instanceof ctor) || list[key].length !== capacity) throw new TypeError('Invalid phoneme list column ' + key);
    }
    integer(index, 0, capacity - 1, 'phoneme index');
    var start = options.start === undefined ? 0 : integer(options.start, 0, index, 'phoneme list start');
    var control = options.control === undefined ? 0 : integer(options.control, 0, 0xffffffff, 'phoneme control');
    var translator = options.translator === undefined ? true : options.translator;
    if (typeof translator !== 'boolean') throw new TypeError('Expected translator presence');
    var reduce = options.reduce === undefined ? 0 : integer(options.reduce, -2147483648, 2147483647, 'reduction option');
    var wordData = options.wordData || null;
    var klatt = options.klatt === undefined ? 0 : integer(options.klatt, -2147483648, 2147483647, 'Klatt parameter');
    var budget = options.instructionBudget === undefined ? 100000 : integer(options.instructionBudget, 1, 10000000, 'instruction budget');
    function at(i, target) { target = target || list; if (i < 0 || i >= target.phcode.length) fail('list-bounds'); return i; }
    function phAt(i, target) { target = target || list; return resolve(target, at(i, target)); }
    function stress(target, i, condition, stressControl) {
      var ph = entries[target.phcode[at(i, target)]];
      var vowelIndex;
      if (ph !== null && ph.type === 2) vowelIndex = i;
      else { var next = entries[target.phcode[at(i + 1, target)]]; if (next !== null && next.type === 2) vowelIndex = i + 1; else return false; }
      var level = target.stresslevel[vowelIndex] & 15;
      if (translator) {
        if ((stressControl & 1) && (target.synthflags[i] & 16) && !(reduce & 1)) return false;
        if ((reduce & 2) && level >= target.wordstress[vowelIndex]) level = 4;
      }
      if (condition === 4) return level >= target.wordstress[vowelIndex];
      if (condition === 3) return level > 3;
      if (condition > 4) fail('invalid-stress-condition');
      return level < [1, 2, 4, 15][condition];
    }
    function condition(pc) {
      var instruction = word(pc) & 0xfff, data = instruction & 255, group = instruction >>> 8;
      if (group >= 14) {
        if (group !== 15) return false;
        if (data === 1) return !!(control & 1);
        if (data === 2) return klatt !== 0; // pinned build USE_KLATT=1
        return false; // pinned build USE_MBROLA=0
      }
      var which = group % 7, target = list, i = index, endType = false;
      if (which === 6) which = word(pc + 1);
      if (which === 4 && list.sourceix[at(index + 1)]) return false;
      if (which === 5 && list.sourceix[index]) return false;
      if (which === 6 && (list.sourceix[at(index + 1)] || list.sourceix[at(index + 2)])) return false;
      switch (which) {
      case 0: case 5: if (index < start + 1) return false; i--; endType = true; break;
      case 1: break;
      case 2: case 4: i++; break;
      case 3: case 6: i += 2; break;
      case 7:
        for (var nextIndex = index + 1;; nextIndex++) {
          if (list.sourceix[at(nextIndex)]) return false;
          var nextPh = entries[list.phcode[nextIndex]];
          if (nextPh === null) return false;
          if (nextPh.type === 2) { i = nextIndex; break; }
        }
        break;
      case 8: if (!wordData || !wordData.prevVowel.phonemeId[0]) return false; target = wordData.prevVowel; i = 0; endType = true; break;
      case 9: for (var next3 = 1; next3 <= 3; next3++) if (list.sourceix[at(index + next3)]) return false; i += 3; break;
      case 10: if (index < start + 2 || list.sourceix[index] || list.sourceix[index - 1]) return false; i -= 2; endType = true; break;
      }
      at(i, target);
      if ((which === 0 || which === 5) && target.phcode[i] === 1) { if (i <= start) return false; i--; }
      if (control & 0x100) target.phonemeId[i] = entries[target.phcode[i]] === null ? 0 : target.phcode[i] + 1;
      var ph = phAt(i, target);
      if (ph === null) return false;
      if (group < 7) {
        var match = entries[data];
        if (match !== null && match.mnemonic === ph.mnemonic) return true;
        return data === (endType && ph.type === 2 ? ph.endType : ph.startType);
      }
      data = instruction & 31;
      switch (instruction & 0xe0) {
      case 0: return ph.type === data;
      case 0x20: return ((ph.phflags >>> 16) & 15) === data;
      case 0x40: return !!(ph.phflags & (1 << data));
      case 0x80:
        if (data <= 4) return stress(target, i, data, 0);
        switch (data) {
        case 17: return ph.type === 0 || !!(list.synthflags[index] & 0x2000);
        case 18: return target.sourceix[i] !== 0;
        case 19: return !!target.sourceix[at(i + 1, target)] || phAt(i + 1, target) === null || phAt(i + 1, target).type === 0;
        case 9:
          if (target.sourceix[i]) return false;
          if (target !== list) fail('previous-vowel-backward-query');
          do { if (i <= start) return false; i--; if ((target.stresslevel[i] & 15) >= 4) return true; } while (!target.sourceix[i]);
          return false;
        case 10: return ph.type !== 2;
        case 11:
          for (;;) { i++; if (target.sourceix[at(i, target)]) return true; var following = phAt(i, target); if (following === null) return true; if (following.type === 2) return false; }
        case 12: return ph.type === 2 || ph.type === 3 || !!(ph.phflags & 16);
        case 13: case 14:
          if (target !== list) fail('previous-vowel-backward-query');
          var count = 0;
          for (;;) { var positionPh = phAt(i); if (positionPh !== null && positionPh.type === 2) count++; if (target.sourceix[i] || i === start) break; i--; }
          return count === data - 12;
        case 16: return !!(target.synthflags[i] & 16);
        }
      }
      return false;
    }
    var ph = phAt(index);
    if (ph === null) fail('null-current-phoneme');
    if (wordData && list.sourceix[index]) wordData.prevVowel.phonemeId[0] = 0;
    output.control = output.pitchEnv = output.ampEnv = 0;
    output.param.fill(0); output.soundAddr.fill(0); output.soundParam.fill(0); output.vowelTransition.fill(0); output.ipa.fill(0);
    output.param[10] = ph.stdLength; output.param[9] = ph.lengthMod;
    if (ph.program === 0) return output; // Original returns before plist/prev_vowel writes.
    var end = 0, returnCount = 0;
    for (var pc = ph.program; end !== 1; pc++) {
      if (--budget < 0) fail('instruction-budget');
      var instruction = word(pc), group = (instruction >>> 8) & 15, data = instruction & 255;
      switch (instruction >>> 12) {
      case 0:
        if (group === 0) { if (data === 1) end = 1; else if (data !== 2) fail('invalid-instruction'); }
        else if (group === 5) { var next = entries[list.phcode[at(index + 1)]]; if (next !== null && next.type === 2) output.param[4] = data; }
        else if (group === 12) output.param[10] += data & 128 ? data - 256 : data;
        else if (group === 13) {
          var ix;
          for (ix = 0; ix < data && ix < 16; ix += 2) { pc++; output.ipa[ix] = word(pc) >>> 8; output.ipa[ix + 1] = word(pc) & 255; }
          output.ipa[ix] = 0;
        } else { output.param[group] = data; if (group === 1 && (control & 0x100)) end = 1; }
        break;
      case 1:
        if (translator && group < 8 && stress(list, index, group & 7, 1)) { output.param[1] = data; end = 1; }
        break;
      case 2: case 3:
        var or = 0, truth = true;
        while ((instruction & 0xe000) === 0x2000) {
          if (--budget < 0) fail('instruction-budget');
          var nextTruth = condition(pc); pc += numWords(pc);
          if (word(pc) === 3) { nextTruth = !nextTruth; pc++; }
          truth = or ? truth || nextTruth : truth && nextTruth;
          or = instruction & 0x1000; instruction = word(pc);
        }
        if (!truth) {
          if ((instruction & 0xf800) === 0x6800) pc += instruction & 255;
          else { pc += numWords(pc); if ((word(pc) & 0xfe00) === 0x6000) pc++; }
        }
        pc--; break;
      case 6:
        switch (group >>> 1) {
        case 0: pc += data - 1; break;
        case 4: break;
        case 5: case 6:
          var kind = (group >>> 1) === 5 ? 2 : 3;
          if (kind === 2) output.control |= 2;
          var neighbor = phAt(index + (kind === 2 ? 1 : -1));
          if (neighbor === null) break; // Original also leaves program pointer on the switch header.
          var vowel = (kind === 2 ? neighbor.startType : neighbor.endType) - 28;
          if (vowel >= 0 && vowel < 6) {
            var selected = pc + vowel * 2, descriptor = word(selected + 1), parameter = (descriptor >>> 4) & 255;
            output.soundAddr[kind] = (((descriptor & 15) << 16) + word(selected + 2)) * 4;
            output.soundParam[kind] = parameter & 128 ? parameter - 256 : parameter;
          }
          pc += 12; break;
        }
        break;
      case 9:
        data = ((instruction & 15) << 16) + word(pc + 1); pc++;
        if (group === 1) { if (returnCount < 10) { returns[returnCount++] = pc; pc = data - 1; } }
        else if (group === 2) output.pitchEnv = data;
        else if (group === 3) output.ampEnv = data;
        break;
      case 10:
        var offset = group === 1 ? 0 : 2;
        output.vowelTransition[offset] = ((instruction & 255) << 16) + word(pc + 1);
        output.vowelTransition[offset + 1] = (word(pc + 2) << 16) + word(pc + 3);
        pc += 3; break;
      case 11: case 12: case 13: case 14: case 15:
        var kind = (instruction >>> 12) - 11;
        output.soundAddr[kind] = ((instruction & 15) << 18) + (word(pc + 1) << 2);
        var parameter = output.soundParam[kind] = (instruction >>> 4) & 255;
        pc++;
        if (word(pc + 1) !== 2) {
          if (kind < 2) end = word(pc + 1) >>> 12 === 15 ? 2 : 1;
          else if (kind === 4) end--;
          if (kind === 2 || kind === 3) output.soundParam[kind] = parameter & 128 ? parameter - 256 : parameter;
        }
        break;
      default: fail('invalid-instruction');
      }
      if (end === 1 && returnCount > 0) { end = 0; pc = returns[--returnCount]; }
    }
    if (wordData && list.type[index] === 2) for (var f = 0; f < FIELD_NAMES.length; f++) wordData.prevVowel[FIELD_NAMES[f]][0] = list[FIELD_NAMES[f]][index];
    list.stdLength[index] = output.param[10];
    var sound = output.soundAddr[0] !== 0 ? 0 : 1;
    list.phontabAddr[index] = output.soundAddr[sound]; list.soundParam[index] = output.soundParam[sound];
    return output;
  }
  return Object.freeze({ interpret: interpret, wordCount: program.length, selectedTable: selectedTable });
}
