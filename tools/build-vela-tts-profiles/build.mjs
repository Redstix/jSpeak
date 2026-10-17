import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnglishSynthesizer } from '../../src/core/english-synthesis.js';
import { createCmnSynthesizer } from '../../src/core/cmn-synthesis.js';
import { CMN_DICTIONARY_MANIFEST } from '../../data/cmn/synthesis-profile.js';
import { benchmarkVelaStartup } from '../../tools/perf/vela-startup-benchmark.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = path.join(ROOT, 'apps/vela-tts');
const EN_SOURCE_DATA = path.join(ROOT, 'apps/vela-probe/src/common/espeak');
const CMN_SOURCE_DATA = path.join(ROOT, 'artifacts/cmn-language-pack');
const DIST = path.join(APP, 'dist');
const PAGE_SOURCE = path.join(APP, 'profiles/a/page.ux');
const EN_MANIFEST_SOURCE = path.join(APP, 'profiles/a/manifest.json');
const SRC_MANIFEST = path.join(APP, 'src/manifest.json');

const PROFILES = [
  {
    id: 'en',
    language: 'en-us',
    profileDir: 'a',
    sourceData: EN_SOURCE_DATA,
    packManifest: path.join(EN_SOURCE_DATA, 'manifest.json'),
    dictionaryManifest: JSON.parse(readFileSync(new URL('../../data/dictionary/manifest.json', import.meta.url))),
    testText: 'Hello world.',
    listeningNote: 'UNVERIFIED；请记录是否清晰英文'
  },
  {
    id: 'cmn',
    language: 'cmn',
    profileDir: 'cmn',
    sourceData: CMN_SOURCE_DATA,
    packManifest: path.join(CMN_SOURCE_DATA, 'manifest.json'),
    dictionaryManifest: CMN_DICTIONARY_MANIFEST,
    testText: '你好，世界。',
    listeningNote: 'UNVERIFIED；请记录是否清晰普通话音节与声调'
  }
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readPack(profile) {
  const manifest = JSON.parse(readFileSync(profile.packManifest, 'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Pack has no runtime files: ' + profile.packManifest);
  return manifest;
}

function dictionaryFile(pack) {
  const file = pack.files.find(entry => entry.id.endsWith('_dict'));
  if (!file) throw new Error('Pack has no dictionary file');
  return file;
}

/** @typedef {{ samples: Int16Array, sampleRate: number, channels: number, bitsPerSample: number }} PcmWav */

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

function text(bytes) {
  return Buffer.from(bytes).toString('ascii');
}

function readData(profile, name) {
  return new Uint8Array(readFileSync(path.join(profile.sourceData, name)));
}

async function generateReferenceAudio(profile, pack) {
  const dictionary = dictionaryFile(pack);
  const data = {
    dictionaryBytes: readData(profile, dictionary.packagePath),
    phontabBytes: readData(profile, pack.files.find(file => file.id === 'phontab').packagePath),
    phonindexBytes: readData(profile, pack.files.find(file => file.id === 'phonindex').packagePath),
    phondataBytes: readData(profile, pack.files.find(file => file.id === 'phondata').packagePath)
  };
  const synthesizer = profile.language === 'cmn'
    ? createCmnSynthesizer(data)
    : createEnglishSynthesizer({ ...data, dictionaryManifest: profile.dictionaryManifest });
  const result = await synthesizer.synthesizeWav(profile.testText, {
    scheduler(callback) { callback(); }
  });
  if (profile.language === 'cmn') {
    const expected = pack.audio?.sha256;
    const actual = sha256(result.wav);
    if (!expected || actual !== expected) {
      throw new Error('cmn JS reference does not match the reviewed C oracle: ' + actual);
    }
  }
  return {
    bytes: result.wav,
    sampleCount: result.pcm.length,
    commandCount: result.stats.producedCommands,
    sha256: sha256(result.wav)
  };
}

function dataAssetsModule(profile, pack, stamp) {
  const dictionary = dictionaryFile(pack);
  const assets = {
    ...pack,
    language: profile.language,
    versionName: JSON.parse(readFileSync(path.join(APP, 'profiles', profile.profileDir, 'manifest.json'))).versionName,
    buildStamp: stamp,
    testText: profile.testText,
    listeningNote: profile.listeningNote,
    dictionaryId: dictionary.id,
    dictionaryManifest: profile.dictionaryManifest,
    dataFileCount: pack.files.length
  };
  return '// Generated by tools/build-vela-tts-profiles/build.mjs; do not edit.\n' +
    'export var DATA_ASSETS = ' + JSON.stringify(assets, null, 2) + ';\n';
}

function stageProfile(profile, pack, stamp) {
  mkdirSync(path.join(APP, 'src/pages/index'), { recursive: true });
  copyFileSync(path.join(APP, 'profiles', profile.profileDir, 'manifest.json'), SRC_MANIFEST);
  copyFileSync(PAGE_SOURCE, path.join(APP, 'src/pages/index/index.ux'));
  rmSync(path.join(APP, 'src/common/espeak'), { recursive: true, force: true });
  mkdirSync(path.join(APP, 'src/common/espeak'), { recursive: true });
  for (const entry of pack.files) {
    copyFileSync(path.join(profile.sourceData, entry.packagePath),
      path.join(APP, 'src/common/espeak', entry.packagePath));
  }
  writeFileSync(path.join(APP, 'src/data-assets.js'), dataAssetsModule(profile, pack, stamp));
}

function expectedRpkName(manifest) {
  return `${manifest.package}.debug.${manifest.versionName}.rpk`;
}

function buildRpk() {
  rmSync(path.join(APP, 'build'), { recursive: true, force: true });
  execFileSync(path.join(APP, 'node_modules/.bin/aiot'), ['build', '--devtool', 'false'], {
    cwd: APP, stdio: 'inherit'
  });
  const manifest = JSON.parse(readFileSync(SRC_MANIFEST));
  const expected = path.join(DIST, expectedRpkName(manifest));
  if (!existsSync(expected)) throw new Error(`Expected ${expected}, not produced`);
  return expected;
}

function zipNames(rpk) {
  return execFileSync('unzip', ['-Z1', rpk], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function readZip(rpk, name) {
  return execFileSync('unzip', ['-p', rpk, name], { maxBuffer: 32 * 1024 * 1024 });
}

function validateRpk(rpk, stamp, profile, pack) {
  const manifest = JSON.parse(readZip(rpk, 'manifest.json'));
  const expectedManifest = JSON.parse(readFileSync(path.join(APP, 'profiles', profile.profileDir, 'manifest.json')));
  const profileConfig = manifest.config?.jspeakProfile;
  const page = readZip(rpk, 'pages/index/index.js').toString('utf8');
  const names = new Set(zipNames(rpk));
  if (profileConfig?.runtime !== 'full-js-synthesis') throw new Error(`Profile mismatch in ${rpk}`);
  if (profileConfig?.variant !== 'A' || profileConfig?.language !== profile.language) {
    throw new Error(`Language/variant mismatch in ${rpk}`);
  }
  if (manifest.versionName !== expectedManifest.versionName || manifest.versionCode !== expectedManifest.versionCode) {
    throw new Error(`Version mismatch in ${rpk}`);
  }
  if (profileConfig?.actionReadBytes !== pack.totalDataBytes) throw new Error(`Read-byte mismatch in ${rpk}`);
  if (!page.includes('READY ') || !page.includes(manifest.versionName) || !page.includes(stamp)) {
    throw new Error(`Version or build stamp missing in ${rpk}`);
  }
  const expectedDataNames = new Set(pack.files.map(entry => entry.packagePath));
  for (const entry of pack.files) {
    const name = `common/espeak/${entry.packagePath}`;
    if (!names.has(name)) throw new Error(`Missing ${entry.packagePath} in ${rpk}`);
    if (sha256(readZip(rpk, name)) !== entry.sha256) throw new Error(`Data hash mismatch for ${entry.packagePath} in ${rpk}`);
  }
  for (const name of names) {
    if (!name.endsWith('/') && name.startsWith('common/espeak/') &&
        !expectedDataNames.has(name.slice('common/espeak/'.length))) {
      throw new Error(`Unexpected data file ${name} in ${rpk}`);
    }
  }
  for (const name of ['provenance.json', 'candidate-comparison.json', 'oracle.wav', 'oracle-wave.txt']) {
    if (names.has(`common/espeak/${name}`)) throw new Error(`Build-time asset ${name} must not ship in full synthesis profile`);
  }
  if ([...names].some(name => name.startsWith('common/jspeak/'))) throw new Error(`Retired precomputed audio found in ${rpk}`);
  if (!page.includes('english-synthesis') || !page.includes('cmn-synthesis')) {
    throw new Error('Full synthesis profile lost a language synthesis runtime');
  }
}

function rpkMatches(rpk, stamp, profile) {
  if (!existsSync(rpk)) return false;
  try {
    const manifest = JSON.parse(readZip(rpk, 'manifest.json'));
    if (manifest.versionName === undefined || manifest.config?.jspeakProfile?.language !== profile.language) return false;
    const page = readZip(rpk, 'pages/index/index.js').toString('utf8');
    return page.includes(stamp) && page.includes(manifest.versionName);
  } catch (error) {
    return false;
  }
}

function zipEntryCount(rpk) {
  return zipNames(rpk).length;
}

async function buildProfiles({ only = null, reuseStamp = false, reuseRpk = false } = {}) {
  const started = Date.now();
  const trace = message => console.error(`[tts:build +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
  if (!existsSync(path.join(EN_SOURCE_DATA, 'manifest.json'))) {
    trace('generate en data pack');
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build-data/build.mjs')], { stdio: 'inherit' });
  }
  if (!existsSync(path.join(CMN_SOURCE_DATA, 'manifest.json'))) {
    trace('generate cmn data pack');
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build-language/build.mjs')], { stdio: 'inherit' });
  }
  if (!reuseStamp) execFileSync(process.execPath, [path.join(APP, 'tools/generate-assets.mjs')], { stdio: 'inherit' });
  const stampMatch = readFileSync(path.join(APP, 'src/build-stamp.js'), 'utf8').match(/B\d{6}T\d{6}/);
  if (!stampMatch) throw new Error('Build stamp generation failed');
  const stamp = stampMatch[0];
  const enManifest = readFileSync(EN_MANIFEST_SOURCE);

  const artifactDirectory = path.join(ROOT, 'artifacts', `vela-tts-${stamp}`);
  mkdirSync(artifactDirectory, { recursive: true });
  mkdirSync(DIST, { recursive: true });
  const profiles = [];
  const references = [];
  try {
    const selected = only ? PROFILES.filter(profile => profile.id === only) : PROFILES;
    if (!selected.length) throw new Error('Unknown profile: ' + only);
    for (const profile of selected) {
      const pack = readPack(profile);
      trace(`reference ${profile.id}`);
      const reference = await generateReferenceAudio(profile, pack);
      writeFileSync(path.join(artifactDirectory, `reference-${profile.id}.wav`), reference.bytes);
      references.push({
        profile: profile.id,
        voice: pack.profile?.voice,
        text: profile.testText,
        sampleCount: reference.sampleCount,
        commandCount: reference.commandCount,
        wavBytes: reference.bytes.length,
        sha256: reference.sha256
      });

      const profileManifest = JSON.parse(readFileSync(path.join(APP, 'profiles', profile.profileDir, 'manifest.json')));
      const candidate = path.join(DIST, expectedRpkName(profileManifest));
      let rpk;
      if (reuseRpk && rpkMatches(candidate, stamp, profile)) {
        trace(`reuse ${profile.id}`);
        rpk = candidate;
      } else {
        stageProfile(profile, pack, stamp);
        trace(`build ${profile.id}`);
        rpk = buildRpk();
      }
      trace(`validate ${profile.id}`);
      validateRpk(rpk, stamp, profile, pack);
      copyFileSync(rpk, path.join(artifactDirectory, `${profile.id}.rpk`));
      const startup = benchmarkVelaStartup(rpk);
      const manifest = JSON.parse(readZip(rpk, 'manifest.json'));
      profiles.push({
        id: profile.id,
        variant: 'A',
        language: profile.language,
        voice: pack.profile?.voice,
        rpk,
        rpkBytes: startup.rpk.bytes,
        rpkSha256: startup.rpk.sha256,
        unpackedBytes: startup.rpk.uncompressedBytes,
        buildStamp: stamp,
        buildTimestamp: manifest.packageInfo?.timeStamp || null,
        versionName: manifest.versionName,
        versionCode: manifest.versionCode,
        runtime: manifest.config.jspeakProfile.runtime,
        sampleRate: manifest.config.jspeakProfile.sampleRate,
        bitsPerSample: manifest.config.jspeakProfile.bitsPerSample,
        actionReadBytes: manifest.config.jspeakProfile.actionReadBytes,
        dataFingerprint: pack.dataFingerprint,
        dataFileCount: pack.files.length,
        dataBytes: pack.totalDataBytes,
        outputAudioBytes: reference.bytes.length,
        packagedAudioBytes: 0,
        packageFileCount: zipEntryCount(rpk),
        audioSha256: reference.sha256,
        startup
      });
    }
  } finally {
    writeFileSync(SRC_MANIFEST, enManifest);
  }

  for (const profile of profiles) {
    copyFileSync(path.join(artifactDirectory, `${profile.id}.rpk`), path.join(DIST, path.basename(profile.rpk)));
  }

  const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  const identity = {
    schemaVersion: 2,
    branch,
    commit,
    buildStamp: stamp,
    references,
    runtimeProfiles: ['A'],
    retiredRuntimeProfiles: ['B', 'C'],
    profiles
  };
  writeFileSync(path.join(DIST, 'profiles.json'), JSON.stringify(identity, null, 2) + '\n');
  writeFileSync(path.join(artifactDirectory, 'profiles.json'), JSON.stringify(identity, null, 2) + '\n');
  return identity;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const args = process.argv.slice(2);
  let only = null, reuseStamp = false, reuseRpk = false;
  for (const arg of args) {
    if (arg === '--reuse-stamp') reuseStamp = true;
    else if (arg === '--reuse-existing-rpk') reuseRpk = true;
    else if (arg.startsWith('--profile=')) only = arg.slice('--profile='.length);
    else throw new Error('Usage: node tools/build-vela-tts-profiles/build.mjs [--profile=en|cmn] [--reuse-stamp] [--reuse-existing-rpk]');
  }
  buildProfiles({ only, reuseStamp, reuseRpk }).then(report => {
    console.log(JSON.stringify({
      branch: report.branch,
      commit: report.commit,
      buildStamp: report.buildStamp,
      profiles: report.profiles.map(profile => ({
        language: profile.language,
        versionName: profile.versionName,
        rpk: profile.rpk,
        bytes: profile.rpkBytes,
        sha256: profile.rpkSha256,
        unpackedBytes: profile.unpackedBytes,
        dataBytes: profile.dataBytes,
        parseSourceBytes: profile.startup.rpk.parseSourceBytes,
        actionReadBytes: profile.actionReadBytes
      }))
    }, null, 2));
  });
}
