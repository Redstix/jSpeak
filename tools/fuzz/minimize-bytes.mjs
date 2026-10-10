import { performance } from 'node:perf_hooks';

class Deadline extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function outcome(value) {
  if (value?.status === 'pass') return { status: 'pass' };
  if (value?.status === 'fail' && ['semantic', 'trace'].includes(value.category) &&
      typeof value.signature === 'string' && value.signature.length > 0 && value.signature.length <= 1024) {
    return { status: 'fail', category: value.category, signature: value.signature };
  }
  throw new TypeError('Predicate must return pass or a classified semantic/trace failure; infrastructure errors must throw');
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(label + ' must be a positive safe integer');
  return value;
}

// Deletion-only ddmin. It establishes one-unit minimality, not a globally
// shortest input. Predicates receive copies and must honor AbortSignal for I/O.
export async function minimizeBytes(input, predicate, options = {}) {
  if (!(input instanceof Uint8Array)) throw new TypeError('input must be Uint8Array');
  if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
  const maxAttempts = positiveInteger(options.maxAttempts ?? 256, 'maxAttempts');
  const maxInputBytes = positiveInteger(options.maxInputBytes ?? 65536, 'maxInputBytes');
  const timeoutMs = positiveInteger(options.timeoutMs ?? 10000, 'timeoutMs');
  const predicateTimeoutMs = positiveInteger(options.predicateTimeoutMs ?? 1000, 'predicateTimeoutMs');
  if (timeoutMs > 2147483647 || predicateTimeoutMs > 2147483647) throw new RangeError('timeout exceeds Node timer limit');
  if (options.validUtf8 !== undefined && typeof options.validUtf8 !== 'boolean') throw new TypeError('validUtf8 must be boolean');
  if (input.length > maxInputBytes) throw new RangeError('input exceeds maxInputBytes');
  let current = Uint8Array.from(input);
  if (options.validUtf8) new TextDecoder('utf-8', { fatal: true }).decode(current);
  const started = performance.now();
  let attempts = 0, accepted = 0;
  async function evaluate(bytes) {
    if (attempts >= maxAttempts) throw new Deadline('attempt-budget');
    const remaining = timeoutMs - (performance.now() - started);
    if (remaining <= 0) throw new Deadline('time-budget');
    const delay = Math.min(remaining, predicateTimeoutMs);
    const reason = remaining <= predicateTimeoutMs ? 'time-budget' : 'predicate-timeout';
    const controller = new AbortController();
    let timer;
    attempts++;
    const invoked = performance.now();
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => predicate(Uint8Array.from(bytes), { signal: controller.signal, attempt: attempts })),
        new Promise((_, reject) => { timer = setTimeout(() => {
          const expired = new Deadline(reason); reject(expired); controller.abort(expired);
        }, delay); })
      ]);
      // A synchronous predicate may delay the timer; reject its late result too.
      if (performance.now() - invoked >= delay) { controller.abort(); throw new Deadline(reason); }
      return outcome(result);
    } finally { clearTimeout(timer); }
  }
  const baseline = await evaluate(current);
  if (baseline.status !== 'fail') throw new Error('Initial input does not reproduce a classified failure');
  function report(reason) {
    return { bytes: current, originalBytes: input.length, attempts, accepted, reason,
      unit: options.validUtf8 ? 'utf8-scalars' : 'bytes',
      failure: { category: baseline.category, signature: baseline.signature } };
  }
  function boundaries(bytes) {
    if (!options.validUtf8) return Array.from({ length: bytes.length + 1 }, (_, i) => i);
    const result = [];
    for (let i = 0; i < bytes.length; i++) if ((bytes[i] & 0xc0) !== 0x80) result.push(i);
    result.push(bytes.length);
    return result;
  }
  let partitions = 2;
  while (current.length) {
    const edges = boundaries(current);
    const units = edges.length - 1;
    partitions = Math.min(partitions, units);
    let reduced = false;
    for (let i = 0; i < partitions; i++) {
      const start = edges[Math.floor(i * units / partitions)];
      const end = edges[Math.floor((i + 1) * units / partitions)];
      const candidate = new Uint8Array(current.length - (end - start));
      candidate.set(current.subarray(0, start));
      candidate.set(current.subarray(end), start);
      let result;
      try { result = await evaluate(candidate); }
      catch (error) { if (error instanceof Deadline) return report(error.reason); throw error; }
      if (result.status === 'fail' && result.category === baseline.category && result.signature === baseline.signature) {
        current = candidate; accepted++; partitions = Math.max(2, partitions - 1); reduced = true; break;
      }
    }
    if (reduced) continue;
    if (partitions === units) return report('one-minimal');
    partitions = Math.min(units, partitions * 2);
  }
  return report('one-minimal');
}
