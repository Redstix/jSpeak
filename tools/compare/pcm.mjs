function validateAudio(audio, label) {
  if (!audio || !(audio.samples instanceof Int16Array)) {
    throw new TypeError(`${label}.samples must be Int16Array`);
  }
  if (!Number.isSafeInteger(audio.sampleRate) || audio.sampleRate <= 0) {
    throw new RangeError(`${label}.sampleRate must be a positive integer`);
  }
}

/** Compare mono PCM16 without alignment, resampling, or trimming silence. */
export function comparePcm(reference, actual) {
  validateAudio(reference, 'reference');
  validateAudio(actual, 'actual');
  if (reference.sampleRate !== actual.sampleRate) {
    throw new RangeError('Sample rates differ; explicit conversion is required');
  }
  const a = reference.samples;
  const b = actual.samples;
  const count = Math.min(a.length, b.length);
  let maxAbsoluteError = 0;
  let squaredError = 0;
  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  let firstMismatch = null;
  for (let i = 0; i < count; i++) {
    const error = a[i] - b[i];
    if (error !== 0 && firstMismatch === null) firstMismatch = i;
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(error));
    squaredError += error * error;
    dot += a[i] * b[i];
    energyA += a[i] * a[i];
    energyB += b[i] * b[i];
  }
  if (a.length !== b.length && firstMismatch === null) firstMismatch = count;
  return {
    exact: firstMismatch === null,
    firstMismatch,
    referenceSamples: a.length,
    actualSamples: b.length,
    comparedSamples: count,
    durationDifferenceSeconds: (b.length - a.length) / reference.sampleRate,
    // Metrics cover the common prefix only; length mismatch is always a failure.
    maxAbsoluteError: count ? maxAbsoluteError : null,
    rmsError: count ? Math.sqrt(squaredError / count) : null,
    normalizedCorrelation: energyA && energyB
      ? Math.max(-1, Math.min(1, dot / Math.sqrt(energyA * energyB)))
      : null
  };
}
