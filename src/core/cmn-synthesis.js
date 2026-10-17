import { CMN_SYNTHESIS_PROFILE } from '../../data/cmn/synthesis-profile.js';
import { DEFAULT_22050_VOICE } from './wave-command-planner.js';
import { createLanguageSynthesizer } from './language-synthesis.js';

export function createCmnSynthesizer({ dictionaryBytes, phontabBytes, phonindexBytes, phondataBytes }) {
  return createLanguageSynthesizer({
    profile: CMN_SYNTHESIS_PROFILE,
    voiceState: DEFAULT_22050_VOICE,
    dictionaryBytes,
    phontabBytes,
    phonindexBytes,
    phondataBytes
  });
}
