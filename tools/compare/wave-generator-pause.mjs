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
const selectedCases = ['smoke-002', 'boundary-1'];

function clauseInput(event) {
  const items = event.phonemeList2.items;
  return [items.length, event.clausePause, event.newSentence2 ? 1 : 0, event.tone,
    event.embedded.list.length, ...event.embedded.list,
    ...items.flatMap(row => [row.phcode, row.stresslevel, row.wordstress, row.tonePh, row.sourceix, row.synthflags])].join('\n') + '\n';
}

export function verifyWaveGeneratorPause({ directory } = {}) {
  assert(existsSync(generateCommandsBinary), 'Build the original Generate command oracle first');
  const observedReport = JSON.parse(readFileSync(path.join(root, 'artifacts/oracle-clause-word2-2pOOA5/report.json'), 'utf8'));
  const cases = [];
  for (const id of selectedCases) {
    const capture = observedReport.captures.find(row => row.id === id);
    assert(capture, 'Missing observed case ' + id);
    const tracePath = path.join(root, 'artifacts/oracle-clause-word2-2pOOA5', id, 'observed.jsonl');
    assert(existsSync(tracePath), 'Missing observed trace ' + id);
    const events = readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const event = events.find(row => row.kind === 'clause.before-phonemelist');
    assert(event, 'Missing pre-MakePhonemeList event ' + id);
    cases.push({ id, text: Buffer.from(capture.utf8Hex, 'hex'), event });
  }

  const inputs = generateCommandsInputs();
  const files = runtimeSnapshot(['src/core/wave-generator.js'], [
    'tools/compare/wave-generator-pause.mjs', 'tools/compare/pcm.mjs', 'tools/compare/wav.mjs',
    'artifacts/oracle-clause-word2-2pOOA5/report.json',
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/wave-generator-pause-')); }
  mkdirSync(directory, { recursive: true });
  const results = [];
  try {
    for (const clause of cases) {
      const commandOutput = execFileSync(generateCommandsBinary, [referenceBuild], {
        input: clauseInput(clause.event), maxBuffer: 32 * 1024 * 1024, timeout: 30000,
      });
      const commands = JSON.parse(commandOutput).results[0].items;
      const wavPath = path.join(directory, clause.id + '.wav');
      execFileSync(path.join(referenceBuild, 'src/espeak-ng'), [
        '-D', '-b', '1', '-v', 'en-us', '-s', '175', '-p', '50', '-a', '100', '--stdin', '-w', wavPath,
      ], { input: clause.text, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ESPEAK_DATA_PATH: referenceBuild, LC_ALL: 'C' } });
      const wav = readWav(readFileSync(wavPath));
      const generated = createWaveGenerator().synthesize(commands);
      const comparison = comparePcm({ samples: wav.samples, sampleRate: wav.sampleRate },
        { samples: generated.samples, sampleRate: generated.sampleRate });
      assert.equal(comparison.exact, true, clause.id + ' pause-only PCM');
      results.push({ id: clause.id, status: 'exact', samples: generated.samples.length,
        commandCount: commands.length, wavSha256: sha256(readFileSync(wavPath)) });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/wave-generator.js'], [
      'tools/compare/wave-generator-pause.mjs', 'tools/compare/pcm.mjs', 'tools/compare/wav.mjs',
      'artifacts/oracle-clause-word2-2pOOA5/report.json',
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length,
      files, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed en-us pause/marker Wavegen commands to PCM16', totalCases: results.length,
    exactCases: results.length, comparedSamples: results.reduce((sum, row) => sum + row.samples, 0),
    unsupportedCases: 0, oracleReference: inputs.reference, files, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(verifyWaveGeneratorPause(), null, 2));
}
