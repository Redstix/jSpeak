import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CLAUSE, CLAUSE_PROPERTY, clausePropertyBits, clauseTypeFromCodePoint } from '../src/core/clause-type.js';
import { CLAUSE_PROPERTY_METADATA, CLAUSE_PROPERTY_RANGES } from '../data/clause/properties.js';
import { compressPropertyExport, extractClauseConstants } from '../tools/build-clause/build.mjs';

test('ASCII clauses preserve pause/type/intonation bitfields and NONE is not zero', () => {
  for (const [character, value] of [['.', CLAUSE.PERIOD], ['?', CLAUSE.QUESTION], ['!', CLAUSE.EXCLAMATION],
    [',', CLAUSE.COMMA], [':', CLAUSE.COLON], [';', CLAUSE.SEMICOLON]]) {
    assert.equal(clauseTypeFromCodePoint(character.codePointAt(0)), value);
  }
  assert.equal(CLAUSE.NONE, 0x4000);
  assert.equal(CLAUSE.PERIOD & CLAUSE.PAUSE, 40);
  assert.equal(CLAUSE.EXCLAMATION & CLAUSE.PAUSE, 45);
  assert.equal(CLAUSE.EOF & CLAUSE.TYPE, CLAUSE.TYPE_SENTENCE | CLAUSE.TYPE_EOF);
  for (const cp of [0, 9, 10, 13, 32, 45, 65, 0xd800, 0x10ffff]) assert.equal(clauseTypeFromCodePoint(cp), CLAUSE.NONE);
});

test('optional-space, in-word, inverted, ellipsis and paragraph properties retain exact C combinations', () => {
  assert.equal(clauseTypeFromCodePoint(0xff0e), CLAUSE.PERIOD | CLAUSE.OPTIONAL_SPACE_AFTER);
  assert.equal(clauseTypeFromCodePoint(0xff1f), CLAUSE.QUESTION | CLAUSE.OPTIONAL_SPACE_AFTER);
  assert.equal(clauseTypeFromCodePoint(0xff1a), CLAUSE.COLON | CLAUSE.OPTIONAL_SPACE_AFTER);
  assert.equal(clauseTypeFromCodePoint(0x55e), CLAUSE.QUESTION | CLAUSE.PUNCTUATION_IN_WORD);
  assert.equal(clauseTypeFromCodePoint(0x55b), CLAUSE.EXCLAMATION | CLAUSE.PUNCTUATION_IN_WORD);
  for (const cp of [0xa1, 0xbf]) assert.equal(clauseTypeFromCodePoint(cp), CLAUSE.SEMICOLON | CLAUSE.OPTIONAL_SPACE_AFTER);
  for (const cp of [0x2013, 0x2014, 0x2e3a, 0x2e3b]) assert.equal(clauseTypeFromCodePoint(cp), CLAUSE.SEMICOLON);
  assert.equal(clauseTypeFromCodePoint(0x2026), CLAUSE.SEMICOLON | CLAUSE.SPEAK_PUNCTUATION_NAME | CLAUSE.OPTIONAL_SPACE_AFTER);
  assert.equal(clauseTypeFromCodePoint(0x2029), CLAUSE.PARAGRAPH);
  assert.equal(clauseTypeFromCodePoint(0x2028), CLAUSE.NONE);
  assert.equal(clauseTypeFromCodePoint(0xe0021), CLAUSE.EXCLAMATION);
});

test('the C switch requires exact masked properties, not any matching punctuation bit', () => {
  for (const cp of [0x2048, 0x2049]) {
    assert.equal(clausePropertyBits(cp), CLAUSE_PROPERTY.QUESTION_MARK | CLAUSE_PROPERTY.EXCLAMATION_MARK);
    assert.equal(clauseTypeFromCodePoint(cp), CLAUSE.NONE);
  }
  assert.equal(clausePropertyBits(0x2e), 0x800); // Original property bit 63, no JS precision loss.
  for (const cp of [0x110000, 0x7fffffff, 0x80000000, 0xffffffff]) {
    assert.equal(clausePropertyBits(cp), 0); assert.equal(clauseTypeFromCodePoint(cp), CLAUSE.NONE);
  }
  for (const cp of [-1, NaN, Infinity, 0.5, 0x100000000, '46', null]) assert.throws(() => clauseTypeFromCodePoint(cp), /uint32/);
});

test('every sparse property interval and its boundaries are searchable without matching gaps', () => {
  assert.equal(CLAUSE_PROPERTY_RANGES.length % 3, 0);
  let previousEnd = -1;
  const slow = cp => {
    for (let i = 0; i < CLAUSE_PROPERTY_RANGES.length; i += 3) {
      if (cp >= CLAUSE_PROPERTY_RANGES[i] && cp <= CLAUSE_PROPERTY_RANGES[i + 1]) return CLAUSE_PROPERTY_RANGES[i + 2];
    }
    return 0;
  };
  for (let i = 0; i < CLAUSE_PROPERTY_RANGES.length; i += 3) {
    const start = CLAUSE_PROPERTY_RANGES[i], end = CLAUSE_PROPERTY_RANGES[i + 1], bits = CLAUSE_PROPERTY_RANGES[i + 2];
    assert.ok(start > previousEnd && end >= start && end <= 0x10ffff);
    assert.ok(bits > 0 && bits <= 0xfff);
    for (const cp of [Math.max(0, start - 1), start, end, end + 1]) assert.equal(clausePropertyBits(cp), slow(cp));
    previousEnd = end;
  }
});

test('generated source identity and all CLAUSE/property constants match independently parsed pinned headers', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/clause/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(CLAUSE, manifest.constants); assert.deepEqual(CLAUSE_PROPERTY, manifest.properties);
  assert.equal(Object.keys(CLAUSE).length, 30); assert.equal(Object.keys(CLAUSE_PROPERTY).length, 12);
  assert.equal(CLAUSE_PROPERTY_METADATA.upstreamCommit, JSON.parse(readFileSync(new URL('../upstream.json', import.meta.url), 'utf8')).commit);
  assert.equal(CLAUSE_PROPERTY_METADATA.sourceFingerprint, manifest.sourceFingerprint);
  assert.equal(CLAUSE_PROPERTY_RANGES.byteLength, manifest.typedArrayBytes);
  const module = readFileSync(new URL('../data/clause/properties.js', import.meta.url));
  assert.equal(createHash('sha256').update(module).digest('hex'), manifest.moduleSha256);
});

test('property compressor merges only identical nonzero runs and rejects damaged exports', () => {
  const buffer = Buffer.alloc(12 + 0x110000 * 4);
  buffer.write('JSCLPR01'); buffer.writeUInt32LE(0x110000, 8);
  for (const cp of [2, 3, 5]) buffer.writeUInt32LE(0x800, 12 + cp * 4);
  buffer.writeUInt32LE(0x400, 12 + 6 * 4);
  assert.deepEqual(compressPropertyExport(buffer), [2, 3, 0x800, 5, 5, 0x800, 6, 6, 0x400]);
  buffer.writeUInt32LE(0x1000, 12);
  assert.throws(() => compressPropertyExport(buffer), /12-bit/);
  assert.throws(() => compressPropertyExport(buffer.subarray(1)), /export/);
  assert.deepEqual(extractClauseConstants('#define CLAUSE_A 0x10\n#define CLAUSE_B (3 | CLAUSE_A) // comment\n'), { A: 16, B: 19 });
  assert.throws(() => extractClauseConstants('#define CLAUSE_X dangerous()'), /Unsupported/);
});
