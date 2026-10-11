import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnglishSynthesizer } from '../../src/core/english-synthesis.js';
import { benchmarkVelaStartup } from '../../tools/perf/vela-startup-benchmark.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = path.join(ROOT, 'apps/vela-tts');
const SOURCE_DATA = path.join(ROOT, 'apps/vela-probe/src/common/espeak');
const DIST = path.join(APP, 'dist');
const RUNTIME_DATA = [
  'en_dict.txt',
  'intonations.txt',
  'lang__gmw__en-US.txt',
  'phondata.txt',
  'phonindex.txt',
  'phontab.txt'
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readData(name) {
  return new Uint8Array(readFileSync(path.join(SOURCE_DATA, name)));
}

function text(bytes) {
  return Buffer.from(bytes).toString('ascii');
}

export function parsePcmWav(bytes) {
  if (bytes.length < 44 || text(bytes.subarray(0, 4)) !== 'RIFF' ||
      text(bytes.subarray(8, 12)) !== 'WAVE' || text(bytes.subarray(36, 40)) !== 'data') {
    throw new Error('Expected canonical RIFF/WAVE/data PCM WAV');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const sampleRate = view.getUint32(24, true);
  const dataBytes = view.getUint32(40, true);
  if (channels !== 1 || bitsPerSample !== 16 || 44 + dataBytes !== bytes.length) {
    throw new Error('Expected mono PCM16 WAV with a complete data chunk');
  }
  const samples = new Int16Array(dataBytes / 2);
  for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(44 + index * 2, true);
  return { samples, sampleRate, channels, bitsPerSample };
}

export function makePcmWav(samples, sampleRate) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => bytes.set(Buffer.from(value, 'ascii'), offset);
  writeText(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, samples[index], true);
  return bytes;
}

export function downsampleWav(bytes, factor, sampleRate) {
  const source = parsePcmWav(bytes);
  if (!Number.isInteger(factor) || factor < 2) throw new Error('Expected integer factor >= 2');
  const output = new Int16Array(Math.ceil(source.samples.length / factor));
  for (let index = 0; index < output.length; index++) {
    const start = index * factor;
    const end = Math.min(start + factor, source.samples.length);
    let sum = 0;
    for (let offset = start; offset < end; offset++) sum += source.samples[offset];
    output[index] = Math.round(sum / (end - start));
  }
  return makePcmWav(output, sampleRate);
}

function rms(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

export function audioQualityMetrics(originalBytes, reducedBytes, factor) {
  const original = parsePcmWav(originalBytes);
  const reduced = parsePcmWav(reducedBytes);
  const reconstructed = new Int16Array(original.samples.length);
  for (let index = 0; index < reconstructed.length; index++) {
    reconstructed[index] = reduced.samples[Math.floor(index / factor)];
  }
  const errors = new Int16Array(original.samples.length);
  let peakError = 0;
  for (let index = 0; index < errors.length; index++) {
    const error = original.samples[index] - reconstructed[index];
    errors[index] = error;
    peakError = Math.max(peakError, Math.abs(error));
  }
  const originalRms = rms(original.samples);
  const errorRms = rms(errors);
  return {
    sampleCountRatio: Number((reduced.samples.length / original.samples.length).toFixed(6)),
    wavBytesRatio: Number((reducedBytes.length / originalBytes.length).toFixed(6)),
    nyquistHz: reduced.sampleRate / 2,
    boxFilterGainAtNyquistDb: Number((20 * Math.log10(
      Math.abs(Math.sin(Math.PI * factor * 0.5 / factor) / (factor * Math.sin(Math.PI * 0.5 / factor)))
    )).toFixed(3)),
    reconstructionSnrDb: errorRms === 0 ? null : Number((20 * Math.log10(originalRms / errorRms)).toFixed(3)),
    reconstructionPeakError: peakError,
    originalDurationMs: Number((original.samples.length / original.sampleRate * 1000).toFixed(3)),
    reducedDurationMs: Number((reduced.samples.length / reduced.sampleRate * 1000).toFixed(3)),
    bitsPerSample: reduced.bitsPerSample
  };
}

async function generateReferenceAudio() {
  const dictionaryManifest = JSON.parse(readFileSync(new URL('../../data/dictionary/manifest.json', import.meta.url)));
  const synthesizer = createEnglishSynthesizer({
    dictionaryBytes: readData('en_dict.txt'),
    dictionaryManifest,
    phontabBytes: readData('phontab.txt'),
    phonindexBytes: readData('phonindex.txt'),
    phondataBytes: readData('phondata.txt')
  });
  const result = await synthesizer.synthesizeWav('Hello world.', {
    scheduler(callback) { callback(); }
  });
  return { bytes: result.wav, sampleCount: result.pcm.length, commandCount: result.stats.producedCommands };
}

function stageProfile(variant, audioBytes) {
  mkdirSync(path.join(APP, 'src/pages/index'), { recursive: true });
  copyFileSync(path.join(APP, 'profiles', variant, 'manifest.json'), path.join(APP, 'src/manifest.json'));
  copyFileSync(path.join(APP, 'profiles', variant, 'page.ux'), path.join(APP, 'src/pages/index/index.ux'));
  rmSync(path.join(APP, 'src/common/espeak'), { recursive: true, force: true });
  rmSync(path.join(APP, 'src/common/jspeak'), { recursive: true, force: true });
  if (variant === 'a') {
    mkdirSync(path.join(APP, 'src/common/espeak'), { recursive: true });
    for (const name of RUNTIME_DATA) copyFileSync(path.join(SOURCE_DATA, name), path.join(APP, 'src/common/espeak', name));
  } else {
    mkdirSync(path.join(APP, 'src/common/jspeak'), { recursive: true });
    writeFileSync(path.join(APP, 'src/common/jspeak/audio.wav'), audioBytes);
  }
}

function expectedRpkName(manifest) {
  return `${manifest.package}.debug.${manifest.versionName}.rpk`;
}

function buildRpk(variant) {
  rmSync(path.join(APP, 'build'), { recursive: true, force: true });
  execFileSync(path.join(APP, 'node_modules/.bin/aiot'), ['build', '--devtool', 'false'], {
    cwd: APP, stdio: 'inherit'
  });
  const manifest = JSON.parse(readFileSync(path.join(APP, 'src/manifest.json')));
  const expected = path.join(DIST, expectedRpkName(manifest));
  const actual = readdirSync(DIST).find(name => name.endsWith('.rpk'));
  if (!actual || path.join(DIST, actual) !== expected) {
    throw new Error(`Expected ${expected}, found ${actual || 'no RPK'}`);
  }
  return expected;
}

function zipNames(rpk) {
  return execFileSync('unzip', ['-Z1', rpk], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function readZip(rpk, name) {
  return execFileSync('unzip', ['-p', rpk, name], { maxBuffer: 16 * 1024 * 1024 });
}

function validateRpk(rpk, variant, stamp, audioBytes) {
  const manifest = JSON.parse(readZip(rpk, 'manifest.json'));
  const page = readZip(rpk, 'pages/index/index.js').toString('utf8');
  const names = new Set(zipNames(rpk));
  if (manifest.config?.jspeakProfile?.variant !== variant.toUpperCase()) throw new Error(`Profile mismatch in ${rpk}`);
  if (!page.includes(`READY 0.5.1-${variant.toUpperCase()}`) || !page.includes(stamp)) {
    throw new Error(`Version or build stamp missing in ${rpk}`);
  }
  if (variant === 'a') {
    for (const name of RUNTIME_DATA) if (!names.has(`common/espeak/${name}`)) throw new Error(`Missing ${name} in ${rpk}`);
    for (const name of ['provenance.json', 'candidate-comparison.json', 'oracle.wav', 'oracle-wave.txt']) {
      if (names.has(`common/espeak/${name}`)) throw new Error(`Build-time asset ${name} must not ship in A profile`);
    }
    if (!page.includes('english-synthesis')) throw new Error('A profile lost the synthesis runtime');
  } else {
    if (!names.has('common/jspeak/audio.wav')) throw new Error(`Missing reduced audio in ${rpk}`);
    if (sha256(readZip(rpk, 'common/jspeak/audio.wav')) !== sha256(audioBytes)) throw new Error(`Reduced audio mismatch in ${rpk}`);
    if ([...names].some(name => name.startsWith('common/espeak/'))) throw new Error(`Reduced profile ships espeak data in ${rpk}`);
    if (page.includes('readArrayBuffer') || page.includes('english-synthesis')) throw new Error(`Reduced profile retained startup synthesis/I/O path in ${rpk}`);
  }
}

function zipEntryCount(rpk) {
  return zipNames(rpk).length;
}

async function buildProfiles() {
  execFileSync(process.execPath, [path.join(APP, 'tools/generate-assets.mjs')], { stdio: 'inherit' });
  const stampMatch = readFileSync(path.join(APP, 'src/build-stamp.js'), 'utf8').match(/B\d{6}T\d{6}/);
  if (!stampMatch) throw new Error('Build stamp generation failed');
  const stamp = stampMatch[0];
  const reference = await generateReferenceAudio();
  const bAudio = downsampleWav(reference.bytes, 2, 11025);
  const cAudio = downsampleWav(reference.bytes, 4, 5512);

  const artifactDirectory = path.join(ROOT, 'artifacts', `vela-tts-profiles-${stamp}`);
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(path.join(artifactDirectory, 'a-reference.wav'), reference.bytes);
  writeFileSync(path.join(artifactDirectory, 'b.wav'), bAudio);
  writeFileSync(path.join(artifactDirectory, 'c.wav'), cAudio);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const audioByVariant = { a: reference.bytes, b: bAudio, c: cAudio };
  const profiles = [];
  for (const variant of ['a', 'b', 'c']) {
    stageProfile(variant, audioByVariant[variant]);
    const rpk = buildRpk(variant);
    validateRpk(rpk, variant, stamp, audioByVariant[variant]);
    const startup = benchmarkVelaStartup(rpk);
    const manifest = JSON.parse(readFileSync(path.join(APP, 'src/manifest.json')));
    const buildManifest = JSON.parse(readFileSync(path.join(APP, 'build/manifest.json')));
    profiles.push({
      variant: variant.toUpperCase(),
      rpk,
      rpkBytes: startup.rpk.bytes,
      rpkSha256: startup.rpk.sha256,
      unpackedBytes: startup.rpk.uncompressedBytes,
      buildStamp: stamp,
      buildTimestamp: buildManifest.packageInfo.timeStamp,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      runtime: manifest.config.jspeakProfile.runtime,
      sampleRate: manifest.config.jspeakProfile.sampleRate,
      bitsPerSample: manifest.config.jspeakProfile.bitsPerSample,
      actionReadBytes: manifest.config.jspeakProfile.actionReadBytes,
      outputAudioBytes: audioByVariant[variant].length,
      packagedAudioBytes: variant === 'a' ? 0 : audioByVariant[variant].length,
      packageFileCount: zipEntryCount(rpk),
      audioSha256: sha256(audioByVariant[variant]),
      startup
    });
  }

  stageProfile('a', reference.bytes);
  const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  const quality = {
    b: audioQualityMetrics(reference.bytes, bAudio, 2),
    c: audioQualityMetrics(reference.bytes, cAudio, 4)
  };
  const profileA = profiles[0];
  const relativeToA = {};
  for (const profile of profiles) {
    relativeToA[profile.variant] = {
      parseSourceBytesRatio: profile.startup.rpk.parseSourceBytes / profileA.startup.rpk.parseSourceBytes,
      firstActionReadBytesRatio: profile.actionReadBytes / profileA.actionReadBytes,
      rpkBytesRatio: profile.rpkBytes / profileA.rpkBytes,
      unpackedBytesRatio: profile.unpackedBytes / profileA.unpackedBytes,
      outputAudioBytesRatio: profile.outputAudioBytes / profileA.outputAudioBytes
    };
  }
  const identity = {
    schemaVersion: 1,
    branch,
    commit,
    buildStamp: stamp,
    reference: {
      text: 'Hello world.',
      sampleCount: reference.sampleCount,
      commandCount: reference.commandCount,
      wavBytes: reference.bytes.length,
      sha256: sha256(reference.bytes)
    },
    quality,
    relativeToA,
    profiles
  };
  writeFileSync(path.join(DIST, 'profiles.json'), JSON.stringify(identity, null, 2) + '\n');
  writeFileSync(path.join(artifactDirectory, 'profiles.json'), JSON.stringify(identity, null, 2) + '\n');
  return identity;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/build-vela-tts-profiles/build.mjs');
  buildProfiles().then(report => {
    console.log(JSON.stringify({
      branch: report.branch,
      commit: report.commit,
      buildStamp: report.buildStamp,
      profiles: report.profiles.map(profile => ({
        variant: profile.variant,
        rpk: profile.rpk,
        bytes: profile.rpkBytes,
        sha256: profile.rpkSha256,
        parseSourceBytes: profile.startup.rpk.parseSourceBytes,
        actionReadBytes: profile.actionReadBytes
      }))
    }, null, 2));
  });
}
