import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createClauseOracle, exportClauseTable, unpackClauseTableRow } from './clause.mjs';
import { makeTraceCorpus } from './trace-corpus.mjs';
import { validateTrace } from '../compare/trace.mjs';
import { root, sha256 } from './trace-build-info.mjs';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--trace-dir')) throw new Error('Usage: node tools/oracle/clause-selfcheck.mjs [--trace-dir ARTIFACT_DIRECTORY]');
const traceDirectory = args.length ? path.resolve(args[1]) : null;
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/oracle-clause-'));
const oracle = createClauseOracle();
let activeRequest = null;
try {
  for (const invalid of [{ unknown: true }, { maxClauses: 0 }, { maxClauses: 129 }, { maxClauses: 1.5 }, { utf8Hex: '0' }, { utf8Hex: 'GG' }, { utf8Hex: '61'.repeat(65537) }, { classify: [-1] }, { classify: [0x100000000] }, { classify: Array(16385).fill(0) }]) assert.throws(() => oracle(invalid));
  const batchInput = JSON.stringify([{ utf8Hex: '61', maxClauses: 1 }, {}, { classify: [46, 0xffffffff] }]);
  const batch = () => execFileSync(process.execPath, ['tools/oracle/clause.mjs'], { input: batchInput, encoding: 'utf8' });
  const batchOutput = batch(); assert.equal(batch(), batchOutput);
  const batchValues = JSON.parse(batchOutput);
  assert.equal(batchValues.length, 3); assert.equal(batchValues[0].clauses[0].sourceHex, '6120');
  assert.equal(batchValues[1].clauses, null); assert.equal(batchValues[2].classifications[1].codepoint, 0xffffffff);
  assert.notEqual(spawnSync(process.execPath, ['tools/oracle/clause.mjs'], { input: JSON.stringify(Array(1025).fill({})) }).status, 0);
  const extra = ['', 'A. B?', 'a\0b', 'Hello\n\nworld', 'x'.repeat(724) + ' y', 'x'.repeat(795) + '😀 tail', 'soft\u00adhyphen', 'a\u200cb', '[[h@loU]].', '...', '!', '\u055b Armenian', '\ufeffHello'];
  const corpus = [...makeTraceCorpus(), ...extra.map((text, index) => ({ id: `clause-boundary-${index}`, bytes: Buffer.from(text) }))];
  let clauseCount = 0;
  for (const entry of corpus) {
    activeRequest = { utf8Hex: entry.bytes.toString('hex'), maxClauses: 128 };
    const observed = oracle(activeRequest);
    assert.deepEqual(observed, oracle(activeRequest, { reference: true }), entry.id + ': clean/instrumented differ');
    assert.deepEqual(observed, oracle(activeRequest), entry.id + ': fresh-process repeat differs');
    assert.equal(observed.clauses[0].stateBefore.countCharacters, -1);
    assert.equal(observed.clauses[0].stateBefore.phonemesRepeatCount, null);
    assert.ok(observed.clauses.at(-1).terminator & 0x10000, entry.id + ': failed to reach returned CLAUSE_TYPE_EOF');
    for (const clause of observed.clauses) {
      assert.equal(clause.charix.length, clause.charixTop + 1);
      assert.equal(clause.stateAfter.phonemesRepeatCount, 0);
    }
    clauseCount += observed.clauses.length;
  }
  activeRequest = { utf8Hex: '', maxClauses: 1 };
  const empty = oracle(activeRequest).clauses[0];
  assert.equal(empty.terminator, 0x90028); assert.equal(empty.sourceHex, '20');
  assert.deepEqual(empty.charix, [0]);
  activeRequest = { utf8Hex: Buffer.from('Hello world. Next.').toString('hex'), maxClauses: 3 };
  const repeated = oracle(activeRequest).clauses;
  assert.equal(repeated.length, 3);
  assert.equal(repeated[1].stateAfter.decoderEof, true);
  assert.equal(repeated[1].terminator & 0x10000, 0);
  assert.ok(repeated[2].terminator & 0x10000);
  const classify = [...Array.from({ length: 256 }, (_, i) => i), 0x55b, 0x55e, 0x589, 0x61f, 0x2026, 0x3002, 0xff01, 0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff];
  activeRequest = { classify };
  const classifications = oracle(activeRequest).classifications;
  assert.deepEqual(classifications, oracle(activeRequest, { reference: true }).classifications);
  const table = exportClauseTable();
  assert.deepEqual(table, exportClauseTable({ reference: true }));
  for (const row of classifications) if (row.codepoint < 0x110000) assert.deepEqual(unpackClauseTableRow(table, row.codepoint, row.codepoint), row);
  for (const row of classifications.filter(r => r.codepoint > 0x10ffff)) assert.equal(row.clauseType, 0x4000);
  let bridge = { status: 'skipped', reason: 'Pass --trace-dir for existing full CLI trace comparison' };
  if (traceDirectory) {
    const report = JSON.parse(readFileSync(path.join(traceDirectory, 'report.json'), 'utf8'));
    let comparedCases = 0, noCliClause = 0;
    for (const entry of report.cases) {
      const trace = validateTrace(JSON.parse(readFileSync(path.join(traceDirectory, entry.id, 'trace.json'), 'utf8')));
      const expected = trace.events.find(event => event.kind === 'clause');
      if (!expected) { noCliClause++; continue; }
      activeRequest = { utf8Hex: trace.input.utf8Hex, maxClauses: 1 };
      const result = oracle(activeRequest);
      assert.equal(result.reference.traceFingerprint, trace.reference.buildFingerprint);
      assert.equal(result.reference.dataFingerprint, trace.reference.dataFingerprint);
      assert.equal(result.reference.upstreamCommit, trace.reference.upstreamCommit);
      const actual = result.clauses[0];
      for (const key of ['startCharacter', 'sourceHex', 'charix', 'charixTop', 'terminator', 'tone']) assert.deepEqual(actual[key], expected[key], entry.id + ': ReadClause/CLI trace ' + key);
      comparedCases++;
    }
    bridge = { status: 'passed', comparedCases, noCliClause, directory: path.relative(root, traceDirectory) };
  }
  const report = { schemaVersion: 1, kind: 'fixed-C-ReadClause-selfcheck-not-C-JS-compatibility', reference: oracle({}).reference, profile: oracle({}).profile,
    inputCases: corpus.length, observedClauses: clauseCount, independentRunsPerInput: 3, classificationPoints: classify.length, propertyTableRows: 0x110000,
    propertyTableSha256: sha256(table), protocolChecks: 'passed', traceBridge: bridge, status: 'passed' };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${corpus.length} inputs / ${clauseCount} clauses; clean/instrumented/fresh-repeat exact; 1114112 property rows exact; trace bridge ${bridge.status}.`);
  console.log(`Report: ${output}/report.json`);
} catch (error) {
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ request: activeRequest, error: error.stack }, null, 2) + '\n');
  throw error;
}
