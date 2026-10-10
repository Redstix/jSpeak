import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createClauseOracle } from '../oracle/clause.mjs';
import { createClauseReader } from '../../src/core/read-clause.js';
import { createReadClauseDictionary } from './character-name-services.mjs';
import { checkClauseProfile, serializeClause, validateClauseRecords } from './clause.mjs';
import { makeTokenizerCorpus } from './tokenizer-corpus.mjs';
import { makeClauseCorpus } from './clause-corpus.mjs';
import { runtimeSnapshot } from './runtime-snapshot.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot() {
  return runtimeSnapshot(['src/core/read-clause.js', 'src/core/word-services.js'], ['src/core/read-clause.js', 'src/core/unicode.js', 'src/core/clause-type.js', 'src/core/character-names.js',
    'src/core/text-services.js', 'src/core/letter-names.js', 'src/core/dictionary-rules.js', 'src/core/text-character.js', 'src/core/utf8-scan.js', 'data/rules/profile.js', 'data/text/tables.js',
    'src/core/dictionary.js', 'src/core/letter-accent.js', 'src/core/word-stress.js', 'src/core/phoneme-table.js', 'src/data/binary.js',
    'data/unicode/tables.js', 'data/clause/properties.js', 'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json',
    'data/dictionary/profile.js', 'data/accent/tables.js', 'data/stress/profile.js', 'build/oracle/espeak-ng-data/phontab',
    'tools/compare/read-clause-names.mjs', 'tools/compare/clause.mjs', 'tools/compare/clause-corpus.mjs', 'tools/compare/clause-exceptions.json',
    'tools/compare/tokenizer-corpus.mjs', 'tools/compare/character-name-services.mjs', 'tools/oracle/clause.mjs',
    'tools/oracle/clause-build-info.mjs', 'tools/oracle/trace-build-info.mjs', 'tools/oracle/corpus.json']
    );
}

export function verifyReadClauseNames() {
  const fixtures = makeTokenizerCorpus({ fuzzCases: 0 }).filter(row => row.id.startsWith('announcement-') || row.id.startsWith('embedded-punct-'));
  for (const row of makeClauseCorpus()) fixtures.push({ id: 'base/' + row.id, utf8Hex: row.utf8Hex, expectedReadClauseUnsupported: null });
  for (const cp of [0x2026, 0xeaf, 0x1801, 0xfe19, 0x22ee, 0x22ef, 0x22f0, 0x22f1]) {
    fixtures.push({ id: 'ellipsis-name-' + cp, utf8Hex: Buffer.from('a' + String.fromCodePoint(cp) + 'b').toString('hex'), expectedReadClauseUnsupported: null });
  }
  const oracle = createClauseOracle(), baseline = oracle({});
  checkClauseProfile(baseline.profile);
  const files = snapshot();
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'artifacts/read-clause-names-'));
  const requests = JSON.stringify({ schemaVersion: 1, maxClauses: 128, fixtures }, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requests);
  writeFileSync(path.join(directory, 'clauses.jsonl'), '');
  const results = [];
  let active;
  try {
    for (const fixture of fixtures) {
      active = fixture;
      const expected = oracle({ utf8Hex: fixture.utf8Hex, maxClauses: 128 });
      assert.deepEqual(expected.reference, baseline.reference); assert.deepEqual(expected.profile, baseline.profile);
      validateClauseRecords(expected.clauses, 128);
      const reader = createClauseReader(Buffer.from(fixture.utf8Hex, 'hex'), { dictionary: createReadClauseDictionary() });
      const actual = [];
      let gap = null;
      while (reader.hasMore()) {
        let row;
        try { row = reader.next(); }
        catch (error) {
          if (error.code !== 'READ_CLAUSE_UNSUPPORTED' || error.name !== 'UnsupportedReadClauseError' || !fixture.expectedReadClauseUnsupported) throw error;
          const signature = { reason: error.reason, codepoint: error.codepoint, clauseIndex: error.clauseIndex };
          assert.deepEqual(signature, fixture.expectedReadClauseUnsupported);
          assert.equal(reader.hasMore(), false); assert.throws(() => reader.next(), again => again === error);
          gap = signature; break;
        }
        assert(actual.length < expected.clauses.length, fixture.id + ' unexpected extra clause');
        actual.push(serializeClause(row));
        assert.deepEqual(actual.at(-1), expected.clauses[actual.length - 1], fixture.id + ' clause ' + (actual.length - 1));
      }
      if (!gap) { assert.deepEqual(actual, expected.clauses, fixture.id); assert.equal(fixture.expectedReadClauseUnsupported, null); }
      results.push({ id: fixture.id, status: gap ? 'unsupported' : 'exact', comparedClauses: actual.length, ...(gap || {}) });
      appendFileSync(path.join(directory, 'clauses.jsonl'), JSON.stringify({ id: fixture.id, expected, actual, gap }) + '\n');
    }
    assert.deepEqual(snapshot(), files, 'Source/data changed during run');
    assert.deepEqual(createClauseOracle()({}), baseline, 'C reference changed during run');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ active, completedCases: results.length, reference: baseline.reference, files, error: error.stack, actual: error.actual, expected: error.expected }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + directory; throw error;
  }
  const report = { schemaVersion: 1, status: 'passed-supported-slice', coverageComplete: false,
    scope: 'Consecutive direct ReadClause with real dictionary/character names, fixed en-us profile; no caller word translation/synthesis',
    totalCases: results.length, exactCases: results.filter(row => row.status === 'exact').length,
    comparedClauses: results.reduce((sum, row) => sum + row.comparedClauses, 0),
    unsupported: results.filter(row => row.status === 'unsupported'), reference: baseline.reference, profile: baseline.profile,
    files, requestsSha256: sha256(requests), artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(verifyReadClauseNames(), null, 2));
