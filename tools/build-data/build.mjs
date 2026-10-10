import { readFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav } from '../compare/wav.mjs';
import { sha256, hash32, makePack, verifyPack, dataFingerprint } from './pack.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CANDIDATES = [
  { id: 'en_dict', sourcePath: 'en_dict', packagePath: 'en_dict.txt', role: 'confirmed en translator dictionary' },
  { id: 'intonations', sourcePath: 'intonations', packagePath: 'intonations.txt', role: 'shared tunes retained whole' },
  { id: 'voice_en_us', sourcePath: 'lang/gmw/en-US', packagePath: 'lang__gmw__en-US.txt', role: 'confirmed fixed voice metadata' },
  { id: 'phondata', sourcePath: 'phondata', packagePath: 'phondata.txt', role: 'shared wave and VM resources retained whole' },
  { id: 'phonindex', sourcePath: 'phonindex', packagePath: 'phonindex.txt', role: 'shared phoneme instructions retained whole' },
  { id: 'phontab', sourcePath: 'phontab', packagePath: 'phontab.txt', role: 'all phoneme tables and inheritance retained whole' }
];
export const AUDIO_TEXT = 'Hello world';

export function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const sourcePath = prefix + name;
    const target = path.join(directory, name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('Source symlink not permitted: ' + sourcePath);
    if (stat.isDirectory()) return inventory(target, sourcePath + '/');
    if (!stat.isFile()) throw new Error('Unexpected source file type: ' + sourcePath);
    const bytes = readFileSync(target);
    return [{ sourcePath, byteLength: bytes.length, sha256: sha256(bytes) }];
  });
}

function requireEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function validateSource(root, build) {
  const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('source-lock.json', import.meta.url), 'utf8'));
  const source = path.join(root, 'upstream/espeak-ng');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  requireEqual(git(['rev-parse', 'HEAD']), config.commit, 'Upstream commit differs from pin');
  requireEqual(git(['status', '--porcelain']), '', 'Upstream checkout is dirty');
  requireEqual(lock.upstreamCommit, config.commit, 'Source lock commit differs from pin');
  const stamp = JSON.parse(readFileSync(path.join(build, 'build-stamp.json'), 'utf8'));
  requireEqual(stamp.upstreamCommit, config.commit, 'Rebuild oracle: commit changed');
  requireEqual(stamp.cmakeOptions, config.cmakeOptions, 'Rebuild oracle: CMake options changed');
  requireEqual(sha256(readFileSync(path.join(build, 'src/espeak-ng'))), stamp.executableSha256, 'Rebuild oracle: binary changed');
  requireEqual(sha256(readFileSync(path.join(build, 'CMakeCache.txt'))), stamp.cmakeCacheSha256, 'Rebuild oracle: CMake cache changed');
  const files = inventory(path.join(build, 'espeak-ng-data'));
  requireEqual(dataFingerprint(files), lock.sourceDataFingerprint, 'Source data fingerprint differs from reviewed lock');
  const selected = CANDIDATES.map(file => files.find(item => item.sourcePath === file.sourcePath));
  requireEqual(selected, lock.files, 'Selected data differs from reviewed lock');
  requireEqual(config.profile, lock.profile, 'Unsupported changed profile');
  return { config, stamp, lock, sourceInventory: files, sourceDataFingerprint: lock.sourceDataFingerprint };
}

function runOracle(binary, dataRoot, args, text) {
  const result = spawnSync(binary, ['--path=' + dataRoot, ...args], {
    input: text, encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ESPEAK_DATA_PATH: dataRoot, LC_ALL: 'C' }
  });
  if (result.error || result.status !== 0) throw new Error('Oracle failed: ' + (result.error || result.stderr || result.status));
  return { stdout: result.stdout, stderr: result.stderr };
}

function fixedArgs(profile) {
  return ['-D', '-b', '1', '-v', profile.voice, '-s', String(profile.speed), '-p', String(profile.pitch), '-a', String(profile.amplitude), '--stdin'];
}

function wavOutput(binary, dataRoot, args, text, output) {
  const result = runOracle(binary, dataRoot, [...args, '-w', output], text);
  const bytes = existsSync(output) ? readFileSync(output) : null;
  if (!bytes && text.trim()) throw new Error('Missing oracle WAV for nonempty input');
  return { bytes, stderr: result.stderr };
}

