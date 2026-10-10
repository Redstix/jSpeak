import { readFileSync } from 'node:fs';

const sourceRoot = new URL('../../apps/vela-probe/src/', import.meta.url);
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const source = readFileSync(new URL(name + '.js', sourceRoot), 'utf8')
    .replace(/from '\.\/([^']+)'/g, (_, child) => 'from ' + JSON.stringify(moduleUrl(child)));
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  urls.set(name, url);
  return url;
}
export function loadProbe(name) { return import(moduleUrl(name)); }

export function fakeClock() {
  const timers = new Map();
  let time = 1000;
  let id = 0;
  const env = {
    now: () => ++time,
    later(fn, delay) { const key = ++id; timers.set(key, { fn, delay }); return key; },
    clear(key) { timers.delete(key); }
  };
  return {
    env, timers,
    step(delay) {
      const pair = [...timers].find(([, value]) => value.delay === delay);
      if (!pair) throw new Error('No timer for ' + delay);
      timers.delete(pair[0]); time += delay; pair[1].fn();
    },
    drain() {
      let steps = 0;
      while (timers.size) {
        if (++steps > 10000) throw new Error('runaway timers');
        const delay = Math.min(...[...timers.values()].map(value => value.delay));
        this.step(delay);
      }
    }
  };
}

export function memoryFile(clock, initial = {}, options = {}) {
  const files = new Map(Object.entries(initial));
  const requests = [];
  const file = {};
  for (const method of ['get', 'readArrayBuffer', 'writeArrayBuffer', 'delete']) {
    file[method] = args => {
      requests.push({ method, args });
      clock.env.later(() => {
        if (options.fail?.(method, args)) { args.fail('injected I/O failure', 300); return; }
        if (method === 'get') {
          if (files.has(args.uri)) args.success({}); else args.fail('missing', 301);
        } else if (method === 'readArrayBuffer') {
          if (!files.has(args.uri)) { args.fail('missing', 301); return; }
          const source = files.get(args.uri);
          const start = args.position || 0;
          const bytes = source.slice(start, args.length === undefined ? source.length : start + args.length);
          if (options.corruptRead?.(args)) bytes[bytes.length - 1] ^= 1;
          args.success({ buffer: bytes });
        } else if (method === 'writeArrayBuffer') {
          const payload = options.wholeBackingWrite ? new Uint8Array(args.buffer.buffer) : args.buffer;
          const previous = files.get(args.uri) || new Uint8Array();
          const start = args.append ? previous.length : (args.position || 0);
          const size = options.truncate && !args.append ? start + payload.length : Math.max(previous.length, start + payload.length);
          const bytes = new Uint8Array(size);
          bytes.set(previous.subarray(0, size)); bytes.set(payload, start);
          files.set(args.uri, bytes); args.success({});
        } else { files.delete(args.uri); args.success({}); }
      }, 1);
    };
  }
  return { file, files, requests };
}

const { hashBytes } = await loadProbe('probe');
export function descriptor(id, bytes, windows = []) {
  const pages = [];
  for (let position = 0; position < bytes.length; position += 32768) {
    const length = Math.min(32768, bytes.length - position);
    pages.push({ position, length, hash32: hashBytes(bytes, position, position + length, 0) });
  }
  return { id, uri: '/common/espeak/' + id + '.txt', byteLength: bytes.length, hash32: hashBytes(bytes, 0, bytes.length, 0), pages,
    windows: windows.map(range => ({ ...range, hash32: hashBytes(bytes, range.position, range.position + range.length, 0) })) };
}

export function manifestFixture(files) {
  return { magic: 'JSPEAK_RAW_DATA', schemaVersion: 1, scope: 'en-us-candidate-probe', pageBytes: 32768,
    sampleRate: 22050, upstreamCommit: 'abcdef1234'.repeat(4), dataFingerprint: '12345678'.repeat(8),
    hash32Spec: { name: 'xorshift32-byte-mix', seed: 0, result: 'signed-int32',
      reset: 'seed 0 separately for each file, page, and window',
      steps: ['state ^= byte', 'state ^= state << 13', 'state ^= state >>> 17', 'state ^= state << 5'] },
    files, totalDataBytes: files.reduce((sum, file) => sum + file.byteLength, 0) };
}

export function wavFixture(byteLength = 40044) {
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']]) {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  }
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 22050, true);
  view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, bytes.length - 44, true);
  for (let i = 44; i < bytes.length; i++) bytes[i] = (i * 37) & 255;
  return { bytes, asset: { uri: '/oracle.wav', dataUri: '/oracle-wave.txt', byteLength: bytes.length,
    sampleRate: 22050, sampleCount: (bytes.length - 44) / 2, hash32: hashBytes(bytes, 0, bytes.length, 0) } };
}
