// Port of pinned setlengths.c:CalcLengths for fixed en-us.
// GPL-3.0-or-later. Copyright (C) 2005-2014 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt.
import { PROSODY_PROFILE } from '../../data/prosody/profile.js';
import { CMN_PROSODY_PROFILE } from '../../data/cmn/synthesis-profile.js';
import { createPhonemeInterpreter, createPhonemeListBuffer } from './phoneme-interpreter.js';

export var LENGTH_CONSTANTS = Object.freeze({
  phPAUSE: 0, phVOWEL: 2, phLIQUID: 3, phSTOP: 4, phVSTOP: 5,
  phFRICATIVE: 6, phVFRICATIVE: 7, phNASAL: 8,
  SFLAG_SEQCONTINUE: 1, SFLAG_EMBEDDED: 2, SFLAG_SYLLABLE: 4, SFLAG_LENGTHEN: 8,
  PHLIST_END_OF_CLAUSE: 2, phonPAUSE_VSHORT: 23, phonPAUSE_CLAUSE: 27,
  phVOICELESS: 1 << 3, phSIBILANT: 1 << 5, phBRKAFTER: 1 << 14,
  phNONSYLLABIC: 1 << 20, phLENGTHENSTOP: 1 << 22, phNOPAUSE: 1 << 24,
  S_NO_EOC_LENGTHEN: 0x200000, S_EO_CLAUSE1: 0x40000, EMBED_S: 2
});
const C = LENGTH_CONSTANTS;
const ENVELOPE = Object.freeze({
  0: Object.freeze({ first: 255, last: 0 }),
  1: Object.freeze({ first: 255, last: 0 }),
  2: Object.freeze({ first: 0, last: 255 }),
  3: Object.freeze({ first: 0, last: 255 }),
  4: Object.freeze({ first: 255, last: 224 }),
  5: Object.freeze({ first: 207, last: 224 }),
  6: Object.freeze({ first: 255, last: 32 }),
  7: Object.freeze({ first: 208, last: 32 })
});

function unsupported(reason) {
  const error = new Error('CalcLengths dependency not implemented: ' + reason);
  error.code = 'CALC_LENGTHS_UNSUPPORTED'; error.reason = reason; throw error;
}

function envelope(index) {
  if (!Object.prototype.hasOwnProperty.call(ENVELOPE, index)) unsupported('intonation-envelope-' + index);
  return ENVELOPE[index];
}

function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid ' + name);
  return value;
}

function divide(value, divisor) { return Math.trunc(value / divisor); }