function compareCandidate(binary, fullRoot, candidateRoot, temp, base, corpus) {
  const cases = corpus.map((input, i) => {
    const fullPhonemes = runOracle(binary, fullRoot, [...base, '-q', '-x'], input);
    const candidatePhonemes = runOracle(binary, candidateRoot, [...base, '-q', '-x'], input);
    const fullAudio = wavOutput(binary, fullRoot, base, input, path.join(temp, 'full-' + i + '.wav'));
    const candidateAudio = wavOutput(binary, candidateRoot, base, input, path.join(temp, 'candidate-' + i + '.wav'));
    const fullWavSha256 = fullAudio.bytes ? sha256(fullAudio.bytes) : null;
    const candidateWavSha256 = candidateAudio.bytes ? sha256(candidateAudio.bytes) : null;
    const phonemesEqual = fullPhonemes.stdout === candidatePhonemes.stdout;
    const wavEqual = fullWavSha256 === candidateWavSha256;
    const normalize = text => text.split(candidateRoot).join('<candidate>').split(fullRoot).join('<full>');
    return { id: String(i).padStart(3, '0'), input, phonemesEqual, wavEqual,
      fullPhonemes: fullPhonemes.stdout, candidatePhonemes: candidatePhonemes.stdout, fullWavSha256, candidateWavSha256,
      fullDiagnostics: normalize(fullPhonemes.stderr + fullAudio.stderr), candidateDiagnostics: normalize(candidatePhonemes.stderr + candidateAudio.stderr) };
  });
  return { kind: 'isolated-candidate-c-data-comparison', closureComplete: false,
    note: 'Corpus agreement cannot establish complete dependencies. Missing dictionaries remain unresolved; this is a probe payload, not a production language pack.',
    caseCount: cases.length, equalCount: cases.filter(c => c.phonemesEqual && c.wavEqual && !c.candidateDiagnostics).length, cases };
}

