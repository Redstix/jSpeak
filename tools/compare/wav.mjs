// Strict RIFF/WAVE PCM16 mono reader. Does not accept streaming sentinel lengths.
export function readWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) throw new Error('Truncated WAV');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not RIFF/WAVE');
  const end = view.getUint32(4, true) + 8;
  if (end !== bytes.length) throw new Error('RIFF size mismatch');
  let format;
  let data;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated chunk header');
    const id = text(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const next = start + size + (size & 1);
    if (next > end) throw new Error('Truncated chunk');
    if (id === 'fmt ') {
      if (format || size < 16) throw new Error('Invalid fmt chunk');
      format = {
        codec: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true)
      };
    } else if (id === 'data') {
      if (data) throw new Error('Duplicate data chunk');
      data = { start, size };
    }
    offset = next;
  }
  if (!format || !data) throw new Error('Missing fmt or data chunk');
  if (format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || format.blockAlign !== 2 || !format.sampleRate || format.byteRate !== format.sampleRate * 2 || data.size % 2) {
    throw new Error('Expected PCM16 mono');
  }
  const samples = new Int16Array(data.size / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(data.start + i * 2, true);
  return { samples, sampleRate: format.sampleRate };
}
