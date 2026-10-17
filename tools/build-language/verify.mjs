import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataFingerprint, sha256, validateRelativePath, verifyPack } from '../build-data/pack.mjs';
import { verifyAudio } from '../build-data/verify.mjs';

export function verifyLanguageDirectory(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('source-lock.json', import.meta.url), 'utf8'));
  const getBytes = name => {
    validateRelativePath(name);
    const filename = path.join(directory, name);
    if (!existsSync(filename) || !lstatSync(filename).isFile()) throw new Error('Missing package file: ' + name);
    return readFileSync(filename);
  };
  verifyPack(manifest, getBytes, lock.upstreamCommit);
  verifyAudio(manifest.audio, getBytes);
  if (manifest.profile.voice !== 'cmn' || JSON.stringify(manifest.profile) !== JSON.stringify(lock.profile)) throw new Error('Mandarin profile mismatch');
  const selected = manifest.files.map(({ id, sourcePath, byteLength, sha256 }) => ({ id, sourcePath, byteLength, sha256 }));
  if (JSON.stringify(selected) !== JSON.stringify(lock.files) || manifest.dataFingerprint !== lock.selectedDataFingerprint ||
      manifest.sourceDataFingerprint !== lock.sourceDataFingerprint) throw new Error('Package differs from reviewed Mandarin source lock');
  if (manifest.audio.sha256 !== lock.audio.sha256 || manifest.audio.text !== lock.audio.text ||
      manifest.audio.sampleCount !== lock.audio.sampleCount || manifest.audio.byteLength !== lock.audio.byteLength) throw new Error('Mandarin audio differs from reviewed reference');
  const expected = new Set([...manifest.files.map(file => file.packagePath), 'oracle.wav', 'oracle-wave.txt',
    'manifest.json', 'provenance.json', 'candidate-comparison.json']);
  for (const filename of readdirSync(directory)) if (!expected.has(filename)) throw new Error('Unexpected package entry: ' + filename);
  const provenance = JSON.parse(getBytes('provenance.json'));
  if (provenance.upstreamCommit !== lock.upstreamCommit || provenance.profile.voice !== 'cmn' ||
      provenance.sourceDataFingerprint !== lock.sourceDataFingerprint || provenance.selectedDataFingerprint !== manifest.dataFingerprint ||
      JSON.stringify(provenance.sourceInputs) !== JSON.stringify(lock.sourceInputs) || provenance.closureComplete !== false ||
      provenance.jsRuntime.synthesisSupported !== true ||
      provenance.jsRuntime.phonemeSynthesisSupported !== true ||
      provenance.jsRuntime.pcmSynthesisSupported !== true) throw new Error('Mandarin provenance identity mismatch');
  const comparison = JSON.parse(getBytes('candidate-comparison.json'));
  if (comparison.kind !== 'isolated-candidate-c-data-comparison' || comparison.profile.voice !== 'cmn' ||
      comparison.closureComplete !== false || !Array.isArray(comparison.cases) ||
      comparison.exactCount + comparison.unsupportedCount !== comparison.caseCount ||
      comparison.jsPhonemeExactCount + comparison.jsPhonemeUnsupportedCount !== comparison.caseCount ||
      comparison.jsPhonemeExactCount !== 29 || comparison.jsPhonemeUnsupportedCount !== 1 ||
      comparison.jsWavExactCount + comparison.jsWavUnsupportedCount !== comparison.caseCount ||
      comparison.jsWavExactCount !== 29 || comparison.jsWavUnsupportedCount !== 1 ||
      comparison.cases.some(item => item.classification === 'exact' ? !(item.phonemesEqual && item.wavEqual && !item.fullDiagnostics && !item.candidateDiagnostics) : item.classification !== item.expectedClassification)) {
    throw new Error('Invalid Mandarin candidate comparison record');
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/build-language/verify.mjs [artifacts/cmn-language-pack]');
  const directory = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../../artifacts/cmn-language-pack', import.meta.url));
  const manifest = verifyLanguageDirectory(directory);
  console.log('Verified cmn package bytes, source inputs, C corpus and oracle WAV: ' + manifest.dataFingerprint);
}
