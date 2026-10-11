import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createWaveGenerator } from '../../src/core/wave-generator.js';
import {
  createArrayCommandSource,
  createBoundedSynthesisRuntime,
  isSynthesisRuntimeCapacityError
} from '../../src/core/synthesis-runtime.js';

function createScheduler() {
  const queue = [];
  return {
    schedule(callback) {
      queue.push(callback);
    },
    drain() {
      let ticks = 0;
      while (queue.length > 0) {
        queue.shift()();
        ticks++;
      }
      return ticks;
    }
  };
}

function createRuntime({ commands, progress, limits, onAudio, onEnd, onError, onCancel }) {
  const scheduler = createScheduler();
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => createArrayCommandSource(commands, progress),
    createWaveGenerator: () => createWaveGenerator(),
    onAudio,
    onEnd: onEnd || (() => {}),
    onError: onError || (() => {}),
    onCancel: onCancel || (() => {}),
    scheduler: scheduler.schedule,
    limits
  });
  return { runtime, scheduler };
}

function pauseCommands(samples) {
  return [{ type: 5, a: samples }, { type: 10, a: 0 }];
}

function durationCase(samples) {
  let emittedSamples = 0;
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(samples),
    onAudio: chunk => {
      emittedSamples += chunk.samples.length;
      chunk.release();
    }
  });
  runtime.start();
  const ticks = scheduler.drain();
  assert.equal(runtime.stats().state, 'completed');
  assert.equal(emittedSamples, samples);
  return {
    samples,
    seconds: samples / 22050,
    schedulerTicks: ticks,
    emittedChunks: runtime.stats().emittedChunks,
    maxQueueCommands: runtime.stats().maxQueueCommands,
    maxInFlightChunks: runtime.stats().maxInFlightChunks,
    profile: runtime.profile()
  };
}

function longInputCase(commandCount) {
  const commands = [
    ...Array.from({ length: commandCount }, () => ({ type: 5, a: 1 })),
    { type: 10, a: 0 }
  ];
  let emittedSamples = 0;
  const { runtime, scheduler } = createRuntime({
    commands,
    progress: { inputBytes: commandCount, codePoints: commandCount, clauses: 1 },
    onAudio: chunk => {
      emittedSamples += chunk.samples.length;
      chunk.release();
    }
  });
  runtime.start();
  const ticks = scheduler.drain();
  assert.equal(runtime.stats().state, 'completed');
  assert.equal(emittedSamples, commandCount);
  return {
    commands: commandCount + 1,
    inputBytes: commandCount,
    codePoints: commandCount,
    clauses: 1,
    schedulerTicks: ticks,
    maxQueueCommands: runtime.stats().maxQueueCommands,
    maxInFlightChunks: runtime.stats().maxInFlightChunks,
    emittedSamples
  };
}

function slowConsumerCase() {
  const retained = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(100000),
    limits: { pcmChunkSamples: 64, pcmInFlightChunks: 2 },
    onAudio: chunk => retained.push(chunk)
  });
  runtime.start();
  const ticks = scheduler.drain();
  assert.equal(runtime.stats().state, 'backpressure');
  assert.equal(retained.length, 2);
  for (const chunk of retained) chunk.release();
  return {
    schedulerTicks: ticks,
    pcmChunkSamples: 64,
    pcmInFlightChunks: 2,
    pcmQueueBytes: 256,
    maxInFlightChunks: runtime.stats().maxInFlightChunks,
    backpressureTransitions: runtime.stats().backpressureCount
  };
}

function cancellationCase() {
  const retained = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(100000),
    onAudio: chunk => retained.push(chunk)
  });
  runtime.start();
  scheduler.drain();
  const before = performance.now();
  runtime.cancel('benchmark-stop');
  const cancellationLatencyMs = performance.now() - before;
  const schedulerTicksAfterCancel = scheduler.drain();
  assert.equal(runtime.stats().state, 'canceled');
  for (const chunk of retained) chunk.release();
  return {
    cancellationLatencyMs,
    retainedChunks: retained.length,
    queueCommandsAfterCancel: runtime.stats().queueCommands,
    schedulerTicksAfterCancel
  };
}

function capacityCase() {
  const errors = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(1),
    progress: { inputBytes: 64 * 1024 + 1 },
    onAudio: () => assert.fail('audio emitted after capacity failure'),
    onError: error => errors.push(error)
  });
  runtime.start();
  scheduler.drain();
  assert.equal(errors.length, 1);
  assert.equal(isSynthesisRuntimeCapacityError(errors[0]), true);
  return {
    reason: errors[0].reason,
    limit: errors[0].limit,
    actual: errors[0].actual,
    state: runtime.stats().state,
    queueCommands: runtime.stats().queueCommands
  };
}

function repeatedCase(sessionCount) {
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(1000),
    onAudio: chunk => chunk.release()
  });
  const heapBefore = process.memoryUsage().heapUsed;
  let maxObservedHeapUsed = heapBefore;
  for (let index = 0; index < sessionCount; index++) {
    runtime.start();
    scheduler.drain();
    assert.equal(runtime.stats().state, 'completed');
    maxObservedHeapUsed = Math.max(maxObservedHeapUsed, process.memoryUsage().heapUsed);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    sessions: sessionCount,
    samplesPerSession: 1000,
    heapUsedBeforeBytes: heapBefore,
    heapUsedAfterBytes: heapAfter,
    maxObservedHeapUsedBetweenSessionsBytes: maxObservedHeapUsed,
    maxInFlightChunks: runtime.stats().maxInFlightChunks,
    maxQueueCommands: runtime.stats().maxQueueCommands
  };
}

export function runSynthesisRuntimeBenchmark({ directory } = {}) {
  const outputDirectory = directory || 'artifacts/synthesis-runtime-m11-20261010';
  const absoluteDirectory = path.resolve(outputDirectory);
  mkdirSync(absoluteDirectory, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: 'passed',
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    limits: {
      commandCapacity: 170,
      pcmChunkSamples: 4096,
      pcmInFlightChunks: 4,
      pcmQueueBytes: 32768,
      maxInputBytes: 65536,
      maxCodePoints: 16384,
      maxClauses: 256,
      maxIntermediateCommands: 100000
    },
    cases: {
      oneSecond: durationCase(22050),
      thirtySeconds: durationCase(661500),
      longInput: longInputCase(5000),
      slowConsumer: slowConsumerCase(),
      cancellation: cancellationCase(),
      capacityFailure: capacityCase(),
      repeatedSynthesis: repeatedCase(100)
    },
    unmeasured: {
      heapPeak: null,
      heapPeakReason: 'Node has no continuous peak-heap API in this benchmark; snapshots are not a peak',
      realDspRtf: null,
      realDspRtfReason: 'Cases use deterministic pause commands and do not represent waveform CPU time'
    }
  };
  writeFileSync(path.join(absoluteDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/synthesis-runtime-benchmark.mjs [directory]');
  console.log(JSON.stringify(runSynthesisRuntimeBenchmark(process.argv[2] ? { directory: process.argv[2] } : {}), null, 2));
}
