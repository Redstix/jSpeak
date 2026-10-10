import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root } from '../oracle/trace-build-info.mjs';
import { phonemeProsodyBinary, phonemeProsodyInputs } from '../oracle/phoneme-prosody-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { preparePhonemeList, PHONEME_PREPARE_PROFILE } from '../../src/core/phoneme-list-prepare.js';
import { createPhonemeListMaker } from '../../src/core/make-phoneme-list.js';
import { createPitchCalculator } from '../../src/core/calc-pitches.js';
import { createLengthCalculator } from '../../src/core/calc-lengths.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = ['count','phcode','stresslevel','wordstress','tonePh','sourceix','synthflags','length','env','type',
  'prepause','amp','newword','pitch1','pitch2','stdLength','phontabAddr','soundParam','tonePhData'];

function list2FromItems(items) {
  const list = { length: items.length, phcode: new Uint8Array(1000), stresslevel: new Uint8Array(1000),
    wordstress: new Uint8Array(1000), tonePh: new Uint8Array(1000), sourceix: new Uint16Array(1000), synthflags: new Uint16Array(1000) };
  items.forEach((row, index) => {
    list.phcode[index] = row.phcode; list.stresslevel[index] = row.stresslevel;
    list.wordstress[index] = row.wordstress; list.tonePh[index] = row.tonePh;
    list.sourceix[index] = row.sourceix; list.synthflags[index] = row.synthflags;
  });
  return list;
}

function oracleInput(cases) {
  const lines = [];
  for (const clause of cases) {
    lines.push(clause.items.length, clause.postPause, clause.startSentence ? 1 : 0, clause.tone, clause.embedded.list.length);
    for (const command of clause.embedded.list) lines.push(command);
    for (const row of clause.items) lines.push(row.phcode, row.stresslevel, row.wordstress, row.tonePh, row.sourceix, row.synthflags);
  }
  return lines.join('\n') + '\n';
}

function snapshotResult(result) {
  return {
    count: result.count,
    phcode: Array.from(result.list.phcode.subarray(0, result.count)),
    stresslevel: Array.from(result.list.stresslevel.subarray(0, result.count)),
    wordstress: Array.from(result.list.wordstress.subarray(0, result.count)),
    tonePh: Array.from(result.list.tonePh.subarray(0, result.count)),
    sourceix: Array.from(result.list.sourceix.subarray(0, result.count)),
    synthflags: Array.from(result.list.synthflags.subarray(0, result.count)),
    length: Array.from(result.list.length.subarray(0, result.count)),
    env: Array.from(result.list.env.subarray(0, result.count)),
    type: Array.from(result.list.type.subarray(0, result.count)),
    prepause: Array.from(result.list.prepause.subarray(0, result.count)),
    amp: Array.from(result.list.amp.subarray(0, result.count)),
    newword: Array.from(result.list.newword.subarray(0, result.count)),
    pitch1: Array.from(result.list.pitch1.subarray(0, result.count)),
    pitch2: Array.from(result.list.pitch2.subarray(0, result.count)),
    stdLength: Array.from(result.list.stdLength.subarray(0, result.count)),
    phontabAddr: Array.from(result.list.phontabAddr.subarray(0, result.count)),
    soundParam: Array.from(result.list.soundParam.subarray(0, result.count)),
    tonePhData: Array.from(result.list.tonePhId.subarray(0, result.count)),
  };
}

export function verifyProsody({ observedDirectory = 'artifacts/oracle-clause-word2-2pOOA5', directory } = {}) {
  const observed = path.resolve(root, observedDirectory);
  const reportPath = path.join(observed, 'report.json');
  assert(existsSync(reportPath), 'Missing original clause Word2 observer report');
  const observedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  const cases = [];
  for (const capture of observedReport.captures) {
    const tracePath = path.join(observed, capture.id, 'observed.jsonl');
    if (!existsSync(tracePath)) continue;
    for (const event of readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)) {
      if (event.kind === 'clause.before-phonemelist') cases.push({ id: capture.id, clause: event.clause,
        items: event.phonemeList2.items, postPause: event.clausePause, startSentence: event.newSentence2,
        tone: event.tone, embedded: event.embedded });
    }
  }
  assert.equal(cases.length, observedReport.clauses, 'Clause count differs from observer report');

  const inputs = phonemeProsodyInputs();
  assert(existsSync(phonemeProsodyBinary), 'Build the original phoneme prosody oracle first');
  const table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(80);
  const maker = createPhonemeListMaker(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phonindex'))), table);
  const pitches = createPitchCalculator(table);
  const lengths = createLengthCalculator(table);
  const files = runtimeSnapshot(['src/core/calc-pitches.js', 'src/core/calc-lengths.js', 'src/core/make-phoneme-list.js', 'src/core/phoneme-list-prepare.js'], [
    'build/oracle/espeak-ng-data/phontab', 'build/oracle/espeak-ng-data/phonindex',
    'data/phoneme-prepare/profile.js', 'data/prosody/profile.js', 'data/prosody/tunes.js',
    'tools/compare/prosody.mjs', path.relative(root, reportPath),
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/prosody-')); }
  mkdirSync(directory, { recursive: true });

  const input = oracleInput(cases), requestHash = sha256(Buffer.from(input));
  const oracle = JSON.parse(execFileSync(phonemeProsodyBinary, [path.join(root, 'build/oracle')], {
    input, maxBuffer: 64 * 1024 * 1024, timeout: 120000,
  }));
  assert.equal(oracle.results.length, cases.length, 'Oracle result count differs');
  const results = [];
  try {
    for (let index = 0; index < cases.length; index++) {
      const clause = cases[index];
      const prepared = preparePhonemeList(list2FromItems(clause.items), table, PHONEME_PREPARE_PROFILE);
      const made = maker.make(prepared, { postPause: clause.postPause, startSentence: clause.startSentence });
      const pitched = pitches.calculate(made.list, made.count, clause.tone);
      const actualPitches = snapshotResult(pitched);
      for (const field of fields) assert.deepEqual(actualPitches[field], oracle.results[index].pitches[field], clause.id + ':' + clause.clause + ' pitches ' + field);
      const lengthened = lengths.calculate(pitched.list, pitched.count, { list: clause.embedded.list, index: 0 });
      const actualLengths = snapshotResult(lengthened);
      for (const field of fields) assert.deepEqual(actualLengths[field], oracle.results[index].lengths[field], clause.id + ':' + clause.clause + ' lengths ' + field);
      results.push({ id: clause.id, clause: clause.clause, status: 'exact', count: actualLengths.count });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/calc-pitches.js', 'src/core/calc-lengths.js', 'src/core/make-phoneme-list.js', 'src/core/phoneme-list-prepare.js'], [
      'build/oracle/espeak-ng-data/phontab', 'build/oracle/espeak-ng-data/phonindex',
      'data/phoneme-prepare/profile.js', 'data/prosody/profile.js', 'data/prosody/tunes.js',
      'tools/compare/prosody.mjs', path.relative(root, reportPath),
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length, files,
      error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed en-us original CalcPitches + CalcLengths over real CLI MakePhonemeList outputs',
    totalCases: results.length, exactCases: results.length,
    comparedPhonemes: results.reduce((sum, row) => sum + row.count, 0),
    comparedStages: 'pitches-and-lengths', unsupportedCases: 0,
    observedDirectory: path.relative(root, observed), requestSha256: requestHash,
    oracleReference: inputs.reference, files, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/prosody.mjs [observed-directory]');
  console.log(JSON.stringify(verifyProsody({ observedDirectory: process.argv[2] }), null, 2));
}
