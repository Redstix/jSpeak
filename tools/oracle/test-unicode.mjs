import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createUnicodeOracle, exportUnicodeTable, unpackUnicodeTableRow } from './unicode.mjs';
import { root, sha256 } from './trace-build-info.mjs';

export function verifyUnicodeOracle({ exhaustiveBytes = true } = {}) {
  const invoke = createUnicodeOracle();
  let lastRequest = null;
  const oracle = (request, options) => { lastRequest = request; return invoke(request, options); };
  try {
    const smoke = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8')).map(s => Buffer.from(s).toString('hex'));
    const boundary = ['', '00', '610062', 'c3a9', 'efbbbf', 'efbfbd', 'eda080', 'edbfbf', 'c080', 'c0af', 'f0808080', 'f8888080', 'f4908080', 'e228a1', 'e282', 'c2', 'ff', '80', 'f48fbfbf', '61'.repeat(65536)];
    let state = 0x5eedb17e;
    const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
    const fuzz = Array.from({ length: exhaustiveBytes ? 64 : 4 }, () => Buffer.from(Array.from({ length: next() % 33 }, () => next() & 255)).toString('hex'));
    const byteCases = exhaustiveBytes ? Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0')) : [];
    const cases = [...smoke, ...boundary, ...byteCases, ...fuzz];
    let decodeCases = 0, steps = 0;
    for (const utf8Hex of cases) for (const termination of ['c-string', 'nul-terminated', 'bounded']) {
      const request = { utf8Hex, termination };
      const observed = oracle(request), clean = oracle(request, { reference: true });
      assert.deepEqual(observed, clean, `C helper differs: ${termination} ${utf8Hex.slice(0, 100)}`);
      assert.deepEqual(observed.decode.terminal, { offset: observed.decode.bufferByteLength, eof: true, peek: 0, getcSupported: false });
      let offset = 0;
      for (const step of observed.decode.steps) {
        assert.equal(step.offsetBefore, offset); assert.equal(step.peekBefore, step.codepoint);
        assert.equal(step.offsetAfter - step.offsetBefore, step.consumedBytes);
        assert.equal(step.remainingBefore, observed.decode.bufferByteLength - offset);
        assert.equal(step.eofAfter, step.offsetAfter === observed.decode.bufferByteLength);
        offset = step.offsetAfter;
      }
      assert.equal(offset, observed.decode.bufferByteLength);
      decodeCases++; steps += observed.decode.steps.length;
    }
    const expect = (utf8Hex, termination, points) => assert.deepEqual(oracle({ utf8Hex, termination }).decode.steps.map(s => s.codepoint), points);
    expect('c3a9', 'c-string', [233, 0]); expect('c3a9', 'bounded', [65533]);
    expect('efbfbd', 'c-string', [26, 0]); expect('eda080', 'c-string', [55296, 0]);
    expect('c080', 'c-string', [0, 0]); expect('610062', 'c-string', [97, 0]);
    expect('610062', 'nul-terminated', [97, 0, 98, 0]); expect('610062', 'bounded', [97, 0, 98]);
    expect('efbbbf', 'c-string', [65279, 0]); expect('e228a1', 'c-string', [65533, 40, 65533, 0]);
    expect('e282', 'c-string', [65533]); expect('f0808080', 'c-string', [0, 0]);
    const points = Array.from(new Set([0, 9, 10, 13, 32, 40, 41, 48, 65, 73, 90, 97, 160, 223, 304, 305, 769, 0x966, 0x2500, 0x259f, 0x25a0, 0x2800, 0xd800, 0xdfff, 0xfeff, 0xfffd, 0xffff, 0x1f600, 0x10ffff, 0x110000, 0xffffffff, ...Array.from({ length: 512 }, () => next() % 0x110001)]));
    for (const dotlessI of [false, true]) assert.deepEqual(oracle({ classify: points, dotlessI }), oracle({ classify: points, dotlessI }, { reference: true }));
    const special = oracle({ classify: [73, 160, 769, 0x966, 0x1f600, 0xd800, 0x110000], dotlessI: true }).classifications;
    assert.equal(special[0].lower, 0x131); assert.equal(special[0].ucdLower, 105);
    assert.equal(special[1].iswSpace, 0); assert.equal(special[2].isAlpha, 1); assert.equal(special[2].iswAlpha, 0);
    assert.equal(special[3].isDigit, 1); assert.equal(special[3].iswDigit, 0); assert.equal(special[4].isAlpha, 1);
    assert.equal(special[5].utf8Hex, 'eda080'); assert.equal(special[6].utf8Hex, '20');
    const table = exportUnicodeTable({ start: 0, count: exhaustiveBytes ? 0x110000 : 512 });
    const cleanTable = exportUnicodeTable({ start: 0, count: exhaustiveBytes ? 0x110000 : 512, reference: true });
    assert.deepEqual(table, cleanTable, 'Clean/instrumented Unicode binary tables differ');
    const tablePoints = points.filter(cp => cp < table.length / 32);
    const rows = oracle({ classify: tablePoints }).classifications;
    rows.forEach((row, index) => assert.deepEqual(unpackUnicodeTableRow(table, tablePoints[index], tablePoints[index]), row));
    return {
      schemaVersion: 1, kind: 'fixed-C-unicode-oracle-selfcheck-not-C-JS-compatibility', reference: oracle({}).reference,
      seed: 0x5eedb17e, decodeCases, decodeSteps: steps, classificationPoints: points.length, dotlessModes: 2,
      tableRows: table.length / 32, tableSha256: sha256(table), status: 'passed',
      coverage: ['UTF-8 three termination modes', 'malformed byte cases', 'peek/cursor/EOF', 'NUL/BOM/surrogates/overlong', 'common + pinned UCD classification', 'case + utf8_out', 'clean/instrumented binary table'],
      unsupported: ['other encodings', 'getc after non-null decoder EOF', 'common.c:utf8_in/utf8_in2', 'JS UTF-16 string adapter policy']
    };
  } catch (error) { error.oracleRequest = lastRequest; throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/test-unicode.mjs');
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'artifacts/oracle-unicode-'));
  try {
    const report = verifyUnicodeOracle();
    writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS: ${report.decodeCases} UTF-8 cases, ${report.classificationPoints} classification points in both dotless modes, ${report.tableRows} full Unicode rows; clean/instrumented C exact.`);
    console.log(`Report: ${directory}/report.json`);
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ seed: 0x5eedb17e, request: error.oracleRequest ?? null, error: error.stack }, null, 2) + '\n');
    throw error;
  }
}
