import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, fileHash, sha256 } from './trace-build-info.mjs';
import { createAccentOracle } from './accent.mjs';
import { createDictionaryOracle } from './dictionary.mjs';
import { loadDictionary, createDictionarySession } from '../../src/core/dictionary.js';
import { createLetterAccentLookup } from '../../src/core/letter-accent.js';
import { ACCENT_PROFILE } from '../../data/accent/tables.js';

mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/oracle-accent-'));
const dictionary = loadDictionary(new Uint8Array(readFileSync(path.join(root, 'data/dictionary/en_dict.bin'))), JSON.parse(readFileSync(path.join(root, 'data/dictionary/manifest.json'))));
const oracle = createAccentOracle(), dictionaryOracle = createDictionaryOracle();
const state = s => ({ repeatCount: s.repeatCount, repeatHex: Buffer.from(s.repeat).toString('hex'), skipWords: s.skipWords });
function session(options) {
  let accent;
  const dictionarySession = createDictionarySession(dictionary, { lookupAccentedLetter: (cp, initial) => accent(cp, initial) });
  accent = createLetterAccentLookup(dictionarySession, options);
  return { dictionarySession, accent };
}
const cases = [], exceptions = [];
let active = null;
try {
  assert.deepEqual(oracle({}).profile, ACCENT_PROFILE);
  const points = [...Array.from({ length: 0x300 }, (_, i) => i), 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x10ffff, 0x110000, 0x7fffffff, 0x80000000, 0xffffffff];
  let comparisons = 0, dictionaryComparisons = 0, dictionaryAccentComparisons = 0;
  for (const accents of [0, 1]) for (const initialHex of ['', '0102030004']) {
    // U+0252 needs TranslateRules for its basic Greek alpha name; keep it as
    // a separate dependency exception, never in the exact pass denominator.
    const request = { accents, letters: points.filter(cp => cp !== 0x252).map(codepoint => ({ codepoint, initialHex })) };
    active = request;
    const expected = oracle(request); assert.deepEqual(expected, oracle(request));
    const { dictionarySession, accent } = session({ accents });
    for (let i = 0; i < request.letters.length; i++) {
      const entry = request.letters[i], before = state(dictionarySession.state());
      const actual = { codepoint: entry.codepoint, stateBefore: before, phonemesHex: Buffer.from(accent(entry.codepoint, new Uint8Array(Buffer.from(initialHex, 'hex')))).toString('hex'), stateAfter: state(dictionarySession.state()) };
      assert.deepEqual(actual, expected.result[i], `Accent ${entry.codepoint.toString(16)} / accents=${accents} / initial=${initialHex}`);
      comparisons++;
    }
    cases.push({ accents, initialHex, cases: request.letters.length, responseSha256: sha256(JSON.stringify(expected)) });
  }
  const missingRequest = { letters: [0x252] };
  const missingC = oracle(missingRequest);
  assert.throws(() => session().accent(0x252), error => error.code === 'ACCENT_UNSUPPORTED' && error.reason === 'translate-rules-letter');
  exceptions.push({ codepoint: 0x252, reason: 'translate-rules-letter', cResult: missingC.result[0] });
  const dictCases = ['à ', 'á ', 'ç ', 'é ', 'ê ', 'ä ', 'ë ', 'ï ', 'ö ', 'ü ', 'û ', 'č ', 'š ', 'ş ', 'ž ', 'ñ '];
  for (const word of dictCases) {
    const request = { utf8Hex: Buffer.from(word).toString('hex'), repeats: 2 };
    active = request; const c = dictionaryOracle(request).result;
    const { dictionarySession } = session();
    try {
      for (let i = 0; i < 2; i++) {
        const r = dictionarySession.lookup(new Uint8Array(Buffer.from(word)));
        const actual = { stateBefore: state(r.stateBefore), found: r.found, flags: Array.from(r.flags), phonemesHex: Buffer.from(r.phonemes).toString('hex'), replacement: r.replacement, wordHex: Buffer.from(r.word).toString('hex'), stateAfter: state(r.stateAfter) };
        assert.deepEqual(actual, c[i], 'Dictionary accent callback ' + word); dictionaryComparisons++;
        if (c[i].flags[1] & 2048) dictionaryAccentComparisons++;
      }
    } catch (error) {
      if (word !== '_ɒ ' || error.code !== 'ACCENT_UNSUPPORTED' || error.reason !== 'translate-rules-letter') throw error;
      exceptions.push({ word, reason: error.reason, cResult: c });
    }
  }
  for (const invalid of [null, [], { letters: [-1] }, { letters: [0x100000000] }, { letters: [{ codepoint: 65, initialHex: '0' }] }, { letters: [{ codepoint: 65, initialHex: 'ff'.repeat(160) }] }, { letters: Array(16385).fill(0) }, { accents: 256 }, { dictCondition: -1 }]) assert.throws(() => oracle(invalid));
  const report = { schemaVersion: 1, kind: 'original-C-vs-JS-lookup-accented-letter', status: 'passed-with-explicit-dependency-exceptions',
    reference: oracle({}).reference, profile: ACCENT_PROFILE, comparisons, dictionaryComparisons, dictionaryAccentComparisons, freshCRepeatsPerBatch: 2, cases, exceptions,
    sources: ['src/core/letter-accent.js', 'src/core/dictionary.js', 'data/accent/tables.js', 'data/accent/manifest.json', 'data/dictionary/en_dict.bin'].map(name => ({ path: name, sha256: fileHash(path.join(root, name)) })),
    limitation: 'TranslateRules for U+0252 is an explicit dependency. Lookup TEXTMODE requires supplied TranslateWord. Neither dependency is emulated by stored answers.' };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${comparisons} C/JS accent outputs and dictionary states, ${dictionaryComparisons} dictionary callback comparisons; U+0252 TranslateRules dependency explicit. Report: ${output}/report.json`);
} catch (error) {
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ active, error: error.stack }, null, 2) + '\n'); throw error;
}
