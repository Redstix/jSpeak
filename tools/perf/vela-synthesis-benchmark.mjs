import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnglishSynthesizer } from '../../src/core/english-synthesis.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_ROOT = path.join(ROOT, 'apps/vela-tts/src/common/espeak');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function readData(name) {
  return new Uint8Array(readFileSync(path.join(DATA_ROOT, name)));
}

export async function benchmarkVelaSynthesis({ runs = 25 } = {}) {
  const dictionaryManifest = JSON.parse(readFileSync(new URL('../../data/dictionary/manifest.json', import.meta.url)));
  const inputs = {
    dictionaryBytes: readData('en_dict.txt'),
    dictionaryManifest,
    phontabBytes: readData('phontab.txt'),
    phonindexBytes: readData('phonindex.txt'),
    phondataBytes: readData('phondata.txt')
  };
  const initializationTimes = [];
  const synthesisTimes = [];
  let result = null;
  for (let index = 0; index < runs; index++) {
    const initializationBefore = performance.now();
    const synthesizer = createEnglishSynthesizer(inputs);
    const initializationAfter = performance.now();
    result = await synthesizer.synthesizeWav('Hello world.', {
      scheduler(callback) { callback(); }
    });
    const synthesisAfter = performance.now();
    initializationTimes.push(initializationAfter - initializationBefore);
    synthesisTimes.push(synthesisAfter - initializationAfter);
  }
  const sampleCount = result.pcm.length;
  const sampleSeconds = sampleCount / 22050;
  const wavBytes = result.wav.length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    profile: {
      text: 'Hello world.',
      voice: 'en-us',
      sampleRate: 22050,
      commandCount: result.stats.producedCommands,
      clauseCount: result.stats.clauseCount,
      sampleCount,
      wavBytes
    },
    benchmark: {
      runs,
      initializationMinMs: Number(Math.min(...initializationTimes).toFixed(3)),
      initializationMedianMs: Number(median(initializationTimes).toFixed(3)),
      initializationMaxMs: Number(Math.max(...initializationTimes).toFixed(3)),
      synthesisMinMs: Number(Math.min(...synthesisTimes).toFixed(3)),
      synthesisMedianMs: Number(median(synthesisTimes).toFixed(3)),
      synthesisMaxMs: Number(Math.max(...synthesisTimes).toFixed(3)),
      synthesisRtfMin: Number((Math.min(...synthesisTimes) / 1000 / sampleSeconds).toFixed(6)),
      synthesisRtfMedian: Number((median(synthesisTimes) / 1000 / sampleSeconds).toFixed(6)),
      synthesisRtfMax: Number((Math.max(...synthesisTimes) / 1000 / sampleSeconds).toFixed(6)),
      outputSha256: sha256(result.wav)
    },
    measurement: {
      scope: 'createEnglishSynthesizer plus text-to-command planning and bounded PCM rendering with an immediate scheduler; excludes package I/O, WAV file writing and playback',
      limitation: 'Node benchmark only; device synthesis RTF and device heap remain unmeasured'
    }
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/perf/vela-synthesis-benchmark.mjs');
  benchmarkVelaSynthesis().then(report => console.log(JSON.stringify(report, null, 2)));
}
