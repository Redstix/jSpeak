import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CLAUSE, CLAUSE_PROPERTY, clauseTypeFromCodePoint, clausePropertyBits } from '../../src/core/clause-type.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['src/core/clause-type.js', 'data/clause/properties.js', 'data/clause/manifest.json',
  'tools/build-clause/build.mjs', 'tools/build-clause/export-properties.c', 'tools/build-clause/verify.mjs'];
const snapshot = () => files.map(name => ({ path: name, sha256: hash(readFileSync(path.join(root, name))) }));

export async function verifyClauseType() {
  const { createClauseOracle, exportClauseTable } = await import('../oracle/clause.mjs');
  const inputs = snapshot();
  const manifest = JSON.parse(readFileSync(path.join(root, 'data/clause/manifest.json'), 'utf8'));
  assert.deepEqual(CLAUSE, manifest.constants); assert.deepEqual(CLAUSE_PROPERTY, manifest.properties);
  assert.equal(hash(readFileSync(path.join(root, 'data/clause/properties.js'))), manifest.moduleSha256);
  const oracle = createClauseOracle();
  const identity = oracle({ classify: [] });
  const table = exportClauseTable();
  assert.equal(table.length, 0x110000 * 16);
  for (let cp = 0; cp < 0x110000; cp++) {
    const offset = cp * 16;
    assert.equal(clausePropertyBits(cp), table.readUInt32LE(offset + 8) >>> 20, 'U+' + cp.toString(16) + ' raw property bits');
    assert.equal(clauseTypeFromCodePoint(cp), table.readUInt32LE(offset + 12), 'U+' + cp.toString(16) + ' clause type');
  }
  const extra = [0x110000, 0x110001, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
  const response = oracle({ classify: extra });
  for (const row of response.classifications) {
    assert.equal(clausePropertyBits(row.codepoint), row.propertiesHigh >>> 20);
    assert.equal(clauseTypeFromCodePoint(row.codepoint), row.clauseType);
  }
  assert.deepEqual(response.reference, identity.reference, 'C reference changed during comparison');
  assert.deepEqual(snapshot(), inputs, 'Clause JS/data inputs changed during comparison');
  const report = { schemaVersion: 1, kind: 'M02.1-clause-property-and-type-C-JS-exact', reference: identity.reference,
    inputs, codePoints: 0x110000, extendedCodePoints: extra, constants: Object.keys(CLAUSE).length,
    sourceFingerprint: manifest.sourceFingerprint, referenceTableSha256: hash(table), status: 'passed',
    scope: 'Raw top12 property bits and clause_type_from_codepoint only; not the full ReadClause state machine' };
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'artifacts/clause-type-'));
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return { ...report, reportPath: path.join(directory, 'report.json') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-clause/verify.mjs');
  console.log(JSON.stringify(await verifyClauseType(), null, 2));
}
