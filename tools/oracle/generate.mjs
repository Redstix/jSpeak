import { readFileSync, readdirSync, statSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readWav } from '../compare/wav.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'upstream.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8'));
const build = path.join(root, 'build/oracle');
const binary = path.join(build, 'src/espeak-ng');
const hash = data => createHash('sha256').update(data).digest('hex');
const git = args => execFileSync('git', ['-C', path.join(root, 'upstream/espeak-ng'), ...args], { encoding: 'utf8' }).trim();
assert.equal(git(['rev-parse', 'HEAD']), config.commit, 'Upstream commit differs');
assert.equal(git(['status', '--porcelain']), '', 'Upstream checkout is dirty');
const stamp = JSON.parse(readFileSync(path.join(build, 'build-stamp.json'), 'utf8'));
assert.equal(stamp.upstreamCommit, config.commit, 'Rebuild: commit changed');
assert.deepEqual(stamp.cmakeOptions, config.cmakeOptions, 'Rebuild: options changed');
assert.equal(stamp.executableSha256, hash(readFileSync(binary)), 'Rebuild: binary changed');
assert.equal(stamp.cmakeCacheSha256, hash(readFileSync(path.join(build, 'CMakeCache.txt'))), 'Rebuild: CMake configuration changed');
function dataFiles(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap(name => {
    const relative = prefix + name;
    const target = path.join(dir, name);
    return statSync(target).isDirectory() ? dataFiles(target, relative + '/') : [{ path: relative, sha256: hash(readFileSync(target)) }];
  });
}
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const out = mkdtempSync(path.join(root, 'artifacts/oracle-'));
const manifest = dataFiles(path.join(build, 'espeak-ng-data'));
const profile = config.profile;
const base = ['-D', '-b', '1', '-v', profile.voice, '-s', String(profile.speed), '-p', String(profile.pitch), '-a', String(profile.amplitude), '--stdin'];
const run = (args, text) => execFileSync(binary, args, {
  env: { ...process.env, ESPEAK_DATA_PATH: build, LC_ALL: 'C' }, input: text, timeout: 15000, maxBuffer: 16 * 1024 * 1024
});
const cases = [];
for (let i = 0; i < corpus.length; i++) {
  const text = corpus[i];
  const id = String(i).padStart(3, '0');
  const phonemes = run([...base, '-x', '-q'], text).toString('utf8');
  assert.equal(run([...base, '-x', '-q'], text).toString('utf8'), phonemes, id + ' phoneme repeat mismatch');
  const wavPath = path.join(out, id + '.wav');
  const repeatPath = path.join(out, id + '.repeat.wav');
  run([...base, '-w', wavPath], text);
  run([...base, '-w', repeatPath], text);
  assert.equal(existsSync(wavPath), existsSync(repeatPath), id + ' WAV presence differs');
  if (!existsSync(wavPath)) {
    assert.equal(text.trim(), '', id + ' missing WAV for nonempty input');
    assert.equal(phonemes.trim(), '', id + ' missing WAV despite phoneme output');
    cases.push({ id, input: text, phonemeMnemonics: phonemes, audio: 'no-file', wav: null, wavSha256: null });
    continue;
  }
  const wav = readFileSync(wavPath);
  assert.equal(hash(readFileSync(repeatPath)), hash(wav), id + ' WAV repeat mismatch');
  const pcm = readWav(wav);
  cases.push({ id, input: text, phonemeMnemonics: phonemes, audio: 'wav', sampleRate: pcm.sampleRate, sampleCount: pcm.samples.length, wav: id + '.wav', wavSha256: hash(wav) });
}
writeFileSync(path.join(out, 'data-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(out, 'reference.json'), JSON.stringify({
  schemaVersion: 1,
  kind: 'cli-reference-smoke-not-internal-trace',
  upstreamCommit: config.commit,
  requestedCmakeOptions: config.cmakeOptions,
  cmakeCacheSha256: hash(readFileSync(path.join(build, 'CMakeCache.txt'))),
  executableSha256: hash(readFileSync(binary)),
  dataFingerprint: hash(JSON.stringify(manifest)),
  profile,
  deterministicRandom: true,
  platform: process.platform,
  arch: process.arch,
  version: run(['--version'], '').toString('utf8').trim(),
  cases
}, null, 2) + '\n');
console.log(`PASS: ${cases.length} cases, two independent C runs each, phoneme text and WAV hashes match.`);
console.log(`Reference artifacts: ${out}`);
console.log('This verifies C repeatability only, not C/JS compatibility or internal trace coverage.');
