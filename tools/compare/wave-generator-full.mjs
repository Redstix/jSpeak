import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild } from '../oracle/trace-build-info.mjs';
import { generateCommandsBinary, generateCommandsInputs } from '../oracle/generate-commands-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { readWav } from './wav.mjs';
import { comparePcm } from './pcm.mjs';
import { createWaveGenerator } from '../../src/core/wave-generator.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function observedCases() {
  const observedDirectory = path.join(root, 'artifacts/oracle-clause-word2-2pOOA5');
  const report = JSON.parse(readFileSync(path.join(observedDirectory, 'report.json'), 'utf8'));
  const cases = [];
  for (const capture of report.captures) {
    const tracePath = path.join(observedDirectory, capture.id, 'observed.jsonl');
    if (!existsSync(tracePath)) continue;
    const clauses = [];
    for (const event of readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)) {
      if (event.kind !== 'clause.before-phonemelist') continue;
      clauses.push({ event, text: Buffer.from(capture.utf8Hex, 'hex') });
    }
    assert(clauses.length > 0, 'Missing clauses for ' + capture.id);
    cases.push({ id: capture.id, clauses });
  }
  assert.equal(cases.reduce((sum, capture) => sum + capture.clauses.length, 0), report.clauses,
    'Observed clause count differs from report');
  return cases;
}

function commandInput(cases) {
  const lines = [];
  for (const capture of cases) {
    for (const clause of capture.clauses) {
      const event = clause.event;
      const items = event.phonemeList2.items;
      lines.push(items.length, event.clausePause, event.newSentence2 ? 1 : 0, event.tone,
        event.embedded.list.length, ...event.embedded.list,
        ...items.flatMap(row => [row.phcode, row.stresslevel, row.wordstress, row.tonePh, row.sourceix, row.synthflags]));
    }
  }
  return lines.join('\n') + '\n';
}

function generateInChunks(commands, voiceState, phondata, chunkSize) {
  const generator = createWaveGenerator({ voice: voiceState, phondataBytes: phondata, randomSeed: 1 });
  const work = new Int16Array(chunkSize);
  let capacity = 4096;
  let output = new Int16Array(capacity);
  let samples = 0;
  for (;;) {
    const result = generator.fill(commands, work);
    if (samples + result.produced > capacity) {
      while (samples + result.produced > capacity) capacity *= 2;
      const grown = new Int16Array(capacity);
      grown.set(output.subarray(0, samples));
      output = grown;
    }
    output.set(work.subarray(0, result.produced), samples);
    samples += result.produced;
    if (result.finished) break;
  }
  return output.subarray(0, samples);
}

export function verifyWaveGeneratorFull({ directory } = {}) {
  assert(existsSync(generateCommandsBinary), 'Build the original Generate command oracle first');
  const cases = observedCases();
  const request = commandInput(cases);
  const requestSha256 = sha256(Buffer.from(request));
  const commandOutput = execFileSync(generateCommandsBinary, [referenceBuild], {
    input: request, maxBuffer: 256 * 1024 * 1024, timeout: 120000,
  });
  const commandPlans = JSON.parse(commandOutput);
  assert.equal(commandPlans.results.length, cases.reduce((sum, capture) => sum + capture.clauses.length, 0),
    'Generate command case count differs');
  const profile = commandPlans.profile;
  assert.equal(profile.sampleRate, 22050, 'Oracle sample rate differs');
  assert.equal(profile.voice, 'en-us', 'Oracle voice differs');

  const phondata = new Uint8Array(readFileSync(path.join(referenceBuild, 'espeak-ng-data/phondata')));
  const inputs = generateCommandsInputs();
  const files = runtimeSnapshot(['src/core/wave-generator.js'], [
    'tools/oracle/generate-commands-oracle.c', 'tools/oracle/generate-commands-build.mjs',
    'tools/compare/wave-generator-full.mjs',
    'artifacts/oracle-clause-word2-2pOOA5/report.json',
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/wave-generator-full-')); }
  mkdirSync(directory, { recursive: true });

  const chunkSizes = [1, 7, 64, 1323, 4096];
  const results = [];
  let commandIndex = 0;
  try {
    for (const capture of cases) {
      const commands = capture.clauses.flatMap(() => {
        const plan = commandPlans.results[commandIndex++];
        for (const command of plan.items) {
          if (command.b && Number.isInteger(command.b.frameIndex)) command.b.frames = plan.frames;
          if (command.c && Number.isInteger(command.c.frameIndex)) command.c.frames = plan.frames;
        }
        return plan.items;
      });
      const wavPath = path.join(directory, capture.id + '.wav');
      execFileSync(path.join(referenceBuild, 'src/espeak-ng'), [
        '-D', '-b', '1', '-v', 'en-us', '-s', '175', '-p', '50', '-a', '100', '--stdin', '-w', wavPath,
      ], { input: capture.clauses[0].text, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ESPEAK_DATA_PATH: referenceBuild, LC_ALL: 'C' } });
      const wav = readWav(readFileSync(wavPath));
      const chunkResults = chunkSizes.map(chunkSize => {
        const generated = generateInChunks(commands, commandPlans.voiceState, phondata, chunkSize);
        return comparePcm({ samples: wav.samples, sampleRate: wav.sampleRate },
          { samples: generated, sampleRate: profile.sampleRate });
      });
      assert(chunkResults.every(result => result.exact), capture.id + ' full PCM or chunk consistency');
      const generator = createWaveGenerator({ voice: commandPlans.voiceState, phondataBytes: phondata, randomSeed: 1 });
      results.push({
        id: capture.id, status: 'exact', clauses: capture.clauses.length, commandCount: commands.length,
        samples: wav.samples.length, wavSha256: sha256(readFileSync(wavPath)),
        bufferProfile: generator.bufferProfile(), chunkSizes,
      });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/wave-generator.js'], [
      'tools/oracle/generate-commands-oracle.c', 'tools/oracle/generate-commands-build.mjs',
      'tools/compare/wave-generator-full.mjs',
      'artifacts/oracle-clause-word2-2pOOA5/report.json',
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length,
      files, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }

  const report = {
    schemaVersion: 1, status: 'passed', coverageComplete: true,
    scope: 'Fixed en-us full Wavegen command profile: SPECT, SPECT2, WAVE, WAVE2, PAUSE, AMPLITUDE, PITCH, EMBEDDED and MARKER',
    profile, totalCases: results.length, exactCases: results.length,
    commandObservation: { capacity: profile.commandCapacity, runtimeCapacity: 170,
      purpose: 'Capture the complete logical Generate plan; runtime queue scheduling remains M11 scope' },
    comparedClauses: results.reduce((sum, row) => sum + row.clauses, 0),
    comparedCommands: results.reduce((sum, row) => sum + row.commandCount, 0),
    comparedSamples: results.reduce((sum, row) => sum + row.samples, 0),
    chunkSizes, unsupportedCases: 0,
    profileUnusedUnsupported: ['WCMD_KLATT', 'WCMD_KLATT2', 'WCMD_VOICE', 'WCMD_MBROLA_DATA',
      'WCMD_FMT_AMPLITUDE', 'WCMD_SONIC_SPEED', 'WCMD_PHONEME_ALIGNMENT'],
    requestSha256, oracleReference: inputs.reference, files, artifactDirectory: directory,
  };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/wave-generator-full.mjs [directory]');
  console.log(JSON.stringify(verifyWaveGeneratorFull(process.argv[2] ? { directory: process.argv[2] } : {}), null, 2));
}
