import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav } from '../compare/wav.mjs';
import { dataFingerprint, hash32, makePack, sha256, verifyPack } from '../build-data/pack.mjs';
import { createCmnSynthesizer } from '../../src/core/cmn-synthesis.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PROFILE = Object.freeze({
  voice: 'cmn', speed: 175, pitch: 50, amplitude: 100, inputEncoding: 'UTF-8'
});
export const CANDIDATES = [
  { id: 'cmn_dict', sourcePath: 'cmn_dict', packagePath: 'cmn_dict.txt', role: 'compiled Mandarin translator dictionary' },
  { id: 'intonations', sourcePath: 'intonations', packagePath: 'intonations.txt', role: 'shared tunes retained whole' },
  { id: 'voice_cmn', sourcePath: 'lang/sit/cmn', packagePath: 'lang__sit__cmn.txt', role: 'fixed Mandarin voice metadata' },
  { id: 'phondata', sourcePath: 'phondata', packagePath: 'phondata.txt', role: 'shared wave and VM resources retained whole' },
  { id: 'phonindex', sourcePath: 'phonindex', packagePath: 'phonindex.txt', role: 'shared phoneme instructions retained whole' },
  { id: 'phontab', sourcePath: 'phontab', packagePath: 'phontab.txt', role: 'all phoneme tables and inheritance retained whole' }
];
export const AUDIO_TEXT = '你好，世界。';

function inventory(directory, prefix = '') {
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

function identity({ sourcePath, byteLength, sha256 }) {
  return { sourcePath, byteLength, sha256 };
}

function validateSource(root, build) {
  const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('source-lock.json', import.meta.url), 'utf8'));
  const source = path.join(root, 'upstream/espeak-ng');
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  requireEqual(git(['rev-parse', 'HEAD']), config.commit, 'Upstream commit differs from pin');
  requireEqual(git(['status', '--porcelain']), '', 'Upstream checkout is dirty');
  requireEqual(lock.upstreamCommit, config.commit, 'Language source lock commit differs from pin');
  const stamp = JSON.parse(readFileSync(path.join(build, 'build-stamp.json'), 'utf8'));
  requireEqual(stamp.upstreamCommit, config.commit, 'Rebuild oracle: commit changed');
  requireEqual(sha256(readFileSync(path.join(build, 'src/espeak-ng'))), stamp.executableSha256, 'Rebuild oracle: binary changed');
  requireEqual(sha256(readFileSync(path.join(build, 'CMakeCache.txt'))), stamp.cmakeCacheSha256, 'Rebuild oracle: CMake cache changed');
  const sourceData = path.join(build, 'espeak-ng-data');
  const sourceInventory = inventory(sourceData);
  requireEqual(dataFingerprint(sourceInventory), lock.sourceDataFingerprint, 'Source data fingerprint differs from reviewed lock');
  const selected = CANDIDATES.map(candidate => {
    const row = sourceInventory.find(file => file.sourcePath === candidate.sourcePath);
    if (!row) throw new Error('Selected language source is absent: ' + candidate.sourcePath);
    return { id: candidate.id, ...identity(row) };
  });
  requireEqual(selected, lock.files, 'Selected language data differs from reviewed lock');
  requireEqual(PROFILE, lock.profile, 'Unsupported changed language profile');
  const sourceInputs = lock.sourceInputs.map(input => {
    const bytes = readFileSync(path.join(source, input.sourcePath));
    return { ...identity(input), byteLength: bytes.length, sha256: sha256(bytes) };
  });
  requireEqual(sourceInputs, lock.sourceInputs, 'Mandarin source inputs differ from reviewed lock');
  return { config, lock, stamp, sourceInventory, sourceInputs };
}

function runOracle(binary, dataRoot, args, input) {
  const result = spawnSync(binary, ['--path=' + dataRoot, ...args], {
    input, timeout: 30000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ESPEAK_DATA_PATH: dataRoot, LC_ALL: 'C' }
  });
  return {
    status: result.status,
    error: result.error ? result.error.message : null,
    stdout: result.stdout?.toString('utf8') ?? '',
    stderr: result.stderr?.toString('utf8') ?? ''
  };
}

