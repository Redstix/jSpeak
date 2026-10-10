// Original dictionary.c EncodePhonemes; GPL-3.0-or-later.
// Copyright (C) 2005-2015 Jonathan Duddington. See licenses/espeak-ng/COPYING.txt.
import { readForward } from './utf8-scan.js';
function space(c) { return c === 32 || (c >= 9 && c <= 13); }

// Return the original advanced input pointer as an absolute byte offset. This
// encodes one whitespace-delimited group, including original switch syntax.
export function encodePhonemes(input, selectedTable, options) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Expected mnemonic bytes');
  if (!selectedTable || !Array.isArray(selectedTable.entries) || selectedTable.entries.length !== 256 ||
      !Number.isInteger(selectedTable.nPhonemes) || selectedTable.nPhonemes < 1 || selectedTable.nPhonemes > 256) throw new TypeError('Expected selected phoneme table');
  var opts = options || {}, at = opts.offset === undefined ? 0 : opts.offset;
  var report = opts.reportBadPhoneme === undefined ? true : opts.reportBadPhoneme;
  if (!Number.isInteger(at) || at < 0 || at > input.length || typeof report !== 'boolean') throw new RangeError('Invalid EncodePhonemes options');
  for (var key in opts) if (key !== 'offset' && key !== 'reportBadPhoneme') throw new TypeError('Unknown EncodePhonemes option');
  // C probes up to four mnemonic bytes and utf8_in may skip continuation bytes.
  // Keep the complete supplied backing, then append virtual terminal zeros.
  var source = new Uint8Array(input.length + 8); source.set(input);
  var out = [], bad = report ? 0 : null;
  while (source[at] < 128 && space(source[at])) at++;
  while (source[at] !== 0 && !space(source[at])) {
    if (source[at] === 124 && source[at + 1] !== 124) { at++; continue; }
    var max = -1, code = 0;
    for (var index = 1; index < selectedTable.nPhonemes; index++) {
      var ph = selectedTable.entries[index];
      if (ph === null || ph.type === 15) continue; // phINVALID
      var count = 0, mnemonic = ph.mnemonic;
      while (source[at + count] > 32 && count < 4 && source[at + count] === ((mnemonic >>> (count * 8)) & 255)) count++;
      if (count > max && (count === 4 || ((mnemonic >>> (count * 8)) & 255) === 0)) { max = count; code = ph.code; }
    }
    if (code === 0) {
      if (report) bad = readForward(source, at).codepoint;
      return { phonemes: Uint8Array.from(out), offset: at + 1, badPhoneme: bad };
    }
    if (max <= 0) max = 1;
    at += max; out.push(code);
    if (code === 21) { // phonSWITCH
      var languageStart = out.length;
      while (!space(source[at]) && source[at] !== 0) {
        var c = source[at++]; out.push(c >= 65 && c <= 90 ? c + 32 : c);
      }
      if (source[at] === 0) {
        // The pinned ESPEAKNG_DEFAULT_VOICE is "en". Drop only an exact
        // terminal default-language name; an internal name retains its '|'.
        if (out.length - languageStart === 2 && out[languageStart] === 101 && out[languageStart + 1] === 110) out.length = languageStart;
      } else out.push(124);
    }
  }
  return { phonemes: Uint8Array.from(out), offset: at, badPhoneme: bad };
}
