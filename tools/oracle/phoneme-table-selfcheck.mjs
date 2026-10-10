import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, referenceBuild, fileHash, sha256 } from './trace-build-info.mjs';
import { createPhonemeTableOracle } from './phoneme-table.mjs';
import { createPhonemeTables, decodePhonemes } from '../../src/core/phoneme-table.js';

export function verifyPhonemeTables({ directory } = {}) {
  const names = ['src/core/phoneme-table.js', 'tools/oracle/phoneme-table-oracle.c', 'tools/oracle/phoneme-table.mjs', 'tools/oracle/phoneme-table-build-info.mjs', 'tools/oracle/phoneme-table-selfcheck.mjs'];
  const snapshot = () => names.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
  const files = snapshot();
  const bytes = readFileSync(path.join(referenceBuild, 'espeak-ng-data/phontab'));
  const tables = createPhonemeTables(bytes);
  const oracle = createPhonemeTableOracle();
  const envelope = oracle();
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/phoneme-table-')); }
  mkdirSync(directory, { recursive: true });
  const decode = Array.from({ length: 256 }, (_, code) => Buffer.from([code, 0]).toString('hex'));
  decode.push('', '1500', '15656e00', '15656e2d757300', '15ff616200', 'ff06000006', Buffer.from(Array.from({ length: 255 }, (_, index) => index + 1)).toString('hex'));
  let random = 0x5eed0202;
  for (let i = 0; i < 64; i++) {
    const row = Buffer.alloc(32);
    for (let j = 0; j < row.length; j++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; row[j] = random & 255; }
    decode.push(row.toString('hex'));
  }
  const requests = { tables: tables.tables.map(table => table.index), decode };
  const requestBytes = JSON.stringify(requests, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestBytes);
  let activeTable = null;
  try {
    for (const table of tables.tables) {
      activeTable = table.index;
      const reference = oracle({ index: table.index, decode });
      assert.deepEqual(reference.reference, envelope.reference);
      const { decoded, ...selected } = reference.result;
      assert.deepEqual(tables.select(table.index), selected, `C table ${table.index}`);
      const actual = decode.map(hex => Buffer.from(decodePhonemes(Buffer.from(hex, 'hex'), tables.select(table.index))).toString('hex'));
      assert.deepEqual(actual, decoded, `C DecodePhonemes table ${table.index}`);
    }
    assert.deepEqual(snapshot(), files, 'Phoneme-table JS/helper sources changed during verification');
    assert.deepEqual(createPhonemeTableOracle()().reference, envelope.reference, 'C reference changed during verification');
    assert.equal(sha256(readFileSync(path.join(referenceBuild, 'espeak-ng-data/phontab'))), sha256(bytes), 'phontab changed during verification');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ status: 'failed', activeTable, error: error.stack, files, reference: envelope.reference }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + path.join(directory, 'failure.json');
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed', scope: 'Original phontab loading/selection and DecodePhonemes; no phoneme VM',
    tableCount: tables.tables.length, comparedSlots: tables.tables.length * 256, decodedCases: tables.tables.length * decode.length,
    inputBytes: bytes.length, phontabSha256: sha256(bytes), requestsSha256: sha256(requestBytes), files, reference: envelope.reference, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/phoneme-table-selfcheck.mjs');
  console.log(JSON.stringify(verifyPhonemeTables(), null, 2));
}
