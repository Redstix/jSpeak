import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnglishSynthesizer } from '../../src/core/english-synthesis.js';
import { createCmnSynthesizer } from '../../src/core/cmn-synthesis.js';
import { createWaveGenerator } from '../../src/core/wave-generator.js';
import { DEFAULT_CMN_VOICE } from '../../src/core/wave-command-planner.js';
import {
  createArrayCommandSource,
  createBoundedSynthesisRuntime
} from '../../src/core/synthesis-runtime.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = path.join(ROOT, 'docs/build-results/2026-10-17-node-synthesis-stress.json');
const SESSIONS = 100;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pcmHash(pcm) {
  return sha256(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

function read(root, name) {
  return new Uint8Array(readFileSync(path.join(root, name)));
}

function loadProfiles() {
  const enRoot = path.join(ROOT, 'apps/vela-probe/src/common/espeak');
  const cmnRoot = path.join(ROOT, 'artifacts/cmn-language-pack');
  const shared = root => ({
    phontabBytes: read(root, 'phontab.txt'),
    phonindexBytes: read(root, 'phonindex.txt'),
    phondataBytes: read(root, 'phondata.txt')
  });
  const enInputs = {
    ...shared(enRoot),
    dictionaryBytes: read(enRoot, 'en_dict.txt'),
    dictionaryManifest: JSON.parse(readFileSync(path.join(ROOT, 'data/dictionary/manifest.json')))
  };
  const cmnInputs = { ...shared(cmnRoot), dictionaryBytes: read(cmnRoot, 'cmn_dict.txt') };
  return {
    en: { synthesizer: createEnglishSynthesizer(enInputs), text: 'Hello world.', phondataBytes: enInputs.phondataBytes },
    cmn: { synthesizer: createCmnSynthesizer(cmnInputs), text: '你好，世界。', phondataBytes: cmnInputs.phondataBytes }
  };
}

function immediateScheduler(callback) { callback(); }

function manualScheduler() {
  const queue = [];
  return {
    schedule(callback) { queue.push(callback); },
    get length() { return queue.length; },
    run(count) {
      let executed = 0;
      while (queue.length && executed < count) { queue.shift()(); executed++; }
      return executed;
    },
    runAll() { return this.run(queue.length); }
  };
}

function prepareCommands(commands) {
  for (const command of commands) {
    if (command.b !== null && typeof command.b === 'number' && (command.type & 0xff) === 9) {
      command.b = { envelope: command.b };
    }
  }
  return commands;
}

function heap() {
  if (typeof global.gc === 'function') global.gc();
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, arrayBuffers: usage.arrayBuffers };
}

async function runSessionStress(profiles) {
  const baseline = {};
  for (const language of ['en', 'cmn']) {
    const result = await profiles[language].synthesizer.synthesizePcm(profiles[language].text, {
      scheduler: immediateScheduler
    });
    baseline[language] = {
      sha256: pcmHash(result.pcm),
      samples: result.sampleCount,
      commandCount: result.stats.producedCommands
    };
  }
  const before = heap();
  const heaps = [];
  const maxima = { en: { inFlight: 0, queue: 0, backpressure: 0 }, cmn: { inFlight: 0, queue: 0, backpressure: 0 } };
  const started = performance.now();
  for (let index = 0; index < SESSIONS; index++) {
    const language = index % 2 === 0 ? 'en' : 'cmn';
    const result = await profiles[language].synthesizer.synthesizePcm(profiles[language].text, {
      scheduler: immediateScheduler
    });
    if (pcmHash(result.pcm) !== baseline[language].sha256) throw new Error(`State crosstalk at session ${index} (${language})`);
    if (result.stats.currentInFlightChunks !== 0 || result.stats.queueCommands !== 0) {
      throw new Error(`Unreleased buffers at session ${index} (${language})`);
    }
    maxima[language].inFlight = Math.max(maxima[language].inFlight, result.stats.maxInFlightChunks);
    maxima[language].queue = Math.max(maxima[language].queue, result.stats.maxQueueCommands);
    maxima[language].backpressure = Math.max(maxima[language].backpressure, result.stats.backpressureCount);
    if (index % 10 === 9) heaps.push({ session: index + 1, ...heap() });
  }
  return {
    sessions: SESSIONS,
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    baseline,
    allOutputsExact: true,
    allBuffersReleased: true,
    maxima,
    heapBefore: before,
    heapSamples: heaps,
    heapUsedDelta: heaps.length ? heaps[heaps.length - 1].heapUsed - before.heapUsed : null
  };
}

async function runLongInput(profiles) {
  const boundaryText = ('好'.repeat(84) + '。 ').repeat(256);
  const boundaryBytes = Buffer.byteLength(boundaryText, 'utf8');
  let planned = null, planningError = null;
  const planningStarted = performance.now();
  try {
    const result = profiles.cmn.synthesizer.synthesize(boundaryText);
    planned = {
      inputBytes: result.inputBytes,
      clauses: result.clauseCount,
      commands: result.commands.length
    };
  } catch (error) {
    planningError = { code: error.code || null, message: error.message };
  }
  const planningMs = performance.now() - planningStarted;

  const clauseText = '好。'.repeat(256);
  const started = performance.now();
  const rendered = await profiles.cmn.synthesizer.synthesizePcm(clauseText, { scheduler: immediateScheduler });
  const elapsedMs = performance.now() - started;
  return {
    inputLimitBytes: 64 * 1024,
    clauseLimit: 256,
    boundaryPlanning: {
      textBytes: boundaryBytes,
      clauses: 256,
      elapsedMs: Number(planningMs.toFixed(3)),
      result: planned,
      error: planningError
    },
    fullRender: {
      textBytes: Buffer.byteLength(clauseText, 'utf8'),
      clauses: rendered.stats.clauseCount,
      samples: rendered.sampleCount,
      audioMs: Number((rendered.sampleCount / 22050 * 1000).toFixed(3)),
      elapsedMs: Number(elapsedMs.toFixed(3)),
      rtf: Number((elapsedMs / 1000 / (rendered.sampleCount / 22050)).toFixed(6)),
      outputSha256: pcmHash(rendered.pcm),
      currentInFlightChunks: rendered.stats.currentInFlightChunks,
      queueCommands: rendered.stats.queueCommands,
      maxInFlightChunks: rendered.stats.maxInFlightChunks,
      maxQueueCommands: rendered.stats.maxQueueCommands
    }
  };
}

async function runBackpressure(profiles) {
  const commands = prepareCommands(profiles.cmn.synthesizer.synthesize(profiles.cmn.text).commands);
  const scheduler = manualScheduler();
  const retained = [];
  let ended = false, canceled = false, error = null;
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => createArrayCommandSource(commands, { inputBytes: 18, codePoints: 6, clauses: 1 }),
    createWaveGenerator: () => createWaveGenerator({
      voice: DEFAULT_CMN_VOICE, phondataBytes: profiles.cmn.phondataBytes, randomSeed: 1
    }),
    onAudio: chunk => retained.push(chunk),
    onEnd: () => { ended = true; },
    onError: value => { error = value; },
    onCancel: () => { canceled = true; },
    scheduler: scheduler.schedule,
    limits: { pcmChunkSamples: 1024, pcmInFlightChunks: 2 }
  });
  runtime.start();
  scheduler.run(100);
  const first = runtime.stats();
  if (first.state !== 'backpressure') throw new Error('Slow consumer did not reach backpressure: ' + first.state);
  let released = 0;
  while (!ended && released < 100000) {
    const chunk = retained.shift();
    if (!chunk) { scheduler.run(1); continue; }
    chunk.release();
    released++;
    scheduler.run(1);
  }
  while (!ended && scheduler.length) scheduler.runAll();
  while (retained.length) {
    retained.shift().release();
    released++;
  }
  const final = runtime.stats();
  if (error) throw error;
  return {
    firstState: first.state,
    firstInFlightChunks: first.currentInFlightChunks,
    maxInFlightChunks: final.maxInFlightChunks,
    maxQueueCommands: final.maxQueueCommands,
    backpressureCount: final.backpressureCount,
    emittedChunks: final.emittedChunks,
    emittedSamples: final.emittedSamples,
    releasedChunks: released,
    ended,
    error: error ? String(error) : null,
    finalCurrentInFlightChunks: final.currentInFlightChunks,
    finalQueueCommands: final.queueCommands
  };
}

