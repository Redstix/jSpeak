// Pinned dictionary.c:GetVowelStress/SetWordStress, initialized en-us profile.
// Copyright (C) 2005-2015 Jonathan Duddington. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt. Phoneme data is supplied by the adapter.
import { WORD_STRESS_PROFILE } from '../../data/stress/profile.js';
import { CMN_WORD_STRESS_PROFILE } from '../../data/cmn/synthesis-profile.js';
export { WORD_STRESS_PROFILE };

var CAPACITY = 200;
var STRESS_PHONEMES = new Uint8Array([3, 2, 4, 5, 6, 7, 26]);
var NONSYLLABIC = 0x100000;
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + label);
}
function validate(table, profile) {
  if (!table || !Array.isArray(table.entries) || table.entries.length !== 256) throw new TypeError('Expected selected phoneme table');
  if (!profile || typeof profile !== 'object') throw new TypeError('Expected explicit initialized stress profile');
  var knownProfiles = { 'en-us': WORD_STRESS_PROFILE, cmn: CMN_WORD_STRESS_PROFILE };
  var expectedProfile = knownProfiles[profile.voice];
  if (!expectedProfile || JSON.stringify(profile) !== JSON.stringify(expectedProfile) ||
      table.index !== profile.phonemeTable || table.name !== profile.voice) {
    throw new Error('Unsupported word-stress profile: ' + profile.voice);
  }
}
function copyInput(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected phoneme Uint8Array');
  var end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= CAPACITY) throw new RangeError('Word phonemes need a NUL within the 200-byte C capacity');
  var result = new Uint8Array(CAPACITY);
  result.set(bytes.subarray(0, end));
  return { bytes: result, length: end };
}
function boundedBytes(bytes) {
  var length = 0;
  while (length < bytes.length && bytes[length] !== 0) length++;
  return bytes.slice(0, length);
}
function scanVowelStress(phonemes, table, profile, stressedSyllable, control) {
  var stress = -1, maximum = -1, primaryPosition = 0, count = 1, out = 0;
  var vowelStress = new Int8Array(CAPACITY / 2);
  vowelStress[0] = 1;
  var cursor = 0;
  while (phonemes[cursor] !== 0 && count < CAPACITY / 2 - 1) {
    var code = phonemes[cursor++], ph = table.entries[code];
    if (ph === null) continue;
    if (ph.type === 1 && ph.program === 0) {
      if (code === 8) {
        var j = count - 1;
        while (j > 0 && stressedSyllable === 0 && vowelStress[j] < 4) {
          if (vowelStress[j] !== 0 && vowelStress[j] !== 1) {
            vowelStress[j] = 4;
            if (maximum < 4) { maximum = 4; primaryPosition = j; }
            for (var ix = 1; ix < j; ix++) if (vowelStress[ix] === 4) vowelStress[ix] = 3;
            break;
          }
          j--;
        }
      } else if (ph.stdLength < 4 || stressedSyllable === 0) {
        stress = ph.stdLength;
        if (stress > maximum) maximum = stress;
      }
      continue;
    }
    if (ph.type === 2 && !(ph.phflags & NONSYLLABIC)) {
      vowelStress[count] = stress;
      if (stress >= 4 && stress >= maximum) { primaryPosition = count; maximum = stress; }
      if (stress < 0 && (control & 1) && (ph.phflags & 2)) vowelStress[count] = 1;
      count++; stress = -1;
    } else if (code === 20) {
      vowelStress[count] = stress;
      if (stress < 0 && (control & 1)) vowelStress[count] = 1;
      count++;
    }
    phonemes[out++] = code;
  }
  vowelStress[count] = 1;
  phonemes[out] = 0;
  if (stressedSyllable > 0) {
    if (stressedSyllable >= count) stressedSyllable = count - 1;
    vowelStress[stressedSyllable] = 4; maximum = 4; primaryPosition = stressedSyllable;
  }
  if (maximum === 5) {
    for (var i = 1; i < count; i++) {
      if (vowelStress[i] === 4) vowelStress[i] = (profile.stressFlags & 0x20000) ? 1 : 3;
      if (vowelStress[i] === 5) { vowelStress[i] = 4; primaryPosition = i; }
    }
    maximum = 4;
  }
  return { phonemes: phonemes, vowelStress: vowelStress, vowelCount: count, stressedSyllable: primaryPosition, maxStress: maximum };
}

export function getVowelStress(phonemes, table, profile, options) {
  validate(table, profile);
  var opts = options || {}, stressed = opts.stressedSyllable === undefined ? 0 : opts.stressedSyllable;
  var control = opts.control === undefined ? 1 : opts.control;
  integer(stressed, 0, 99, 'stressed syllable'); integer(control, 0, 0x7fffffff, 'stress control');
  var result = scanVowelStress(copyInput(phonemes).bytes, table, profile, stressed, control);
  return { phonemes: boundedBytes(result.phonemes), vowelStress: result.vowelStress.slice(0, result.vowelCount + 1),
    vowelCount: result.vowelCount, stressedSyllable: result.stressedSyllable, maxStress: result.maxStress };
}

