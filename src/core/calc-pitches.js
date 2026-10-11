// Port of pinned intonation.c:CalcPitches for fixed en-us.
// GPL-3.0-or-later. Copyright (C) 2005-2007 Jonathan Duddington;
// 2015-2016 Reece H. Dunn. See licenses/espeak-ng/COPYING.txt.
import { PROSODY_TUNES } from '../../data/prosody/tunes.js';
import { CMN_PROSODY_PROFILE } from '../../data/cmn/prosody-profile.js';
import { createTonePitchCalculator } from './calc-pitches-tone.js';

export var PITCH_CONSTANTS = Object.freeze({
  PITCHfall: 0, PITCHrise: 2, PITCHfrise: 4, PITCHfrise2: 6,
  SYL_RISE: 1, SYL_EMPHASIS: 2, SYL_END_CLAUSE: 4,
  SECONDARY: 3, PRIMARY: 4, PRIMARY_STRESSED: 6, PRIMARY_LAST: 7,
  phonPAUSE_CLAUSE: 27, SFLAG_SYLLABLE: 4, OPTION_EMPHASIZE_PENULTIMATE: 1
});
const C = PITCH_CONSTANTS;
const MIN_DROP = Object.freeze([6, 7, 9, 9, 20, 20, 20, 25]);
const DROPS_0 = Object.freeze([9, 9, 16, 16, 16, 23, 55, 32]);

function clampPitch(value) { return value < 0 ? 0 : value > 254 ? 254 : value; }

function setPitch(syllable, base, drop) {
  if (base < 0) base = 0;
  let flags = 0;
  syllable.pitch2 = base;
  if (drop < 0) { flags = C.SYL_RISE; drop = -drop; }
  syllable.pitch1 = clampPitch(syllable.pitch2 + drop);
  syllable.pitch2 = clampPitch(syllable.pitch2);
  syllable.flags |= flags;
}

function setPitchGradient(syllables, start, end, startPitch, endPitch) {
  let increment = (endPitch - startPitch) * 256;
  const count = end - start;
  if (count <= 0) return;
  if (count > 1) increment = Math.trunc(increment / count);
  let pitch = startPitch * 256;
  for (let ix = start; ix < end; ix++) {
    const syllable = syllables[ix], stress = syllable.stress;
    if (increment > 0) {
      setPitch(syllable, Math.trunc(pitch / 256), -Math.trunc(increment / 256));
      pitch += increment;
    } else {
      let drop = -Math.trunc(increment / 256);
      if (drop < MIN_DROP[stress]) drop = MIN_DROP[stress];
      pitch += increment;
      if (drop > 18) drop = 18;
      setPitch(syllable, Math.trunc(pitch / 256), drop);
    }
  }
}

function countIncrements(syllables, ix, end, minimumStress) {
  let count = 0;
  while (ix < end) {
    const stress = syllables[ix++].stress;
    if (stress >= C.PRIMARY_LAST) break;
    if (stress >= minimumStress) count++;
  }
  return count;
}

function countUnstressed(syllables, start, end, limit) {
  let ix = start;
  while (ix <= end && syllables[ix].stress < limit) ix++;
  return ix - start;
}

function setHeadIntonation(syllables, tune, syllableIndex, endIndex) {
  let pitch = 0, increment = 0, steps = 0, stage = 0, overflowIndex = 0;
  let unstressedCount = 0, unstressedIndex = 0, unstressedIncrement = 0;
  let initial = true, usedOnset = false, headFinal = endIndex;
  const secondary = 2;
  const pitchRange = (tune.headEnd - tune.headStart) * 256;
  const pitchRangeAbs = Math.abs(pitchRange);
  if (tune.onset === 255) stage = 1;
  if (tune.headLast !== 255) {
    for (let ix = endIndex - 1; ix >= syllableIndex; ix--) if (syllables[ix].stress >= 4) { headFinal = ix; break; }
  }
  while (syllableIndex < endIndex) {
    const syllable = syllables[syllableIndex], stress = syllable.stress;
    if (initial || stress >= 4) {
      if (initial || stress === 5) {
        initial = false; overflowIndex = 0;
        if (tune.onset === 255) {
          steps = countIncrements(syllables, syllableIndex, headFinal, 4);
          pitch = tune.headStart * 256;
        } else {
          steps = countIncrements(syllables, syllableIndex + 1, headFinal, 4);
          pitch = tune.onset * 256;
          usedOnset = true;
        }
        if (steps > tune.headMaxSteps) steps = tune.headMaxSteps;
        increment = steps > 1 ? Math.trunc(pitchRange / (steps - 1)) : 0;
      } else if (syllableIndex === headFinal) {
        pitch = tune.headLast * 256; stage = 2;
      } else {
        if (usedOnset) {
          stage = 1; usedOnset = false; pitch = tune.headStart * 256; steps++;
        } else if (steps > 0) pitch += increment;
        else {
          pitch = tune.headEnd * 256 + Math.trunc(pitchRangeAbs * tune.headExtend[overflowIndex++] / 64);
          if (overflowIndex >= tune.nHeadExtend) overflowIndex = 0;
        }
      }
      steps--;
    }
    if (stress >= C.PRIMARY) {
      unstressedCount = countUnstressed(syllables, syllableIndex + 1, endIndex, secondary);
      unstressedIndex = 0;
      syllable.stress = C.PRIMARY_STRESSED;
      syllable.env = tune.stressedEnv;
      setPitch(syllable, Math.trunc(pitch / 256), tune.stressedDrop);
    } else if (stress >= secondary) {
      unstressedCount = countUnstressed(syllables, syllableIndex + 1, endIndex, secondary);
      unstressedIndex = 0;
      setPitch(syllable, Math.trunc(pitch / 256), DROPS_0[stress]);
    } else {
      unstressedIncrement = unstressedCount > 1
        ? Math.trunc((tune.unstrEnd[stage] - tune.unstrStart[stage]) / (unstressedCount - 1))
        : 0;
      setPitch(syllable, Math.trunc(pitch / 256) + tune.unstrStart[stage] + unstressedIncrement * unstressedIndex, DROPS_0[stress]);
      unstressedIndex++;
    }
    syllableIndex++;
  }
  return syllableIndex;
}

