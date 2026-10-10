// Behavior port of pinned eSpeak NG encoding.c/common.c. GPL-3.0-or-later.
// Copyright (C) 2005 to 2013 Jonathan Duddington; (C) 2013-2017 Reece H. Dunn.
// See licenses/espeak-ng/COPYING.txt; UCD data terms: licenses/espeak-ng/COPYING.UCD.txt.
// No host Unicode, text codec, filesystem, or asynchronous runtime dependencies.
import { UCD_RANGES, LOWER_CASE, UPPER_CASE } from '../../data/unicode/tables.js';

function checkCodePoint(cp) {
  if (typeof cp !== 'number' || cp !== Math.floor(cp) || cp < 0 || cp > 4294967295) throw new RangeError('Expected uint32 code point');
}

// text_decoder_decode_string + string_decoder_getc_utf_8. The virtual trailing
// NUL avoids copying borrowed bytes; callers must not mutate them during use.
export function createUtf8Decoder(bytes, options) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  if (options !== undefined && options !== null && (typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Expected decoder options object');
  var opts = options || {};
  var keys = Object.keys(opts);
  for (var k = 0; k < keys.length; k++) if (keys[k] !== 'encoding' && keys[k] !== 'termination') throw new Error('Unsupported decoder option: ' + keys[k]);
  if (opts.encoding !== undefined && opts.encoding !== 'UTF-8') throw new Error('Unsupported encoding: only explicit UTF-8 is implemented');
  var termination = opts.termination === undefined ? 'c-string' : opts.termination;
  if (termination !== 'c-string' && termination !== 'nul-terminated' && termination !== 'bounded') throw new Error('Unsupported termination mode');
  if (bytes.length > 2147483646) throw new RangeError('Input exceeds C signed-length contract');
  var end = bytes.length;
  if (termination === 'c-string') {
    for (end = 0; end < bytes.length && bytes[end] !== 0; end++) {}
    end++;
  } else if (termination === 'nul-terminated') end++;
  var offset = 0;
  function byteAt(index) { return index === bytes.length ? 0 : bytes[index]; }
  function next() {
    if (offset === end) throw new RangeError('getc at EOF is unsupported by the C decoder');
    var c = byteAt(offset++);
    var high = c & 240;
    var count;
    var value;
    if (high < 128) return c;
    if (high < 192) return 65533;
    if (high < 224) { count = 1; value = c & 31; }
    else if (high === 224) { count = 2; value = c & 15; }
    else { count = 3; value = c & 15; }
    // The upstream uses >=, requiring a byte beyond the multibyte sequence.
    if (offset + count >= end) { offset = end; return 65533; }
    for (var i = 0; i < count; i++) {
      c = byteAt(offset++);
      if ((c & 192) !== 128) { offset--; return 65533; }
      value = (value << 6) + (c & 63);
    }
    if (count === 2 && value === 65533) return 26;
    if (count === 3 && value > 1114111) return 65533;
    return value;
  }
  return {
    next: next,
    peek: function () {
      if (offset === end) return 0;
      var before = offset;
      var cp = next();
      offset = before;
      return cp;
    },
    eof: function () { return offset === end; },
    offset: function () { return offset; },
    remaining: function () { return end - offset; },
    byteLength: end,
    termination: termination
  };
}

// Includes every C getc result, including a terminal NUL when it is consumed.
// Count first to return an exact-sized backing store rather than a byte-sized
// allocation retained behind a shorter view.
export function decodeUtf8(bytes, options) {
  var decoder = createUtf8Decoder(bytes, options);
  var count = 0;
  while (!decoder.eof()) { decoder.next(); count++; }
  var result = new Uint32Array(count);
  decoder = createUtf8Decoder(bytes, options);
  for (var i = 0; i < count; i++) result[i] = decoder.next();
  return result;
}

function encodedLength(cp) { return cp < 128 || cp >= 1114112 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; }

// common.c:utf8_out: surrogates are emitted verbatim, >=0x110000 becomes space.
export function writeUtf8CodePoint(cp, output, offset) {
  checkCodePoint(cp);
  if (!(output instanceof Uint8Array)) throw new TypeError('Expected output Uint8Array');
  var size = encodedLength(cp);
  if (typeof offset !== 'number' || offset !== Math.floor(offset) || offset < 0 || size > output.length - offset) throw new RangeError('UTF-8 output bounds');
  if (size === 1) { output[offset] = cp >= 1114112 ? 32 : cp; return 1; }
  var tails = size - 1;
  output[offset] = (tails === 1 ? 192 : tails === 2 ? 224 : 240) | (cp >>> (tails * 6));
  for (var i = 1; i < size; i++) output[offset + i] = 128 | ((cp >>> ((tails - i) * 6)) & 63);
  return size;
}

export function encodeUtf8(points) {
  if (!(points instanceof Uint32Array)) throw new TypeError('Expected Uint32Array code points');
  var length = 0;
  for (var i = 0; i < points.length; i++) length += encodedLength(points[i]);
  if (length > 2147483647) throw new RangeError('UTF-8 output exceeds C signed-length contract');
  var result = new Uint8Array(length);
  var offset = 0;
  for (var j = 0; j < points.length; j++) offset += writeUtf8CodePoint(points[j], result, offset);
  return result;
}

// JS boundary policy: combine valid UTF-16 pairs, preserve lone surrogates as
// numeric surrogate code points. No normalization, case folding, or NUL removal.
export function stringToCodePoints(text) {
  if (typeof text !== 'string') throw new TypeError('Expected string');
  var count = 0;
  var i;
  for (i = 0; i < text.length; i++) {
    var high = text.charCodeAt(i);
    if (high >= 55296 && high <= 56319 && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 56320 && low <= 57343) i++;
    }
    count++;
  }
  var points = new Uint32Array(count);
  var n = 0;
  for (i = 0; i < text.length; i++) {
    var cp = text.charCodeAt(i);
    if (cp >= 55296 && cp <= 56319 && i + 1 < text.length) {
      var tail = text.charCodeAt(i + 1);
      if (tail >= 56320 && tail <= 57343) { cp = 65536 + ((cp - 55296) << 10) + tail - 56320; i++; }
    }
    points[n++] = cp;
  }
  return points;
}

