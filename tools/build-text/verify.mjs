import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, fileHash, sha256 } from '../oracle/trace-build-info.mjs';
import { createTokenizerOracle } from '../oracle/tokenizer.mjs';
import { readForward, readBackward } from '../../src/core/utf8-scan.js';
import { createTextCharacterSession, alphabetFromChar, shouldSplitIdeographs } from '../../src/core/text-character.js';
import { encodeUtf8, toUpperCodePoint } from '../../src/core/unicode.js';
import { ALPHABETS, REPLACEMENT_BYTES } from '../../data/text/tables.js';
import { decodeReplacementStream } from './build.mjs';

export function makeTextPrimitiveCorpus() {
  const scans = [], translations = [], splits = [], alphabets = new Set([0, 0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff]);
  for (let first = 0; first < 256; first++) {
    for (const tails of [[], [0x80], [0x41], [0x80, 0x80], [0x41, 0xbf], [0xbf, 0xbf, 0xbf]]) {
      const bytes = Buffer.from([32, first, ...tails, 0]);
      scans.push({ bytesHex: bytes.toString('hex'), offset: 1, backwards: false });
      scans.push({ bytesHex: bytes.toString('hex'), offset: bytes.length - 2, backwards: true });
    }
  }
  for (const raw of [[32, 0x80, 0xbf, 0xc3, 0xa9, 0], [0xed, 0xa0, 0x80, 0], [0xf7, 0xbf, 0xbf, 0xbf, 0], [0xf8, 0], [0xff, 0]]) {
    for (let offset = 0; offset < raw.length; offset++) {
      scans.push({ bytesHex: Buffer.from(raw).toString('hex'), offset, backwards: false });
      scans.push({ bytesHex: Buffer.from(raw).toString('hex'), offset, backwards: true });
    }
  }
  const add = (codepoint, nextIn = 32, insert = 0, wordFlags = 0) => {
    const encoded = encodeUtf8(Uint32Array.of(nextIn, 0));
    const source = Buffer.concat([Buffer.from([32]), Buffer.from(encoded), Buffer.alloc(4)]);
    translations.push({ sourceHex: source.toString('hex'), nextOffset: 1, prevIn: 32, codepoint, nextIn, insert, wordFlags });
  };
  for (let cp = 0; cp < 256; cp++) add(cp);
  for (let cp = 0xabff; cp <= 0xd7b0; cp++) add(cp);
  for (let cp = 0x312f; cp <= 0x3164; cp++) add(cp);
  for (const entry of decodeReplacementStream(REPLACEMENT_BYTES)) {
    const cp = readForward(Uint8Array.from([...entry.from, 0]), 0).codepoint;
    for (const c of new Set([cp, toUpperCodePoint(cp)])) for (const next of [32, 65, 97, 0x391, 0x3b1]) add(c, next, 123, 0x80000040);
  }
  for (const cp of [0, 0xd800, 0xdfff, 0xfffd, 0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff]) add(cp, 65, 123, 0x80000040);
  for (const table of ALPHABETS) {
    for (const cp of [table.rangeMin - 1, table.rangeMin, table.rangeMin + 1, table.rangeMax - 1, table.rangeMax, table.rangeMax + 1]) alphabets.add(cp);
  }
  for (const cp of alphabets) for (const previous of [32, 0x3041, 0x4e00]) splits.push({ codepoint: cp, previous });
  return { scans, translations, splits, alphabets: [...alphabets].sort((a, b) => a - b) };
}

export function verifyTextPrimitives({ directory } = {}) {
  const names = ['src/core/utf8-scan.js', 'src/core/text-character.js', 'src/core/unicode.js', 'data/text/tables.js', 'data/text/manifest.json',
    'data/unicode/tables.js', 'data/unicode/manifest.json', 'tools/build-text/verify.mjs', 'tools/build-text/build.mjs', 'tools/oracle/tokenizer.mjs'];
  const snapshot = () => names.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
  const files = snapshot(), requests = makeTextPrimitiveCorpus();
  const oracle = createTokenizerOracle(), initial = oracle({});
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/text-primitives-')); }
  mkdirSync(directory, { recursive: true });
  const requestBytes = JSON.stringify(requests, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestBytes);
  let active = null;
  try {
    const expected = oracle(requests);
    assert.deepEqual(expected.reference, initial.reference);
    assert.deepEqual(expected.profile, initial.profile);
    assert.deepEqual(expected.request, requests);
    assert.equal(expected.scans.length, requests.scans.length);
    assert.equal(expected.translations.length, requests.translations.length);
    assert.equal(expected.splits.length, requests.splits.length);
    assert.equal(expected.alphabets.length, requests.alphabets.length);
    requests.scans.forEach((row, index) => {
      active = { kind: 'scan', index, request: row };
      const actual = (row.backwards ? readBackward : readForward)(Buffer.from(row.bytesHex, 'hex'), row.offset);
      assert.deepEqual({ codepoint: actual.codepoint, bytes: actual.bytes }, expected.scans[index], `C utf8_in2 scan ${index}`);
    });
    const session = createTextCharacterSession();
    requests.translations.forEach((row, index) => {
      active = { kind: 'translate', index, request: row };
      const actual = session.translate(Buffer.from(row.sourceHex, 'hex'), row.nextOffset, row.prevIn, row.codepoint, row.nextIn, row.insert, row.wordFlags);
      assert.deepEqual(actual, expected.translations[index], `C TranslateChar ${index}`);
    });
    requests.splits.forEach((row, index) => {
      active = { kind: 'split', index, request: row };
      assert.equal(shouldSplitIdeographs(row.codepoint, row.previous), expected.splits[index], `C ShouldSplitIdeographs ${index}`);
    });
    requests.alphabets.forEach((cp, index) => {
      active = { kind: 'alphabet', index, codepoint: cp };
      assert.deepEqual(alphabetFromChar(cp), expected.alphabets[index], `C AlphabetFromChar U+${cp.toString(16)}`);
    });
    assert.deepEqual(snapshot(), files, 'JS/data/verification sources changed during primitive comparison');
    const after = createTokenizerOracle()({});
    assert.deepEqual(after.reference, initial.reference, 'C primitive reference changed');
    assert.deepEqual(after.profile, initial.profile, 'C primitive profile changed');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', active, error: error.stack, files, reference: initial.reference }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + path.join(directory, 'failure.json');
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed', scope: 'Fixed en-us UTF-8 scanner, TranslateChar, alphabet and ideograph primitives',
    scans: requests.scans.length, translations: requests.translations.length, splits: requests.splits.length, alphabets: requests.alphabets.length,
    requestsSha256: sha256(requestBytes), files, reference: initial.reference, profile: initial.profile, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/build-text/verify.mjs');
  console.log(JSON.stringify(verifyTextPrimitives(), null, 2));
}
