import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createUnicodeOracle, exportUnicodeTable, unpackUnicodeTableRow } from '../oracle/unicode.mjs';
import { createUtf8Decoder, classifyCodePoint, writeUtf8CodePoint } from '../../src/core/unicode.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function jsDecode(bytes, termination = 'c-string') {
  const decoder = createUtf8Decoder(bytes, { termination });
  const steps = [];
  while (!decoder.eof()) {
    const offsetBefore = decoder.offset();
    const remainingBefore = decoder.remaining();
    const peekBefore = decoder.peek();
    const codepoint = decoder.next();
    steps.push({ codepoint, peekBefore, offsetBefore, offsetAfter: decoder.offset(), remainingBefore,
      consumedBytes: decoder.offset() - offsetBefore, eofBefore: false, eofAfter: decoder.eof() });
  }
  return { inputByteLength: bytes.length, bufferByteLength: decoder.byteLength, steps,
    terminal: { offset: decoder.offset(), eof: true, peek: decoder.peek(), getcSupported: false } };
}
export function jsClassify(cp, dotlessI = false, output) {
  const result = classifyCodePoint(cp, dotlessI, output);
  const encoded = new Uint8Array(4);
  const count = writeUtf8CodePoint(cp, encoded, 0);
  result.utf8Hex = Buffer.from(encoded.subarray(0, count)).toString('hex');
  return result;
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function verifyUnicode({ seed = 0x5eeda11, fuzzCases = 512, fullTable = true } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(fuzzCases) || fuzzCases < 0 || fuzzCases > 4096 || typeof fullTable !== 'boolean') throw new RangeError('Invalid bounded Unicode verification options');
  const oracle = createUnicodeOracle();
  const reference = oracle({}).reference;
  const provenance = { reference,
    coreSha256: hash(readFileSync(path.join(root, 'src/core/unicode.js'))),
    dataManifestSha256: hash(readFileSync(path.join(root, 'data/unicode/manifest.json'))),
    dataModuleSha256: hash(readFileSync(path.join(root, 'data/unicode/tables.js'))) };
  const directory = path.join(root, 'artifacts/unicode'); mkdirSync(directory, { recursive: true });
  let state = seed >>> 0;
  function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; }
  const corpus = JSON.parse(readFileSync(path.join(root, 'tools/oracle/corpus.json'), 'utf8'));
  const fixtures = ['', '00', '410042', 'c2a9', 'e4bda0', 'f09f9880', 'efbbbf', 'efbfbd', 'c080', 'eda080',
    'c2', 'e180', 'f09080', 'e14180', 'e18041', 'f5808080', 'ffbfbfbf', 'c24142', 'e180414243', 'f18080414243'];
  for (const text of corpus) fixtures.push(Buffer.from(text, 'utf8').toString('hex'));
  for (let i = 0; i < fuzzCases; i++) {
    const bytes = Buffer.alloc(random() % 129);
    for (let j = 0; j < bytes.length; j++) bytes[j] = random() & 255;
    fixtures.push(bytes.toString('hex'));
  }
  // Every initial byte value is exercised under all three C length contracts.
  for (let i = 0; i < 256; i++) fixtures.push(Buffer.from([i, 0x80, 0x41]).toString('hex'));
  const requests = fixtures.flatMap(utf8Hex => ['c-string', 'nul-terminated', 'bounded'].map(termination => ({ utf8Hex, termination })));
  const classificationPoints = [0, 0x49, 0x130, 0x131, 0xd800, 0xdfff, 0xffff, 0x10000, 0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff];
  const requestRecord = JSON.stringify({ schemaVersion: 1, seed, fuzzCases, requests }, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestRecord);
  provenance.requestsSha256 = hash(requestRecord);
  let tested = 0;
  let tableHash = null;
  let active = null;
  try {
    for (let i = 0; i < requests.length; i += 64) {
      const batch = requests.slice(i, i + 64);
      const expected = batch.map(request => oracle(request, { reference: false }));
      for (let j = 0; j < batch.length; j++) {
        active = { kind: 'decoder', caseIndex: i + j, request: batch[j] };
        assert.deepEqual(jsDecode(Buffer.from(batch[j].utf8Hex, 'hex'), batch[j].termination), expected[j].decode);
        tested++;
      }
    }
    for (const dotlessI of [false, true]) {
      active = { kind: 'classify-extra', request: { classify: classificationPoints, dotlessI } };
      const expected = oracle(active.request, { reference: false });
      assert.deepEqual(classificationPoints.map(cp => jsClassify(cp, dotlessI)), expected.classifications);
    }
    if (fullTable) {
      const table = exportUnicodeTable({ reference: false });
      tableHash = hash(table);
      const actual = {};
      for (let cp = 0; cp < 0x110000; cp++) {
        active = { kind: 'classify-all', codepoint: cp };
        assert.deepEqual(jsClassify(cp, false, actual), unpackUnicodeTableRow(table, cp, cp));
      }
    }
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', seed, fuzzCases, ...provenance, active, error: String(error) }, null, 2) + '\n');
    throw error;
  }
  const summary = { schemaVersion: 1, status: 'passed', kind: 'M01-direct-C-JS-differential', seed, fuzzCases, decoderCases: tested,
    unicodeClassifications: fullTable ? 0x110000 : 0, extendedClassifications: classificationPoints.length * 2,
    classificationTableSha256: tableHash, ...provenance, requestArtifact: 'requests.json', scope: 'UTF-8 decoder/common classifications and encoding/UCD case; no clause or pronunciation implementation' };
  rmSync(path.join(directory, 'failure.json'), { force: true });
  writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-unicode/verify.mjs');
  console.log(JSON.stringify(verifyUnicode(), null, 2));
}
