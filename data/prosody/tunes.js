// Fixed en-us default intonation tunes. GPL-3.0-or-later.
// See licenses/espeak-ng/COPYING.txt.
export var PROSODY_TUNES = Object.freeze([
  Object.freeze({
    name: 's1', flags: Object.freeze([0, 0, 0, 0]),
    headExtend: Object.freeze([0, 40, 24, 8, 0, 0, 0, 0]),
    preheadStart: 46, preheadEnd: 57, stressedEnv: 0, stressedDrop: 16,
    secondaryDrop: 0, unstressedShape: 0, onset: 255, headStart: 80, headEnd: 50,
    headLast: 255, headMaxSteps: 4, nHeadExtend: 5,
    unstrStart: Object.freeze([-8, -8, -8]), unstrEnd: Object.freeze([-5, -5, -5]),
    nucleus0Env: 0, nucleus0Max: 64, nucleus0Min: 8,
    nucleus1Env: 0, nucleus1Max: 70, nucleus1Min: 18,
    tailStart: 24, tailEnd: 12,
    splitNucleusEnv: 0, splitNucleusMax: 70, splitNucleusMin: 18,
    splitTailStart: 24, splitTailEnd: 12, splitTune: 0
  }),
  Object.freeze({
    name: 'c1', flags: Object.freeze([0, 0, 0, 0]),
    headExtend: Object.freeze([0, 40, 24, 8, 0, 0, 0, 0]),
    preheadStart: 46, preheadEnd: 57, stressedEnv: 0, stressedDrop: 16,
    secondaryDrop: 0, unstressedShape: 0, onset: 255, headStart: 80, headEnd: 46,
    headLast: 255, headMaxSteps: 4, nHeadExtend: 5,
    unstrStart: Object.freeze([-8, -8, -8]), unstrEnd: Object.freeze([-5, -5, -5]),
    nucleus0Env: 4, nucleus0Max: 80, nucleus0Min: 18,
    nucleus1Env: 6, nucleus1Max: 78, nucleus1Min: 22,
    tailStart: 34, tailEnd: 52,
    splitNucleusEnv: 6, splitNucleusMax: 78, splitNucleusMin: 22,
    splitTailStart: 34, splitTailEnd: 52, splitTune: 0
  }),
  Object.freeze({
    name: 'q1', flags: Object.freeze([0, 0, 0, 0]),
    headExtend: Object.freeze([12, 38, 22, 7, 0, 0, 0, 0]),
    preheadStart: 45, preheadEnd: 56, stressedEnv: 0, stressedDrop: 16,
    secondaryDrop: 0, unstressedShape: 0, onset: 255, headStart: 75, headEnd: 43,
    headLast: 255, headMaxSteps: 3, nHeadExtend: 5,
    unstrStart: Object.freeze([-7, -7, -7]), unstrEnd: Object.freeze([0, 0, 0]),
    nucleus0Env: 4, nucleus0Max: 89, nucleus0Min: 21,
    nucleus1Env: 6, nucleus1Max: 86, nucleus1Min: 21,
    tailStart: 34, tailEnd: 68,
    splitNucleusEnv: 6, splitNucleusMax: 86, splitNucleusMin: 21,
    splitTailStart: 34, splitTailEnd: 68, splitTune: 0
  }),
  Object.freeze({
    name: 'e1', flags: Object.freeze([0, 0, 0, 0]),
    headExtend: Object.freeze([10, 52, 32, 20, 10, 0, 0, 0]),
    preheadStart: 46, preheadEnd: 57, stressedEnv: 0, stressedDrop: 16,
    secondaryDrop: 0, unstressedShape: 0, onset: 255, headStart: 90, headEnd: 50,
    headLast: 255, headMaxSteps: 3, nHeadExtend: 5,
    unstrStart: Object.freeze([-9, -9, -9]), unstrEnd: Object.freeze([0, 0, 0]),
    nucleus0Env: 0, nucleus0Max: 92, nucleus0Min: 8,
    nucleus1Env: 0, nucleus1Max: 92, nucleus1Min: 80,
    tailStart: 76, tailEnd: 8,
    splitNucleusEnv: 0, splitNucleusMax: 92, splitNucleusMin: 80,
    splitTailStart: 76, splitTailEnd: 8, splitTune: 0
  })
]);