export function buildData({ root = ROOT, output = path.join(root, 'apps/vela-probe/src/common/espeak'), moduleOutput = path.join(root, 'apps/vela-probe/src/data-assets.js') } = {}) {
  const build = path.join(root, 'build/oracle');
  const { config, stamp, lock, sourceInventory, sourceDataFingerprint } = validateSource(root, build);
  const sourceData = path.join(build, 'espeak-ng-data');
  const entries = CANDIDATES.map(file => ({ ...file, bytes: readFileSync(path.join(sourceData, file.sourcePath)) }));
  const manifest = makePack({ upstreamCommit: config.commit, buildFingerprint: sha256(JSON.stringify(stamp)), sourceDataFingerprint, profile: config.profile, entries });
  const byPackage = new Map(entries.map(file => [file.packagePath, file.bytes]));
  verifyPack(manifest, filename => byPackage.get(filename), config.commit);
  const temp = mkdtempSync(path.join(tmpdir(), 'jspeak-data-'));
  try {
    const candidateRoot = path.join(temp, 'candidate');
    const candidateData = path.join(candidateRoot, 'espeak-ng-data');
    for (const entry of entries) {
      const target = path.join(candidateData, entry.sourcePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes);
    }
    const binary = path.join(build, 'src/espeak-ng');
    const base = fixedArgs(config.profile);
    const first = wavOutput(binary, build, base, AUDIO_TEXT, path.join(temp, 'oracle.wav'));
    const repeat = wavOutput(binary, build, base, AUDIO_TEXT, path.join(temp, 'repeat.wav'));
    if (first.stderr || repeat.stderr) throw new Error('Unexpected oracle WAV diagnostics');
    requireEqual(sha256(first.bytes), sha256(repeat.bytes), 'Oracle WAV is not repeatable');
    requireEqual(sha256(first.bytes), lock.audio.sha256, 'Oracle WAV differs from reviewed reference');
    requireEqual(AUDIO_TEXT, lock.audio.text, 'Oracle text differs from reviewed reference');
    const wav = readWav(first.bytes);
    requireEqual(wav.sampleRate, 22050, 'Unexpected oracle sample rate');
    if (first.bytes.length !== 44 + wav.samples.length * 2 || first.bytes.toString('ascii', 36, 40) !== 'data' || first.bytes.length > 262144) throw new Error('Expected bounded canonical 44-byte PCM WAV');
    manifest.audio = {
      uri: '/common/espeak/oracle.wav', dataUri: '/common/espeak/oracle-wave.txt', source: 'fixed uninstrumented C oracle', text: AUDIO_TEXT,
      byteLength: first.bytes.length, sha256: sha256(first.bytes), hash32: hash32(first.bytes), sampleRate: wav.sampleRate,
      sampleCount: wav.samples.length, channels: 1, bitsPerSample: 16, headerLength: 44, dataOffset: 44, repeatRuns: 2
    };
    const corpus = JSON.parse(readFileSync(path.join(root, 'tools/oracle/corpus.json'), 'utf8'));
    const dependencyCases = ['Ελληνικά', 'русский', 'Հայերեն', '한국어', '日本語', 'עברית', 'العربية', 'हिन्दी'];
    const comparison = compareCandidate(binary, build, candidateRoot, temp, base, [...corpus, ...dependencyCases]);
    for (const result of comparison.cases.slice(0, corpus.length)) {
      if (!result.phonemesEqual || !result.wavEqual || result.fullDiagnostics || result.candidateDiagnostics) throw new Error('Candidate changed original smoke case ' + result.id);
    }
    const selectedNames = new Set(entries.map(file => file.sourcePath));
    const provenance = {
      schemaVersion: 1, upstreamCommit: config.commit, repository: config.repository, buildStamp: stamp,
      sourceDataFingerprint, selectedDataFingerprint: manifest.dataFingerprint,
      sourceInventory, retained: CANDIDATES,
      excluded: sourceInventory.filter(file => !selectedNames.has(file.sourcePath)).map(file => ({
        ...file, disposition: file.sourcePath.endsWith('_dict') ? 'unresolved dynamic language/character fallback dependency; omitted only from bounded device probe' :
          file.sourcePath.startsWith('lang/') || file.sourcePath.startsWith('voices/') ? 'other voice selection metadata; fixed voice only in this probe' : 'not consumed by the known fixed profile; production closure unresolved'
      })),
      missingOptionalConfig: !existsSync(path.join(sourceData, 'config')),
      closureComplete: false,
      license: { notice: 'THIRD_PARTY_NOTICES.md', upstreamLicense: 'upstream/espeak-ng/COPYING', sourceCommit: config.commit },
      caveats: ['All shared phoneme tables, instructions, waves, and intonations remain unmodified.',
        'The probe candidate is not a complete en-us input-language dependency closure.',
        'SetAlternateTranslator and character spelling can load other dictionaries for plain-text en-us.',
        'Build fingerprint includes machine-specific executable and CMake cache; raw data identity is separately locked.']
    };
    mkdirSync(output, { recursive: true });
    const expectedOutput = new Set([...entries.map(file => file.packagePath), 'oracle.wav', 'oracle-wave.txt', 'manifest.json', 'provenance.json', 'candidate-comparison.json']);
    for (const name of readdirSync(output)) if (!expectedOutput.has(name)) throw new Error('Unexpected stale output file; inspect before rebuilding: ' + name);
    for (const entry of entries) writeFileSync(path.join(output, entry.packagePath), entry.bytes);
    writeFileSync(path.join(output, 'oracle.wav'), first.bytes);
    writeFileSync(path.join(output, 'oracle-wave.txt'), first.bytes);
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    writeFileSync(path.join(output, 'candidate-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
    mkdirSync(path.dirname(moduleOutput), { recursive: true });
    writeFileSync(moduleOutput, '// Generated by tools/build-data/build.mjs; do not edit.\nexport var DATA_ASSETS = ' + JSON.stringify(manifest, null, 2) + ';\n');
    verifyPack(manifest, filename => readFileSync(path.join(output, filename)), config.commit);
    // Verify source did not change while outputs were being produced.
    requireEqual(dataFingerprint(inventory(sourceData)), sourceDataFingerprint, 'Source data changed during packaging');
    return { manifest, comparison, output };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/build-data/build.mjs');
  const { manifest, comparison, output } = buildData();
  console.log('Pack verified: ' + manifest.files.length + ' files / ' + manifest.totalDataBytes + ' data bytes; ' + manifest.dataFingerprint);
  console.log('Oracle WAV: ' + manifest.audio.byteLength + ' bytes / ' + manifest.audio.sampleRate + ' Hz; two C runs equal.');
  console.log('Isolated candidate: ' + comparison.equalCount + '/' + comparison.caseCount + ' cases equal without diagnostics; closureComplete=false.');
  console.log('Output: ' + output);
}
