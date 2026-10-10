import { openSync, fstatSync, readSync, readFileSync, closeSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { minimizeBytes } from './minimize-bytes.mjs';

const args = process.argv.slice(2), values = {}, options = {};
const numeric = { '--max-attempts': 'maxAttempts', '--max-input-bytes': 'maxInputBytes',
  '--timeout-ms': 'timeoutMs', '--predicate-timeout-ms': 'predicateTimeoutMs' };
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--valid-utf8') options.validUtf8 = true;
  else if (Object.hasOwn(numeric, key)) options[numeric[key]] = Number(args[++i]);
  else if (['--input', '--predicate', '--output'].includes(key)) values[key] = args[++i];
  else throw new Error('Unknown argument ' + key);
}
for (const key of ['--input', '--predicate', '--output']) if (!values[key]) throw new Error('Required: ' + key);
const cap = options.maxInputBytes ?? 65536;
if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError('maxInputBytes must be a positive safe integer');
const descriptor = openSync(values['--input'], 'r');
let input;
try {
  const info = fstatSync(descriptor);
  if (!info.isFile() || info.size > cap) throw new RangeError('input must be a regular file within maxInputBytes');
  // One byte beyond the inspected size detects growth without reading an unbounded file.
  const buffer = Buffer.alloc(info.size + 1);
  const count = readSync(descriptor, buffer, 0, buffer.length, 0);
  if (count !== info.size) throw new Error('input size changed while reading');
  input = buffer.subarray(0, count);
} finally { closeSync(descriptor); }
// Explicit trusted module loading; no shell command or exit-code-as-bug logic.
const predicatePath = path.resolve(values['--predicate']);
const predicateSha256 = createHash('sha256').update(readFileSync(predicatePath)).digest('hex');
const { default: predicate } = await import(pathToFileURL(predicatePath).href);
const result = await minimizeBytes(input, predicate, options);
if (createHash('sha256').update(readFileSync(predicatePath)).digest('hex') !== predicateSha256) throw new Error('Predicate module changed during reduction');
const { bytes, ...summary } = result;
const report = { schemaVersion: 1, kind: 'byte-failure-reduction', ...summary,
  predicate: { path: predicatePath, sha256: predicateSha256, metadata: predicate.metadata ?? null },
  originalSha256: createHash('sha256').update(input).digest('hex'), input: { utf8Hex: Buffer.from(bytes).toString('hex') } };
writeFileSync(values['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: values['--output'], bytes: bytes.length, attempts: result.attempts, reason: result.reason }));
