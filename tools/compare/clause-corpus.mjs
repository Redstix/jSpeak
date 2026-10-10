import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const exceptionManifest = JSON.parse(readFileSync(new URL('clause-exceptions.json', import.meta.url), 'utf8'));
if (exceptionManifest.schemaVersion !== 1 || exceptionManifest.profile !== 'read-clause-en-us-v1') throw new Error('Unknown ReadClause coverage exception manifest');
const exceptions = new Map(exceptionManifest.exceptions.map(row => [row.id, row]));
if (exceptions.size !== exceptionManifest.exceptions.length) throw new Error('Duplicate clause exception IDs');

// Raw input is preserved in every report; Node encoding is only a fixture builder.
export function makeClauseCorpus({ seed = 0x5eedc102, fuzzCases = 128 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(fuzzCases) || fuzzCases < 0 || fuzzCases > 4096) throw new RangeError('Invalid bounded clause corpus options');
  const corpus = [];
  const add = (id, bytes) => {
    const raw = Buffer.from(bytes);
    const exception = exceptions.get(id);
    if (exception && exception.inputSha256 !== createHash('sha256').update(raw).digest('hex')) throw new Error(`Clause exception input changed: ${id}`);
    const expectedUnsupported = exception ? { reason: exception.reason, codepoint: exception.codepoint, clauseIndex: exception.clauseIndex } : null;
    corpus.push({ id, utf8Hex: raw.toString('hex'), maxClauses: 128, expectedUnsupported });
  };
  const text = (id, value) => add(id, Buffer.from(value));
  const smoke = JSON.parse(readFileSync(new URL('../oracle/corpus.json', import.meta.url), 'utf8'));
  smoke.forEach((value, i) => text(`smoke-${String(i).padStart(3, '0')}`, value));
  const cases = {
    punctuation: 'Hi, friend; goodbye: yes? No! Next.',
    'punctuation-run': 'Hello?!? Goodbye!!! Next;',
    abbreviation: 'Dr. A. B. Smith met Mr. Jones. Next.',
    'dot-lowercase': 'Mr. smith. next. End.',
    'dot-apostrophe': "Mr.'s book. U.S.A.'s map.",
    numbers: '1. 12.50 1,234 -0.5 23rd 0x10 3/4 2026-10-05.',
    'hyphen-apostrophe': "mother-in-law one--two can't John's dogs'",
    whitespace: ' \t a  b\r\nc\n d\t ',
    paragraphs: 'First.\n\nSecond?\n\n\nThird!\n\n\n\n\nLast',
    'blank-paragraphs': '\n\n\n\n\n',
    'only-punctuation': '. , ; : ? !',
    'closing-brackets': 'Hello.) next [one?] {two!} (three).',
    'mixed-scripts': 'Hello 世界 Ελληνικά Русский العربية हिन्दी 한국어',
    combining: 'é e\u0301 İ ı ß ẞ Α α',
    emoji: 'Hi 😀 👩‍👩‍👧‍👦 🇨🇳 👍🏽 next.',
    bom: '\ufeffHello.\ufeffNext.',
    'nul-middle': 'before\0after',
    'ignored-codepoints': 'a\u00adb\u200cc\u200dd',
    'tibetan-space': 'a\u0f0bb',
    'malayalam-virama': 'a\u0d4d\u200db',
    'sinhala-virama': 'a\u0dca\u200db',
    'phoneme-brackets': '[[h@loU... w3:ld?]] Next.',
    'phoneme-open': '[[a? b. c',
    'private-less-than': 'a\ue03cb',
    'stress-punctuation': 'a\u055cword next.',
    'stress-at-eof': 'a\u055c',
    'two-dots': 'Wait.. what?',
    'replacement-from-js-surrogate': 'prefix\ud800suffix',
  };
  for (const [id, value] of Object.entries(cases)) text(id, value);
  text('ellipsis-unicode', 'Wait… what?');
  for (const cp of [0x0eaf, 0x1801, 0xfe19, 0x22ee, 0x22ef, 0x22f0, 0x22f1]) text(`ellipsis-u${cp.toString(16)}`, `Wait${String.fromCodePoint(cp)} what?`);
  text('ellipsis-later-clause', 'Hello. Wait... what?');
  text('embedded-command', 'Hello\x01+10s world');
  text('embedded-later-clause', 'Hello. Next\x01+10s word');
  for (const size of [723, 724, 725, 726, 727, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 1592]) {
    text(`capacity-word-${size}`, 'a'.repeat(size));
    text(`capacity-space-${size}`, 'a'.repeat(size) + ' Next.');
  }
  for (const [id, value] of [['multi2', 'é'], ['multi3', '界'], ['multi4', '😀']]) {
    for (const length of [724, 725, 792, 795, 796, 797]) {
      text(`capacity-${id}-${length}`, 'a'.repeat(length) + value + ' End.');
    }
  }
  text('many-clauses', 'First. Second? Third! Fourth; '.repeat(16));
  text('long-paragraph', 'word '.repeat(1000));
  const raw = ['00', '410042', 'efbfbd', 'c080', 'c081', 'eda080', 'edbfbf', 'c2', 'e180', 'f09080', 'e14180', 'e18041', 'f5808080', 'ffbfbfbf'];
  raw.forEach((hex, i) => add(`raw-${i}`, Buffer.from(hex, 'hex')));
  for (let first = 0; first < 256; first++) add(`lead-${first.toString(16).padStart(2, '0')}`, [first, 0x80, 0x41]);
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const tokens = ['a', 'READ', ' café', 'é', 'e\u0301', '你好', '😀', '42', "'", '-', '.', ',', '?', ' ', '\t', '\n', '\r', '[', ']'];
  for (let i = 0; i < fuzzCases; i++) {
    text(`seed-${seed}-text-${i}`, Array.from({ length: 1 + random() % 160 }, () => tokens[random() % tokens.length]).join(''));
    const bytes = Buffer.alloc(random() % 129);
    for (let j = 0; j < bytes.length; j++) bytes[j] = random() & 255;
    add(`seed-${seed}-raw-${i}`, bytes);
  }
  return corpus;
}