export function codePointsToString(points) {
  if (!(points instanceof Uint32Array)) throw new TypeError('Expected Uint32Array code points');
  var chunks = [];
  var chunk = '';
  for (var i = 0; i < points.length; i++) {
    var cp = points[i];
    if (cp > 1114111) throw new RangeError('Code point cannot be represented in a JS string');
    if (cp < 65536) chunk += String.fromCharCode(cp);
    else { cp -= 65536; chunk += String.fromCharCode(55296 + (cp >>> 10), 56320 + (cp & 1023)); }
    if (chunk.length >= 1024) { chunks.push(chunk); chunk = ''; }
  }
  chunks.push(chunk);
  return chunks.join('');
}

function ucdRecord(cp) {
  checkCodePoint(cp);
  if (cp > 1114111) return 5 << 12; // UCD_CATEGORY_Ii, no ctype flags
  var low = 0;
  var high = UCD_RANGES.length / 3 - 1;
  while (low <= high) {
    var mid = (low + high) >>> 1;
    var offset = mid * 3;
    if (cp < UCD_RANGES[offset]) high = mid - 1;
    else if (cp > UCD_RANGES[offset + 1]) low = mid + 1;
    else return UCD_RANGES[offset + 2];
  }
  throw new Error('Generated UCD table does not cover code point');
}
function flag(cp, bit) { return (ucdRecord(cp) >>> bit) & 1; }
function caseLookup(table, cp) {
  checkCodePoint(cp);
  var low = 0;
  var high = table.length / 2 - 1;
  while (low <= high) {
    var mid = (low + high) >>> 1;
    var key = table[mid * 2];
    if (cp < key) high = mid - 1;
    else if (cp > key) low = mid + 1;
    else return table[mid * 2 + 1];
  }
  return cp;
}
export function category(cp) { return ucdRecord(cp) >>> 12; }
export function iswAlnum(cp) { return flag(cp, 0); }
export function iswAlpha(cp) { return flag(cp, 1); }
export function iswBlank(cp) { return flag(cp, 2); }
export function iswCntrl(cp) { return flag(cp, 3); }
export function iswDigit(cp) { return flag(cp, 4); }
export function iswGraph(cp) { return flag(cp, 5); }
export function iswLower(cp) { return flag(cp, 6); }
export function iswPrint(cp) { return flag(cp, 7); }
export function iswPunct(cp) { return flag(cp, 8); }
export function iswSpace(cp) { return flag(cp, 9); }
export function iswUpper(cp) { return flag(cp, 10); }
export function iswXdigit(cp) { return flag(cp, 11); }
export function ucdToLower(cp) { return caseLookup(LOWER_CASE, cp); }
export function toUpperCodePoint(cp) { return caseLookup(UPPER_CASE, cp); }
export function toLowerCodePoint(cp, dotlessI) {
  checkCodePoint(cp);
  if (dotlessI !== undefined && typeof dotlessI !== 'boolean') throw new TypeError('dotlessI must be boolean');
  return cp === 73 && dotlessI ? 305 : ucdToLower(cp);
}

