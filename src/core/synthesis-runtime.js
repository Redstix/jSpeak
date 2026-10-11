const DEFAULT_LIMITS = Object.freeze({
  commandCapacity: 170,
  pcmChunkSamples: 4096,
  pcmInFlightChunks: 4,
  maxInputBytes: 64 * 1024,
  maxCodePoints: 16384,
  maxClauses: 256,
  maxIntermediateCommands: 100000,
  maxPumpChunks: 1
});

function integerOption(value, name, minimum, maximum, fallback) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`Invalid ${name}`);
  }
  return result;
}

function callbackOption(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Expected ${name} function`);
  return value;
}

export function isSynthesisRuntimeCapacityError(error) {
  return Boolean(error && error.code === 'SYNTHESIS_RUNTIME_CAPACITY');
}

function capacityError(reason, limit, actual) {
  const error = new Error(`Synthesis runtime capacity exceeded: ${reason}`);
  error.code = 'SYNTHESIS_RUNTIME_CAPACITY';
  error.reason = reason;
  error.limit = limit;
  error.actual = actual;
  return error;
}

function runtimeError(reason, cause) {
  const error = new Error(`Synthesis runtime failure: ${reason}`);
  error.code = 'SYNTHESIS_RUNTIME_FAILURE';
  error.reason = reason;
  if (cause) error.cause = cause;
  return error;
}

function validateProgress(progress, previous, limits) {
  if (progress === undefined) return { inputBytes: previous.inputBytes, codePoints: previous.codePoints, clauses: previous.clauses };
  if (!progress || typeof progress !== 'object') throw runtimeError('invalid-source-progress');
  const fields = [
    ['inputBytes', limits.maxInputBytes],
    ['codePoints', limits.maxCodePoints],
    ['clauses', limits.maxClauses]
  ];
  const result = { inputBytes: previous.inputBytes, codePoints: previous.codePoints, clauses: previous.clauses };
  for (const [name, limit] of fields) {
    const value = progress[name] === undefined ? previous[name] : progress[name];
    if (!Number.isSafeInteger(value) || value < 0) throw runtimeError('invalid-source-progress');
    if (value < previous[name]) throw runtimeError('source-progress-decreased');
    if (value > limit) throw capacityError(name, limit, value);
    result[name] = value;
  }
  return result;
}

export function createArrayCommandSource(commands, progress) {
  if (!Array.isArray(commands)) throw new TypeError('Expected wave command array');
  const frozenProgress = progress === undefined ? { inputBytes: 0, codePoints: 0, clauses: 0 } : progress;
  let index = 0;
  return {
    next() {
      if (index >= commands.length) return { done: true, progress: frozenProgress };
      return { command: commands[index++], progress: frozenProgress };
    }
  };
}

export function createBoundedSynthesisRuntime(options) {
  const opts = options || {};
  const createCommandSource = callbackOption(opts.createCommandSource, 'createCommandSource');
  const createWaveGenerator = callbackOption(opts.createWaveGenerator, 'createWaveGenerator');
  const onAudio = callbackOption(opts.onAudio, 'onAudio');
  const onEnd = callbackOption(opts.onEnd, 'onEnd');
  const onError = callbackOption(opts.onError, 'onError');
  const onCancel = callbackOption(opts.onCancel, 'onCancel');
  const scheduler = callbackOption(opts.scheduler, 'scheduler');
  const sourceLimits = opts.limits || {};
  const limits = {
    commandCapacity: integerOption(sourceLimits.commandCapacity, 'command capacity', 1, 0x100000, DEFAULT_LIMITS.commandCapacity),
    pcmChunkSamples: integerOption(sourceLimits.pcmChunkSamples, 'PCM chunk samples', 1, 0x100000, DEFAULT_LIMITS.pcmChunkSamples),
    pcmInFlightChunks: integerOption(sourceLimits.pcmInFlightChunks, 'PCM in-flight chunks', 1, 1024, DEFAULT_LIMITS.pcmInFlightChunks),
    maxInputBytes: integerOption(sourceLimits.maxInputBytes, 'maximum input bytes', 0, 0x7fffffff, DEFAULT_LIMITS.maxInputBytes),
    maxCodePoints: integerOption(sourceLimits.maxCodePoints, 'maximum code points', 0, 0x7fffffff, DEFAULT_LIMITS.maxCodePoints),
    maxClauses: integerOption(sourceLimits.maxClauses, 'maximum clauses', 0, 0x7fffffff, DEFAULT_LIMITS.maxClauses),
    maxIntermediateCommands: integerOption(sourceLimits.maxIntermediateCommands, 'maximum intermediate commands', 1, 0x7fffffff, DEFAULT_LIMITS.maxIntermediateCommands),
    maxPumpChunks: integerOption(sourceLimits.maxPumpChunks, 'maximum pump chunks', 1, 1024, DEFAULT_LIMITS.maxPumpChunks)
  };

  const commandQueue = new Array(limits.commandCapacity).fill(null);
  const pcmPool = [];
  for (let index = 0; index < limits.pcmInFlightChunks; index++) {
    pcmPool.push({ id: index, state: 'free', sessionId: 0, samples: new Int16Array(limits.pcmChunkSamples) });
  }

  let state = 'idle';
  let sessionId = 0;
  let scheduled = false;
  let commandSource = null;
  let generator = null;
  let sourceDone = false;
  let queueLength = 0;
  let emittedChunks = 0;
  let emittedSamples = 0;
  let producedCommands = 0;
  let currentProgress = { inputBytes: 0, codePoints: 0, clauses: 0 };
  let leasedChunks = 0;
  let maxInFlightChunks = 0;
  let maxQueueCommands = 0;
  let backpressureCount = 0;
  let active = false;

  function stats() {
    return {
      state,
      sessionId,
      queueCommands: queueLength,
      sourceDone,
      emittedChunks,
      emittedSamples,
      producedCommands,
      currentInFlightChunks: leasedChunks,
      maxInFlightChunks,
      maxQueueCommands,
      backpressureCount
    };
  }

  function clearSession(reason) {
    if (commandSource && typeof commandSource.cancel === 'function') commandSource.cancel(reason);
    commandQueue.fill(null);
    queueLength = 0;
    sourceDone = true;
    commandSource = null;
    generator = null;
  }

  function fail(error) {
    if (!active) return;
    state = 'error';
    active = false;
    clearSession('error');
    try {
      onError(error, stats());
    } catch (callbackError) {
      state = 'error-callback-failed';
      callbackError.cause = callbackError.cause || error;
      throw callbackError;
    }
  }

  function finish() {
    state = 'completed';
    active = false;
    clearSession('completed');
    try {
      onEnd(stats());
    } catch (error) {
      state = 'end-callback-failed';
      throw error;
    }
  }

  function releaseQueueCommands(count) {
    if (count <= 0) return;
    for (let index = 0; index < count; index++) commandQueue[index] = null;
    for (let index = count; index < queueLength; index++) commandQueue[index - count] = commandQueue[index];
    for (let index = queueLength - count; index < queueLength; index++) commandQueue[index] = null;
    queueLength -= count;
  }

  function refillCommandQueue() {
    while (!sourceDone && queueLength < limits.commandCapacity) {
      let item;
      try {
        item = commandSource.next();
      } catch (error) {
        fail(runtimeError('command-source-failed', error));
        return;
      }
      if (!item || typeof item !== 'object') {
        fail(runtimeError('invalid-command-source-result'));
        return;
      }
      try {
        currentProgress = validateProgress(item.progress, currentProgress, limits);
      } catch (error) {
        fail(error);
        return;
      }
      if (item.done) {
        sourceDone = true;
        break;
      }
      if (!item.command || typeof item.command !== 'object') {
        fail(runtimeError('invalid-command'));
        return;
      }
      commandQueue[queueLength++] = item.command;
      producedCommands++;
      maxQueueCommands = Math.max(maxQueueCommands, queueLength);
      if (producedCommands > limits.maxIntermediateCommands) {
        fail(capacityError('intermediateCommands', limits.maxIntermediateCommands, producedCommands));
        return;
      }
    }
  }

  function acquirePcmBuffer() {
    for (const entry of pcmPool) {
      if (entry.state === 'free') return entry;
    }
    return null;
  }

  function scheduleNext() {
    if (scheduled || state !== 'running') return;
    scheduled = true;
    try {
      scheduler(() => {
        scheduled = false;
        pump();
      });
    } catch (error) {
      scheduled = false;
      fail(runtimeError('scheduler-failed', error));
    }
  }

  function emitChunk(entry, produced, final, token) {
    entry.state = 'leased';
    entry.sessionId = token;
    leasedChunks++;
    maxInFlightChunks = Math.max(maxInFlightChunks, leasedChunks);
    const samples = entry.samples.subarray(0, produced);
    const chunk = {
      sessionId: token,
      index: emittedChunks,
      poolId: entry.id,
      sampleRate: generator.state().sampleRate,
      samples,
      bytes: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
      final,
      released: false,
      release() {
        releaseAudio(chunk);
      }
    };
    emittedChunks++;
    emittedSamples += produced;
    try {
      onAudio(chunk);
    } catch (error) {
      releaseAudio(chunk);
      throw error;
    }
  }

  function produceChunk(token, maxCommands) {
    const entry = acquirePcmBuffer();
    if (!entry) {
      state = 'backpressure';
      backpressureCount++;
      return false;
    }

    let commandsProcessed = 0;
    for (;;) {
      refillCommandQueue();
      if (!active || token !== sessionId) return false;
      if (queueLength === 0) {
        if (sourceDone) {
          finish();
          return false;
        }
        state = 'backpressure';
        backpressureCount++;
        return false;
      }
      if (commandsProcessed >= maxCommands) {
        return false;
      }

      let result;
      try {
        result = generator.fill(commandQueue, entry.samples, { commandCount: queueLength, commandIndex: 0 });
      } catch (error) {
        fail(runtimeError('wave-generator-failed', error));
        return false;
      }
      if (!active || token !== sessionId) return false;
      releaseQueueCommands(result.commandIndex);
      commandsProcessed += result.commandIndex;
      if (result.produced > 0) {
        const final = result.finished && sourceDone && queueLength === 0 && !result.resume;
        try {
          emitChunk(entry, result.produced, final, token);
        } catch (error) {
          fail(runtimeError('audio-callback-failed', error));
          return false;
        }
        if (!active || token !== sessionId) return false;
        if (final) {
        finish();
        return false;
      }
      if (!acquirePcmBuffer()) {
        state = 'backpressure';
        backpressureCount++;
      }
      return true;
      }
      if (result.finished && sourceDone && queueLength === 0) {
        entry.state = 'free';
        finish();
        return false;
      }
      if (commandsProcessed >= maxCommands) {
        return false;
      }
    }
  }

  function pump(requestedChunkCount) {
    const token = sessionId;
    if (state !== 'running' || token === 0 || !active) return stats();
    const chunkBudget = requestedChunkCount === undefined
      ? limits.maxPumpChunks
      : integerOption(requestedChunkCount, 'pump chunk count', 1, limits.maxPumpChunks, limits.maxPumpChunks);
    let emitted = 0;
    while (state === 'running' && active && token === sessionId && emitted < chunkBudget) {
      const produced = produceChunk(token, limits.commandCapacity);
      if (!active || token !== sessionId) break;
      if (!produced) break;
      emitted++;
    }
    if (state === 'running' && active && token === sessionId) scheduleNext();
    return stats();
  }

  function releaseAudio(chunk) {
    if (!chunk || typeof chunk !== 'object' || chunk.released) {
      throw runtimeError('invalid-audio-release');
    }
    const entry = pcmPool.find(item => item.id === chunk.poolId && item.samples.buffer === chunk.samples.buffer);
    if (!entry || entry.state !== 'leased' || entry.sessionId !== chunk.sessionId) {
      throw runtimeError('invalid-audio-release');
    }
    entry.state = 'free';
    entry.sessionId = 0;
    leasedChunks--;
    chunk.released = true;
    if (state === 'backpressure' && active) {
      state = 'running';
      scheduleNext();
    }
  }

  function start() {
    if (state === 'running' || state === 'backpressure' || state === 'paused') {
      throw runtimeError('session-already-active');
    }
    if (leasedChunks > 0) {
      throw capacityError('outstandingAudioChunks', 0, leasedChunks);
    }
    emittedChunks = 0;
    emittedSamples = 0;
    producedCommands = 0;
    currentProgress = { inputBytes: 0, codePoints: 0, clauses: 0 };
    maxInFlightChunks = 0;
    maxQueueCommands = 0;
    backpressureCount = 0;
    commandQueue.fill(null);
    queueLength = 0;
    sourceDone = false;
    sessionId++;
    active = true;
    state = 'running';
    try {
      commandSource = createCommandSource();
      generator = createWaveGenerator();
      if (!commandSource || typeof commandSource.next !== 'function') throw new TypeError('Expected command source');
      if (!generator || typeof generator.fill !== 'function') throw new TypeError('Expected wave generator');
    } catch (error) {
      if (commandSource && typeof commandSource.cancel === 'function') {
        commandSource.cancel('initialization-failed');
      }
      active = false;
      state = 'idle';
      sessionId--;
      throw runtimeError('session-initialization-failed', error);
    }
    scheduleNext();
    return sessionId;
  }

  function pause() {
    if (state !== 'running' && state !== 'backpressure') return false;
    state = 'paused';
    return true;
  }

  function resume() {
    if (state !== 'paused') return false;
    state = 'running';
    scheduleNext();
    return true;
  }

  function cancel(reason) {
    const token = sessionId;
    if (!active || token === 0 || state === 'idle' || state === 'completed' || state === 'canceled' || state === 'error') return false;
    state = 'canceled';
    active = false;
    scheduled = false;
    clearSession('canceled');
    try {
      onCancel({ sessionId: token, reason, stats: stats() });
    } catch (error) {
      state = 'cancel-callback-failed';
      throw error;
    }
    return true;
  }

  return {
    start,
    pause,
    resume,
    cancel,
    pump,
    releaseAudio,
    stats,
    profile: () => ({
      ...limits,
      pcmQueueBytes: limits.pcmChunkSamples * 2 * limits.pcmInFlightChunks,
      commandQueueSlots: limits.commandCapacity,
      outputLengthDependent: false
    })
  };
}
