// Port of pinned common.c:utf8_in/utf8_in2. GPL-3.0-or-later.
// Copyright (C) 2005-2015 Jonathan Duddington.
// See licenses/espeak-ng/COPYING.txt. This scanner is distinct from the text decoder.

function scan(bytes, offset, backwards) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new RangeError('UTF-8 scanner offset outside backing buffer');
  function byteAt(index) {
    if (index < 0 || index >= bytes.length) throw new RangeError('UTF-8 scanner read outside backing buffer');
    return bytes[index];
  }
  var start = offset;
  while ((byteAt(start) & 0xc0) === 0x80) start += backwards ? -1 : 1;
  var cursor = start;
  var cp = byteAt(cursor++);
  var tails = 0;
  if (cp & 0x80) {
    if ((cp & 0xe0) === 0xc0) tails = 1;
    else if ((cp & 0xf0) === 0xe0) tails = 2;
    else if ((cp & 0xf8) === 0xf0) tails = 3;
    cp &= tails === 1 ? 0x1f : tails === 2 ? 0x0f : tails === 3 ? 0x07 : 0xff;
    var consumed = 0;
    for (; consumed < tails; consumed++) {
      var next = byteAt(cursor);
      if (next === 0) break;
      cp = (cp << 6) + (next & 0x3f);
      cursor++;
    }
    tails = consumed;
  }
  return { codepoint: cp, bytes: tails + 1, start: start };
}

// C returns decoded width, excluding continuation bytes skipped before decoding.
// Backward offsets name the last byte to inspect (typically cursor - 1).
export function readForward(bytes, offset) { return scan(bytes, offset, false); }
export function readBackward(bytes, offset) { return scan(bytes, offset, true); }