export function createWordStressSession(table, profile, options) {
  validate(table, profile);
  var initial = options || {};
  var prevLastStress = initial.prevLastStress === undefined ? 0 : initial.prevLastStress;
  integer(prevLastStress, -0x80000000, 0x7fffffff, 'previous last stress');
  function setWordStress(input, options) {
    var opts = options || {}, dictionaryFlags = opts.dictionaryFlags === undefined ? null : opts.dictionaryFlags;
    var tonic = opts.tonic === undefined ? -1 : opts.tonic, control = opts.control === undefined ? 0 : opts.control;
    if (dictionaryFlags !== null) integer(dictionaryFlags, 0, 0xffffffff, 'dictionary flags');
    integer(tonic, -1, 6, 'tonic'); integer(control, 0, 0x7fffffff, 'stress control');
    var copied = copyInput(input), phonetic = copied.bytes;
    if (copied.length === 0) return { phonemes: new Uint8Array(0), prevLastStress: prevLastStress };
    for (var index = 0; index < copied.length; index++) if (phonetic[index] >= table.nPhonemes || table.entries[phonetic[index]] === null) phonetic[index] = 13;
    var flags = dictionaryFlags === null ? 0 : dictionaryFlags;
    var stressedSyllable = flags & 7, unstressedWord = false;
    if (flags & 8) { stressedSyllable = flags & 3; unstressedWord = true; }
    var scanned = scanVowelStress(phonetic, table, profile, stressedSyllable, 1);
    var vowelStress = scanned.vowelStress, count = scanned.vowelCount, maximum = scanned.maxStress;
    if (maximum < 0 && dictionaryFlags !== null) maximum = 0;
    if (profile.stressRule === 3 && stressedSyllable === 0) {
      stressedSyllable = count - 1;
      while (stressedSyllable > 0) {
        if (vowelStress[stressedSyllable] < 1) {
          vowelStress[stressedSyllable] = 4;
          break;
        }
        stressedSyllable--;
      }
      maximum = 4;
    }
    // The measured en-us rule is STRESSPOSN_1L (0), with stress_flags=8.
    // No switch case or syllable-weight-dependent option is active for that
    // profile. cmn uses the final-syllable branch above with S_NO_DIM.
    var stress = maximum < 4 ? 4 : 3;
    for (var v = 1; v < count; v++) {
      if (vowelStress[v] < 0 && vowelStress[v - 1] <= 1 && (vowelStress[v + 1] <= 1 || (stress === 4 && vowelStress[v + 1] <= 2))) {
        vowelStress[v] = stress;
        stress = 3;
      }
    }
    if (unstressedWord && tonic < 0) tonic = count <= 2 ? profile.unstressedWord1 : profile.unstressedWord2;
    maximum = 0;
    var maximumPosition = 0;
    for (var syllable = 1; syllable < count; syllable++) {
      if (vowelStress[syllable] >= maximum) { maximum = vowelStress[syllable]; maximumPosition = syllable; }
    }
    if (tonic >= 0) {
      if (tonic > maximum || maximum <= 4) vowelStress[maximumPosition] = tonic;
      maximum = tonic;
    }
    var output = new Uint8Array(CAPACITY), out = 0, cursor = 0;
    v = 1;
    // Actual en-us vowel_pause=0 and it_lengthen=0, so these two branches have
    // no observable action. Prefix stress markers were removed by the scan.
    while (phonetic[cursor] !== 0 && out < CAPACITY - 3) {
      var code = phonetic[cursor++], ph = table.entries[code];
      if (ph === null) continue;
      if (ph.type === 0) prevLastStress = 0;
      else if ((ph.type === 2 && !(ph.phflags & NONSYLLABIC)) || phonetic[cursor] === 20) {
        if (v > count) throw new RangeError('C word-stress syllable progression exceeded vowel count');
        var currentStress = vowelStress[v];
        prevLastStress = currentStress;
        if (currentStress <= 1) {
          if (v === 1 || v === count - 1) currentStress = 1;
        else if ((profile.stressFlags & 2) !== 0 ||
                 (v === count - 2 && vowelStress[count - 1] <= 1)) currentStress = 1;
          else { currentStress = 0; vowelStress[v] = 0; }
        }
        if (currentStress === 0 || currentStress > 1) output[out++] = STRESS_PHONEMES[currentStress];
        if (vowelStress[v] > maximum) maximum = vowelStress[v];
        v++;
      }
      if (code !== 1) output[out++] = code;
    }
    output[out] = 0;
    return { phonemes: output.slice(0, out), prevLastStress: prevLastStress };
  }
  return { setWordStress: setWordStress, state: function () { return { prevLastStress: prevLastStress }; },
    setState: function (value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || value.prevLastStress === undefined) throw new TypeError('Expected previous stress state');
      integer(value.prevLastStress, -0x80000000, 0x7fffffff, 'previous last stress');prevLastStress = value.prevLastStress;
    } };
}
