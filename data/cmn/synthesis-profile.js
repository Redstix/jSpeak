// Fixed initialized Mandarin synthesis profile. GPL-3.0-or-later.
import { LETTER_BITS, LETTER_GROUPS, REMOVE_ACCENT } from '../rules/profile.js';
import { PROSODY_PROFILE as EN_PROSODY_PROFILE } from '../prosody/profile.js';
import { CMN_PROSODY_PROFILE as CMN_TONE_PROSODY_PROFILE } from './prosody-profile.js';

export var CMN_DICTIONARY_MANIFEST = Object.freeze({
  schemaVersion: 1,
  magic: 'JSPEAK_RAW_DICTIONARY',
  format: 'espeak-ng-dict-v1',
  upstreamCommit: 'ba90c8e9f440ad544f674a790bb5f53878b6ffc5',
  language: 'cmn',
  voice: 'cmn',
  byteLength: 1578875,
  hash32: -1467526186,
  hashSpec: 'xorshift32-byte-mix-seed0',
  rulesOffset: 1577487
});

export var CMN_RULE_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8,
  dictCondition: 0, letterBitsOffset: 0, toneNumbers: 1, textmode: 1, suffix: 0,
  diereses: 0, bracketPause: 4, bracketPauseAnnounced: 2,
  altAlphabet: 0, altAlphabetLanguage: 25966, removeAccentLimit: 606
});

export var CMN_RULE_DATA = Object.freeze({
  letterBits: LETTER_BITS,
  letterGroups: LETTER_GROUPS,
  removeAccent: REMOVE_ACCENT
});

export var CMN_PHONEMIZER_PROFILE = Object.freeze({
  voice: 'cmn', combineWords: 0, maxDigits: 14,
  breakNumbers: 1227133512, thousandsSep: 44, decimalSep: 46,
  optionEndpause: 0, cliOptionEndpause: 4096
});

export var CMN_TEXT_CHARACTER_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, dotlessI: 0,
  letterBitsOffset: 0, ideographs: 1, altAlphabet: 0,
  altAlphabetLanguage: 25966, toneNumbers: 1, capsInWord: 0,
  apostrophe: 0, punctWithinWord: Object.freeze([39]), charPlusApostrophe: Object.freeze([])
});
export var CMN_REPLACEMENT_BYTES = new Uint8Array(0);

export var CMN_WORD_TRANSLATION_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8, dictCondition: 0,
  wordBytes: 160, phonemeBytes: 200, numbers: 1, numbers2: 0,
  stressFlags: 2, prefixes: 0, alt: 0, unpronouncable: 115,
  maxInitialConsonants: 3, accents: 0, ourAlphabet: 12544, altAlphabet: 0,
  minRoman: 2, maxRoman: 49, spellingStress: false, OPTION_EMPHASIZE_ALLCAPS: 256
});

export var CMN_WORD_STRESS_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8,
  stressRule: 3, stressFlags: 2, unstressedWord1: 1, unstressedWord2: 3,
  vowelPause: 0, itLengthen: 0, wordPhonemeCapacity: 200
});

export var CMN_WORD_ENDING_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, suffixAddE: 0,
  wordCopyCapacity: 160, endingCapacity: 50
});

export var CMN_PHONEME_LIST_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8,
  capacity: 1000, embeddedCapacity: 250, phonemeCapacity: 200
});

export var CMN_PHONEME_PREPARE_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8,
  capacity: 1000, regressiveVoicing: 0, stressFlags: 2,
  vowelPause: 0, wordGap: 33, optionWordgap: 0
});
export var CMN_PHONEME_REPLACEMENTS = Object.freeze([]);

export var CMN_NUMBER_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, dictCondition: 0,
  phonemeTable: 8, numbers: 1, numbers2: 0, minRoman: 2, maxRoman: 49,
  thousandsSeparator: 44, decimalSeparator: 46, romanSuffix: '', ordinalIndicator: null
});

export var CMN_PROSODY_PROFILE = Object.freeze({
  voice: 'cmn', translatorName: 6516078, phonemeTable: 8,
  stressAmps: Object.freeze([22, 16, 22, 22, 22, 22, 22, 22]),
  stressLengths: Object.freeze([230, 150, 230, 230, 230, 0, 240, 250]),
  lenSpeeds: Object.freeze([87, 80, 78]),
  maxAmpEoc: 19, max_lengthmod: 500, lengthen_tonic: 20, long_stop: 100,
  stress_flags: 2, word_gap: 33, sonorantMin: 95, longVowelThreshold: 95,
  length_mods: EN_PROSODY_PROFILE.length_mods,
  length_mods0: EN_PROSODY_PROFILE.length_mods
});

export var CMN_READ_CLAUSE_PROFILE = Object.freeze({
  voice: 'cmn', encoding: 'UTF-8', termination: 'c-string', capacity: 800,
  translatorName: 6516078, charsIgnore: Object.freeze([173, 1, 8204, 1, 0, 0])
});

export var CMN_SYNTHESIS_PROFILE = Object.freeze({
  voice: 'cmn',
  dictionaryManifest: CMN_DICTIONARY_MANIFEST,
  ruleProfile: CMN_RULE_PROFILE,
  ruleData: CMN_RULE_DATA,
  phonemizerProfile: CMN_PHONEMIZER_PROFILE,
  textCharacterProfile: CMN_TEXT_CHARACTER_PROFILE,
  replacementBytes: CMN_REPLACEMENT_BYTES,
  wordTranslationProfile: CMN_WORD_TRANSLATION_PROFILE,
  wordStressProfile: CMN_WORD_STRESS_PROFILE,
  wordEndingProfile: CMN_WORD_ENDING_PROFILE,
  phonemeListProfile: CMN_PHONEME_LIST_PROFILE,
  phonemePrepareProfile: CMN_PHONEME_PREPARE_PROFILE,
  phonemeReplacements: CMN_PHONEME_REPLACEMENTS,
  numberProfile: CMN_NUMBER_PROFILE,
  prosodyProfile: CMN_PROSODY_PROFILE,
  pitchCalculatorProfile: CMN_TONE_PROSODY_PROFILE,
  readClauseProfile: CMN_READ_CLAUSE_PROFILE,
  toneLanguage: 1
});
