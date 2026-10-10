import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, referenceBuild, sha256 } from './trace-build-info.mjs';
import { createWordOracle, wordStateFields } from './word.mjs';
import { validateWordBuild } from './word-build-info.mjs';
import { validateWordObserverBuild, wordObserverBinary } from './word-observer-build-info.mjs';
import { makeTraceCorpus } from './trace-corpus.mjs';

if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/word-selfcheck.mjs');
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/oracle-word-'));
const oracle = createWordOracle(), helper = validateWordBuild(), observer = validateWordObserverBuild();
let active = null;
const captures = [], replayed = [], excluded = [];
try {
  const extra = ['boogey', 'boogey hello', 'running runners stopped studies', 'a the to of and', 'read record object present', 'I read it. I have read it.',
    'hello NASA USA B.B.C.', 'é è ɑ ɒ ß', '12 100 1000 23rd 4.5 2026', 'IV IX XL MMXXVI', "cat’s dog\'s can\'t", '\x0118YAb12', '\x0136Ykey', 'foo@example.com https://example.com']
    .map((text, i) => ({ id: 'word-extra-' + i, bytes: Buffer.from(text) }));
  const corpus = [...makeTraceCorpus(), ...extra];
  for (const entry of corpus) {
    active = { id: entry.id, utf8Hex: entry.bytes.toString('hex') };
    const directory = path.join(output, entry.id); mkdirSync(directory);
    function cli(observed) {
      const label = observed ? 'observer' : 'reference', wav = path.join(directory, label + '.wav'), trace = path.join(directory, 'trace.jsonl');
      const mnemonic = execFileSync(observed ? wordObserverBinary : path.join(referenceBuild, 'src/espeak-ng'),
        ['-D', '-b', '1', '-v', 'en-us', '-s', '175', '-p', '50', '-a', '100', '--stdin', '-x', '-w', wav], {
          input: entry.bytes, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, ESPEAK_DATA_PATH: referenceBuild, JSPEAK_TRACE_FILE: '', JSPEAK_WORD_TRACE_FILE: observed ? trace : '', LC_ALL: 'C' }
        });
      return { mnemonic, wavSha256: existsSync(wav) ? sha256(readFileSync(wav)) : null };
    }
    const expected = cli(false); assert.deepEqual(cli(true), expected, entry.id + ': observer changes complete CLI result');
    const tracePath = path.join(directory, 'trace.jsonl');
    const events = existsSync(tracePath) ? readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    captures.push({ ...active, ...expected, events: events.length });
    const pending = new Map();
    for (const event of events) {
      assert.equal(event.schemaVersion, 1);
      if (event.phase === 'enter') { assert(!pending.has(event.id)); pending.set(event.id, event); continue; }
      assert.equal(event.phase, 'exit'); const before = pending.get(event.id); assert(before); pending.delete(event.id);
      const source = Buffer.from(before.utf8Hex, 'hex');
      const reasons = [];
      if (!before.state.native || before.translatorName !== 25966 || before.state.phonemeTable !== 80) reasons.push('different-translator-or-table');
      if (before.state.clauseEnd === null) reasons.push('clause-end-outside-source');
      if (source.length < 1 || source.length > 4096 || source.at(-1) !== 32) reasons.push('source-not-space-terminated');
      if (before.capacity !== 200) reasons.push('different-phoneme-capacity');
      if (before.anyStressedWords === null) reasons.push('null-any-stressed-pointer');
      if (before.bufferHex === null) reasons.push('no-original-clause-buffer');
      if (reasons.length) { excluded.push({ id: entry.id, call: before.id, depth: before.depth, reasons }); continue; }
      const request = { operation: 'word3', bufferHex: before.bufferHex, offset: before.offset, utf8Hex: before.utf8Hex, prefixHex: before.prefixHex, words: before.words, remaining: before.remaining,
        wordOut: before.wordOut, anyStressedWords: before.anyStressedWords, alphabetCodepoint: before.alphabetCodepoint, initialPhonemesHex: before.phonemesHex,
        state: Object.fromEntries([...wordStateFields, 'repeatHex'].map(key => [key, before.state[key]])) };
      active = { id: entry.id, call: before.id, request };
      const response = oracle(request), actual = response.result;
      assert.equal(response.status, 'ok'); assert.equal(response.diagnostic, null);
      const wanted = { stateBefore: before.state, wordsBefore: before.words, flags: event.flags, phonemesHex: event.phonemesHex,
        wordOutHex: event.wordOutHex, prefixAfterHex: event.prefixHex, wordAfterHex: event.utf8Hex, bufferAfterHex: event.bufferHex,
        wordsAfter: event.words, stateAfter: event.state, anyStressedWords: event.anyStressedWords };
      assert.deepEqual(actual, wanted, entry.id + ':' + before.id + ': independent original call differs from live CLI');
      assert.deepEqual(response, oracle(request), entry.id + ':' + before.id + ': fresh process differs');
      replayed.push({ id: entry.id, call: before.id, depth: before.depth, response });
    }
    assert.equal(pending.size, 0);
  }
  const direct = [];
  for (const word of ['hello', 'boogey', 'running', 'studies', 'café', 'ɒ', 'read', '42', 'NASA']) {
    for (const operation of ['word', 'word3']) for (const wordOut of [true, false]) {
      const response = oracle({ operation, utf8Hex: Buffer.from(word + ' ').toString('hex'), wordOut });
      assert.deepEqual(response, oracle(response.request)); direct.push({ word, response });
    }
  }
  const replaced = direct.find(row => row.word === 'boogey' && row.response.request.operation === 'word' && row.response.request.wordOut).response.result;
  const single = direct.find(row => row.word === 'boogey' && row.response.request.operation === 'word3' && row.response.request.wordOut).response.result;
  assert.equal(single.wordOutHex, Buffer.from('boogie ').toString('hex')); assert.equal(single.phonemesHex, '');
  assert.equal(replaced.wordOutHex, single.wordOutHex); assert.notEqual(replaced.phonemesHex, '');
  const bounded = [];
  for (const word of ['hello', 'boogey', 'running', 'read']) {
    const request = { operation: 'withBounds', utf8Hex: Buffer.from(word + ' ').toString('hex'), remaining: 0 };
    const response = oracle(request), publicResponse = oracle({ ...request, operation: 'word' });
    assert.equal(response.status, 'ok');
    assert.deepEqual({ ...response.result, anyStressedWords: null }, publicResponse.result, 'Bounds zero must call the original public wrapper semantics');
    bounded.push(response);
  }
  for (const anyStressedWords of [false, true]) {
    const response = oracle({ operation: 'withBounds', utf8Hex: Buffer.from('boogey hello ').toString('hex'), words: [{}, {}], remaining: 2, anyStressedWords });
    assert.equal(response.status, 'ok'); assert.equal(response.result.phonemesHex, replaced.phonemesHex);
    assert.deepEqual(response, oracle(response.request)); bounded.push(response);
  }
  const undefinedCases = [];
  for (const word of ['key', 'abc']) {
    const request = { utf8Hex: Buffer.from(word + ' ').toString('hex'), state: { optionSayas: 36 } };
    const response = oracle(request); assert.equal(response.status, 'undefined-upstream-behavior'); assert.equal(response.result, null);
    assert.equal(response.diagnostic.code, 'WORD_SOURCE_UNDERFLOW'); assert.equal(response.diagnostic.relativeIndex, -1);
    assert.deepEqual(response, oracle(request));
    assert.equal(oracle({ ...request, prefixHex: '2020' }).status, 'ok'); undefinedCases.push(response);
  }
  const invalid = [{}, { utf8Hex: '61' }, { utf8Hex: '610020' }, { utf8Hex: '6120', prefixHex: '00' }, { utf8Hex: '6120', words: [], remaining: 1 },
    { utf8Hex: '6120', operation: 'word', words: [] }, { utf8Hex: '6120', operation: 'word', remaining: 1 }, { utf8Hex: '6120', state: { clauseEnd: 3 } },
    { utf8Hex: '6120', words: [{ flags: -1 }] }, { utf8Hex: '6120', anyStressedWords: 0 }, { utf8Hex: '6120', state: { fake: 1 } }];
  invalid.forEach(request => assert.throws(() => oracle(request)));
  assert.deepEqual(validateWordBuild(), helper); assert.deepEqual(validateWordObserverBuild(), observer);
  writeFileSync(path.join(output, 'captures.json'), JSON.stringify(captures, null, 2) + '\n');
  writeFileSync(path.join(output, 'replays.json'), JSON.stringify(replayed, null, 2) + '\n');
  writeFileSync(path.join(output, 'direct.json'), JSON.stringify(direct, null, 2) + '\n');
  writeFileSync(path.join(output, 'bounded.json'), JSON.stringify(bounded, null, 2) + '\n');
  writeFileSync(path.join(output, 'undefined.json'), JSON.stringify(undefinedCases, null, 2) + '\n');
  const report = { schemaVersion: 1, kind: 'clean-original-word-oracle-cli-replay-not-C-JS-compatibility', status: 'passed',
    reference: direct[0].response.reference, observerFingerprint: observer.fingerprint, profile: direct[0].response.profile,
    cliTransparencyCases: captures.length, cliTransparencyOutputs: 'exact mnemonic and complete WAV bytes', observedCalls: captures.reduce((sum, row) => sum + row.events / 2, 0),
    replayedCalls: replayed.length, freshRunsPerReplay: 2, excludedCalls: excluded.length, exclusions: excluded, directCases: direct.length, boundedCases: bounded.length,
    undefinedSourceCases: undefinedCases.length, invalidNodeRequests: invalid.length,
    limitations: ['Direct word3 uses nonnull any_stressed_words and 200-byte phoneme capacity.', 'Each direct request starts a fresh fixed en-us process; complete original clause bytes and explicit caller state are reconstructed.',
      'External-buffer clause_end, nonnative calls and calls without a verified original clause buffer are recorded but not replayed.', 'CLI observer preserves original libraries and uses GNU ld --wrap=TranslateWord3; internal same-object calls may not cross the wrapper.',
      'These are original C oracle/transparency checks, not proof of a complete JS TranslateWord implementation.'] };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${captures.length} exact CLI mnemonic/WAV cases; ${replayed.length} calls replayed, ${excluded.length} explicitly excluded; ${direct.length} direct word/word3 cases.`);
  console.log('Report: ' + path.join(output, 'report.json'));
} catch (error) { writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ active, error: error.stack }, null, 2) + '\n'); throw error; }
