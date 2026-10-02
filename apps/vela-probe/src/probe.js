export function capabilities() {
  var results = [];
  function check(name, supported, run) {
    if (!supported) { results.push({ label: name, value: 'UNSUPPORTED' }); return; }
    try {
      if (!run()) throw new Error('semantic mismatch');
      results.push({ label: name, value: 'PASS' });
    } catch (error) { results.push({ label: name, value: 'FAIL ' + String(error) }); }
  }
  check('TypedArray / 64 KiB', typeof ArrayBuffer !== 'undefined' && typeof Uint8Array !== 'undefined' && typeof Int16Array !== 'undefined' && typeof Uint32Array !== 'undefined', function () {
    var bytes = new Uint8Array(65536);
    bytes[0] = 255; bytes[65535] = 123;
    var signed = new Int16Array(1); signed[0] = 65535;
    var unsigned = new Uint32Array(1); unsigned[0] = -1;
    return bytes[0] === 255 && bytes[65535] === 123 && signed[0] === -1 && unsigned[0] === 4294967295;
  });
  check('DataView / endian', typeof DataView !== 'undefined' && typeof ArrayBuffer !== 'undefined', function () {
    var view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, 0x12345678, true);
    return view.getUint8(0) === 0x78 && view.getUint32(0, false) === 0x78563412;
  });
  check('Math.imul', typeof Math.imul === 'function', function () {
    return Math.imul(0xffffffff, 5) === -5 && Math.imul(0x7fffffff, 0x7fffffff) === 1;
  });
  check('32-bit shift', true, function () { return (-1 >>> 1) === 2147483647 && (-4 >> 1) === -2; });
  return results;
}

// Bounded synthetic integer workload, NOT an eSpeak DSP implementation or RTF.
export function computeSlice(seed, count) {
  if (count < 0 || count > 4096 || count !== Math.floor(count)) throw new RangeError('slice count');
  var state = seed | 0;
  for (var i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
  }
  return state | 0;
}

export function validateResource(bytes) {
  if (!bytes || bytes.length !== 65536) return false;
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] !== (i & 255)) return false;
  }
  return true;
}