async function runCancelRestart(profiles) {
  const commands = prepareCommands(profiles.cmn.synthesizer.synthesize('你好，世界。'.repeat(20)).commands);
  const scheduler = manualScheduler();
  let canceled = false;
  const retained = [];
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => createArrayCommandSource(commands, { inputBytes: 360, codePoints: 120, clauses: 20 }),
    createWaveGenerator: () => createWaveGenerator({
      voice: DEFAULT_CMN_VOICE, phondataBytes: profiles.cmn.phondataBytes, randomSeed: 1
    }),
    onAudio: chunk => retained.push(chunk),
    onEnd: () => {},
    onError: error => { throw error; },
    onCancel: () => { canceled = true; },
    scheduler: scheduler.schedule
  });
  runtime.start();
  scheduler.run(3);
  const before = runtime.stats();
  const cancelStarted = performance.now();
  runtime.cancel('stress-stop');
  const cancelLatencyMs = performance.now() - cancelStarted;
  for (const chunk of retained) chunk.release();
  scheduler.runAll();
  const after = runtime.stats();
  const restartStarted = performance.now();
  const first = await profiles.cmn.synthesizer.synthesizePcm('你好，世界。', { scheduler: immediateScheduler });
  const second = await profiles.cmn.synthesizer.synthesizePcm('你好，世界。', { scheduler: immediateScheduler });
  if (pcmHash(first.pcm) !== pcmHash(second.pcm)) throw new Error('Restart output differs');
  return {
    canceled,
    cancelLatencyMs: Number(cancelLatencyMs.toFixed(6)),
    beforeCancel: { state: before.state, inFlight: before.currentInFlightChunks, queue: before.queueCommands },
    afterCancel: { state: after.state, inFlight: after.currentInFlightChunks, queue: after.queueCommands },
    restartElapsedMs: Number((performance.now() - restartStarted).toFixed(3)),
    restartOutputStable: true,
    restartOutputSha256: pcmHash(second.pcm)
  };
}

export async function stressSynthesis() {
  const profiles = loadProfiles();
  const started = performance.now();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    sessionStress: await runSessionStress(profiles),
    longInput: await runLongInput(profiles),
    backpressure: await runBackpressure(profiles),
    cancelRestart: await runCancelRestart(profiles),
    totalElapsedMs: Number((performance.now() - started).toFixed(3)),
    limitations: [
      'Node/V8 only; device heap, CPU and cancellation behavior remain unmeasured.',
      'The 64KiB/256-clause boundary is planning-only; the full render case is 256 clauses and 1536 bytes.',
      'Heap samples are GC-influenced point measurements, not peak device heap.'
    ]
  };
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/perf/node-synthesis-stress.mjs');
  stressSynthesis().then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.error('Output: ' + OUTPUT);
  });
}
