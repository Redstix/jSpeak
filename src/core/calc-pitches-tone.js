const TONE = Object.freeze({
  phonPAUSE: 9,
  phonDEFAULTTONE: 17,
  SFLAG_SYLLABLE: 4,
  T11: 0x3131,
  T21: 0x3135,
  T22: 0x3232,
  T33: 0x3333,
  T35: 0x3335,
  T44: 0x3434,
  T53: 0x3533,
  T55: 0x3535,
  T214: 0x343132,
  CODE_11: 108,
  CODE_15: 118,
  CODE_21: 110,
  CODE_22: 113,
  CODE_33: 114,
  CODE_35: 115,
  CODE_44: 117,
  CODE_53: 120,
  CODE_55: 121
});

function requireTonePhoneme(table, code) {
  const phoneme = table.entries[code];
  if (!phoneme) throw new Error('Missing Mandarin tone phoneme: ' + code);
  return phoneme;
}

export function createTonePitchCalculator(selectedTable, profile) {
  if (!selectedTable || selectedTable.index !== 8 || selectedTable.name !== 'cmn') throw new TypeError('Expected cmn phoneme table');
  if (!profile || profile.voice !== 'cmn' || profile.translatorName !== 6516078 ||
      profile.phonemeTable !== 8 || profile.toneLanguage !== 1) throw new Error('Unsupported cmn tone profile');
  const pausePhoneme = requireTonePhoneme(selectedTable, TONE.phonPAUSE);
  const defaultTone = requireTonePhoneme(selectedTable, TONE.phonDEFAULTTONE);

  function calculate(list, count, clauseType) {
    if (!list || !Number.isInteger(count) || count < 1 || count > list.phcode.length) throw new RangeError('Invalid phoneme list bounds');
    if (!Number.isInteger(clauseType) || clauseType < 0 || clauseType > 4) throw new RangeError('Invalid clause type');
    let finalStressed = 0;
    for (let index = 0; index < count; index++) {
      if (list.type[index] === 2 && list.stresslevel[index] >= 4) finalStressed = index;
    }
    list.stresslevel[finalStressed] = 7;

    let pause = true;
    let tonePromoted = false;
    let previousIndex = 0;
    let previousPhoneme = pausePhoneme;
    let previousWordPhoneme = pausePhoneme;
    for (let index = 0; index < count; index++) {
      const phoneme = requireTonePhoneme(selectedTable, list.phcode[index]);
      if (list.type[index] === 0 && phoneme.stdLength > 50) {
        pause = true;
        previousWordPhoneme = pausePhoneme;
      }
      if (list.newword[index]) previousPhoneme = pausePhoneme;
      if (list.synthflags[index] & TONE.SFLAG_SYLLABLE) {
        let tonePh = list.tonePh[index];
        let tonePhoneme = requireTonePhoneme(selectedTable, tonePh);
        if (tonePh === 0) {
          if (pause || tonePromoted) {
            tonePh = TONE.CODE_55;
            tonePromoted = true;
          } else {
            tonePh = TONE.CODE_11;
            tonePromoted = false;
          }
          list.tonePh[index] = tonePh;
          tonePhoneme = requireTonePhoneme(selectedTable, tonePh);
        } else tonePromoted = false;

        if (index === finalStressed &&
            (tonePhoneme.mnemonic === TONE.T55 || tonePhoneme.mnemonic === TONE.T21)) {
          list.stresslevel[finalStressed] = 6;
        }
        if (previousWordPhoneme.mnemonic === TONE.T214) {
          list.tonePh[previousIndex] = tonePhoneme.mnemonic === TONE.T214 ? TONE.CODE_35 : TONE.CODE_21;
        }
        if (previousPhoneme.mnemonic === TONE.T21 && tonePhoneme.mnemonic === TONE.T21) {
          list.tonePh[previousIndex] = TONE.CODE_53;
        }
        if (tonePhoneme.mnemonic === TONE.T11) {
          if (previousWordPhoneme.mnemonic === TONE.T55) list.tonePh[index] = TONE.CODE_22;
          if (previousWordPhoneme.mnemonic === TONE.T53) list.tonePh[index] = TONE.CODE_33;
          if (previousWordPhoneme.mnemonic === TONE.T214) list.tonePh[index] = TONE.CODE_44;
          list.stresslevel[index] = 0;
        }
        previousIndex = index;
        previousWordPhoneme = previousPhoneme = tonePhoneme;
        pause = false;
      }
    }

    let pitchAdjust = 0;
    const pitchDecrement = 0;
    const pitchLow = 0;
    const pitchHigh = 0;
    for (let index = 0; index < count; index++) {
      if (list.synthflags[index] & TONE.SFLAG_SYLLABLE) {
        let tonePh = list.tonePh[index];
        if (list.stresslevel[index] !== 0) {
          if (index === finalStressed) pitchAdjust = pitchLow;
          else {
            pitchAdjust -= pitchDecrement;
            if (pitchAdjust <= pitchLow) pitchAdjust = pitchHigh;
          }
        }
        if (tonePh === 0) {
          tonePh = TONE.phonDEFAULTTONE;
          list.tonePh[index] = tonePh;
        }
        const tonePhoneme = requireTonePhoneme(selectedTable, tonePh);
        list.pitch1[index] = pitchAdjust + tonePhoneme.startType;
        list.pitch2[index] = pitchAdjust + tonePhoneme.endType;
      }
    }
    return { list, count };
  }

  return { calculate };
}
