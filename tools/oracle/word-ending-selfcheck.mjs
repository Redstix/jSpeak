import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, fileHash, sha256 } from './trace-build-info.mjs';
import { createWordEndingOracle } from './word-ending.mjs';
import { removeEnding, WORD_ENDING_PROFILE } from '../../src/core/word-ending.js';

export function makeWordEndingCorpus() {
  const requests = [];
  const add = (word, endType, settings = {}) => requests.push({ wordHex: Buffer.from(word).toString('hex'), endType, expectVerb: 0, copyWord: true, ...settings });
  const words = ['testing', 'hoped', 'tried', 'dogs', "dog's", 'missions', 'sponges', 'ranged', 'larger', 'dancing', 'cursing', 'firing', 'curing', 'bathing', 'sensing', 'bluing', 'bites', 'Eats', 'SEEinG', 'café', 'café雪𝄞', '', 'a', 'ion', ' '];
  const flags = [0, 0x100, 0x200, 0x800, 0x300, 0x900, 0xa00, 0xb00, 0xff00, -8382464];
  for (const word of words) {
    const count = [...word.split(' ')[0]].length;
    for (let length = 0; length <= count; length++) for (const flag of flags) add(word, flag | length);
  }
  for (const prefix of ['a', 'E', 'ion', 'spong', 'café', '雪']) {
    for (let length = 0; length < 64; length++) {
      for (const flag of flags) add(prefix + 's'.repeat(length), flag | length, { expectVerb: length % 3 === 0 ? -7 : length % 3, copyWord: length % 2 === 0 });
    }
  }
  for (const length of [0, 1, 2, 48, 49, 50, 62, 63, 64, 158, 159, 160, 161, 199, 256, 1024]) {
    for (const letter of ['a', 'E', '雪', '𝄞']) for (const removed of [0, 1, 16, 48, 49, 50, 63].filter(n => n <= length)) {
      add(letter.repeat(length), removed | 0x900);
      add(letter.repeat(length), removed, { copyWord: false, expectVerb: 99 });
    }
  }
  for (const word of ['cats tail', 'Eats EATS', 'hoped\0ignored', 'cats\0']) for (const flag of flags) add(word, flag | 1);
  for (const bytes of [[0x61, 0x80], [0x61, 0x80, 0x80], [0x61, 0xff, 0x80], [0x61, 0xc0, 0xbf], [0x61, 0x80, 0x73], [0x61, 0xfe, 0xff]]) {
    for (const flag of flags) add(bytes, flag | 1);
  }
  let random = 0x5eedbe02;
  const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return random >>> 0; };
  for (let i = 0; i < 2048; i++) {
    const bytes = [0x61];
    for (let j = next() % 160; j > 0; j--) { const b = next() & 255; bytes.push(b === 0 || b === 32 ? 69 : b); }
    const characters = bytes.filter(b => (b & 0xc0) !== 0x80).length;
    add(bytes, (next() & ~63) | (next() % Math.min(64, characters + 1)), { expectVerb: next() | 0, copyWord: Boolean(next() & 1) });
  }
  return requests;
}

export function verifyWordEnding({ directory } = {}) {
  const names = ['src/core/word-ending.js', 'src/core/unicode.js', 'data/word-ending/profile.js', 'data/word-ending/manifest.json', 'data/rules/profile.js', 'data/dictionary/profile.js', 'tools/oracle/word-ending.mjs', 'tools/oracle/word-ending-selfcheck.mjs'];
  const snapshot = () => names.map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
  const files = snapshot(), oracle = createWordEndingOracle(), initial = oracle();
  assert.deepEqual(initial.profile, WORD_ENDING_PROFILE);
  const requests = makeWordEndingCorpus();
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/word-ending-')); }
  mkdirSync(directory, { recursive: true });
  const requestBytes = JSON.stringify(requests, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestBytes);
  let active = null;
  try {
    for (let offset = 0; offset < requests.length; offset += 256) {
      const rows = requests.slice(offset, offset + 256);
      active = { batchOffset: offset };
      const reference = oracle(rows);
      assert.deepEqual(reference.reference, initial.reference); assert.deepEqual(reference.profile, WORD_ENDING_PROFILE);
      rows.forEach((row, index) => {
        active = { index: offset + index, request: row };
        const result = removeEnding(Buffer.from(row.wordHex, 'hex'), row.endType, WORD_ENDING_PROFILE, row);
        const actual = { wordHex: Buffer.from(result.word).toString('hex'), wordCopyHex: result.wordCopy === null ? null : Buffer.from(result.wordCopy).toString('hex'), endFlags: result.endFlags, expectVerb: result.expectVerb };
        assert.deepEqual(actual, reference.results[index], `C RemoveEnding ${offset + index}`);
      });
    }
    assert.deepEqual(snapshot(), files, 'Word-ending sources changed during verification');
    assert.deepEqual(createWordEndingOracle()().reference, initial.reference, 'Word-ending C reference changed during verification');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', active, error: error.stack, files, reference: initial.reference }, null, 2) + '\n');
    error.message += '\nFailure artifact: ' + path.join(directory, 'failure.json');
    throw error;
  }
  const report = { schemaVersion: 1, status: 'passed', scope: 'Initialized en-us public RemoveEnding; byte mutation, suffix flags, original copy and expect_verb', cases: requests.length,
    requestsSha256: sha256(requestBytes), files, reference: initial.reference, profile: initial.profile, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/word-ending-selfcheck.mjs');
  console.log(JSON.stringify(verifyWordEnding(), null, 2));
}
