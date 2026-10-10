// Original numbers.c IsSuperscript; GPL-3.0-or-later.
// Copyright (C) 2005-2015 Jonathan Duddington; 2015-2016, 2020 Reece H. Dunn.
// See licenses/espeak-ng/COPYING.txt.
import { DERIVED_LETTERS, NON_ASCII_NUMBER_RANGES } from '../../data/derived-letter/table.js';
export { DERIVED_CONSTANTS, HEX_LETTER_NAMES, DERIVED_MODIFIERS } from '../../data/derived-letter/table.js';
export function isSuperscript(letter) {
  if (!Number.isInteger(letter) || letter < -2147483648 || letter > 4294967295) throw new RangeError('Expected C int codepoint');
  letter |= 0;
  for (var i = 0; DERIVED_LETTERS[i] !== 0; i += 2) {
    var codepoint = DERIVED_LETTERS[i];
    if (codepoint > letter) break;
    if (codepoint === letter) return DERIVED_LETTERS[i + 1];
  }
  return 0;
}
export function nonAsciiNumber(letter) {
  if (!Number.isInteger(letter) || letter < -2147483648 || letter > 4294967295) throw new RangeError('Expected C int codepoint');
  letter |= 0;
  for (var i = 0; NON_ASCII_NUMBER_RANGES[i] !== 0; i++) {
    var base = NON_ASCII_NUMBER_RANGES[i];
    if (letter < base) break;
    if (letter < base + 10) return letter - base + 48;
  }
  return -1;
}
