import { CMN_PROSODY_PROFILE } from '../../data/cmn/prosody-profile.js';
import { createEnglishPitchCalculator } from './calc-pitches-en.js';
import { createTonePitchCalculator } from './calc-pitches-tone.js';

export function createPitchCalculator(selectedTable, options) {
  if (options && options.toneLanguage === 1) {
    return createTonePitchCalculator(selectedTable, { ...CMN_PROSODY_PROFILE, ...options });
  }
  return createEnglishPitchCalculator(selectedTable, options);
}
