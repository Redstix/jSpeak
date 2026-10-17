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

function stageProfile() {
  mkdirSync(path.join(APP, 'src/pages/index'), { recursive: true });
  copyFileSync(path.join(APP, 'profiles/a/manifest.json'), path.join(APP, 'src/manifest.json'));
  copyFileSync(path.join(APP, 'profiles/a/page.ux'), path.join(APP, 'src/pages/index/index.ux'));
  rmSync(path.join(APP, 'src/common/espeak'), { recursive: true, force: true });
  mkdirSync(path.join(APP, 'src/common/espeak'), { recursive: true });
  for (const name of RUNTIME_DATA) copyFileSync(path.join(SOURCE_DATA, name), path.join(APP, 'src/common/espeak', name));
}

function expectedRpkName(manifest) {
  return `${manifest.package}.debug.${manifest.versionName}.rpk`;
}

function buildRpk() {
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

function validateRpk(rpk, stamp, versionName) {
  const manifest = JSON.parse(readZip(rpk, 'manifest.json'));
  const page = readZip(rpk, 'pages/index/index.js').toString('utf8');
  const names = new Set(zipNames(rpk));
  if (manifest.config?.jspeakProfile?.runtime !== 'full-js-synthesis') throw new Error(`Profile mismatch in ${rpk}`);
  if (!page.includes(`READY ${versionName} A`) || !page.includes(stamp)) {
    throw new Error(`Version or build stamp missing in ${rpk}`);
  }
  for (const name of RUNTIME_DATA) if (!names.has(`common/espeak/${name}`)) throw new Error(`Missing ${name} in ${rpk}`);
  for (const name of ['provenance.json', 'candidate-comparison.json', 'oracle.wav', 'oracle-wave.txt']) {
    if (names.has(`common/espeak/${name}`)) throw new Error(`Build-time asset ${name} must not ship in full synthesis profile`);
  }
  if ([...names].some(name => name.startsWith('common/jspeak/'))) throw new Error(`Retired precomputed audio found in ${rpk}`);
  if (!page.includes('english-synthesis')) throw new Error('Full synthesis profile lost the synthesis runtime');
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

  const artifactDirectory = path.join(ROOT, 'artifacts', `vela-tts-${stamp}`);
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(path.join(artifactDirectory, 'reference.wav'), reference.bytes);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const profiles = [];
  stageProfile();
  const rpk = buildRpk();
  const manifest = JSON.parse(readFileSync(path.join(APP, 'src/manifest.json')));
  validateRpk(rpk, stamp, manifest.versionName);
  copyFileSync(rpk, path.join(artifactDirectory, 'tts.rpk'));
  const startup = benchmarkVelaStartup(rpk);
  const buildManifest = JSON.parse(readFileSync(path.join(APP, 'build/manifest.json')));
  profiles.push({
    variant: 'A',
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
    outputAudioBytes: reference.bytes.length,
    packagedAudioBytes: 0,
    packageFileCount: zipEntryCount(rpk),
    audioSha256: sha256(reference.bytes),
    startup
  });
  const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  const profileA = profiles[0];
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
    runtimeProfiles: ['A'],
    retiredRuntimeProfiles: ['B', 'C'],
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
        versionName: profile.versionName,
        rpk: profile.rpk,
        bytes: profile.rpkBytes,
        sha256: profile.rpkSha256,
        parseSourceBytes: profile.startup.rpk.parseSourceBytes,
        actionReadBytes: profile.actionReadBytes
      }))
    }, null, 2));
  });
}
