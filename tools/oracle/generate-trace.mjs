import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readWav } from '../compare/wav.mjs';
import { compareTraces, validateTrace } from '../compare/trace.mjs';
import { root, config, traceBuild, referenceBuild, sha256, validateTraceBuild } from './trace-build-info.mjs';
import { makeTraceCorpus } from './trace-corpus.mjs';

const args = process.argv.slice(2);
let seed = 0x5eed1234, fuzzCount = 16, replay;
let upstreamTests = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--seed') seed = Number(args[++i]);
  else if (args[i] === '--fuzz-count') fuzzCount = Number(args[++i]);
  else if (args[i] === '--replay') replay = args[++i];
  else if (args[i] === '--skip-upstream') upstreamTests = false;
  else throw new Error(`Unknown argument ${args[i]}`);
}
const { stamp, fingerprint } = validateTraceBuild();
const corpus = replay ? (() => {
  const saved = JSON.parse(readFileSync(replay, 'utf8'));
  assert.match(saved.input.utf8Hex, /^(?:[0-9a-f]{2})*$/);
  return [{ id: 'replay', caseId: saved.caseId ?? 'replay', bytes: Buffer.from(saved.input.utf8Hex, 'hex') }];
})() : makeTraceCorpus(seed, fuzzCount);
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/oracle-trace-'));
const reference = {
  upstreamCommit: config.commit, buildFingerprint: fingerprint,
  dataFingerprint: stamp.reference.dataFingerprint, observationPatchSha256: stamp.patchSha256,
  profile: { ...config.profile, randomSeed: 1 }
};
const base = ['-D', '-b', '1', '-v', config.profile.voice, '-s', String(config.profile.speed), '-p', String(config.profile.pitch), '-a', String(config.profile.amplitude), '--stdin', '-x'];
function run(build, directory, label, bytes, observe) {
  const wavPath = path.join(directory, label + '.wav');
  const eventsPath = path.join(directory, label + '.jsonl');
  const mnemonic = execFileSync(path.join(build, 'src/espeak-ng'), [...base, '-w', wavPath], {
    env: { ...process.env, ESPEAK_DATA_PATH: build, LC_ALL: 'C', JSPEAK_TRACE_FILE: observe ? eventsPath : '' },
    input: bytes, timeout: 30000, maxBuffer: 32 * 1024 * 1024
  }).toString('utf8');
  let audio = null;
  if (existsSync(wavPath)) {
    const wavBytes = readFileSync(wavPath); const wav = readWav(wavBytes);
    assert.equal(wav.sampleRate, 22050, 'Reference sample rate changed');
    // readWav enforces PCM16 mono and whole RIFF size; exact bytes include every sample.
    audio = { format: 'PCM16LE-mono', sampleRate: wav.sampleRate, sampleCount: wav.samples.length, wavSha256: sha256(wavBytes) };
  }
  const events = observe && existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  if (observe && events.length === 0) assert.equal(mnemonic.trim(), '', 'Trace unexpectedly absent for phoneme output');
  if (!audio) assert.equal(mnemonic.trim(), '', 'Missing WAV for phoneme output');
  return { mnemonic, audio, events };
}
function envelope(entry, events) {
  return validateTrace({
    schemaVersion: 1, stage: 'frontend-observations-v1', caseId: entry.caseId ?? entry.id, reference,
    input: { utf8Hex: entry.bytes.toString('hex') }, initialState: { process: 'fresh-cli', randomSeed: 1 },
    events, finalState: { eventCount: events.length, clauseCount: events.filter(e => e.kind === 'clause').length }
  });
}
const cases = [];
for (const entry of corpus) {
  const directory = path.join(output, entry.id); mkdirSync(directory);
  try {
    const clean = run(referenceBuild, directory, 'reference', entry.bytes, false);
    const cleanRepeat = run(referenceBuild, directory, 'reference-repeat', entry.bytes, false);
    const observed = run(traceBuild, directory, 'instrumented', entry.bytes, true);
    const repeated = run(traceBuild, directory, 'instrumented-repeat', entry.bytes, true);
    for (const [label, actual] of [['clean repeat', cleanRepeat], ['instrumented', observed], ['instrumented repeat', repeated]]) {
      assert.equal(actual.mnemonic, clean.mnemonic, entry.id + ': ' + label + ' changed mnemonics');
      assert.deepEqual(actual.audio, clean.audio, entry.id + ': ' + label + ' changed PCM/WAV');
    }
    if (observed.mnemonic.trim()) assert.ok(observed.events.some(e => e.kind === 'clause'), 'Missing clause observations for synthesized text');
    const trace = envelope(entry, observed.events);
    const comparison = compareTraces(trace, envelope(entry, repeated.events));
    assert.equal(comparison.equal, true, JSON.stringify(comparison));
    writeFileSync(path.join(directory, 'trace.json'), JSON.stringify(trace, null, 2) + '\n');
    cases.push({ id: entry.id, inputHex: entry.bytes.toString('hex'), eventCount: trace.events.length, clauseCount: trace.finalState.clauseCount, phonemeMnemonics: clean.mnemonic, audio: clean.audio });
  } catch (error) {
    const failure = { caseId: entry.id, seed, input: { utf8Hex: entry.bytes.toString('hex') }, reference, error: error.stack };
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify(failure, null, 2) + '\n');
    console.error(`FAIL: ${entry.id}; replay: node tools/oracle/generate-trace.mjs --skip-upstream --replay ${path.join(directory, 'failure.json')}`);
    throw error;
  }
}
let tests = { status: 'skipped', reason: 'Explicit --skip-upstream argument; run without it for CTest evidence' };
if (upstreamTests) {
  const result = spawnSync('ctest', ['--test-dir', traceBuild, '--output-on-failure', '--parallel', '2', '--output-junit', path.join(output, 'upstream-tests.xml')], {
    env: { ...process.env, JSPEAK_TRACE_FILE: '' }, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024
  });
  writeFileSync(path.join(output, 'upstream-tests.log'), (result.stdout || '') + (result.stderr || ''));
  tests = { status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status, error: result.error?.message || null, disabled: ['MBROLA (USE_MBROLA=OFF)', 'Windows data/installer tests (not registered by upstream CMake)'] };
}
writeFileSync(path.join(output, 'report.json'), JSON.stringify({ schemaVersion: 1, kind: 'C-oracle-instrumentation-and-repeatability-not-C-JS-compatibility', reference, seed, fuzzCount: replay ? 0 : fuzzCount, cases, upstreamTests: tests }, null, 2) + '\n');
console.log(`PASS: ${cases.length} cases; clean/instrumented mnemonic and PCM exact; independent repeated traces exact.`);
console.log(`Upstream CTest: ${tests.status}. Artifacts: ${output}`);
console.log('Partial frontend observations only; no C/JS compatibility claim.');
if (tests.status === 'failed') process.exitCode = 1;