function countPitchVowels(syllables, start, end, clauseEnd, noTonic, state) {
  let maxStress = 0, maxStressPosition = 0, maxStressPosition2 = 0, lastPrimary = -1;
  state.numberPre = -1; state.numberTail = 0;
  for (let ix = start; ix < end; ix++) {
    const stress = syllables[ix].stress;
    if (stress >= maxStress) {
      if (stress > maxStress) maxStressPosition2 = ix;
      else maxStressPosition2 = maxStressPosition;
      maxStressPosition = ix; maxStress = stress;
    }
    if (stress >= C.PRIMARY) {
      if (state.numberPre < 0) state.numberPre = ix - start;
      lastPrimary = ix;
    }
  }
  if (state.numberPre < 0) state.numberPre = end;
  state.numberTail = end - maxStressPosition - 1;
  state.tonePosition = maxStressPosition;
  state.tonePosition2 = maxStressPosition2;
  if (noTonic) { state.tonePosition = state.tonePosition2 = end; }
  else if (lastPrimary >= 0) {
    if (end === clauseEnd) syllables[lastPrimary].stress = C.PRIMARY_LAST;
  } else syllables[state.tonePosition].stress = C.PRIMARY_LAST;
}

function calcPitches2(syllables, start, end, tuneNumber, optionToneFlags, noTonic, state) {
  const tune = PROSODY_TUNES[tuneNumber];
  let ix = start;
  setPitchGradient(syllables, ix, ix + state.numberPre, tune.preheadStart, tune.preheadEnd);
  ix += state.numberPre;
  if (optionToneFlags & C.OPTION_EMPHASIZE_PENULTIMATE) state.tonePosition = state.tonePosition2;
  ix = setHeadIntonation(syllables, tune, ix, state.tonePosition);
  if (noTonic) return 0;
  let tonePitchEnv;
  if (state.numberTail === 0) {
    tonePitchEnv = tune.nucleus0Env;
    setPitch(syllables[ix++], tune.nucleus0Min, tune.nucleus0Max - tune.nucleus0Min);
  } else {
    tonePitchEnv = tune.nucleus1Env;
    setPitch(syllables[ix++], tune.nucleus1Min, tune.nucleus1Max - tune.nucleus1Min);
  }
  syllables[state.tonePosition].env = tonePitchEnv;
  if (syllables[state.tonePosition].stress === C.PRIMARY) syllables[state.tonePosition].stress = C.PRIMARY_STRESSED;
  setPitchGradient(syllables, ix, end, tune.tailStart, tune.tailEnd);
  return tonePitchEnv;
}

function calcPitches(syllables, control, start, end, tuneNumber, optionToneFlags, noTonic, state) {
  if (control === 0) return calcPitches2(syllables, start, end, tuneNumber, optionToneFlags, noTonic, state);
  throw new Error('Unsupported intonation control: ' + control);
}

