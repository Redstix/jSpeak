import { readFileSync } from 'node:fs';
export function makeTraceCorpus(seed = 0x5eed1234, fuzzCount = 16) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be uint32');
  if (!Number.isInteger(fuzzCount) || fuzzCount < 0 || fuzzCount > 1000) throw new Error('Fuzz count must be 0..1000');
  const smoke = JSON.parse(readFileSync(new URL('corpus.json', import.meta.url), 'utf8')).map((text, i) => ({ id: `smoke-${String(i).padStart(3, '0')}`, bytes: Buffer.from(text) }));
  const boundaries = ['\ufeffHello.', '\r\n\t', 'a\r\nb', 'e\u0301 é İ ß', 'a\u00a0b\u2003c', '😀𐐀', 'Dr. A. B. said: “Hi!”', 'a'.repeat(300), 'word '.repeat(250), 'First.\n\nSecond?', '0x10 1,234 23rd', 'a\0b'];
  let state = seed >>> 0;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const tokens = ['a', 'READ', ' café', 'é', 'e\u0301', '你好', '😀', '42', "'", '-', '.', ',', '?', ' ', '\t', '\n'];
  const fuzz = Array.from({ length: fuzzCount }, (_, i) => ({ id: `seed-${seed}-case-${i}`, bytes: Buffer.from(Array.from({ length: 1 + next() % 40 }, () => tokens[next() % tokens.length]).join('')) }));
  return [...smoke, ...boundaries.map((text, i) => ({ id: `boundary-${i}`, bytes: Buffer.from(text) })), ...fuzz];
}
