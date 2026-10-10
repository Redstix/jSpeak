import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav } from '../compare/wav.mjs';
import { verifyPack, dataFingerprint, sha256, hash32, validateRelativePath } from './pack.mjs';

export function verifyAudio(audio, getBytes) {
  if (!audio || audio.uri !== '/common/espeak/oracle.wav' || audio.dataUri !== '/common/espeak/oracle-wave.txt') throw new Error('Invalid audio mapping');
  const wav = getBytes('oracle.wav');
  const data = getBytes('oracle-wave.txt');
  if (!(wav instanceof Uint8Array) || wav.length !== audio.byteLength ||
      sha256(wav) !== audio.sha256 || hash32(wav) !== audio.hash32 ||
      !(data instanceof Uint8Array) || data.length !== wav.length || sha256(data) !== audio.sha256) throw new Error('Oracle audio integrity mismatch');
  const pcm = readWav(wav);
  if (pcm.sampleRate !== 22050 || pcm.sampleRate !== audio.sampleRate || pcm.samples.length !== audio.sampleCount ||
      audio.channels !== 1 || audio.bitsPerSample !== 16 || audio.headerLength !== 44 || audio.dataOffset !== 44 ||
      wav.length !== 44 + pcm.samples.length * 2 || String.fromCharCode(...wav.subarray(36, 40)) !== 'data') throw new Error('Oracle audio format mismatch');
  return true;
}

export function verifyDirectory(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('source-lock.json', import.meta.url), 'utf8'));
  const getBytes = name => {
    validateRelativePath(name);
    const filename = path.join(directory, name);
    if (!lstatSync(filename).isFile()) throw new Error('Non-regular package file: ' + name);
    return readFileSync(filename);
  };
  verifyPack(manifest, getBytes, lock.upstreamCommit);
  verifyAudio(manifest.audio, getBytes);
  if (manifest.dataFingerprint !== dataFingerprint(lock.files) || manifest.sourceDataFingerprint !== lock.sourceDataFingerprint) throw new Error('Package differs from reviewed source lock');
  if (manifest.audio.sha256 !== lock.audio.sha256 || manifest.audio.text !== lock.audio.text) throw new Error('Audio differs from reviewed fixed-profile reference');
  const expected = new Set([...manifest.files.map(f => f.packagePath), 'oracle.wav', 'oracle-wave.txt', 'manifest.json', 'provenance.json', 'candidate-comparison.json']);
  for (const filename of readdirSync(directory)) if (!expected.has(filename)) throw new Error('Unexpected package entry: ' + filename);
  // Provenance and comparison are review records. Check their identity anchors as well as payloads.
  const provenance = JSON.parse(getBytes('provenance.json'));
  if (provenance.upstreamCommit !== lock.upstreamCommit || provenance.sourceDataFingerprint !== lock.sourceDataFingerprint ||
      dataFingerprint(provenance.sourceInventory) !== lock.sourceDataFingerprint || provenance.selectedDataFingerprint !== manifest.dataFingerprint) throw new Error('Provenance identity mismatch');
  const comparison = JSON.parse(getBytes('candidate-comparison.json'));
  if (comparison.kind !== 'isolated-candidate-c-data-comparison' || comparison.closureComplete !== false || !Array.isArray(comparison.cases)) throw new Error('Invalid candidate comparison record');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/build-data/verify.mjs [extracted/common/espeak]');
  const directory = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../../apps/vela-probe/src/common/espeak', import.meta.url));
  const manifest = verifyDirectory(directory);
  console.log('Verified package bytes, manifest, source lock and oracle WAV: ' + manifest.dataFingerprint);
}
