// Port of translate.c:EmbeddedCommand/Word_EmbeddedCmd and wavegen.c defaults.
// Copyright (C) 2005-2015 Jonathan Duddington. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt.
export var EMBEDDED_DEFAULTS = Object.freeze([0, 50, 175, 100, 50, 0, 0, 0, 175, 0, 0, 0, 0, 0, 0]);
export var SAYAS = Object.freeze({ CHARS: 0x12, GLYPHS: 0x13, SINGLE_CHARS: 0x14, KEY: 0x24, DIGITS: 0x40, DIGITS1: 0xc1 });
var COMMANDS = 'PSARHTIVYMUBF';

// On the fixed Linux reference, atoi parses through a signed 64-bit long and
// narrows to int. Keep both halves exact instead of rounding through JS Number.
function decimalInt(bytes, offset) {
  var high = 0, low = 0, saturated = false, at = offset;
  while (bytes[at] >= 48 && bytes[at] <= 57) {
    if (!saturated) {
      var lower = low * 10 + bytes[at] - 48;
      var upper = high * 10 + Math.floor(lower / 4294967296);
      low = lower >>> 0;
      if (upper > 0x7fffffff) { high = 0x7fffffff; low = 0xffffffff; saturated = true; }
      else high = upper >>> 0;
    }
    at++;
  }
  return { value: low | 0, offset: at };
}

export function createEmbeddedSession() {
  var list = new Uint32Array(250);
  var embeddedIx = 0, embeddedRead = 0, embeddedCount = 0;
  var optionSayas2 = 0, countSayasDigits = 0, wordEmphasis = 0;
  var optionSayas = 0, optionEmphasis = 0;
  function state() {
    var values = [];
    for (var i = 0; i < embeddedIx; i++) values.push(list[i]);
    return { embeddedIx: embeddedIx, embeddedRead: embeddedRead, pendingCount: embeddedCount,
      list: values, optionSayas2: optionSayas2, countSayasDigits: countSayasDigits,
      wordEmphasis: wordEmphasis, optionSayas: optionSayas, optionEmphasis: optionEmphasis };
  }
  function beginClause() { embeddedIx = 0; embeddedRead = 0; embeddedCount = 0; }
  function consume(bytes, sourceIndex) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected embedded source Uint8Array');
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= bytes.length) throw new RangeError('Embedded source offset');
    var at = sourceIndex, value = -1, sign = 0;
    if (bytes[at] === 43) { sign = 0x40; at++; }
    else if (bytes[at] === 45) { sign = 0x60; at++; }
    if (bytes[at] >= 48 && bytes[at] <= 57) { var parsed = decimalInt(bytes, at); value = parsed.value; at = parsed.offset; }
    if (at >= bytes.length) throw new RangeError('Embedded command leaves source backing');
    var c = bytes[at++];
    if (embeddedIx >= 248) return { sourceIndex: sourceIndex, added: 0 };
    // strchr_w uses exact ASCII, including strchr's match at the terminating NUL.
    var command = c === 0 ? COMMANDS.length + 1 : c >= 128 ? 0 : COMMANDS.indexOf(String.fromCharCode(c)) + 1;
    if (command === 0) return { sourceIndex: sourceIndex, added: 0 };
    if (value === -1) { value = EMBEDDED_DEFAULTS[command]; sign = 0; }
    if (command === 9) { optionSayas2 = value; countSayasDigits = 0; }
    if (command === 13) wordEmphasis = value >= 3 ? 0x800 : 0;
    list[embeddedIx++] = command + sign + (value << 8);
    embeddedCount++;
    return { sourceIndex: at, added: 1 };
  }
  function markWord(clearPending) {
    if (embeddedCount === 0) return false;
    list[embeddedIx - 1] |= 0x80;
    if (clearPending !== false) embeddedCount = 0;
    return true;
  }
  function consumeWordCommands(prePause) {
    if (!Number.isInteger(prePause)) throw new TypeError('Expected integer prepause');
    if (embeddedRead >= embeddedIx) return prePause;
    var command;
    do {
      command = list[embeddedRead++];
      var value = (command | 0) >> 8;
      if ((command & 0x1f) === 9) optionSayas = value;
      else if ((command & 0x1f) === 13) optionEmphasis = value;
      else if ((command & 0x1f) === 12) prePause = value === 0 ? 0 : prePause + value;
    } while (!(command & 0x80) && embeddedRead < embeddedIx);
    return prePause;
  }
  return {
    state: state, beginClause: beginClause, consume: consume, markWord: markWord,
    hasPending: function () { return embeddedCount > 0; },
    sayasMode: function () { return optionSayas2; },
    setSingleCharacterMode: function () { optionSayas2 = SAYAS.SINGLE_CHARS; },
    incrementDigits: function () { countSayasDigits++; return countSayasDigits; },
    resetDigits: function () { countSayasDigits = 0; },
    wordEmphasis: function () { return wordEmphasis; },
    consumeWordCommands: consumeWordCommands
  };
}
