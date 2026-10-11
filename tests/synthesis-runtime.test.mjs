import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createWaveGenerator } from '../src/core/wave-generator.js';
import {
  createArrayCommandSource,
  createBoundedSynthesisRuntime,
  isSynthesisRuntimeCapacityError
} from '../src/core/synthesis-runtime.js';

function createManualScheduler() {
  const queue = [];
  return {
    schedule(callback) {
      queue.push(callback);
    },
    get length() {
      return queue.length;
    },
    run(count = queue.length) {
      let executed = 0;
      while (queue.length > 0 && executed < count) {
        queue.shift()();
        executed++;
      }
      return executed;
    },
    runAll() {
      let executed = 0;
      while (queue.length > 0) {
        queue.shift()();
        executed++;
      }
      return executed;
    }
  };
}

function pauseCommands(samples) {
  return [{ type: 5, a: samples }, { type: 10, a: 0 }];
}

function createRuntime({
  commands,
  progress,
  limits,
  onAudio,
  onEnd,
  onError,
  onCancel
} = {}) {
  const scheduler = createManualScheduler();
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => createArrayCommandSource(commands, progress),
    createWaveGenerator: () => createWaveGenerator(),
    onAudio: onAudio || (() => {}),
    onEnd: onEnd || (() => {}),
    onError: onError || (() => {}),
    onCancel: onCancel || (() => {}),
    scheduler: scheduler.schedule,
    limits
  });
  return { runtime, scheduler };
}

test('slow consumer stops at the bounded PCM pool and resumes on release', () => {
  const retained = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(100000),
    limits: { pcmChunkSamples: 64, pcmInFlightChunks: 2 },
    onAudio: chunk => retained.push(chunk)
  });

  runtime.start();
  scheduler.run(2);
  assert.equal(runtime.stats().state, 'backpressure');
  assert.equal(retained.length, 2);
  assert.equal(runtime.stats().currentInFlightChunks, 2);
  assert.equal(runtime.stats().maxInFlightChunks, 2);
  assert.equal(scheduler.length, 0);

  retained[0].release();
  assert.equal(scheduler.length, 1);
  scheduler.run(1);
  assert.equal(retained.length, 3);
  assert.equal(runtime.stats().state, 'backpressure');
  assert.equal(runtime.stats().currentInFlightChunks, 2);
  assert.equal(runtime.profile().pcmQueueBytes, 256);
});

test('one-second and thirty-second PCM generation stay bounded', () => {
  for (const samples of [22050, 661500]) {
    let chunks = 0;
    let total = 0;
    let ended = false;
    const { runtime, scheduler } = createRuntime({
      commands: pauseCommands(samples),
      onAudio: chunk => {
        chunks++;
        total += chunk.samples.length;
        chunk.release();
      },
      onEnd: () => {
        ended = true;
      }
    });
    runtime.start();
    scheduler.runAll();
    assert.equal(ended, true);
    assert.equal(runtime.stats().state, 'completed');
    assert.equal(total, samples);
    assert.equal(chunks, Math.ceil(samples / runtime.profile().pcmChunkSamples));
    assert.equal(runtime.stats().maxQueueCommands <= runtime.profile().commandCapacity, true);
    assert.equal(runtime.stats().maxInFlightChunks <= runtime.profile().pcmInFlightChunks, true);
    assert.equal(runtime.profile().outputLengthDependent, false);
  }
});

test('long command input reuses the original bounded command queue', () => {
  const commandCount = 5000;
  let produced = 0;
  const commandSource = createArrayCommandSource([
    ...Array.from({ length: commandCount }, () => ({ type: 5, a: 1 })),
    { type: 10, a: 0 }
  ], { inputBytes: commandCount, codePoints: commandCount, clauses: 1 });
  const scheduler = createManualScheduler();
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => commandSource,
    createWaveGenerator: () => createWaveGenerator(),
    onAudio: chunk => {
      produced += chunk.samples.length;
      chunk.release();
    },
    onEnd: () => {},
    onError: () => {},
    onCancel: () => {},
    scheduler: scheduler.schedule
  });

  runtime.start();
  scheduler.runAll();
  assert.equal(runtime.stats().state, 'completed');
  assert.equal(produced, commandCount);
  assert.equal(runtime.stats().producedCommands, commandCount + 1);
  assert.equal(runtime.stats().maxQueueCommands, 170);
  assert.equal(runtime.stats().queueCommands, 0);
});

test('input and intermediate capacity failures are explicit', () => {
  const errors = [];
  const overInput = createRuntime({
    commands: pauseCommands(1),
    progress: { inputBytes: 64 * 1024 + 1 },
    onAudio: () => assert.fail('audio emitted after input capacity failure'),
    onError: error => errors.push(error)
  });
  overInput.runtime.start();
  overInput.scheduler.run(1);
  assert.equal(errors.length, 1);
  assert.equal(isSynthesisRuntimeCapacityError(errors[0]), true);
  assert.equal(errors[0].reason, 'inputBytes');
  assert.equal(errors[0].limit, 64 * 1024);
  assert.equal(errors[0].actual, 64 * 1024 + 1);
  assert.equal(overInput.runtime.stats().state, 'error');
  assert.equal(overInput.runtime.stats().queueCommands, 0);

  const commandProgress = { inputBytes: 3, codePoints: 3, clauses: 3 };
  const overCommands = createRuntime({
    commands: [{ type: 5, a: 1 }, { type: 5, a: 1 }, { type: 5, a: 1 }, { type: 10, a: 0 }],
    progress: commandProgress,
    limits: { maxIntermediateCommands: 2 },
    onAudio: () => assert.fail('audio emitted after command capacity failure'),
    onError: error => errors.push(error)
  });
  overCommands.runtime.start();
  overCommands.scheduler.run(1);
  assert.equal(errors.length, 2);
  assert.equal(isSynthesisRuntimeCapacityError(errors[1]), true);
  assert.equal(errors[1].reason, 'intermediateCommands');
  assert.equal(errors[1].limit, 2);
  assert.equal(errors[1].actual, 3);
});

