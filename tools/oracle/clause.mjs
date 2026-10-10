import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { config, traceBuild, referenceBuild } from './trace-build-info.mjs';
import { clauseBinary, clauseReferenceBinary, validateClauseBuild } from './clause-build-info.mjs';
export const clauseTableRowBytes = 16;
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function normalizeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected clause request object');
  for (const key of Object.keys(value)) if (!['utf8Hex', 'maxClauses', 'classify'].includes(key)) throw new Error(`Unknown clause request field ${key}`);
  if (value.utf8Hex !== undefined && (typeof value.utf8Hex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(value.utf8Hex) || value.utf8Hex.length > 65536 * 2)) throw new Error('utf8Hex must be lowercase hex, at most 65536 bytes');
  if (value.maxClauses !== undefined && (!Number.isInteger(value.maxClauses) || value.maxClauses < 1 || value.maxClauses > 128)) throw new Error('maxClauses must be 1..128');
  if (value.classify !== undefined && (!Array.isArray(value.classify) || value.classify.length > 16384 || value.classify.some(cp => !uint32(cp)))) throw new Error('classify must contain at most 16384 uint32 code points');
  return { ...(value.utf8Hex === undefined ? {} : { utf8Hex: value.utf8Hex }), maxClauses: value.maxClauses ?? 1, classify: value.classify ?? [] };
}
function run(binary, args, input = Buffer.alloc(0), binaryOutput = false) {
  const output = execFileSync(binary, args, { input, timeout: 30000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, JSPEAK_TRACE_FILE: '', LC_ALL: 'C' } });
  return binaryOutput ? output : JSON.parse(output.toString('utf8'));
}
export function createClauseOracle() {
  const build = validateClauseBuild();
  const profile = run(clauseBinary, ['profile', traceBuild]).profile;
  assert.deepEqual(profile, run(clauseReferenceBinary, ['profile', referenceBuild]).profile, 'Clean/instrumented en-us profile differs');
  const reference = { upstreamCommit: config.commit, traceFingerprint: build.trace.fingerprint, helperFingerprint: build.fingerprint,
    dataFingerprint: build.trace.stamp.reference.dataFingerprint, profile: 'read-clause-en-us-v1' };
  return (value, options = {}) => {
    const request = normalizeRequest(value);
    const binary = options.reference ? clauseReferenceBinary : clauseBinary;
    const buildPath = options.reference ? referenceBuild : traceBuild;
    let clauses = null;
    if (request.utf8Hex !== undefined) {
      const result = run(binary, ['read', buildPath, String(request.maxClauses)], Buffer.from(request.utf8Hex, 'hex'));
      assert.deepEqual(result.profile, profile, 'ReadClause initial profile changed');
      clauses = result.clauses;
    }
    const packed = Buffer.alloc(request.classify.length * 4);
    request.classify.forEach((cp, i) => packed.writeUInt32LE(cp, i * 4));
    const classifications = request.classify.length ? run(binary, ['classify'], packed) : [];
    return { schemaVersion: 1, reference: structuredClone(reference), request, profile: structuredClone(profile), clauses, classifications };
  };
}
export function exportClauseTable({ start = 0, count = 0x110000, reference = false } = {}) {
  if (!uint32(start) || !Number.isInteger(count) || count < 0 || count > 0x110000 || start + count > 0x100000000) throw new Error('Invalid clause table range');
  validateClauseBuild();
  const bytes = run(reference ? clauseReferenceBinary : clauseBinary, ['export-table', String(start), String(count)], Buffer.alloc(0), true);
  if (bytes.length !== count * clauseTableRowBytes) throw new Error('Truncated clause table export');
  return bytes;
}
export function unpackClauseTableRow(bytes, index, codepoint) {
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(index) || index < 0 || (index + 1) * clauseTableRowBytes > bytes.byteLength || !uint32(codepoint)) throw new Error('Invalid clause table row');
  const data = new DataView(bytes.buffer, bytes.byteOffset + index * clauseTableRowBytes, clauseTableRowBytes);
  return { codepoint, category: data.getUint32(0, true), propertiesLow: data.getUint32(4, true), propertiesHigh: data.getUint32(8, true), clauseType: data.getUint32(12, true) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/clause.mjs < request-or-batch.json');
    const bytes = readFileSync(0);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Clause JSON batch exceeds 4 MiB');
    const input = JSON.parse(bytes.toString('utf8'));
    if (Array.isArray(input) && input.length > 1024) throw new Error('Clause batch exceeds 1024 requests');
    const oracle = createClauseOracle();
    console.log(JSON.stringify(Array.isArray(input) ? input.map(request => oracle(request)) : oracle(input)));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
