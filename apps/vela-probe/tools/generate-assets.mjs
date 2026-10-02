import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const dir = new URL('../src/common/', import.meta.url);
mkdirSync(dir, { recursive: true });
const bytes = Buffer.alloc(65536);
for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
writeFileSync(new URL('probe.bin', dir), bytes);
const rate = 16000;
const samples = rate * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const envelope = Math.min(1, i / 800, (samples - 1 - i) / 800);
  wav.writeInt16LE(Math.round(2400 * envelope * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + 2 * i);
}
writeFileSync(new URL('tone.wav', dir), wav);
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length); type.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  return result;
}
const width = 64;
const pixels = Buffer.alloc((1 + width * 3) * width);
for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
  const offset = y * (1 + width * 3) + 1 + x * 3;
  const bright = x > 20 && x < 44 && y > 12 && y < 52;
  pixels[offset] = bright ? 240 : 24;
  pixels[offset + 1] = bright ? 240 : 48;
  pixels[offset + 2] = bright ? 240 : 80;
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(width, 4); header[8] = 8; header[9] = 2;
writeFileSync(new URL('logo.png', dir), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
console.log('Generated 64 KiB resource, 2s PCM16 WAV, and project icon');
