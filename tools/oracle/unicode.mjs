import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { config } from './trace-build-info.mjs';
import { unicodeBinary, unicodeReferenceBinary, validateUnicodeBuild } from './unicode-build-info.mjs';

export const unicodeFlagFields = Object.freeze(['isAlpha', 'isDigit', 'isDigit09', 'isSpace', 'isSpace2', 'isEmoji', 'isRegionalIndicator', 'isEmojiModifier', 'isEmojiTag', 'iswAlnum', 'iswAlpha', 'iswBlank', 'iswCntrl', 'iswDigit', 'iswGraph', 'iswLower', 'iswPrint', 'iswPunct', 'iswSpace', 'iswUpper', 'iswXdigit']);
export const unicodeTableRowBytes = 32;
const modes = ['c-string', 'nul-terminated', 'bounded'];
const uint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function normalizeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected Unicode request object');
  for (const key of Object.keys(value)) if (!['utf8Hex', 'termination', 'classify', 'dotlessI'].includes(key)) throw new Error(`Unknown request field ${key}`);
  if (value.utf8Hex !== undefined && (typeof value.utf8Hex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(value.utf8Hex) || value.utf8Hex.length > 65536 * 2)) throw new Error('utf8Hex must be lowercase hex, at most 65536 bytes');
  if (value.termination !== undefined && !modes.includes(value.termination)) throw new Error('Unknown UTF-8 termination mode');
  if (value.classify !== undefined && (!Array.isArray(value.classify) || value.classify.length > 65536 || value.classify.some(cp => !uint32(cp)))) throw new Error('classify must contain at most 65536 uint32 code points');
  if (value.dotlessI !== undefined && typeof value.dotlessI !== 'boolean') throw new Error('dotlessI must be boolean');
  return { ...(value.utf8Hex === undefined ? {} : { utf8Hex: value.utf8Hex }), termination: value.termination ?? 'c-string', classify: value.classify ?? [], dotlessI: value.dotlessI ?? false };
}
function run(binary, args, input, binaryOutput = false) {
  const output = execFileSync(binary, args, { input, timeout: 30000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, JSPEAK_TRACE_FILE: '', LC_ALL: 'C' } });
  return binaryOutput ? output : JSON.parse(output.toString('utf8'));
}

// Validate build provenance once; suitable for a bounded differential batch.
export function createUnicodeOracle() {
  const build = validateUnicodeBuild();
  const reference = { upstreamCommit: config.commit, traceFingerprint: build.trace.fingerprint, helperFingerprint: build.fingerprint, profile: 'utf8-unicode-v1' };
  return (value, options = {}) => {
    const request = normalizeRequest(value);
    const binary = options.reference ? unicodeReferenceBinary : unicodeBinary;
    const decode = request.utf8Hex === undefined ? null : run(binary, ['decode', request.termination], Buffer.from(request.utf8Hex, 'hex'));
    const packed = Buffer.alloc(request.classify.length * 4);
    request.classify.forEach((cp, i) => packed.writeUInt32LE(cp, i * 4));
    const classifications = request.classify.length ? run(binary, ['classify', request.dotlessI ? '1' : '0'], packed) : [];
    return { schemaVersion: 1, reference, request, decode, classifications };
  };
}
export function exportUnicodeTable({ start = 0, count = 0x110000, reference = false } = {}) {
  if (!uint32(start) || !Number.isInteger(count) || count < 0 || count > 0x110000 || start + count > 0x100000000) throw new Error('Invalid Unicode table range');
  validateUnicodeBuild();
  const bytes = run(reference ? unicodeReferenceBinary : unicodeBinary, ['export-table', String(start), String(count)], Buffer.alloc(0), true);
  if (bytes.length !== count * unicodeTableRowBytes) throw new Error('Truncated Unicode table export');
  return bytes;
}
export function unpackUnicodeTableRow(bytes, index, codepoint) {
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(index) || index < 0 || (index + 1) * unicodeTableRowBytes > bytes.byteLength || !uint32(codepoint)) throw new Error('Invalid Unicode table row');
  const data = new DataView(bytes.buffer, bytes.byteOffset + index * unicodeTableRowBytes, unicodeTableRowBytes);
  const flags = data.getUint32(0, true);
  const encoded = data.getUint32(24, true); const length = data.getUint32(28, true);
  if (flags >>> unicodeFlagFields.length || length < 1 || length > 4) throw new Error('Invalid Unicode table row fields');
  let utf8Hex = '';
  for (let i = 0; i < length; i++) utf8Hex += ((encoded >>> (i * 8)) & 255).toString(16).padStart(2, '0');
  const row = { codepoint, category: data.getUint32(4, true), lower: data.getUint32(8, true), upper: data.getUint32(12, true), ucdLower: data.getUint32(16, true), bracket: data.getInt32(20, true) };
  unicodeFlagFields.forEach((field, bit) => row[field] = (flags >>> bit) & 1);
  return { ...row, utf8Hex };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/oracle/unicode.mjs < request-or-batch.json');
    const bytes = readFileSync(0);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('JSON batch exceeds 4 MiB');
    const input = JSON.parse(bytes.toString('utf8'));
    if (Array.isArray(input) && input.length > 1024) throw new Error('Batch exceeds 1024 requests');
    const oracle = createUnicodeOracle();
    const output = Array.isArray(input) ? input.map(request => oracle(request)) : oracle(input);
    console.log(JSON.stringify(output));
  } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 2; }
}