export function createPitchCalculator(selectedTable, options) {
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  const opts = options || {};
  if (opts.intonationGroup !== undefined && opts.intonationGroup !== 0) throw new Error('Unsupported intonation group');
  if (opts.toneLanguage === 1) return createTonePitchCalculator(selectedTable, { ...CMN_PROSODY_PROFILE, ...opts });
  if (opts.toneLanguage !== undefined && opts.toneLanguage !== 0) throw new Error('Unsupported tone language');
  const optionToneFlags = opts.optionToneFlags === undefined ? 0 : opts.optionToneFlags;
  if (!Number.isInteger(optionToneFlags) || optionToneFlags < 0 || optionToneFlags > 0xffffffff) throw new RangeError('Invalid option tone flags');

  function calculate(list, count, clauseType) {
    if (!list || !Number.isInteger(count) || count < 1 || count > list.phcode.length) throw new RangeError('Invalid phoneme list bounds');
    if (!Number.isInteger(clauseType) || clauseType < 0 || clauseType > 4) throw new RangeError('Invalid clause type');
    const syllables = new Array(count + 1);
    for (let i = 0; i <= count; i++) syllables[i] = { stress: 0, env: 0, flags: 0, nextphType: 0, pitch1: 0, pitch2: 0 };
    let syllableCount = 0, primaryCount = 0;
    for (let ix = 0; ix < count - 1; ix++) {
      const synthflags = list.synthflags[ix], stresslevel = list.stresslevel[ix], phcode = list.phcode[ix];
      syllables[ix].flags = 0;
      if (synthflags & C.SFLAG_SYLLABLE) {
        const syllable = syllables[syllableCount];
        syllable.env = C.PITCHfall;
        syllable.nextphType = list.type[ix + 1];
        syllable.stress = stresslevel;
        syllableCount++;
        if (syllable.stress >= 4) primaryCount++;
      } else if (phcode === C.phonPAUSE_CLAUSE && syllableCount > 0) {
        syllables[syllableCount - 1].flags |= C.SYL_END_CLAUSE;
      }
    }
    syllables[syllableCount].stress = 0;
    if (syllableCount === 0) return { list, count };

    const noTonic = clauseType === 4;
    const state = { numberPre: 0, numberTail: 0, tonePosition: 0, tonePosition2: 0 };
    let groupTone = clauseType === 4 ? 0 : clauseType, groupToneComma = 1;
    let start = 0, primarySeen = 0;
    for (let syllableIndex = 0; syllableIndex < syllableCount; syllableIndex++) {
      const syllable = syllables[syllableIndex];
      if (syllable.stress >= 4) primarySeen++;
      if (syllable.stress === 6) {
        for (let ix = syllableIndex - 1; ix >= start && ix >= syllableIndex - 3; ix--) {
          if (syllables[ix].stress === 6) break;
          if (syllables[ix].stress === 4) { syllables[ix].stress = 3; break; }
        }
        for (let ix = syllableIndex + 1; ix < syllableCount; ix++) {
          if (syllables[ix].stress === 4) break;
          if (syllables[ix].stress === 6) { syllables[syllableIndex].flags = C.SYL_EMPHASIS; syllable.stress = 5; break; }
        }
      }
      if (syllable.stress === 6) {
        syllable.flags = C.SYL_EMPHASIS;
        let tail = 0;
        if (primaryCount - primarySeen > 1) tail = 1;
        let ix = syllableIndex + 1;
        while (ix < syllableCount) {
          if (syllables[ix].stress > 4) break;
          if (syllables[ix].stress === 4) { tail++; if (tail > 1) break; }
          ix++;
        }
        countPitchVowels(syllables, start, ix, syllableCount, noTonic, state);
        if (ix < syllableCount || clauseType === 0) {
          calcPitches(syllables, 0, start, ix, groupTone, optionToneFlags, noTonic, state);
          groupTone = clauseType === 1 || clauseType === 2 ? 1 : 0;
        } else calcPitches(syllables, 0, start, ix, groupTone, optionToneFlags, noTonic, state);
        start = ix;
      }
      if (start < syllableIndex && syllable.flags & C.SYL_END_CLAUSE) {
        const clauseEnd = syllableIndex + 1;
        countPitchVowels(syllables, start, clauseEnd, clauseEnd, noTonic, state);
        calcPitches(syllables, 0, start, clauseEnd, groupToneComma, optionToneFlags, noTonic, state);
        start = clauseEnd;
      }
    }
    if (start < syllableCount) {
      countPitchVowels(syllables, start, syllableCount, syllableCount, noTonic, state);
      calcPitches(syllables, 0, start, syllableCount, groupTone, optionToneFlags, noTonic, state);
    }

    let syllableIndex = 0;
    for (let ix = 0; ix < count; ix++) {
      const synthflags = list.synthflags[ix];
      list.stresslevel[ix] = syllables[syllableIndex].stress;
      if (synthflags & C.SFLAG_SYLLABLE) {
        const syllable = syllables[syllableIndex];
        list.pitch1[ix] = syllable.pitch1;
        list.pitch2[ix] = syllable.pitch2;
        list.env[ix] = C.PITCHfall;
        if (syllable.flags & C.SYL_RISE) list.env[ix] = C.PITCHrise;
        else if (list.stresslevel[ix] > 5) list.env[ix] = syllable.env;
        if (list.pitch1[ix] > list.pitch2[ix]) {
          const swap = list.pitch1[ix];
          list.pitch1[ix] = list.pitch2[ix];
          list.pitch2[ix] = swap;
        }
        if (list.tonePh[ix] !== 0) {
          const phoneme = selectedTable.entries[list.tonePh[ix]];
          if (phoneme) {
            const middle = Math.trunc((list.pitch1[ix] + list.pitch2[ix]) / 2);
            list.pitch2[ix] = middle + phoneme.endType;
            list.pitch1[ix] = middle + phoneme.startType;
          }
        }
        if (syllable.flags & C.SYL_EMPHASIS) list.stresslevel[ix] |= 8;
        syllableIndex++;
      }
    }
    return { list, count };
  }

  return { calculate: calculate };
}