test('cancellation is immediate and a new session produces complete output', () => {
  const retained = [];
  let canceled = false;
  let cancellationLatencyMs;
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(100000),
    onAudio: chunk => retained.push(chunk),
    onCancel: () => {
      canceled = true;
    }
  });

  runtime.start();
  scheduler.run(3);
  assert.equal(retained.length, 3);
  const before = performance.now();
  runtime.cancel('operator-stop');
  cancellationLatencyMs = performance.now() - before;
  assert.equal(canceled, true);
  assert.equal(runtime.stats().state, 'canceled');
  assert.equal(runtime.stats().queueCommands, 0);
  assert.equal(cancellationLatencyMs >= 0, true);
  scheduler.run(1);
  assert.equal(scheduler.length, 0);

  for (const chunk of retained) chunk.release();
  const restarted = [];
  let ended = false;
  const secondRuntime = createBoundedSynthesisRuntime({
    createCommandSource: () => createArrayCommandSource(pauseCommands(100000)),
    createWaveGenerator: () => createWaveGenerator(),
    onAudio: chunk => {
      restarted.push(chunk);
      chunk.release();
    },
    onEnd: () => {
      ended = true;
    },
    onError: () => {},
    onCancel: () => {},
    scheduler: scheduler.schedule
  });
  secondRuntime.start();
  scheduler.runAll();
  assert.equal(ended, true);
  assert.equal(secondRuntime.stats().state, 'completed');
  assert.equal(secondRuntime.stats().emittedSamples, 100000);
  assert.deepEqual(restarted[0].samples, new Int16Array(runtime.profile().pcmChunkSamples));
});

test('repeated sessions reuse the bounded pool without state crossover', () => {
  const observed = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(1000),
    onAudio: chunk => {
      observed.push(Array.from(chunk.samples));
      chunk.release();
    }
  });
  for (let session = 0; session < 3; session++) {
    runtime.start();
    scheduler.runAll();
    assert.equal(runtime.stats().state, 'completed');
    assert.equal(runtime.stats().emittedSamples, 1000);
    assert.equal(runtime.stats().queueCommands, 0);
  }
  assert.equal(observed.length, 3);
  for (const chunks of observed) {
    assert.deepEqual(chunks.flat(), new Array(1000).fill(0));
  }
});

test('audio ownership must be released before a new session starts', () => {
  const retained = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(10),
    onAudio: chunk => retained.push(chunk)
  });
  runtime.start();
  scheduler.runAll();
  assert.equal(runtime.stats().state, 'completed');
  assert.equal(retained.length, 1);
  assert.throws(() => runtime.start(), error =>
    isSynthesisRuntimeCapacityError(error) && error.reason === 'outstandingAudioChunks');
  retained[0].release();
  assert.throws(() => retained[0].release(), /invalid-audio-release/);
  runtime.start();
  scheduler.runAll();
  assert.equal(runtime.stats().state, 'completed');
});

test('cancellation and completion release the command source', () => {
  const cancelReasons = [];
  const scheduler = createManualScheduler();
  const createSource = canceled => ({
    next: () => ({ done: true, progress: { inputBytes: 0, codePoints: 0, clauses: 0 } }),
    cancel: reason => canceled.push(reason)
  });
  const reasons = [];
  const runtime = createBoundedSynthesisRuntime({
    createCommandSource: () => createSource(reasons),
    createWaveGenerator: () => createWaveGenerator(),
    onAudio: () => {},
    onEnd: () => {},
    onError: () => {},
    onCancel: () => {},
    scheduler: scheduler.schedule
  });
  runtime.start();
  scheduler.runAll();
  assert.deepEqual(reasons, ['completed']);

  const cancellationReasons = [];
  const canceledRuntime = createBoundedSynthesisRuntime({
    createCommandSource: () => ({
      next: () => ({ command: { type: 5, a: 100000 }, progress: { inputBytes: 0, codePoints: 0, clauses: 0 } }),
      cancel: reason => cancellationReasons.push(reason)
    }),
    createWaveGenerator: () => createWaveGenerator(),
    onAudio: chunk => chunk.release(),
    onEnd: () => {},
    onError: () => {},
    onCancel: () => {},
    scheduler: scheduler.schedule
  });
  canceledRuntime.start();
  scheduler.run(1);
  canceledRuntime.cancel('test');
  assert.deepEqual(cancellationReasons, ['canceled']);
});

test('audio callback failure is reported through the runtime error callback', () => {
  const errors = [];
  const { runtime, scheduler } = createRuntime({
    commands: pauseCommands(10),
    onAudio: () => {
      throw new Error('consumer failed');
    },
    onError: error => errors.push(error)
  });
  runtime.start();
  scheduler.run(1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'SYNTHESIS_RUNTIME_FAILURE');
  assert.equal(errors[0].reason, 'audio-callback-failed');
  assert.equal(errors[0].cause.message, 'consumer failed');
  assert.equal(runtime.stats().state, 'error');
  assert.equal(runtime.stats().currentInFlightChunks, 0);
  assert.equal(runtime.stats().queueCommands, 0);
});
