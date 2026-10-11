import { createHash } from 'node:crypto';

export const PACK_SCHEMA_VERSION = 1;
export const PACK_MAGIC = 'JSPEAK_RAW_DATA';
export const PAGE_BYTES = 32768;
export const PHONDATA_VERSION = 0x014801;
export const SAMPLE_RATE = 22050;
export const HASH_SPEC = {
  name: 'xorshift32-byte-mix', seed: 0, result: 'signed-int32',
  steps: ['state ^= byte', 'state ^= state << 13', 'state ^= state >>> 17', 'state ^= state << 5'],
  reset: 'seed 0 separately for each file, page, and window',
  note: 'Diagnostic checksum, not SHA256 or a cryptographic integrity check.'
};

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function hash32(bytes) {
  let state = 0;
  for (const byte of bytes) {
    state ^= byte;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
  }
  return state | 0;
}

export function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..') || !/^[A-Za-z0-9_!+. /-]+$/.test(value)) {
    throw new Error('Unsafe relative path: ' + value);
  }
  return value;
}

export function checkRange(byteLength, position, length) {
  if (![byteLength, position, length].every(Number.isSafeInteger) || byteLength < 0 ||
      position < 0 || length < 0 || position > byteLength || length > byteLength - position) {
    throw new RangeError('Data window out of bounds');
  }
}

export function describeBytes(bytes, pageSize = PAGE_BYTES) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_BYTES) throw new RangeError('Invalid page size');
  const pages = [];
  for (let position = 0; position < bytes.length; position += pageSize) {
    const length = Math.min(pageSize, bytes.length - position);
    pages.push({ position, length, hash32: hash32(bytes.subarray(position, position + length)) });
  }
  const windows = [];
  function add(id, position, length) {
    checkRange(bytes.length, position, length);
    windows.push({ id, position, length, hash32: hash32(bytes.subarray(position, position + length)) });
  }
  add('begin', 0, Math.min(2048, bytes.length));
  if (bytes.length > pageSize) add('cross-page', pageSize - 1, Math.min(2048, bytes.length - pageSize + 1));
  if (bytes.length > 262145) add('high-offset', 262145, Math.min(2048, bytes.length - 262145));
  add('end', Math.max(0, bytes.length - 2048), Math.min(2048, bytes.length));
  add('eof', bytes.length, 0);
  return { byteLength: bytes.length, sha256: sha256(bytes), hash32: hash32(bytes), pages, windows };
}

export function dataFingerprint(files) {
  const identities = files.map(({ sourcePath, byteLength, sha256 }) => ({ sourcePath, byteLength, sha256 }))
    .sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0);
  return sha256(JSON.stringify(identities));
}

export function makePack({ upstreamCommit, buildFingerprint, sourceDataFingerprint, profile, entries }) {
  if (!/^[a-f0-9]{40}$/.test(upstreamCommit)) throw new Error('Invalid upstream commit');
  if (!entries.length) throw new Error('Empty data pack');
  const ids = new Set();
  const sources = new Set();
  const targets = new Set();
  const files = entries.map(({ id, sourcePath, packagePath, bytes, role }) => {
    validateRelativePath(sourcePath);
    validateRelativePath(packagePath);
    if (!/^[a-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('Duplicate or invalid id: ' + id);
    if (sources.has(sourcePath)) throw new Error('Duplicate source: ' + sourcePath);
    if (targets.has(packagePath)) throw new Error('Duplicate package mapping: ' + packagePath);
    if (!packagePath.endsWith('.txt')) throw new Error('Raw package path must end in .txt');
    ids.add(id); sources.add(sourcePath); targets.add(packagePath);
    return { id, sourcePath, packagePath, uri: '/common/espeak/' + packagePath, role, ...describeBytes(bytes) };
  }).sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0);
  const voice = profile?.voice;
  if (!/^(en-us|cmn)$/.test(voice || '')) throw new Error('Unsupported language profile: ' + voice);
  return {
    magic: PACK_MAGIC, schemaVersion: PACK_SCHEMA_VERSION, scope: voice + '-candidate-probe', closureComplete: false,
    upstreamCommit, buildFingerprint, sourceDataFingerprint, dataFingerprint: dataFingerprint(files), profile,
    sampleRate: SAMPLE_RATE, phondataVersion: PHONDATA_VERSION, pageBytes: PAGE_BYTES,
    hash32Spec: HASH_SPEC, totalDataBytes: files.reduce((sum, f) => sum + f.byteLength, 0), files
  };
}

// Full desktop verification. Device probes use the explicitly specified 32-bit checksum.
export function verifyPack(manifest, getBytes, expectedCommit) {
  if (!manifest || manifest.magic !== PACK_MAGIC || manifest.schemaVersion !== PACK_SCHEMA_VERSION) throw new Error('Incompatible data pack version');
  if (!/^(en-us|cmn)-candidate-probe$/.test(manifest.scope || '') || manifest.closureComplete !== false) throw new Error('Unsupported pack scope');
  if (!manifest.profile || manifest.scope !== manifest.profile.voice + '-candidate-probe') throw new Error('Profile and pack scope mismatch');
  if (expectedCommit && manifest.upstreamCommit !== expectedCommit) throw new Error('Upstream commit mismatch');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Empty data pack');
  const targets = new Set();
  const ids = new Set();
  const sources = new Set();
  let total = 0;
  for (const file of manifest.files) {
    validateRelativePath(file.packagePath);
    validateRelativePath(file.sourcePath);
    if (targets.has(file.packagePath) || ids.has(file.id) || sources.has(file.sourcePath)) throw new Error('Duplicate manifest mapping');
    targets.add(file.packagePath); ids.add(file.id); sources.add(file.sourcePath);
    if (file.uri !== '/common/espeak/' + file.packagePath) throw new Error('Package URI mismatch');
    const bytes = getBytes(file.packagePath);
    if (!(bytes instanceof Uint8Array) || bytes.length !== file.byteLength) throw new Error('Length mismatch: ' + file.sourcePath);
    if (sha256(bytes) !== file.sha256 || hash32(bytes) !== file.hash32) throw new Error('Integrity mismatch: ' + file.sourcePath);
    if (JSON.stringify(describeBytes(bytes).pages) !== JSON.stringify(file.pages) ||
        JSON.stringify(describeBytes(bytes).windows) !== JSON.stringify(file.windows)) throw new Error('Page/window mismatch: ' + file.sourcePath);
    total += bytes.length;
  }
  if (manifest.pageBytes !== PAGE_BYTES || JSON.stringify(manifest.hash32Spec) !== JSON.stringify(HASH_SPEC)) throw new Error('Unsupported checksum/page contract');
  if (total !== manifest.totalDataBytes || dataFingerprint(manifest.files) !== manifest.dataFingerprint) throw new Error('Data fingerprint/total mismatch');
  if (manifest.sampleRate !== SAMPLE_RATE || manifest.phondataVersion !== PHONDATA_VERSION) throw new Error('Unsupported phondata version or sample rate');
  const phondata = manifest.files.find(file => file.sourcePath === 'phondata');
  if (phondata) {
    const bytes = getBytes(phondata.packagePath);
    if (bytes.byteLength < 8) throw new Error('Truncated phondata header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== PHONDATA_VERSION || view.getUint32(4, true) !== SAMPLE_RATE) throw new Error('Incompatible upstream phondata header');
  }
  return true;
}
