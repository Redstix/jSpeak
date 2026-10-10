import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { root, fileHash, sha256 } from '../oracle/trace-build-info.mjs';
import { createDictionaryOracle } from '../oracle/dictionary.mjs';
import { loadDictionary, createDictionarySession, transposeDictionaryWord, hashDictionary, DICTIONARY_CONSTANTS as F } from '../../src/core/dictionary.js';
import { createLetterAccentLookup } from '../../src/core/letter-accent.js';
import { TRANSPOSE_MAP } from '../../data/dictionary/profile.js';

const bytes = text => new Uint8Array(Buffer.from(text));
const hex = value => Buffer.from(value).toString('hex');
const state = value => ({ repeatCount: value.repeatCount, repeatHex: hex(value.repeat), skipWords: value.skipWords });
export function serializeDictionaryResult(value) {
  return { stateBefore: state(value.stateBefore), found: value.found, flags: Array.from(value.flags), phonemesHex: hex(value.phonemes), replacement: value.replacement, wordHex: hex(value.word), stateAfter: state(value.stateAfter) };
}
export function makeDictionaryCorpus() {
  const requests = [], seen = new Set();
  function add(text, settings = {}, category = 'context') {
    const request = { utf8Hex: hex(bytes(text)), ...settings }, key = JSON.stringify(request);
    if (!seen.has(key)) { seen.add(key); requests.push({ id: `dictionary-${requests.length}`, category, request }); }
  }
  const source = readFileSync(path.join(root, 'upstream/espeak-ng/dictsource/en_list'), 'utf8');
  for (const original of source.split('\n')) {
    const line = original.replace(/\/\/.*$/, '').trim().replace(/^\?!?\d+\s+/, '');
    if (!line || line[0] === '$') continue;
    const match = line.match(/^\(([^)]+)\)|^(\S+)/);
    if (!match) continue;
    const word = (match[1] || match[2]).replace(/[A-Z]/g, c => c.toLowerCase());
    add(word + ' ', {}, 'source-list');
    if (/\$text/.test(line)) add(word + ' ', { endFlags: F.FLAG_ALLOW_TEXTMODE }, 'textmode');
    if (/\$verb\b/.test(line)) add(word + ' ', { expectVerb: 1 }, 'verb');
    if (/\$noun\b/.test(line)) add(word + ' ', { expectNoun: 1 }, 'noun');
    if (/\$past\b/.test(line)) add(word + ' ', { expectPast: 1 }, 'past');
    if (/^\?!?\d/.test(original)) for (const dictCondition of [0, 8, 0xffffffff]) add(word + ' ', { dictCondition }, 'condition');
    if (match[1]) for (const emphasize of [-1, 0, 1]) {
      const words = word.split(' ').map((part, i) => ({ flags: i === emphasize ? F.FLAG_EMPHASIZED : 0, length: Buffer.byteLength(part) }));
      add(word + ' ', { words }, 'multiword');
    }
  }
  const contexts = [{}, { withWord: 1, wordFlags: F.FLAG_FIRST_UPPER }, { withWord: 1, wordFlags: F.FLAG_ALL_UPPER },
    { withWord: 1, wordFlags: F.FLAG_HAS_DOT }, { withWord: 1, wordFlags: F.FLAG_FIRST_WORD }, { expectVerb: 1 }, { expectNoun: 1 }, { expectPast: 1 },
    { expectVerbS: 1, endFlags: F.FLAG_SUFX | F.FLAG_SUFX_S }, { endFlags: F.FLAG_SUFX }, { endFlags: F.SUFX_P },
    { endFlags: F.FLAG_SUFX_E_ADDED }, { endFlags: F.SUFX_D }, { clauseTerminator: 0x80000 }, { native: false },
    { flags1: F.FLAG_LOOKUP_SYMBOL }, { flags0: 0x123400, flags1: 0x80000000 }];
  for (const word of ['hello', 'read', 'record', 'close', 'house', 'bow', 'a', 'what', 'when', 'us', 'un', 'km', 'dr', '²', '³', 'é', 'café', 'alpha', 'boogey', 'abstraction', 'make', 'runn', 'th', 'zzqzx', '.', '_!', '…', 'a . k . a .'])
    for (const setting of contexts) add(word + ' ', setting);
  for (const word of ['', ' ', 'Hi', 'HELLO', 'a\0ignored', 'a'.repeat(159), 'b'.repeat(160), 'c'.repeat(4096), 'é'.repeat(100), 'a . '.repeat(100), '中', '한', '😀']) add(word, {}, 'boundary');
  for (const word of ['.', '!', '?', '=', '€', '_a', 'é', 'bow down ', 'the ']) add(word, { repeats: 6 }, 'repeat');
  for (const word of ['a next ', 'the next ', 'at next ', 'to next ', 'é next ']) for (const clauseEnd of [0, 2, Buffer.byteLength(word)]) add(word, { clauseEnd }, 'clause-end');
  let seed = 0xd1c710aa;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const alphabet = Array.from('abcdeéèïxyz01239.-_!?');
  for (let i = 0; i < 512; i++) {
    let word = ''; const length = 1 + random() % 80;
    for (let n = 0; n < length; n++) word += alphabet[random() % alphabet.length];
    add(word + ' ', contexts[random() % contexts.length], 'seeded-fuzz');
  }
  for (const word of ['', 'hello', 'read', 'a', 'café', 'HELLO', 'é', 'a'.repeat(159), 'é'.repeat(79), 'hello\0tail', '😀', '中', '-foo']) add(word, { operation: 'transpose' }, 'transpose');
  for (let cp = 0; cp <= 0x200; cp++) add(String.fromCodePoint(cp), { operation: 'transpose' }, 'transpose-range');
  return requests;
}
function sourceSnapshot() {
  return ['src/core/dictionary.js', 'src/data/binary.js', 'src/core/letter-accent.js', 'src/core/utf8-scan.js', 'src/core/unicode.js',
    'data/dictionary/en_dict.bin', 'data/dictionary/manifest.json', 'data/dictionary/profile.js', 'data/accent/tables.js', 'data/unicode/tables.js',
    'tools/compare/dictionary.mjs', 'tools/oracle/dictionary.mjs', 'tools/oracle/dictionary-oracle.c', 'upstream/espeak-ng/dictsource/en_list']
    .map(name => ({ path: name, sha256: fileHash(path.join(root, name)) }));
}
export function verifyDictionary() {
  const dictionary = loadDictionary(bytesFromFile('data/dictionary/en_dict.bin'), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
  const oracle = createDictionaryOracle(), profile = oracle({ operation: 'profile' });
  assert.deepEqual(profile.result, { voice: 'en-us', translatorName: 25966, dictCondition: 72, transposeMin: 96, transposeMax: 383, textmode: false, frequentPairsPresent: false, maxWordBytes: 160, maxPhonemeBytes: 160, phonemeTable: 80, transposeMap: Array.from(TRANSPOSE_MAP) });
  const requests = makeDictionaryCorpus(), snapshot = sourceSnapshot();
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const output = mkdtempSync(path.join(root, 'artifacts/dictionary-differential-'));
  writeFileSync(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
  let active, lookupComparisons = 0, transposeComparisons = 0, cleanComparisons = 0, repeatComparisons = 0, contextComparisons = 0;
  const categories = {}, decisions = { found: 0, missing: 0, attributesOnly: 0, textReplacement: 0, multiword: 0, accent: 0 };
  try {
    for (let index = 0; index < requests.length; index++) {
      active = requests[index]; const expected = oracle(active.request);
      if (index % 17 === 0) { assert.deepEqual(oracle(active.request, { reference: true }), expected); cleanComparisons++; }
      if (index % 31 === 0) { assert.deepEqual(oracle(active.request), expected); repeatComparisons++; }
      const request = expected.request, input = new Uint8Array(Buffer.from(request.utf8Hex, 'hex'));
      if (request.operation === 'transpose') {
        const actual = transposeDictionaryWord(input), end = actual.bytes.indexOf(0);
        assert.deepEqual({ originalHash: hashDictionary(input), length: actual.length, hash: hashDictionary(actual.bytes), bufferHex: hex(actual.bytes.subarray(0, end < 0 ? actual.bytes.length : end)) }, expected.result, active.id);
        transposeComparisons++;
      } else {
        let accent;
        const session = createDictionarySession(dictionary, { lookupAccentedLetter: (cp, initial) => accent(cp, initial) });
        accent = createLetterAccentLookup(session, { dictCondition: request.dictCondition });
        // Exercise public JS defaults directly; do not copy normalized C defaults
        // into JS, which would hide default-context discrepancies for embedded NUL.
        const { operation, utf8Hex, repeats, ...settings } = active.request;
        for (let i = 0; i < request.repeats; i++) {
          const result = session.lookup(input, settings), actual = serializeDictionaryResult(result);
          assert.deepEqual(actual, expected.result[i], `${active.id} / repeat ${i}`); lookupComparisons++;
          decisions[result.found ? 'found' : 'missing']++;
          if (!result.found && (result.flags[0] & F.FLAG_FOUND_ATTRIBUTES)) decisions.attributesOnly++;
          if (result.replacement) decisions.textReplacement++;
          if (result.flags[0] & F.FLAG_SKIPWORDS) decisions.multiword++;
          if (result.flags[1] & F.FLAG_ACCENT) decisions.accent++;
        }
        if (index % 19 === 0) {
          let nestedAccent;
          const shared = createDictionarySession(dictionary, { lookupAccentedLetter: (cp, initial) => nestedAccent(cp, initial) });
          nestedAccent = createLetterAccentLookup(shared);
          const sharedSettings = { ...settings }, context = {};
          for (const field of ['dictCondition', 'expectVerb', 'expectVerbS', 'expectNoun', 'expectPast', 'prevDictFlags', 'clauseTerminator']) {
            context[field] = request[field];delete sharedSettings[field];
          }
          shared.setContext(context);
          for (let i = 0; i < request.repeats; i++) {
            assert.deepEqual(serializeDictionaryResult(shared.lookup(input, sharedSettings)), expected.result[i], `${active.id} inherited context / repeat ${i}`);contextComparisons++;
          }
        }
      }
      categories[active.category] = (categories[active.category] || 0) + 1;
      appendFileSync(path.join(output, 'oracle.jsonl'), JSON.stringify({ id: active.id, expected }) + '\n');
      if ((index + 1) % 1000 === 0) console.log(`Dictionary ${index + 1}/${requests.length} exact`);
    }
    assert.deepEqual(sourceSnapshot(), snapshot, 'Dictionary sources changed during comparison');
    assert.deepEqual(createDictionaryOracle()({ operation: 'profile' }), profile);
    const report = { schemaVersion: 1, status: 'passed', kind: 'original-C-vs-JS-dictionary', reference: profile.reference, profile: profile.result,
      requests: requests.length, lookupComparisons, transposeComparisons, cleanComparisons, repeatComparisons, contextComparisons, categories, decisions,
      dictionary: { entryCount: dictionary.entryCount, rulesOffset: dictionary.rulesOffset, twoLetterGroups: dictionary.groups2Used, byteLength: dictionary.bytes.length },
      sources: snapshot, requestsSha256: fileHash(path.join(output, 'requests.json')), oracleSha256: fileHash(path.join(output, 'oracle.jsonl')),
      limitations: ['Fixed initialized en-us dictionary profile; U+0252 accent fallback requires TranslateRules and is verified separately as an explicit dependency.', 'LookupDictList alone does not implement TranslateWord or its text-replacement recursion.'] };
    writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS: ${lookupComparisons} lookups, ${transposeComparisons} transpositions. Report: ${output}/report.json`);
    return report;
  } catch (error) { writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ active, error: error.stack }, null, 2) + '\n'); throw error; }
}
function bytesFromFile(name) { return new Uint8Array(readFileSync(path.join(root, name))); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyDictionary();
