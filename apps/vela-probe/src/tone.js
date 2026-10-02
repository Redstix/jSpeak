// A small diagnostic signal, not an eSpeak waveform generator.
export function createTone() {
  var rate = 16000;
  var count = rate * 2;
  var bytes = new Uint8Array(44 + count * 2);
  var view = new DataView(bytes.buffer);
  function text(offset, value) {
    for (var i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  var position = 0;
  return {
    bytes: bytes,
    renderSlice: function () {
      var end = Math.min(position + 512, count);
      for (; position < end; position++) {
        var local = position < 12800 ? position : position - 19200;
        var frequency = position < 12800 ? 660 : 880;
        var sample = 0;
        if (local >= 0 && local < 12800) {
          var envelope = Math.min(1, local / 800, (12799 - local) / 800);
          sample = Math.round(2400 * envelope * Math.sin(2 * Math.PI * frequency * local / rate));
        }
        view.setInt16(44 + position * 2, sample, true);
      }
      return position === count;
    }
  };
}
