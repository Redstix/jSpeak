import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createClauseOracle } from '../oracle/clause.mjs';
import { createClauseReader, READ_CLAUSE_PROFILE } from '../../src/core/read-clause.js';
import { CLAUSE, clauseTypeFromCodePoint } from '../../src/core/clause-type.js';
import { createUtf8Decoder } from '../../src/core/unicode.js';
import { makeClauseCorpus } from './clause-corpus.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stateFields = ['decoderOffset', 'decoderRemaining', 'decoderEof', 'decoderPeek', 'logicalEof', 'countCharacters', 'clauseUpperCount', 'clauseLowerCount', 'phonemesRepeatCount'];
function keys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields`);
}
function integer(value, low, high, label) { assert(Number.isInteger(value) && value >= low && value <= high, `Invalid ${label}`); }
function hex(value, label) { assert(typeof value === 'string' && /^(?:[0-9a-f]{2})*$/.test(value), `Invalid ${label}`); }
function validateState(value, first, label) {
  keys(value, stateFields, label);
  for (const field of ['decoderOffset', 'decoderRemaining', 'decoderPeek']) integer(value[field], 0, 0xffffffff, field);
  for (const field of ['countCharacters', 'clauseUpperCount', 'clauseLowerCount']) integer(value[field], -1, 0x7fffffff, field);
  for (const field of ['decoderEof', 'logicalEof']) assert.equal(typeof value[field], 'boolean', field);
  if (first) assert.equal(value.phonemesRepeatCount, null, 'Initial repeat count is uninitialized in C');
  else integer(value.phonemesRepeatCount, 0, 0x7fffffff, 'phonemesRepeatCount');
}
export function validateClauseRecords(records, maxClauses) {
  assert(Array.isArray(records) && records.length > 0 && records.length <= maxClauses, 'Invalid clause record count');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    keys(record, ['index', 'startCharacter', 'sourceHex', 'charix', 'charixTop', 'terminator', 'tone', 'voiceChangeHex', 'stateBefore', 'stateAfter'], 'clause');
    assert.equal(record.index, index);
    integer(record.startCharacter, 0, 0x7fffffff, 'startCharacter');
    hex(record.sourceHex, 'sourceHex'); hex(record.voiceChangeHex, 'voiceChangeHex');
    assert(record.sourceHex.length <= 840 * 2, 'Source exceeds C backing capacity');
    integer(record.charixTop, 0, 800, 'charixTop');
    assert(Array.isArray(record.charix) && record.charix.length === record.charixTop + 1, 'charix length must be top+1');
    record.charix.forEach(value => integer(value, -32768, 32767, 'charix int16'));
    integer(record.terminator, 0, 0xffffffff, 'terminator'); integer(record.tone, 0, 15, 'tone');
    validateState(record.stateBefore, index === 0, 'stateBefore'); validateState(record.stateAfter, false, 'stateAfter');
    assert.equal(record.startCharacter, Math.max(0, record.stateBefore.countCharacters));
    if (index) assert.deepEqual(record.stateBefore, records[index - 1].stateAfter, 'Direct ReadClause state continuity');
    if (index < records.length - 1) assert.equal(record.terminator & CLAUSE.TYPE_EOF, 0, 'Records after EOF');
  }
  if (records.length < maxClauses) assert.notEqual(records.at(-1).terminator & CLAUSE.TYPE_EOF, 0, 'Premature oracle termination');
  return records;
}
export function serializeClause(record) {
  const { source, charix, voiceChange, ...rest } = record;
  assert(source instanceof Uint8Array && voiceChange instanceof Uint8Array && charix instanceof Int16Array, 'Unexpected JS clause buffer types');
  return { ...rest, sourceHex: Buffer.from(source).toString('hex'), charix: Array.from(charix), voiceChangeHex: Buffer.from(voiceChange).toString('hex') };
}
export function checkClauseProfile(profile) {
  assert.equal(profile.voice, READ_CLAUSE_PROFILE.voice);
  assert.equal(profile.inputEncoding, READ_CLAUSE_PROFILE.encoding);
  assert.equal(profile.capacity, READ_CLAUSE_PROFILE.capacity);
  const options = { ssml: 0, phonemeInput: 256, endPause: 4096, capitals: 0, punctuation: 0, lineLength: 0, sayas: 0, silence: 0, speed: 175, pitch: 50, amplitude: 100 };
  assert.deepEqual(profile.options, options);
  assert.equal(profile.randomSeed, 1);
  assert.equal(profile.translator.name, READ_CLAUSE_PROFILE.translatorName);
  assert.equal(profile.translator.numbers, READ_CLAUSE_PROFILE.numbers);
  assert.equal(profile.translator.lowercaseSentence, READ_CLAUSE_PROFILE.lowercaseSentence);
  assert.deepEqual(profile.translator.charsIgnore, [[173, 1], [8204, 1]]);
}
function validateUnsupported(error, fixture, reader) {
  const gap = fixture.expectedUnsupported;
  assert(gap, `${fixture.id}: unexpected unsupported regression; new dependency gaps require review`);
  assert.deepEqual({ reason: error.reason, codepoint: error.codepoint, clauseIndex: error.clauseIndex }, gap, 'Unsupported signature changed');
  integer(error.codepoint, 0, 0xffffffff, 'unsupported codepoint');
  if (error.reason === 'embedded-command') assert.equal(error.codepoint, 1, 'Unsupported reason/codepoint mismatch');
  else if (error.reason === 'punctuation-name-dictionary') assert.notEqual(clauseTypeFromCodePoint(error.codepoint) & CLAUSE.SPEAK_PUNCTUATION_NAME, 0, 'Unsupported reason/codepoint mismatch');
  else throw new Error('Unknown unsupported reason');
  // Necessary input evidence only, not a second implementation of ReadClause.
  // Lexical context and the exact rejected clause are locked in the reviewed manifest.
  const decoder = createUtf8Decoder(Buffer.from(fixture.utf8Hex, 'hex'));
  let evidence = false, dots = 0;
  while (!decoder.eof()) {
    const cp = decoder.next();
    dots = cp === 46 ? dots + 1 : 0;
    if (cp === error.codepoint || (error.codepoint === 0x2026 && dots >= 3)) evidence = true;
  }
  assert(evidence, 'Unsupported reason has no input codepoint evidence');
  validateState(error.state, false, 'unsupported state');
  assert.deepEqual(error.state, reader.state(), 'Unsupported state differs from reader');
}
export function compareClauseCase(fixture, expected, readerFactory = createClauseReader) {
  validateClauseRecords(expected, fixture.maxClauses);
  const reader = readerFactory(Buffer.from(fixture.utf8Hex, 'hex'));
  let comparedClauses = 0;
  for (let index = 0; index < fixture.maxClauses && reader.hasMore(); index++) {
    let actual;
    try { actual = reader.next(); }
    catch (error) {
      // Only explicitly enumerated implementation gaps can be reported as coverage gaps.
      // Invalid oracle/schema/process errors and unexpected JS errors always fail.
      if (error.code !== 'READ_CLAUSE_UNSUPPORTED' || error.name !== 'UnsupportedReadClauseError') throw error;
      validateUnsupported(error, fixture, reader);
      assert(index < expected.length, 'JS unsupported branch occurred after C EOF');
      assert.equal(error.clauseIndex, index);
      assert.equal(reader.hasMore(), false, 'Faulted reader must not continue');
      assert.throws(() => reader.next(), candidate => candidate === error, 'Fault must remain stable');
      return { id: fixture.id, status: 'unsupported', comparedClauses, clauseIndex: index, reason: error.reason, codepoint: error.codepoint };
    }
    assert(index < expected.length, 'JS produced an extra clause');
    assert.deepEqual(serializeClause(actual), expected[index], `${fixture.id} clause ${index}`);
    comparedClauses++;
  }
  assert.equal(comparedClauses, expected.length, `${fixture.id} stopped before expected clauses`);
  assert.equal(fixture.expectedUnsupported, null, 'Reviewed gap unexpectedly accepted; verify real implementation before updating exception manifest');
  const reachedEof = (expected.at(-1).terminator & CLAUSE.TYPE_EOF) !== 0;
  assert.equal(reader.hasMore(), !reachedEof);
  return { id: fixture.id, status: 'exact', comparedClauses, reachedEof };
}
export function verifyClause({ seed = 0x5eedc102, fuzzCases = 128, directory } = {}) {
  const fixtures = makeClauseCorpus({ seed, fuzzCases });
  const oracle = createClauseOracle();
  const envelope = oracle({});
  checkClauseProfile(envelope.profile);
  if (!directory) { mkdirSync(path.join(root, 'artifacts'), { recursive: true }); directory = mkdtempSync(path.join(root, 'artifacts/clause-differential-')); }
  mkdirSync(directory, { recursive: true });
  const inputs = ['src/core/read-clause.js', 'src/core/clause-type.js', 'src/core/unicode.js', 'data/clause/properties.js', 'data/clause/manifest.json', 'data/unicode/tables.js', 'data/unicode/manifest.json', 'tools/compare/clause.mjs', 'tools/compare/clause-corpus.mjs', 'tools/compare/clause-exceptions.json', 'tools/oracle/clause.mjs'];
  const snapshot = () => inputs.map(name => ({ path: name, sha256: sha256(readFileSync(path.join(root, name))) }));
  const provenance = { reference: envelope.reference, profile: envelope.profile, files: snapshot() };
  const requestBytes = JSON.stringify({ schemaVersion: 1, seed, fuzzCases, fixtures }, null, 2) + '\n';
  writeFileSync(path.join(directory, 'requests.json'), requestBytes);
  const results = [];
  let active = null;
  try {
    for (const fixture of fixtures) {
      active = fixture;
      const expected = oracle({ utf8Hex: fixture.utf8Hex, maxClauses: fixture.maxClauses });
      keys(expected, ['schemaVersion', 'reference', 'request', 'profile', 'clauses', 'classifications'], 'oracle envelope');
      assert.equal(expected.schemaVersion, 1);
      assert.deepEqual(expected.reference, envelope.reference); assert.deepEqual(expected.profile, envelope.profile);
      assert.deepEqual(expected.request, { utf8Hex: fixture.utf8Hex, maxClauses: fixture.maxClauses, classify: [] });
      assert.deepEqual(expected.classifications, []);
      results.push(compareClauseCase(fixture, expected.clauses));
    }
    assert.deepEqual(snapshot(), provenance.files, 'JS/data/comparison sources changed during differential run');
    assert.deepEqual(createClauseOracle()({}), envelope, 'C helper/provenance changed during differential run');
  } catch (error) {
    writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ schemaVersion: 1, status: 'failed', ...provenance, active, completedCases: results.length, error: error.stack }, null, 2) + '\n');
    error.message += `\nFailure artifact: ${path.join(directory, 'failure.json')}`;
    throw error;
  }
  const gaps = results.filter(result => result.status === 'unsupported');
  const summary = { schemaVersion: 1, status: 'passed-supported-slice', scope: 'M02.1 fixed-profile direct ReadClause; no tokenizer/word translation or unsupported dependencies', coverageComplete: false,
    seed, fuzzCases, totalCases: results.length, exactCases: results.length - gaps.length, unsupportedCases: gaps.length,
    completeEofCases: results.filter(value => value.status === 'exact' && value.reachedEof).length,
    boundedPrefixCases: results.filter(value => value.status === 'exact' && !value.reachedEof).length,
    comparedClauses: results.reduce((sum, value) => sum + value.comparedClauses, 0), unsupported: gaps,
    requestsSha256: sha256(requestBytes), ...provenance, artifactDirectory: directory };
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools/compare/clause.mjs');
  console.log(JSON.stringify(verifyClause(), null, 2));
}