export function isEmoji(cp) {
  checkCodePoint(cp);
  return ((cp >= 0x2194 && cp <= 0x2199) || cp === 0x21a9 || cp === 0x21aa ||
    (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b05 && cp <= 0x2b07) || cp === 0x2b1b || cp === 0x2b1c ||
    cp === 0x2b50 || cp === 0x2b55 || (cp >= 0x1f000 && cp <= 0x1fbff)) ? 1 : 0;
}
export function isRegionalIndicator(cp) { checkCodePoint(cp); return cp >= 0x1f1e6 && cp <= 0x1f1ff ? 1 : 0; }
export function isEmojiModifier(cp) { checkCodePoint(cp); return cp >= 0x1f3fb && cp <= 0x1f3ff ? 1 : 0; }
export function isEmojiTag(cp) { checkCodePoint(cp); return cp >= 0xe0020 && cp <= 0xe007f ? 1 : 0; }

export function isAlpha(cp) {
  if (iswAlpha(cp)) return 1;
  if (cp < 0x300) return 0;
  if (cp >= 0x901 && cp <= 0xdf7) return (cp & 0x7f) < 0x64 || cp === 0xa70 || cp === 0xa71 || (cp >= 0xd7a && cp <= 0xd7f) ? 1 : 0;
  if ((cp >= 0x5b0 && cp <= 0x5c2) || cp === 0x605 || cp === 0x670 ||
      (cp >= 0x64b && cp <= 0x65e) || (cp >= 0x300 && cp <= 0x36f) ||
      (cp >= 0xf40 && cp <= 0xfbc) || (cp >= 0x1100 && cp <= 0x11ff) ||
      (cp >= 0x2800 && cp <= 0x28ff) || (cp > 0x3040 && cp <= 0xa700)) return 1;
  return isEmoji(cp);
}
var brackets = new Uint32Array([40,41,91,93,123,125,60,62,34,39,96,0xab,0xbb,0x300a,0x300b,0xe03c]);
export function bracketIndex(cp) {
  checkCodePoint(cp);
  if (cp >= 0x2014 && cp <= 0x201f) return 1;
  for (var i = 0; i < brackets.length; i++) if (brackets[i] === cp) return i + 1;
  return 0;
}
export function isDigit09(cp) { checkCodePoint(cp); return cp >= 48 && cp <= 57 ? 1 : 0; }
export function isDigit(cp) { return iswDigit(cp) || (cp >= 0x966 && cp <= 0x96f) ? 1 : 0; }
export function isSpace(cp) {
  checkCodePoint(cp);
  if (cp === 0) return 0;
  if ((cp >= 0x2500 && cp < 0x25a0) || (cp >= 0xfff9 && cp <= 0xffff)) return 1;
  return iswSpace(cp);
}
export function isSpace2(cp) { checkCodePoint(cp); return (cp & 255) === 0 || cp > 32 ? 0 : 1; }
export function isLetter(cp) { return isAlpha(cp); }
export function isWhitespace(cp) { return isSpace(cp); }

// Diagnostic convenience; callers can provide a reusable output record.
export function classifyCodePoint(cp, dotlessI, output) {
  var result = output || {};
  var record = ucdRecord(cp);
  result.codepoint = cp; result.category = record >>> 12;
  result.lower = toLowerCodePoint(cp, dotlessI); result.upper = toUpperCodePoint(cp); result.ucdLower = ucdToLower(cp);
  result.bracket = bracketIndex(cp); result.isAlpha = isAlpha(cp); result.isDigit = isDigit(cp);
  result.isDigit09 = isDigit09(cp); result.isSpace = isSpace(cp); result.isSpace2 = isSpace2(cp);
  result.isEmoji = isEmoji(cp); result.isRegionalIndicator = isRegionalIndicator(cp);
  result.isEmojiModifier = isEmojiModifier(cp); result.isEmojiTag = isEmojiTag(cp);
  result.iswAlnum = record & 1; result.iswAlpha = (record >>> 1) & 1; result.iswBlank = (record >>> 2) & 1;
  result.iswCntrl = (record >>> 3) & 1; result.iswDigit = (record >>> 4) & 1; result.iswGraph = (record >>> 5) & 1;
  result.iswLower = (record >>> 6) & 1; result.iswPrint = (record >>> 7) & 1; result.iswPunct = (record >>> 8) & 1;
  result.iswSpace = (record >>> 9) & 1; result.iswUpper = (record >>> 10) & 1; result.iswXdigit = (record >>> 11) & 1;
  return result;
}
