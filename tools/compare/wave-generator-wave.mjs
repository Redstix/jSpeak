import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild } from '../oracle/trace-build-info.mjs';
import { generateCommandsBinary, generateCommandsInputs } from '../oracle/generate-commands-build-info.mjs';
import { waveSampleBinary, waveSampleInputs } from '../oracle/wave-sample-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createWaveGenerator } from '../../src/core/wave-generator.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function observedCases() {
  const report = JSON.parse(readFileSync(path.join(root, 'artifacts/oracle-clause-word2-2pOOA5/report.json'), 'utf8'));
  const cases = [];
  for (const capture of report.captures) {
    const tracePath = path.join(root, 'artifacts/oracle-clause-word2-2pOOA5', capture.id, 'observed.jsonl');
    if (!existsSync(tracePath)) continue;
    for (const event of readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)) {
      if (event.kind !== 'clause.before-phonemelist') continue;
      const items = event.phonemeList2.items;
      cases.push({ id: capture.id, clause: event.clause, event });
    }
  }
  return cases;
}

function commandInput(cases) {
  const lines = [];
  for (const clause of cases) {
    const event = clause.event, items = event.phonemeList2.items;
    lines.push(items.length, event.clausePause, event.newSentence2 ? 1 : 0, event.tone,
      event.embedded.list.length, ...event.embedded.list,
      ...items.flatMap(row => [row.phcode, row.stresslevel, row.wordstress, row.tonePh, row.sourceix, row.synthflags]));
  }
  return lines.join('\n') + '\n';
}

export function verifyWaveGeneratorWave({ directory } = {}) {
  assert(existsSync(generateCommandsBinary), 'Build the original Generate command oracle first');
  assert(existsSync(waveSampleBinary), 'Build the original wave-sample oracle first');
  const cases = observedCases();
  const commandOutput = execFileSync(generateCommandsBinary, [referenceBuild], {
    input: commandInput(cases), maxBuffer: 64 * 1024 * 1024, timeout: 120000,
  });
  const commandPlans = JSON.parse(commandOutput).results;
  assert.equal(commandPlans.length, cases.length, 'Generate command case count differs');
  const unique = new Map();
  for (const plan of commandPlans) for (const command of plan.items) {
    if ((command.type & 0xff) !== 6) continue;
    const key = JSON.stringify([command.a, command.b, command.c]);
    if (!unique.has(key)) unique.set(key, command);
  }
  assert(unique.size > 0, 'No WCMD_WAVE commands found');

  const phondata = new Uint8Array(readFileSync(path.join(referenceBuild, 'espeak-ng-data/phondata')));
  const generator = createWaveGenerator({ phondataBytes: phondata });
  const files = runtimeSnapshot(['src/core/wave-generator.js'], [
    'tools/compare/wave-generator-wave.mjs', 'artifacts/oracle-clause-word2-2pOOA5/report.json',
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/wave-generator-wave-')); }
  mkdirSync(directory, { recursive: true });
  const results = [];
  try {
    let index = 0;
    for (const command of unique.values()) {
      const actual = generator.synthesize([command]);
      const packed = command.c;
      const sampleOutput = execFileSync(waveSampleBinary, [referenceBuild], {
        input: `${command.b.phondataOffset} ${command.a} ${packed & 0xff} ${packed >>> 8}\n`,
        maxBuffer: 64 * 1024 * 1024, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const expected = JSON.parse(sampleOutput.toString().trim().split('\n').filter(Boolean).at(-1));
      index++;
      assert.deepEqual(Array.from(actual.samples), expected.samples, 'Wave command ' + index);
      results.push({ index, status: 'exact', samples: actual.samples.length,
        offset: command.b.phondataOffset, packed: command.c });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/wave-generator.js'], [
      'tools/compare/wave-generator-wave.mjs', 'artifacts/oracle-clause-word2-2pOOA5/report.json',
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length,
      files, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed en-us original PlayWave commands to PCM16', totalCases: results.length,
    exactCases: results.length, comparedSamples: results.reduce((sum, row) => sum + row.samples, 0),
    unsupportedCases: 0, generateReference: generateCommandsInputs().reference,
    waveReference: waveSampleInputs().reference, files, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyWaveGeneratorWave(), null, 2));
}
