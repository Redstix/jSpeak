import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { root } from '../oracle/trace-build-info.mjs';
import { generateEventsBinary, generateEventsInputs } from '../oracle/generate-events-build-info.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';
import { createPhonemeTables } from '../../src/core/phoneme-table.js';
import { preparePhonemeList, PHONEME_PREPARE_PROFILE } from '../../src/core/phoneme-list-prepare.js';
import { createPhonemeListMaker } from '../../src/core/make-phoneme-list.js';
import { createPitchCalculator } from '../../src/core/calc-pitches.js';
import { createLengthCalculator } from '../../src/core/calc-lengths.js';
import { createGenerateEventPlanner } from '../../src/core/generate-events.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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

function splitEvents(lines) {
  const cases = [];
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.kind === 'generate.begin') cases.push([]);
    assert(cases.length > 0, 'Event before generate.begin');
    cases[cases.length - 1].push(event);
  }
  return cases;
}

export function verifyGenerateEvents({ observedDirectory = 'artifacts/oracle-clause-word2-2pOOA5', directory } = {}) {
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

  const inputs = generateEventsInputs();
  assert(existsSync(generateEventsBinary), 'Build the original Generate event oracle first');
  const table = createPhonemeTables(new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phontab')))).select(80);
  const phonindex = new Uint8Array(readFileSync(path.join(root, 'build/oracle/espeak-ng-data/phonindex')));
  const maker = createPhonemeListMaker(phonindex, table);
  const pitches = createPitchCalculator(table);
  const lengths = createLengthCalculator(table);
  const planner = createGenerateEventPlanner(phonindex, table);
  const files = runtimeSnapshot(['src/core/generate-events.js', 'src/core/calc-pitches.js', 'src/core/calc-lengths.js',
    'src/core/make-phoneme-list.js', 'src/core/phoneme-list-prepare.js'], [
    'build/oracle/espeak-ng-data/phontab', 'build/oracle/espeak-ng-data/phonindex',
    'data/phoneme-prepare/profile.js', 'data/prosody/profile.js', 'data/prosody/tunes.js',
    'tools/compare/generate-events.mjs', path.relative(root, reportPath),
  ]);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/generate-events-')); }
  mkdirSync(directory, { recursive: true });

  const input = oracleInput(cases), requestHash = sha256(Buffer.from(input));
  const output = execFileSync(generateEventsBinary, [path.join(root, 'build/oracle')], {
    input, maxBuffer: 64 * 1024 * 1024, timeout: 120000,
  });
  const expectedCases = splitEvents(output.toString().trim().split('\n').filter(Boolean));
  assert.equal(expectedCases.length, cases.length, 'Oracle Generate case count differs');

  const results = [];
  try {
    for (let index = 0; index < cases.length; index++) {
      const clause = cases[index];
      const prepared = preparePhonemeList(list2FromItems(clause.items), table, PHONEME_PREPARE_PROFILE);
      const made = maker.make(prepared, { postPause: clause.postPause, startSentence: clause.startSentence });
      const pitched = pitches.calculate(made.list, made.count, clause.tone);
      const lengthened = lengths.calculate(pitched.list, pitched.count, { list: clause.embedded.list, index: 0 });
      const actual = planner.plan(lengthened.list, lengthened.count, { list: clause.embedded.list });
      assert.deepEqual(actual, expectedCases[index], clause.id + ':' + clause.clause + ' Generate event plan');
      results.push({ id: clause.id, clause: clause.clause, status: 'exact', events: actual.length });
    }
    assert.deepEqual(runtimeSnapshot(['src/core/generate-events.js', 'src/core/calc-pitches.js', 'src/core/calc-lengths.js',
      'src/core/make-phoneme-list.js', 'src/core/phoneme-list-prepare.js'], [
      'build/oracle/espeak-ng-data/phontab', 'build/oracle/espeak-ng-data/phonindex',
      'data/phoneme-prepare/profile.js', 'data/prosody/profile.js', 'data/prosody/tunes.js',
      'tools/compare/generate-events.mjs', path.relative(root, reportPath),
    ]), files, 'Runtime/data/comparator changed during comparison');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', active: results.length, files,
      error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory;
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Fixed en-us original Generate high-level synthesis event plan',
    totalCases: results.length, exactCases: results.filter(row => row.status === 'exact').length,
    comparedEvents: results.reduce((sum, row) => sum + (row.events || 0), 0),
    unsupportedCases: results.filter(row => row.status === 'unsupported').length,
    unsupported: results.filter(row => row.status === 'unsupported'),
    observedDirectory: path.relative(root, observed), requestSha256: requestHash,
    oracleReference: inputs.reference, files, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) throw new Error('Usage: node tools/compare/generate-events.mjs [observed-directory]');
  console.log(JSON.stringify(verifyGenerateEvents({ observedDirectory: process.argv[2] }), null, 2));
}