export function createLengthCalculator(selectedTable, profile, dependencies) {
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  const supplied = profile || PROSODY_PROFILE;
  const knownProfiles = { 'en-us': PROSODY_PROFILE, cmn: CMN_PROSODY_PROFILE };
  const expectedProfile = knownProfiles[supplied.voice];
  if (!expectedProfile || JSON.stringify(supplied) !== JSON.stringify(expectedProfile)) throw new Error('Unsupported CalcLengths profile');
  const stressAmps = supplied.stressAmps, stressLengths = supplied.stressLengths, lenSpeeds = supplied.lenSpeeds;
  const lengthMods = supplied.length_mods, lengthMods0 = supplied.length_mods0;
  const suppliedDependencies = dependencies || {};
  let toneInterpreter = null, phondataBytes = null;
  if (supplied.voice === 'cmn') {
    if (!(suppliedDependencies.phonindexBytes instanceof Uint8Array) ||
        !(suppliedDependencies.phondataBytes instanceof Uint8Array)) {
      throw new TypeError('Expected complete cmn tone phoneme data');
    }
    phondataBytes = suppliedDependencies.phondataBytes;
    toneInterpreter = createPhonemeInterpreter(suppliedDependencies.phonindexBytes, selectedTable);
  }

  function toneEnvelopeFirst(code) {
    const isolated = createPhonemeListBuffer(4);
    for (let index = 0; index < 4; index++) isolated.phcode[index] = 9;
    isolated.phcode[1] = code;
    isolated.phonemeId[1] = code + 1;
    isolated.sourceix[2] = 1;
    const toneData = toneInterpreter.interpret(isolated, 1, { start: 0, control: 0, translator: false, wordData: null });
    const address = toneData.pitchEnv;
    if (address === 0) return ENVELOPE[0].first;
    if (address < 0 || address + 128 > phondataBytes.length) unsupported('tone-envelope-bounds');
    return phondataBytes[address];
  }

  function calculate(list, count, embedded) {
    if (!list || !Number.isInteger(count) || count < 2 || count > list.phcode.length) throw new RangeError('Invalid phoneme list bounds');
    let moreSyllables = 0, preSonorant = false, preVoiced = false, lastPitch = 0;
    for (let ix = 1; ix < count; ix++) {
      const prevIndex = ix - 1, nextIndex = ix + 1, next2Index = ix + 2, next3Index = ix + 3;
      const currentPh = selectedTable.entries[list.phcode[ix]];
      const prevPh = selectedTable.entries[list.phcode[prevIndex]];
      const nextPh = selectedTable.entries[list.phcode[nextIndex]];
      const next2Ph = selectedTable.entries[list.phcode[next2Index]];
      const next3Ph = selectedTable.entries[list.phcode[next3Index]];
      if (!currentPh || !prevPh || !nextPh || !next2Ph || !next3Ph) unsupported('phoneme-neighbor');
      let stress = list.stresslevel[ix] & 7;
      const emphasized = list.stresslevel[ix] & 8;
      if (list.synthflags[ix] & C.SFLAG_EMBEDDED) {
        if (!embedded || !Array.isArray(embedded.list)) unsupported('embedded-command-context');
        let command;
        do {
          if (embedded.index >= embedded.list.length) unsupported('embedded-command-bounds');
          command = embedded.list[embedded.index++];
          if ((command & 31) === C.EMBED_S) unsupported('embedded-speed');
        } while (!(command & 128) && embedded.index < embedded.list.length);
      }
      let type = list.type[ix];
      if (list.synthflags[ix] & C.SFLAG_SYLLABLE) type = C.phVOWEL;

      if (type === C.phPAUSE) {
        lastPitch = 0;
      } else if (type === C.phSTOP) {
        lastPitch = 0;
        if (list.type[prevIndex] === C.phFRICATIVE) list.prepause[ix] = 25;
        else if (moreSyllables > 0 || stress < 4) list.prepause[ix] = 48;
        else list.prepause[ix] = 60;
        if (list.type[prevIndex] === C.phSTOP) list.prepause[ix] = 60;
        if ((supplied.word_gap & 0x10) && list.newword[ix]) list.prepause[ix] = 60;
        if (currentPh.phflags & C.phLENGTHENSTOP) list.prepause[ix] += 30;
        if (list.synthflags[ix] & C.SFLAG_LENGTHEN) list.prepause[ix] += supplied.long_stop;
      } else if (type === C.phVFRICATIVE || type === C.phFRICATIVE) {
        if (list.newword[ix]) {
          if (!(list.type[prevIndex] === C.phVOWEL && (currentPh.phflags & C.phNOPAUSE))) list.prepause[ix] = 15;
        }
        if (list.type[nextIndex] === C.phPAUSE && list.type[prevIndex] === C.phNASAL && !(currentPh.phflags & C.phVOICELESS)) list.prepause[ix] = 25;
        if (prevPh.phflags & C.phBRKAFTER) list.prepause[ix] = 30;
        if ((supplied.word_gap & 0x10) && list.newword[ix]) list.prepause[ix] = 30;
        if ((currentPh.phflags & C.phSIBILANT) && list.type[nextIndex] === C.phSTOP && !list.newword[nextIndex]) {
          list.length[ix] = list.type[prevIndex] === C.phVOWEL ? 200 : 150;
        } else list.length[ix] = 256;
        if (type === C.phVFRICATIVE) {
          if (list.type[nextIndex] === C.phVOWEL) preVoiced = true;
          if (list.type[prevIndex] === C.phVOWEL || list.type[prevIndex] === C.phLIQUID) list.length[ix] = divide(255 + list.length[prevIndex], 2);
        }
      } else if (type === C.phVSTOP) {
        if (list.type[prevIndex] === C.phVFRICATIVE || list.type[prevIndex] === C.phFRICATIVE ||
            (prevPh.phflags & C.phSIBILANT) || list.type[prevIndex] === C.phLIQUID) list.prepause[ix] = 30;
        if (list.type[nextIndex] === C.phVOWEL || list.type[nextIndex] === C.phLIQUID) {
          if (list.type[nextIndex] === C.phVOWEL || !list.newword[nextIndex]) preVoiced = true;
          list.prepause[ix] = 40;
          if (list.type[prevIndex] === C.phVOWEL) list.prepause[ix] = 0;
          else if (list.type[prevIndex] === C.phPAUSE) {
            if (list.length[prevIndex] < list.prepause[ix]) list.prepause[ix] -= list.length[prevIndex];
            else list.prepause[ix] = 0;
          } else if (list.newword[ix] === 0) {
            if (list.type[prevIndex] === C.phLIQUID) list.prepause[ix] = 20;
            if (list.type[prevIndex] === C.phNASAL) list.prepause[ix] = 12;
            if (list.type[prevIndex] === C.phSTOP && !(prevPh.phflags & C.phVOICELESS)) list.prepause[ix] = 0;
          }
        }
        if ((supplied.word_gap & 0x10) && list.newword[ix] && list.prepause[ix] < 20) list.prepause[ix] = 20;
      } else if (type === C.phLIQUID || type === C.phNASAL) {
        list.amp[ix] = stressAmps[0];
        list.length[ix] = 256;
        if (list.newword[ix]) {
          if (list.type[prevIndex] === C.phLIQUID) list.prepause[ix] = 25;
          if (list.type[prevIndex] === C.phVOWEL && !(currentPh.phflags & C.phNOPAUSE)) list.prepause[ix] = 12;
        }
        if (list.type[nextIndex] === C.phVOWEL) preSonorant = true;
        else {
          list.pitch2[ix] = lastPitch;
          if (list.type[prevIndex] === C.phVOWEL || list.type[prevIndex] === C.phLIQUID) {
            list.length[ix] = list.length[prevIndex];
            if (list.type[ix] === C.phLIQUID) list.length[ix] = lenSpeeds[0];
            if (list.type[nextIndex] === C.phVSTOP) list.length[ix] = divide(list.length[ix] * 160, 100);
            if (list.type[nextIndex] === C.phVFRICATIVE) list.length[ix] = divide(list.length[ix] * 120, 100);
          } else {
            for (let at = ix; at < count; at++) {
              if (list.type[at] === C.phVOWEL) { list.pitch2[ix] = list.pitch2[at]; break; }
            }
          }
          list.pitch1[ix] = list.pitch2[ix] - 16;
          if (list.pitch2[ix] < 16) list.pitch1[ix] = 0;
          list.env[ix] = 0;
          preVoiced = false;
        }
      } else if (type === C.phVOWEL) {
        let minDrop = 0;
        if (stress > 7) stress = 7;
        if (stress <= 1) stress ^= 1;
        if (preSonorant) list.amp[ix] = stressAmps[stress] - 1;
        else list.amp[ix] = stressAmps[stress];
        if (emphasized) list.amp[ix] = 25;
        if (ix >= count - 3 && list.amp[ix] > supplied.maxAmpEoc) list.amp[ix] = supplied.maxAmpEoc;

        moreSyllables = 0;
        let endOfClause = 0, p2Index = ix + 1;
        while (list.newword[p2Index] === 0) {
          const p2Ph = selectedTable.entries[list.phcode[p2Index]];
          if (list.type[p2Index] === C.phVOWEL && !(p2Ph.phflags & C.phNONSYLLABIC)) moreSyllables++;
          if (p2Ph.code === C.phonPAUSE_CLAUSE) endOfClause = 2;
          p2Index++;
        }
        const p2Ph = selectedTable.entries[list.phcode[p2Index]];
        if (p2Ph.code === C.phonPAUSE_CLAUSE) endOfClause = 2;
        if ((list.newword[p2Index] & C.PHLIST_END_OF_CLAUSE) && moreSyllables === 0) endOfClause = 2;

        let nextIndex2 = nextIndex, next2Index2 = next2Index, next3Index2 = next3Index;
        if (nextPh.code === C.phonPAUSE_VSHORT && list.type[next2Index] === C.phPAUSE) {
          nextIndex2 = next2Index; next2Index2 = next3Index; next3Index2 = ix + 4;
        }
        const nextPh2 = selectedTable.entries[list.phcode[nextIndex2]];
        const next2Ph2 = selectedTable.entries[list.phcode[next2Index2]];
        const next3Ph2 = selectedTable.entries[list.phcode[next3Index2]];
        if (!nextPh2 || !next2Ph2 || !next3Ph2) unsupported('phoneme-neighbor');
        let next2Type = next2Ph2.lengthMod;
        let lengthMod;
        if (moreSyllables === 0) {
          if (list.newword[nextIndex2] || list.newword[next2Index2]) {
            if (next2Type !== 1) next2Type = 0;
          }
          const len = lengthMods0[next2Type * 10 + nextPh2.lengthMod];
          if (list.newword[nextIndex2] && (supplied.word_gap & 0x20)) {
            lengthMod = divide(len + lengthMods0[nextPh2.lengthMod * 10 + 1], 2);
          } else lengthMod = len;
        } else {
          lengthMod = lengthMods[next2Type * 10 + nextPh.lengthMod];
          if (list.type[nextIndex2] === C.phNASAL && (list.type[next2Index2] === C.phSTOP || list.type[next2Index2] === C.phVSTOP) &&
              (next3Ph2.phflags & C.phVOICELESS)) lengthMod -= 15;
        }
        if (moreSyllables === 0) lengthMod *= lenSpeeds[0];
        else if (moreSyllables === 1) lengthMod *= lenSpeeds[1];
        else lengthMod *= lenSpeeds[2];
        lengthMod = divide(lengthMod, 128);
        if (lengthMod < 8) lengthMod = 8;
        if (stress >= 7) {
          lengthMod += supplied.lengthen_tonic;
          if (emphasized) lengthMod += divide(supplied.lengthen_tonic, 2);
        } else if (emphasized) lengthMod += supplied.lengthen_tonic;
        let len = stressLengths[stress];
        if (len === 0) len = stressLengths[6];
        lengthMod *= len;
        if (list.tonePh[ix] !== 0) {
          const tonePh = selectedTable.entries[list.tonePh[ix]];
          if (tonePh && tonePh.stdLength > 0) lengthMod = divide(lengthMod * tonePh.stdLength, 100);
        }
        if (endOfClause === 2 && !(supplied.stress_flags & C.S_NO_EOC_LENGTHEN)) {
          len = currentPh.stdLength * 2;
          if (supplied.stress_flags & C.S_EO_CLAUSE1) len = 200;
          lengthMod = divide(lengthMod * (256 + divide(280 - len, 3)), 256);
        }
        if (lengthMod > supplied.max_lengthmod * lenSpeeds[0]) lengthMod = supplied.max_lengthmod * lenSpeeds[0];
        lengthMod = divide(lengthMod, 128);
        if (list.type[ix] !== C.phVOWEL) { lengthMod = 256; minDrop = 16; }
        list.length[ix] = lengthMod;

        const env2 = list.env[ix] + 1;
        const pitchEnvelopeFirst = list.tonePh[ix] !== 0 ? toneEnvelopeFirst(list.tonePh[ix]) : envelope(env2).first;
        const pitchStart = list.pitch1[ix] + divide((list.pitch2[ix] - list.pitch1[ix]) * pitchEnvelopeFirst, 256);
        if (preSonorant || preVoiced) {
          if (pitchStart === 255) lastPitch = pitchStart;
          if (pitchStart - lastPitch > 16) lastPitch = pitchStart - 16;
          list.pitch1[prevIndex] = lastPitch;
          list.pitch2[prevIndex] = pitchStart;
          if (lastPitch < pitchStart) {
            list.env[prevIndex] = 2;
            list.env[ix] = env2;
          } else list.env[prevIndex] = 0;
          list.length[prevIndex] = lengthMod;
          list.amp[prevIndex] = list.amp[ix];
          if (list.type[prevIndex] !== C.phLIQUID && list.amp[prevIndex] > 18) list.amp[prevIndex] = 18;
        }

        list.synthflags[nextIndex] &= ~C.SFLAG_SEQCONTINUE;
        if (list.type[nextIndex] === C.phNASAL && list.type[next2Index] !== C.phVOWEL) list.synthflags[nextIndex] |= C.SFLAG_SEQCONTINUE;
        if (list.type[nextIndex] === C.phLIQUID) {
          list.synthflags[nextIndex] |= C.SFLAG_SEQCONTINUE;
          if (list.type[next2Index] === C.phVOWEL) list.synthflags[nextIndex] &= ~C.SFLAG_SEQCONTINUE;
          if (list.type[next2Index] !== C.phVOWEL && nextPh.mnemonic === (0x2f * 256 + 0x72)) list.synthflags[nextIndex] &= ~C.SFLAG_SEQCONTINUE;
        }
        if (minDrop > 0 && list.pitch2[ix] - list.pitch1[ix] < minDrop) {
          let pitch1 = list.pitch2[ix] - minDrop;
          if (pitch1 < 0) pitch1 = 0;
          list.pitch1[ix] = pitch1;
        }
        lastPitch = list.pitch1[ix] + divide((list.pitch2[ix] - list.pitch1[ix]) * envelope(list.env[ix]).last, 256);
        preSonorant = false;
        preVoiced = false;
      }
    }
    return { list, count };
  }

  return { calculate: calculate };
}