function fixedArgs(profile) {
  return ['-D', '-b', '1', '-v', profile.voice, '-s', String(profile.speed),
    '-p', String(profile.pitch), '-a', String(profile.amplitude), '--stdin'];
}

function wavOutput(binary, dataRoot, args, input, output) {
  const result = runOracle(binary, dataRoot, [...args, '-w', output], input);
  const bytes = existsSync(output) ? readFileSync(output) : null;
  return { result, bytes };
}

function caseInput(row) {
  if (row.inputBytesHex !== undefined) return Uint8Array.from(row.inputBytesHex.match(/../g).map(byte => parseInt(byte, 16)));
  const text = row.repeat === undefined ? row.text : row.text.repeat(row.repeat);
  return Buffer.from(text, 'utf8');
}

function toneBearingTokens(phonemes) {
  return phonemes.trim().split(/\s+/).filter(Boolean).filter(token => /\d/.test(token));
}

function compareCandidate(binary, fullRoot, candidateRoot, temp, base, rows, jsSynthesizer) {
  const normalize = text => text.split(candidateRoot).join('<candidate>');
  const cases = rows.map(row => {
    const input = caseInput(row);
    const fullPhonemes = runOracle(binary, fullRoot, [...base, '-q', '-x'], input);
    const candidatePhonemes = runOracle(binary, candidateRoot, [...base, '-q', '-x'], input);
    const fullAudio = wavOutput(binary, fullRoot, base, input, path.join(temp, row.id + '-full.wav'));
    const candidateAudio = wavOutput(binary, candidateRoot, base, input, path.join(temp, row.id + '-candidate.wav'));
    const fullWavSha256 = fullAudio.bytes ? sha256(fullAudio.bytes) : null;
    const candidateWavSha256 = candidateAudio.bytes ? sha256(candidateAudio.bytes) : null;
    const fullDiagnostics = normalize(fullPhonemes.stderr + fullAudio.result.stderr);
    const candidateDiagnostics = normalize(candidatePhonemes.stderr + candidateAudio.result.stderr);
    const phonemesEqual = fullPhonemes.status === 0 && candidatePhonemes.status === 0 && fullPhonemes.stdout === candidatePhonemes.stdout;
    let jsPhonemes = null, jsPhonemeError = null;
    try { jsPhonemes = jsSynthesizer.synthesizePhonemes(input).phonemeText; }
    catch (error) { jsPhonemeError = error.message; }
    const fullPhonemeText = fullPhonemes.stdout.endsWith('\n') ? fullPhonemes.stdout.slice(0, -1) : fullPhonemes.stdout;
    const jsPhonemesEqual = fullPhonemes.status === 0 && jsPhonemes === fullPhonemeText;
    const wavEqual = fullWavSha256 === candidateWavSha256;
    const exact = phonemesEqual && wavEqual && !fullDiagnostics && !candidateDiagnostics;
    if (row.classification.startsWith('exact') && !exact) {
      throw new Error('Expected exact Mandarin case ' + row.id);
    }
    if (row.classification.startsWith('unsupported') && (exact || fullPhonemes.status !== 0 || fullDiagnostics || !fullWavSha256)) {
      throw new Error('Unsupported Mandarin case did not preserve its reviewed boundary: ' + row.id);
    }
    if (row.classification.startsWith('exact') && !jsPhonemesEqual) {
      throw new Error('Expected exact Mandarin JS phoneme case ' + row.id + (jsPhonemeError ? ': ' + jsPhonemeError : ''));
    }
    if (row.classification.startsWith('unsupported') && (jsPhonemesEqual || !jsPhonemeError)) {
      throw new Error('Unsupported Mandarin JS phoneme case was not explicit: ' + row.id);
    }
    return {
      id: row.id,
      inputBytesHex: Buffer.from(input).toString('hex'),
      expectedClassification: row.classification,
      classification: exact ? 'exact' : row.classification,
      phonemesEqual,
      jsPhonemes,
      jsPhonemesEqual,
      jsPhonemeError,
      wavEqual,
      fullPhonemes: fullPhonemes.stdout,
      candidatePhonemes: candidatePhonemes.stdout,
      toneBearingTokens: toneBearingTokens(fullPhonemes.stdout),
      toneBearingTokenCount: toneBearingTokens(fullPhonemes.stdout).length,
      fullWavSha256,
      candidateWavSha256,
      fullSampleCount: fullAudio.bytes ? readWav(fullAudio.bytes).samples.length : 0,
      candidateSampleCount: candidateAudio.bytes ? readWav(candidateAudio.bytes).samples.length : 0,
      fullDiagnostics,
      candidateDiagnostics
    };
  });
  const exactCount = cases.filter(item => item.classification === 'exact').length;
  const unsupportedCount = cases.filter(item => item.classification !== 'exact').length;
  const jsPhonemeExactCount = cases.filter(item => item.jsPhonemesEqual).length;
  const jsPhonemeUnsupportedCount = cases.filter(item => !item.jsPhonemesEqual).length;
  return {
    kind: 'isolated-candidate-c-data-comparison', profile: PROFILE,
    closureComplete: false,
    caseCount: cases.length, exactCount, unsupportedCount,
    jsPhonemeExactCount, jsPhonemeUnsupportedCount,
    note: 'Exact agreement proves only the fixed corpus and selected runtime files. The explicit en-us voice switch is unsupported because the standalone cmn pack intentionally omits en_dict. This comparison is not a JS runtime result.',
    cases
  };
}

