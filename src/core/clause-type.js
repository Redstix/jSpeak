// Port of pinned readclause.c:clause_type_from_codepoint and translate.h CLAUSE_*.
// Copyright (C) 2005-2015 Jonathan Duddington; (C) 2015-2017, 2020 Reece H. Dunn.
// GPL-3.0-or-later. Runtime uses 12-bit property values, never JS 64-bit bitwise.
// See licenses/espeak-ng/COPYING.txt and licenses/espeak-ng/COPYING.UCD.txt.
import { CLAUSE_PROPERTY_RANGES } from '../../data/clause/properties.js';

export var CLAUSE = Object.freeze({
  PAUSE: 0x00000fff, INTONATION_TYPE: 0x00007000, OPTIONAL_SPACE_AFTER: 0x00008000,
  TYPE: 0x000f0000, PUNCTUATION_IN_WORD: 0x00100000, SPEAK_PUNCTUATION_NAME: 0x00200000,
  DOT_AFTER_LAST_WORD: 0x00400000, PAUSE_LONG: 0x00800000,
  INTONATION_FULL_STOP: 0x00000000, INTONATION_COMMA: 0x00001000,
  INTONATION_QUESTION: 0x00002000, INTONATION_EXCLAMATION: 0x00003000, INTONATION_NONE: 0x00004000,
  TYPE_NONE: 0x00000000, TYPE_EOF: 0x00010000, TYPE_VOICE_CHANGE: 0x00020000,
  TYPE_CLAUSE: 0x00040000, TYPE_SENTENCE: 0x00080000,
  NONE: 0 | 0x00004000 | 0x00000000,
  PARAGRAPH: 70 | 0x00000000 | 0x00080000,
  EOF: 40 | 0x00000000 | 0x00080000 | 0x00010000,
  VOICE: 0 | 0x00004000 | 0x00020000,
  PERIOD: 40 | 0x00000000 | 0x00080000,
  COMMA: 20 | 0x00001000 | 0x00040000,
  SHORTCOMMA: 4 | 0x00001000 | 0x00040000,
  SHORTFALL: 4 | 0x00000000 | 0x00040000,
  QUESTION: 40 | 0x00002000 | 0x00080000,
  EXCLAMATION: 45 | 0x00003000 | 0x00080000,
  COLON: 30 | 0x00000000 | 0x00040000,
  SEMICOLON: 30 | 0x00001000 | 0x00040000
});

// ESPEAKNG_PROPERTY_* shifted right by 52; preserves every masked bit exactly.
export var CLAUSE_PROPERTY = Object.freeze({
  INVERTED_TERMINAL_PUNCTUATION: 0x001, PUNCTUATION_IN_WORD: 0x002, OPTIONAL_SPACE_AFTER: 0x004,
  EXTENDED_DASH: 0x008, PARAGRAPH_SEPARATOR: 0x010, ELLIPSIS: 0x020,
  SEMI_COLON: 0x040, COLON: 0x080, COMMA: 0x100, EXCLAMATION_MARK: 0x200,
  QUESTION_MARK: 0x400, FULL_STOP: 0x800
});

export function clausePropertyBits(codepoint) {
  if (typeof codepoint !== 'number' || codepoint !== Math.floor(codepoint) || codepoint < 0 || codepoint > 0xffffffff) throw new RangeError('Expected uint32 code point');
  var low = 0;
  var high = CLAUSE_PROPERTY_RANGES.length / 3 - 1;
  while (low <= high) {
    var middle = (low + high) >>> 1;
    var offset = middle * 3;
    if (codepoint < CLAUSE_PROPERTY_RANGES[offset]) high = middle - 1;
    else if (codepoint > CLAUSE_PROPERTY_RANGES[offset + 1]) low = middle + 1;
    else return CLAUSE_PROPERTY_RANGES[offset + 2];
  }
  return 0; // Includes >0x10ffff: the C category is Ii and its properties are zero.
}

export function clauseTypeFromCodePoint(codepoint) {
  var property = CLAUSE_PROPERTY;
  switch (clausePropertyBits(codepoint)) {
    case property.FULL_STOP: return CLAUSE.PERIOD;
    case property.FULL_STOP | property.OPTIONAL_SPACE_AFTER: return CLAUSE.PERIOD | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.QUESTION_MARK: return CLAUSE.QUESTION;
    case property.QUESTION_MARK | property.OPTIONAL_SPACE_AFTER: return CLAUSE.QUESTION | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.QUESTION_MARK | property.PUNCTUATION_IN_WORD: return CLAUSE.QUESTION | CLAUSE.PUNCTUATION_IN_WORD;
    case property.EXCLAMATION_MARK: return CLAUSE.EXCLAMATION;
    case property.EXCLAMATION_MARK | property.OPTIONAL_SPACE_AFTER: return CLAUSE.EXCLAMATION | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.EXCLAMATION_MARK | property.PUNCTUATION_IN_WORD: return CLAUSE.EXCLAMATION | CLAUSE.PUNCTUATION_IN_WORD;
    case property.COMMA: return CLAUSE.COMMA;
    case property.COMMA | property.OPTIONAL_SPACE_AFTER: return CLAUSE.COMMA | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.COLON: return CLAUSE.COLON;
    case property.COLON | property.OPTIONAL_SPACE_AFTER: return CLAUSE.COLON | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.SEMI_COLON:
    case property.EXTENDED_DASH: return CLAUSE.SEMICOLON;
    case property.SEMI_COLON | property.OPTIONAL_SPACE_AFTER:
    case property.QUESTION_MARK | property.OPTIONAL_SPACE_AFTER | property.INVERTED_TERMINAL_PUNCTUATION:
    case property.EXCLAMATION_MARK | property.OPTIONAL_SPACE_AFTER | property.INVERTED_TERMINAL_PUNCTUATION:
      return CLAUSE.SEMICOLON | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.ELLIPSIS: return CLAUSE.SEMICOLON | CLAUSE.SPEAK_PUNCTUATION_NAME | CLAUSE.OPTIONAL_SPACE_AFTER;
    case property.PARAGRAPH_SEPARATOR: return CLAUSE.PARAGRAPH;
  }
  return CLAUSE.NONE;
}
