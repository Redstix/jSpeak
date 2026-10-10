import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createTokenizerOracle } from './tokenizer.mjs';
import { createClauseOracle } from './clause.mjs';
import { tokenizerBinary, tokenizerBuild } from './tokenizer-build-info.mjs';
import { root, referenceBuild, sha256 } from './trace-build-info.mjs';
import { makeTraceCorpus } from './trace-corpus.mjs';
import { validateTrace } from '../compare/trace.mjs';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--trace-dir')) throw new Error('Usage: node tools/oracle/tokenizer-selfcheck.mjs [--trace-dir ARTIFACT_DIRECTORY]');
const traceDirectory = args.length ? path.resolve(args[1]) : null;
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const output = mkdtempSync(path.join(root, 'artifacts/oracle-tokenizer-'));
const oracle = createTokenizerOracle(), clauseOracle = createClauseOracle();
let activeRequest = null;
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const clauseKeys = ['startCharacter', 'startWord', 'sourceHex', 'charixTop', 'charix', 'terminator', 'tone'];
try {
  const invalid = [null, [], { unknown: 1 }, { utf8Hex: '0' }, { utf8Hex: 'AA' }, { utf8Hex: '61'.repeat(65537) },
    { scans: [{ bytesHex: '80', backwards: true }] }, { scans: [{ bytesHex: '', offset: 1 }] }, { scans: [{ bytesHex: '61', backwards: 1 }] },
    { scans: [{ bytesHex: '', offset: 0.5 }] }, { scans: Array(16385).fill({ bytesHex: '' }) }, { translations: [{ codepoint: -1 }] },
    { translations: [{ codepoint: 65, wordFlags: -1 }] }, { translations: [{ codepoint: 65, nextOffset: 1 }] }, { splits: [{ codepoint: 0x100000000 }] },
    { alphabets: [NaN] }, { alphabets: Array(16385).fill(0) }];
  for (const request of invalid) assert.throws(() => oracle(request));
  function packed(...values) { const b = Buffer.alloc(values.length * 4); values.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; }
  const malformedFrames = [
    ['scan', Buffer.alloc(0)], ['scan', packed(16385)], ['scan', packed(1, 65537, 0, 0)],
    ['scan', packed(1, 0, 1, 0)], ['scan', packed(1, 0, 0, 2)], ['scan', Buffer.concat([packed(1, 1, 0, 1), Buffer.from([0x80])])],
    ['scan', Buffer.concat([packed(0), Buffer.from([0])])], ['translate', packed(1, 0, 1, 0, 65, 0, 0, 0)],
    ['split', packed(1, 65)], ['alphabet', packed(1)]
  ];
  for (const [mode, input] of malformedFrames) {
    const result = spawnSync(tokenizerBinary, [mode, tokenizerBuild], { input, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 65, `Malformed ${mode} frame accepted or crashed: ${result.stderr}`);
  }
  const extra = ['', 'A. B?', 'a\0b', '[[h@loU]].', '한글', '각난힣', 'ㄱㄲㄳㅏ', 'Straße Æ Œ', 'foo - 2', 'foo - bar', 'a - ' + '한'.repeat(88),
    'x'.repeat(795), 'e\u0301 é İ ß', "o'clock U.S.A.'s", '👨‍👩‍👧‍👦'].map((text, index) => ({ id: `tokenizer-boundary-${index}`, bytes: Buffer.from(text) }));
  const controls = ['\x01Pword', '\x01+5Pword', '\x01-5Pword', '\x01pword', '\x013Fword', '\x012Fword',
    '\x0166Y1234567', '\x0136YX', '\x0118YAb12', '\x010Bword', '\x01P', '\x01P\x01S\x01Aword',
    ...'PSARHTIVYMUBF'.split('').map(command => '\x01' + command + 'word')].map((text, index) => ({ id: `embedded-boundary-${index}`, bytes: Buffer.from(text) }));
  const corpus = [...makeTraceCorpus(), ...extra, ...controls];
  const captures = [];
  for (const entry of corpus) {
    activeRequest = { utf8Hex: entry.bytes.toString('hex') };
    const actual = oracle(activeRequest);
    assert.equal(actual.status, 'ok', entry.id + ': unexpected undefined behavior');
    assert.equal(actual.diagnostic, null);
    assert.deepEqual(actual, oracle(activeRequest), entry.id + ': fresh-process result changed');
    const read = clauseOracle({ ...activeRequest, maxClauses: 1 }).clauses[0];
    const frozenKeys = clauseKeys.filter(key => key !== 'startWord');
    assert.deepEqual(pick(actual.readClause, frozenKeys), pick(read, frozenKeys), entry.id + ': frozen ReadClause helper differs');
    assert.equal(actual.readClause.startWord, 1, entry.id + ': initial caller word offset changed');
    assert.equal(actual.embeddedStateBefore.embeddedIx, actual.embeddedStateBefore.list.length);
    assert.equal(actual.embeddedStateAfter.embeddedIx, actual.embeddedStateAfter.list.length);
    assert.equal(actual.embeddedStateAfter.embeddedRead, 0, 'Downstream embedded effects must not execute');
    assert(actual.embeddedStateAfter.list.length <= actual.profile.embedded.capacity - 2);
    assert.equal(actual.words.bufferHex.slice(0, 6), '002020');
    assert.ok(actual.words.bufferHex.length / 2 < 800);
    captures.push({ id: entry.id, response: actual });
  }
  activeRequest = { utf8Hex: Buffer.from('ab - ' + '한'.repeat(88)).toString('hex') };
  const overflow = oracle(activeRequest);
  assert.equal(overflow.status, 'undefined-upstream-behavior');
  assert.equal(overflow.diagnostic.code, 'TOKENIZER_BOUNDS_UNDEFINED');
  assert.equal(overflow.diagnostic.index, 800); assert.equal(overflow.diagnostic.arrayType, 'char [800]');
  assert.equal(overflow.readClause, null); assert.equal(overflow.words, null); assert.equal(overflow.state, null);
  assert.deepEqual(overflow, oracle(activeRequest));

  activeRequest = { scans: [{ bytesHex: 'e4b896' }, { bytesHex: '80e4b896', offset: 0 }, { bytesHex: '61e4b896', offset: 3, backwards: true }, { bytesHex: '' }],
    translations: [{ codepoint: 0xd55c }, { codepoint: 0x3131 }, { codepoint: 0x41 }],
    splits: [{ codepoint: 0x4e00, previous: 0x4e01 }], alphabets: [65, 0x4e00, 0xffffffff] };
  const primitives = oracle(activeRequest);
  assert.deepEqual(primitives, oracle(activeRequest));
  assert.deepEqual(primitives.scans, [{ codepoint: 0x4e16, bytes: 3 }, { codepoint: 0x4e16, bytes: 3 }, { codepoint: 0x4e16, bytes: 3 }, { codepoint: 0, bytes: 1 }]);
  assert.deepEqual(primitives.translations[0], { codepoint: 0x1112, insert: 0xc548, wordFlags: 0 });
  assert.equal(primitives.translations[1].codepoint, 0x1100);
  const batchRequests = [{}, { utf8Hex: '61' }, activeRequest];
  const batch = () => execFileSync(process.execPath, ['tools/oracle/tokenizer.mjs'], { input: JSON.stringify(batchRequests), encoding: 'utf8' });
  const batchOutput = batch(); assert.equal(batchOutput, batch());
  assert.deepEqual(JSON.parse(batchOutput), batchRequests.map(request => oracle(request)));

  // Hooks are NULL in the normal CLI. Verify complete mnemonic and WAV bytes.
  function cli(build, entry, label) {
    const directory = path.join(output, 'cli', entry.id); mkdirSync(directory, { recursive: true });
    const wav = path.join(directory, label + '.wav');
    const mnemonic = execFileSync(path.join(build, 'src/espeak-ng'), ['-D', '-b', '1', '-v', 'en-us', '-s', '175', '-p', '50', '-a', '100', '--stdin', '-x', '-w', wav], {
      input: entry.bytes, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ESPEAK_DATA_PATH: build, LC_ALL: 'C', JSPEAK_TRACE_FILE: '' }
    });
    return { mnemonic, wavSha256: existsSync(wav) ? sha256(readFileSync(wav)) : null };
  }
  const transparency = [];
  for (const entry of [...makeTraceCorpus(), ...controls.filter(entry => ['embedded-boundary-4', 'embedded-boundary-6'].includes(entry.id))]) {
    const expected = cli(referenceBuild, entry, 'reference');
    assert.deepEqual(cli(tokenizerBuild, entry, 'tokenizer'), expected, entry.id + ': patch changes original CLI');
    transparency.push({ id: entry.id, ...expected });
  }
  let bridge = { status: 'skipped', reason: 'Pass --trace-dir for existing full CLI trace comparison' };
  if (traceDirectory) {
    const report = JSON.parse(readFileSync(path.join(traceDirectory, 'report.json'), 'utf8'));
    let comparedCases = 0, noCliClause = 0;
    for (const entry of report.cases) {
      const trace = validateTrace(JSON.parse(readFileSync(path.join(traceDirectory, entry.id, 'trace.json'), 'utf8')));
      const expectedRead = trace.events.find(event => event.kind === 'clause');
      const expectedWords = trace.events.find(event => event.kind === 'words');
      if (!expectedRead) { assert.equal(expectedWords, undefined); noCliClause++; continue; }
      activeRequest = { utf8Hex: trace.input.utf8Hex };
      const actual = oracle(activeRequest);
      assert.equal(actual.status, 'ok');
      assert.equal(actual.reference.upstreamCommit, trace.reference.upstreamCommit);
      assert.equal(actual.reference.dataFingerprint, trace.reference.dataFingerprint);
      assert.deepEqual(actual.readClause, pick(expectedRead, clauseKeys), entry.id + ': first ReadClause trace differs');
      assert.deepEqual(actual.words, pick(expectedWords, ['bufferHex', 'items']), entry.id + ': first words trace differs');
      comparedCases++;
    }
    bridge = { status: 'passed', comparedCases, noCliClause, directory: path.relative(root, traceDirectory) };
  }
  writeFileSync(path.join(output, 'captures.json'), JSON.stringify(captures, null, 2) + '\n');
  writeFileSync(path.join(output, 'transparency.json'), JSON.stringify(transparency, null, 2) + '\n');
  const report = { schemaVersion: 1, kind: 'fixed-C-tokenizer-first-clause-selfcheck-not-C-JS-compatibility', status: 'passed',
    reference: oracle({}).reference, profile: oracle({}).profile, inputCases: corpus.length, independentTokenizerRunsPerInput: 2,
    frozenClauseComparisons: corpus.length, embeddedObservationCases: controls.length, cliTransparencyCases: transparency.length, cliTransparencyOutputs: 'exact mnemonic and complete WAV bytes',
    invalidNodeRequests: invalid.length, malformedCFrames: malformedFrames.length, batchAndPrimitiveChecks: 'passed',
    undefinedBehavior: { cases: 1, expectedStatus: overflow.status, diagnostic: overflow.diagnostic, inputHex: overflow.request.utf8Hex }, traceBridge: bridge,
    limitation: 'One first original-input clause per fresh process. Bounds sanitizer on translate.c is not a whole-program UB audit.' };
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS: ${corpus.length} first-clause captures exact on repeat and frozen ReadClause; ${transparency.length} CLI mnemonic/WAV exact; trace bridge ${bridge.status}; explicit upstream bounds rejection.`);
  console.log(`Report: ${output}/report.json`);
} catch (error) {
  writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ request: activeRequest, error: error.stack }, null, 2) + '\n');
  throw error;
}
