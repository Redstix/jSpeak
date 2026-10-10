// Platform-independent little-endian byte access. No runtime I/O or codecs.
export function byteHash32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  var state = 0;
  for (var i = 0; i < bytes.length; i++) {
    state ^= bytes[i]; state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  }
  return state | 0;
}
export function createBinaryReader(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  var data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function range(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length || length > bytes.length - offset) throw new RangeError('Binary range outside supplied data');
  }
  return {
    bytes: bytes, length: bytes.length, range: range,
    u8: function (offset) { range(offset, 1); return bytes[offset]; },
    u16: function (offset) { range(offset, 2); return data.getUint16(offset, true); },
    u32: function (offset) { range(offset, 4); return data.getUint32(offset, true); },
    zeroEnd: function (offset, limit) {
      if (limit === undefined) limit = bytes.length;
      range(offset, limit - offset);
      while (offset < limit && bytes[offset] !== 0) offset++;
      if (offset === limit) throw new RangeError('Missing binary string terminator');
      return offset;
    }
  };
}
