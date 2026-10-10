import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePack, verifyPack, hash32, sha256, describeBytes, checkRange, PAGE_BYTES, PHONDATA_VERSION } from '../tools/build-data/pack.mjs';
import { inventory } from '../tools/build-data/build.mjs';
import { verifyAudio } from '../tools/build-data/verify.mjs';

const { hashBytes } = await import('data:text/javascript,' + encodeURIComponent(readFileSync(new URL('../apps/vela-probe/src/probe.js', import.meta.url), 'utf8')));
const commit = 'a'.repeat(40);
const bytes = Uint8Array.from({ length: 300001 }, (_, i) => (i * 73 + (i >>> 8)) & 255);
function fixture(entries = [{ id: 'sample', sourcePath: 'sample', packagePath: 'sample.txt', bytes }]) {
  return makePack({ upstreamCommit: commit, buildFingerprint: 'b'.repeat(64), sourceDataFingerprint: 'c'.repeat(64), profile: { voice: 'en-us' }, entries });
}
const clone = object => JSON.parse(JSON.stringify(object));

test('byte checksum agrees with existing device implementation including signed overflow', () => {
  for (const data of [new Uint8Array(), Uint8Array.of(255), Uint8Array.from([0, 1, 127, 128, 255]), bytes]) {
    assert.equal(hash32(data), hashBytes(data, 0, data.length, 0));
  }
  assert.equal(hash32(new Uint8Array()), 0);
  assert.equal(sha256(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('pages cover all bytes once, include partial tail, high offset, cross-page and exact EOF', () => {
  const descriptor = describeBytes(bytes);
  let offset = 0;
  for (const page of descriptor.pages) {
    assert.equal(page.position, offset);
    assert.ok(page.length > 0 && page.length <= PAGE_BYTES);
    assert.equal(page.hash32, hashBytes(bytes, page.position, page.position + page.length, 0));
    offset += page.length;
  }
  assert.equal(offset, bytes.length);
  assert.equal(descriptor.pages.at(-1).length, bytes.length % PAGE_BYTES);
  const windows = Object.fromEntries(descriptor.windows.map(w => [w.id, w]));
  assert.ok(windows['cross-page'].position < PAGE_BYTES);
  assert.ok(windows['cross-page'].position + windows['cross-page'].length > PAGE_BYTES);
  assert.ok(windows['high-offset'].position > 262144);
  assert.deepEqual(windows.eof, { id: 'eof', position: bytes.length, length: 0, hash32: 0 });
  assert.equal(windows.end.position + windows.end.length, bytes.length);
});

test('range contract distinguishes EOF from out-of-bounds and rejects noninteger/overflow input', () => {
  assert.doesNotThrow(() => checkRange(17, 17, 0));
  for (const args of [[17, 17, 1], [17, 18, 0], [17, -1, 1], [17, 0, -1], [17, .5, 1], [17, NaN, 0], [17, 0, Infinity], [17, Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => checkRange(...args), RangeError);
  }
  for (const count of [0, 1, PAGE_BYTES, PAGE_BYTES + 1]) {
    const d = describeBytes(bytes.subarray(0, count));
    assert.equal(d.pages.reduce((sum, p) => sum + p.length, 0), count);
    assert.equal(d.windows.at(-1).position, count);
  }
});

test('pack bytes remain unmodified and manifest ordering/fingerprint is reproducible', () => {
  const entry1 = { id: 'one', sourcePath: 'a', packagePath: 'a.txt', bytes: bytes.subarray(0, 80) };
  const entry2 = { id: 'two', sourcePath: 'z', packagePath: 'z.txt', bytes: bytes.subarray(80, 255) };
  const original = bytes.slice();
  assert.deepEqual(fixture([entry1, entry2]), fixture([entry2, entry1]));
  assert.deepEqual(bytes, original);
  const manifest = fixture();
  assert.equal(verifyPack(manifest, () => bytes, commit), true);
  assert.equal(manifest.closureComplete, false);
});

test('duplicate mappings, unsafe paths and invalid IDs fail before creating payload', () => {
  const base = { id: 'one', sourcePath: 'a', packagePath: 'a.txt', bytes: Uint8Array.of(1) };
  assert.throws(() => fixture([base, { ...base, id: 'two', sourcePath: 'b' }]), /Duplicate package/);
  assert.throws(() => fixture([base, { ...base, sourcePath: 'b', packagePath: 'b.txt' }]), /Duplicate or invalid id/);
  assert.throws(() => fixture([base, { ...base, id: 'two', packagePath: 'b.txt' }]), /Duplicate source/);
  for (const packagePath of ['../x.txt', '/x.txt', 'a/../x.txt', 'a\\x.txt', 'a//x.txt', 'a.bin']) {
    assert.throws(() => fixture([{ ...base, packagePath }]));
  }
});

test('missing/truncated/corrupted files and incompatible manifest identities are rejected', () => {
  const manifest = fixture();
  assert.throws(() => verifyPack(manifest, () => undefined, commit), /Length mismatch/);
  assert.throws(() => verifyPack(manifest, () => bytes.subarray(1), commit), /Length mismatch/);
  const damaged = bytes.slice(); damaged[262200] ^= 1;
  assert.throws(() => verifyPack(manifest, () => damaged, commit), /Integrity mismatch/);
  assert.throws(() => verifyPack(manifest, () => bytes, 'd'.repeat(40)), /commit mismatch/);
  for (const mutate of [m => m.schemaVersion++, m => m.magic = 'wrong', m => m.closureComplete = true,
    m => m.files[0].pages[0].length++, m => m.files[0].windows.at(-1).position++,
    m => m.files[0].uri = '/common/other.txt', m => m.hash32Spec.seed = 1, m => m.pageBytes++,
    m => m.dataFingerprint = '0'.repeat(64), m => m.totalDataBytes++, m => m.files.push(clone(m.files[0]))]) {
    const altered = clone(manifest); mutate(altered);
    assert.throws(() => verifyPack(altered, () => bytes, commit));
  }
});

test('upstream phondata header is validated independently of manifest checksums', () => {
  function phData(version, rate) {
    const data = new Uint8Array(16);
    const view = new DataView(data.buffer);
    view.setUint32(0, version, true); view.setUint32(4, rate, true);
    return data;
  }
  for (const [version, rate, valid] of [[PHONDATA_VERSION, 22050, true], [1, 22050, false], [PHONDATA_VERSION, 16000, false]]) {
    const data = phData(version, rate);
    const manifest = fixture([{ id: 'phondata', sourcePath: 'phondata', packagePath: 'phondata.txt', bytes: data }]);
    if (valid) assert.equal(verifyPack(manifest, () => data, commit), true);
    else assert.throws(() => verifyPack(manifest, () => data, commit), /upstream phondata header/);
  }
});

test('source inventory is sorted, hashes exact bytes, and rejects symlink indirection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jspeak-pack-test-'));
  try {
    mkdirSync(path.join(directory, 'sub'));
    writeFileSync(path.join(directory, 'z'), Uint8Array.of(0, 255));
    writeFileSync(path.join(directory, 'sub/a'), 'binary\0\xff', 'latin1');
    const files = inventory(directory);
    assert.deepEqual(files.map(f => f.sourcePath), ['sub/a', 'z']);
    assert.equal(files[0].byteLength, 8);
    symlinkSync(path.join(directory, 'z'), path.join(directory, 'alias'));
    assert.throws(() => inventory(directory), /symlink/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function audioFixture() {
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
  wav.writeInt16LE(-32768, 44); wav.writeInt16LE(32767, 46);
  return { wav, audio: { uri: '/common/espeak/oracle.wav', dataUri: '/common/espeak/oracle-wave.txt',
    byteLength: wav.length, sha256: sha256(wav), hash32: hash32(wav), sampleRate: 22050,
    sampleCount: 2, channels: 1, bitsPerSample: 16, headerLength: 44, dataOffset: 44 } };
}

test('A1 WAV verification checks duplicate bytes, PCM format and audio metadata', () => {
  const { wav, audio } = audioFixture();
  assert.equal(verifyAudio(audio, () => wav), true);
  const corrupt = Buffer.from(wav); corrupt[47] ^= 1;
  assert.throws(() => verifyAudio(audio, name => name.endsWith('.txt') ? corrupt : wav), /integrity/);
  assert.throws(() => verifyAudio({ ...audio, sampleRate: 16000 }, () => wav), /format/);
  assert.throws(() => verifyAudio({ ...audio, sampleCount: 1 }, () => wav), /format/);
  assert.throws(() => verifyAudio({ ...audio, dataOffset: 40 }, () => wav), /format/);
  const wrongRate = Buffer.from(wav); wrongRate.writeUInt32LE(16000, 24); wrongRate.writeUInt32LE(32000, 28);
  assert.throws(() => verifyAudio({ ...audio, sha256: sha256(wrongRate), hash32: hash32(wrongRate) }, () => wrongRate), /format/);
});
