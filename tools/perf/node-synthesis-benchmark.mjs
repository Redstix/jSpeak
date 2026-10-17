import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnglishSynthesizer } from '../../src/core/english-synthesis.js';
import { createCmnSynthesizer } from '../../src/core/cmn-synthesis.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ROUNDS = 5;
const ITERATIONS = 25;
const OUTPUT = path.join(ROOT, 'docs/build-results/2026-10-17-node-synthesis-benchmark.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function stats(values) {
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values)
  };
}

function load(profile) {
  const read = name => new Uint8Array(readFileSync(path.join(profile.root, name)));
  const inputs = {
    phontabBytes: read('phontab.txt'),
    phonindexBytes: read('phonindex.txt'),
    phondataBytes: read('phondata.txt')
  };
  if (profile.language === 'cmn') {
    return { ...inputs, dictionaryBytes: read('cmn_dict.txt') };
  }
  return {
    ...inputs,
    dictionaryBytes: read('en_dict.txt'),
    dictionaryManifest: JSON.parse(readFileSync(path.join(ROOT, 'data/dictionary/manifest.json')))
  };
}

function create(profile, inputs) {
  return profile.language === 'cmn'
    ? createCmnSynthesizer(inputs)
    : createEnglishSynthesizer(inputs);
}

async function synthesize(synthesizer, text) {
  return synthesizer.synthesizeWav(text, {
    scheduler(callback) { callback(); }
  });
}

export async function benchmarkNodeSynthesis() {
  const profiles = [
    {
      language: 'en', voice: 'en-us', text: 'Hello world.',
      root: path.join(ROOT, 'apps/vela-probe/src/common/espeak')
    },
    {
      language: 'cmn', voice: 'cmn', text: '你好，世界。',
      root: path.join(ROOT, 'artifacts/cmn-language-pack')
    }
  ].map(profile => ({ ...profile, inputs: load(profile) }));

  const initialization = { en: [], cmn: [] };
  const synthesis = { en: [], cmn: [] };
  const outputs = {};
  for (const profile of profiles) outputs[profile.language] = null;

  for (let round = 0; round < ROUNDS; round++) {
    for (let index = 0; index < ITERATIONS; index++) {
      for (const profile of profiles) {
        const before = performance.now();
        create(profile, profile.inputs);
        initialization[profile.language].push(performance.now() - before);
      }
    }
    for (const profile of profiles) {
      const synthesizer = create(profile, profile.inputs);
      for (let index = 0; index < ITERATIONS; index++) {
        const before = performance.now();
        const result = await synthesize(synthesizer, profile.text);
        synthesis[profile.language].push(performance.now() - before);
        const identity = {
          samples: result.pcm.length,
          wavBytes: result.wav.length,
          sha256: sha256(result.wav),
          commandCount: result.stats.producedCommands,
          clauseCount: result.stats.clauseCount
        };
        if (!outputs[profile.language]) outputs[profile.language] = identity;
        else if (JSON.stringify(outputs[profile.language]) !== JSON.stringify(identity)) {
          throw new Error(`${profile.language} output changed between runs`);
        }
      }
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    method: {
      rounds: ROUNDS,
      iterationsPerRound: ITERATIONS,
      pairedRunsPerLanguage: ROUNDS * ITERATIONS,
      initialization: 'create a new synthesizer per paired iteration; excludes data file I/O',
      synthesis: 'fixed text to complete PCM16 WAV with an immediate scheduler; excludes package I/O, file write and playback',
      rtf: 'elapsed seconds / audio seconds; Node/V8 only'
    },
    profiles: profiles.map(profile => {
      const identity = outputs[profile.language];
      const audioSeconds = identity.samples / 22050;
      const init = stats(initialization[profile.language]);
      const synth = stats(synthesis[profile.language]);
      return {
        language: profile.language,
        voice: profile.voice,
        text: profile.text,
        output: identity,
        audioSeconds,
        initializationMs: {
          min: Number(init.min.toFixed(3)),
          median: Number(init.median.toFixed(3)),
          max: Number(init.max.toFixed(3))
        },
        synthesisMs: {
          min: Number(synth.min.toFixed(3)),
          median: Number(synth.median.toFixed(3)),
          max: Number(synth.max.toFixed(3))
        },
        rtf: {
          min: Number((synth.min / 1000 / audioSeconds).toFixed(6)),
          median: Number((synth.median / 1000 / audioSeconds).toFixed(6)),
          max: Number((synth.max / 1000 / audioSeconds).toFixed(6))
        }
      };
    }),
    limitations: [
      'Node/V8 measurements do not represent device QuickJS, device heap or device latency.',
      'No package file I/O, internal file write/readback or playback is included.'
    ]
  };
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('Usage: node tools/perf/node-synthesis-benchmark.mjs');
  benchmarkNodeSynthesis().then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.error('Output: ' + OUTPUT);
  });
}