export function buildLanguageData({ root = ROOT, output = path.join(root, 'artifacts/cmn-language-pack') } = {}) {
  const build = path.join(root, 'build/oracle');
  const { config, stamp, lock, sourceInventory, sourceInputs } = validateSource(root, build);
  const sourceData = path.join(build, 'espeak-ng-data');
  const entries = CANDIDATES.map(file => ({ ...file, bytes: readFileSync(path.join(sourceData, file.sourcePath)) }));
  const manifest = makePack({
    upstreamCommit: config.commit,
    buildFingerprint: sha256(JSON.stringify(stamp)),
    sourceDataFingerprint: lock.sourceDataFingerprint,
    profile: PROFILE,
    entries
  });
  requireEqual(manifest.dataFingerprint, lock.selectedDataFingerprint, 'Selected data differs from reviewed language lock');
  const byPackage = new Map(entries.map(file => [file.packagePath, file.bytes]));
  verifyPack(manifest, filename => byPackage.get(filename), config.commit);
  const temp = mkdtempSync(path.join(tmpdir(), 'jspeak-cmn-data-'));
  try {
    const candidateRoot = path.join(temp, 'candidate');
    const candidateData = path.join(candidateRoot, 'espeak-ng-data');
    for (const entry of entries) {
      const target = path.join(candidateData, entry.sourcePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, entry.bytes);
    }
    const binary = path.join(build, 'src/espeak-ng');
    const base = fixedArgs(PROFILE);
    const first = wavOutput(binary, build, base, AUDIO_TEXT, path.join(temp, 'oracle.wav'));
    const repeat = wavOutput(binary, build, base, AUDIO_TEXT, path.join(temp, 'repeat.wav'));
    if (first.result.status !== 0 || repeat.result.status !== 0 || first.result.stderr || repeat.result.stderr) throw new Error('Mandarin oracle reference failed');
    requireEqual(sha256(first.bytes), sha256(repeat.bytes), 'Mandarin oracle WAV is not repeatable');
    requireEqual(sha256(first.bytes), lock.audio.sha256, 'Mandarin oracle WAV differs from reviewed reference');
    requireEqual(AUDIO_TEXT, lock.audio.text, 'Mandarin oracle text differs from reviewed reference');
    const wav = readWav(first.bytes);
    if (wav.sampleRate !== 22050 || wav.samples.length !== lock.audio.sampleCount ||
        first.bytes.length !== lock.audio.byteLength) throw new Error('Mandarin oracle WAV format differs from reviewed reference');
    manifest.audio = {
      uri: '/common/espeak/oracle.wav', dataUri: '/common/espeak/oracle-wave.txt', source: 'fixed uninstrumented C oracle', text: AUDIO_TEXT,
      byteLength: first.bytes.length, sha256: sha256(first.bytes), hash32: hash32(first.bytes), sampleRate: wav.sampleRate,
      sampleCount: wav.samples.length, channels: 1, bitsPerSample: 16, headerLength: 44, dataOffset: 44, repeatRuns: 2
    };
    const corpus = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8'));
    const jsSynthesizer = createCmnSynthesizer({
      dictionaryBytes: byPackage.get('cmn_dict.txt'),
      phontabBytes: byPackage.get('phontab.txt'),
      phonindexBytes: byPackage.get('phonindex.txt'),
      phondataBytes: byPackage.get('phondata.txt')
    });
    const comparison = compareCandidate(binary, build, candidateRoot, temp, base, corpus, jsSynthesizer);
    const selectedNames = new Set(entries.map(file => file.sourcePath));
    const provenance = {
      schemaVersion: 1, upstreamCommit: config.commit, repository: config.repository, buildStamp: stamp,
      profile: PROFILE,
      sourceDataFingerprint: lock.sourceDataFingerprint, selectedDataFingerprint: manifest.dataFingerprint,
      sourceInventory, sourceInputs, retained: CANDIDATES,
      excluded: sourceInventory.filter(file => !selectedNames.has(file.sourcePath)).map(file => ({
        ...file,
        disposition: file.sourcePath === 'en_dict' ? 'omitted from standalone cmn profile; explicit [[en-us]] switching is classified unsupported' :
          file.sourcePath === 'lang/sit/cmn-Latn-pinyin' ? 'pinyin voice variant not selected by the cmn profile' :
          file.sourcePath.startsWith('lang/') || file.sourcePath.startsWith('voices/') ? 'other voice selection metadata; fixed cmn profile only' :
          'not consumed by the known fixed cmn profile; production closure unresolved'
      })),
      closureComplete: false,
      jsRuntime: {
        synthesisSupported: false,
        phonemeSynthesisSupported: true,
        pcmSynthesisSupported: false,
        reason: 'The reviewed cmn JS text→phoneme frontend is C-exact for the fixed corpus; JS PCM is not yet compared or accepted'
      },
      license: { notice: 'THIRD_PARTY_NOTICES.md', upstreamLicense: 'upstream/espeak-ng/COPYING', sourceCommit: config.commit },
      caveats: ['cmn_list, cmn_rules and cmn_emoji are source-input provenance; cmn_dict is the unmodified upstream compiled runtime dependency.',
        'All shared phoneme tables, instructions, waves and intonations remain unmodified.',
        'The standalone pack deliberately does not support [[en-us]] language switching because en_dict is omitted.',
        'Exact C data comparison does not validate the QuickJS/Vela runtime.']
    };
    mkdirSync(output, { recursive: true });
    const expectedOutput = new Set([...entries.map(file => file.packagePath), 'oracle.wav', 'oracle-wave.txt',
      'manifest.json', 'provenance.json', 'candidate-comparison.json']);
    for (const name of readdirSync(output)) if (!expectedOutput.has(name)) throw new Error('Unexpected stale output file: ' + name);
    for (const entry of entries) writeFileSync(path.join(output, entry.packagePath), entry.bytes);
    writeFileSync(path.join(output, 'oracle.wav'), first.bytes);
    writeFileSync(path.join(output, 'oracle-wave.txt'), first.bytes);
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    writeFileSync(path.join(output, 'candidate-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
    verifyPack(manifest, filename => readFileSync(path.join(output, filename)), config.commit);
    requireEqual(dataFingerprint(inventory(sourceData)), lock.sourceDataFingerprint, 'Source data changed during language packaging');
    return { manifest, comparison, provenance, output };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/build-language/build.mjs');
  const { manifest, comparison, output } = buildLanguageData();
  console.log('cmn pack verified: ' + manifest.files.length + ' files / ' + manifest.totalDataBytes + ' data bytes; ' + manifest.dataFingerprint);
  console.log('Mandarin C differential: ' + comparison.exactCount + ' exact, ' + comparison.unsupportedCount + ' explicit unsupported; closureComplete=false.');
  console.log('Mandarin JS phoneme differential: ' + comparison.jsPhonemeExactCount + ' exact, ' + comparison.jsPhonemeUnsupportedCount + ' explicit unsupported; PCM not compared.');
  console.log('Output: ' + output);
}
