import { createHash } from 'node:crypto';

const undefinedInputs = {
  'sayas-36-97-3': 'c9346a51c95bc44e101fc0bdeb93723515e9ff28a494b0931f1ca4e55aa92340',
  'sayas-36-107-3': '57d4c35ec817f9a6b42637ca5474c4b55d3ba215245e44f53a68227550fa1bea'
};
export function makeWordCorpus() {
  const fixtures = [];
  const add = (id, text, context = {}) => fixtures.push({ id, request: { utf8Hex: Buffer.from(text).toString('hex'), ...context } });
  const words = ['hello', 'world', 'the', 'a', 'i', 'cat', 'cats', 'dog', 'dogs', 'testing', 'tested', 'walked', 'running',
    'unhappy', 'unbelievably', 'happiness', 'replacement', 'riposted', 'boogey', 'read', 'record', 'object', 'present', 'to', 'have',
    'tv', 'bbc', 'nasa', 'abcdefg', 'xylophone', 'café', 'résumé', 'é', 'è', 'ɑ', 'ɒ', 'ß', '𐐨',
    '0', '1', '12', '42', '100', '1000', '1900', '2026', '23rd', '4.5', '1,234', 'iv', 'ix', 'xl', 'mmxxvi',
    '+', '😀', '👩‍🔬', '👍🏽', '🇨🇳', '²', '₅'];
  for (const [i, word] of words.entries()) {
    for (const operation of ['word3', 'word', 'withBounds']) for (const wordOut of [true, false]) add(`word-${i}-${operation}-${wordOut}`, word + ' ', { operation, wordOut });
  }
  for (const word of ['read', 'object', 'the', 'a', 'b', 'cat', 'nasa', 'running', 'unbelievably', 'boogey']) {
    for (const flags of [1, 2, 4, 16, 128, 1024, 2048, 3072, 65536]) add('flags-' + word + '-' + flags, word + ' ', { words: [{ flags }], state: { clauseLowerCount: 12, clauseUpperCount: 4 } });
  }
  for (const mode of [0, 18, 19, 20, 36, 193]) for (const word of ['abc', 'key', 'a', '42', 'Plus', 'é', 'ɑ', '²', '😀']) add('sayas-' + mode + '-' + word.codePointAt(0) + '-' + word.length, word + ' ', { state: { optionSayas: mode } });
  for (const field of ['expectVerb', 'expectVerbS', 'expectNoun', 'expectPast']) for (const value of [0, 1, 2, 3]) {
    for (const word of ['read', 'record', 'present']) add(`expect-${field}-${value}-${word}`, word + ' ', { state: { [field]: value } });
  }
  for (const value of [0, 1, 2, 3, 4, 6]) add('prior-stress-' + value, 'and ', { state: { prevLastStress: value }, words: [{ flags: 16 }] });
  for (const count of [159, 160, 199, 300, 799]) {
    add('long-word-' + count, 'a'.repeat(count) + ' ');
    add('long-tail-' + count, 'word ' + 'word '.repeat(count));
  }
  for (const text of ['u . s . a ', "u . s . a .'s ", 'in front of ', 'one of the ', 'new york ', '👩🏽‍🔬 next ', '🏴\u{e0067}\u{e0062}\u{e007f} next ', '😀 hello ', 'boogey hello ']) {
    for (const operation of ['word', 'word3', 'withBounds']) add('multi-' + fixtures.length, text, { operation, words: Array.from({ length: 8 }, () => ({ length: 1 })) });
  }
  let seed = 0x51ced123;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let i = 0; i < 128; i++) {
    let text = ''; const length = 1 + random() % 16;
    for (let c = 0; c < length; c++) text += String.fromCharCode(97 + random() % 26);
    add('generated-' + i, text + ' ');
  }
  for (const fixture of fixtures) {
    fixture.expectedUndefined = Object.hasOwn(undefinedInputs, fixture.id);
    if (fixture.expectedUndefined && createHash('sha256').update(JSON.stringify(fixture.request)).digest('hex') !== undefinedInputs[fixture.id]) throw new Error('Reviewed word source-UB input changed: ' + fixture.id);
  }
  return fixtures;
}
