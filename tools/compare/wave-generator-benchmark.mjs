import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { generateCommandsBinary } from '../oracle/generate-commands-build-info.mjs';
import { referenceBuild, root } from '../oracle/trace-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createWaveGenerator } from '../../src/core/wave-generator.js';

function observedCases() {
  const observedDirectory = path.join(root, 'artifacts/oracle-clause-word2-2pOOA5');
  const report = JSON.parse(readFileSync(path.join(observedDirectory, 'report.json'), 'utf8'));
  const cases = [];
  for (const capture of report.captures) {
    const tracePath = path.join(observedDirectory, capture.id, 'observed.jsonl');
    if (!existsSync(tracePath)) continue;
    const clauses = readFileSync(tracePath, 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse)
      .filter(event => event.kind === 'clause.before-phonemelist');
    if (clauses.length > 0) cases.push({ id: capture.id, clauses });
  }
  return cases;
}

function commandInput(cases) {
  const lines = [];
  for (const capture of cases) {
    for (const clause of capture.clauses) {
      const event = clause;
      const items = event.phonemeList2.items;
      lines.push(items.length, event.clausePause, event.newSentence2 ? 1 : 0, event.tone,
        event.embedded.list.length, ...event.embedded.list,
        ...items.flatMap(row => [row.phcode, row.stresslevel, row.wordstress, row.tonePh, row.sourceix, row.synthflags]));
    }
  }
  return lines.join('\n') + '\n';
}

function parseRuns(args) {
  if (args.length === 0) return 3;
  if (args.length !== 2 || args[0] !== '--runs') throw new Error('Usage: node tools/compare/wave-generator-benchmark.mjs [--runs N]');
  const runs = Number(args[1]);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) throw new RangeError('Benchmark runs must be 1..20');
  return runs;
}

export function benchmarkWaveGenerator({ runs = 3 } = {}) {
  if (!existsSync(generateCommandsBinary)) throw new Error('Build the original Generate command oracle first');
  const cases = observedCases();
  const request = commandInput(cases);
  const commandOutput = execFileSync(generateCommandsBinary, [referenceBuild], {
    input: request, maxBuffer: 256 * 1024 * 1024, timeout: 120000
  });
  const commandPlans = JSON.parse(commandOutput);
  const phondata = new Uint8Array(readFileSync(path.join(referenceBuild, 'espeak-ng-data/phondata')));
  let commandIndex = 0;
  const prepared = cases.map(capture => {
    const commands = capture.clauses.flatMap(() => {
      const plan = commandPlans.results[commandIndex++];
      for (const command of plan.items) {
        if (command.b && Number.isInteger(command.b.frameIndex)) command.b.frames = plan.frames;
        if (command.c && Number.isInteger(command.c.frameIndex)) command.c.frames = plan.frames;
      }
      return plan.items;
    });
    return { id: capture.id, commands };
  });

  const runResults = [];
  for (let run = 1; run <= runs; run++) {
    const caseResults = [];
    for (const item of prepared) {
      const generator = createWaveGenerator({
        voice: commandPlans.voiceState, phondataBytes: phondata, randomSeed: 1
      });
      const started = performance.now();
      const result = generator.synthesize(item.commands, { chunkSize: 4096 });
      const elapsed = performance.now() - started;
      caseResults.push({ id: item.id, commands: item.commands.length, samples: result.samples.length, elapsedMs: elapsed });
    }
    const totalMs = caseResults.reduce((sum, row) => sum + row.elapsedMs, 0);
    const samples = caseResults.reduce((sum, row) => sum + row.samples, 0);
    runResults.push({
      run, totalMs, samples,
      samplesPerSecond: samples / (totalMs / 1000),
      slowestCaseMs: Math.max(...caseResults.map(row => row.elapsedMs))
    });
  }
  const sorted = [...runResults].sort((a, b) => a.totalMs - b.totalMs);
  return {
    schemaVersion: 1,
    status: 'passed',
    scope: 'Fixed en-us M10 Wavegen pure-JS generation benchmark; exactness is verified separately by test:wave-generator:full',
    runs,
    cases: prepared.length,
    samples: runResults[0].samples,
    medianTotalMs: sorted[Math.floor((sorted.length - 1) / 2)].totalMs,
    fastestTotalMs: sorted[0].totalMs,
    slowestTotalMs: sorted[sorted.length - 1].totalMs,
    medianSamplesPerSecond: sorted[Math.floor((sorted.length - 1) / 2)].samplesPerSecond,
    chunkSamples: 4096,
    results: runResults,
    unmeasured: {
      velaRtf: null,
      velaRtfReason: 'Node JIT timing cannot be transferred to QuickJS/Vela',
      maxSlice: null,
      maxSliceReason: 'This benchmark uses synchronous generator.synthesize and does not observe event-loop scheduling'
    },
    files: runtimeSnapshot(['src/core/wave-generator.js', 'tools/compare/wave-generator-benchmark.mjs'], [
      'artifacts/oracle-clause-word2-2pOOA5/report.json'
    ])
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runs = parseRuns(process.argv.slice(2));
  console.log(JSON.stringify(benchmarkWaveGenerator({ runs }), null, 2));
}
