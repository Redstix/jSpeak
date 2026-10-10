import { makeClauseCorpus } from './clause-corpus.mjs';
import { createHash } from 'node:crypto';

// Reviewed missing service calls, bound to exact inputs; never inferred from errors.
const announcementGaps = {};

export function makeTokenizerCorpus({ seed = 0x5eedc102, fuzzCases = 128 } = {}) {
  const cases = makeClauseCorpus({ seed, fuzzCases }).map(entry => ({
    id: entry.id, utf8Hex: entry.utf8Hex,
    // This integration runner provides the real dictionary service. Former
    // no-service ReadClause exceptions must now compare normally, not regress.
    expectedReadClauseUnsupported: null,
    allowedTokenizerUnsupported: [], expectedUndefined: false
  }));
  const add = (id, value, expectedUndefined = false) => {
    const bytes = Buffer.from(value), gap = announcementGaps[id];
    if (gap && createHash('sha256').update(bytes).digest('hex') !== gap.hash) throw new Error('Tokenizer announcement exception input changed: ' + id);
    cases.push({ id, utf8Hex: bytes.toString('hex'), expectedReadClauseUnsupported: gap ? { reason: 'character-name-translate-word-textmode', codepoint: gap.codepoint, clauseIndex: 0 } : null,
      allowedTokenizerUnsupported: [], expectedUndefined });
  };
  const examples = {
    'camel-case-plurals': "fooBar XMLParser NATO MPs DVDs ABC's",
    'single-case-runs': 'aB ABc ABCd aBC IJssel XMLParser fooBAR BazQ',
    'quotes-hyphens': "can't dogs' 'one' a-b a - b a--b a-2 a -2",
    'smart-quotes': 'can’t can‘t can?t a′b a´b ‘quoted’',
    'replacement-ligatures': 'æ Æ Œ œ ﬀ ﬁ ﬂ ﬅ ﬆ ﬃ ÆON ŒUVRE æon',
    'replacement-greek': 'ά έ ή ί ϊ ό ύ ϋ ΰ ώ Ά Έ Ή Ί Ό Ύ Ώ ʻ',
    'foreign-boundaries': 'BJPയുമായുള്ള xРусскийy a한국어b aΕλληνικάb αἄβ',
    'hangul-expansion': '한국어 한글 ㄱ ㅎ 가 각 간 갈 꿇 어 애 야 얘',
    'emoji-runs': '😀😀 👍🏽 🇨🇳🇺🇸🇬 👩‍👩‍👧‍👦',
    'emoji-tag': '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}',
    'stray-joiner': 'a👩‍🔬b \u200d😀 a\u200d😀',
    'emoji-presentation': '☀︎ ☀️ a\ufe0e b\ufe0f 👩‍🔬️',
    'digit-word-gaps': 'a 2 a2 2 a 2a 12.34 1,234 23rd 2é é2',
    'underscore-tab': 'one\t two\nthree_four',
    'phoneme-words': '[[h@loU w3:ld]] next',
    'phoneme-close-tail': '[[A:]]word [[x]] WORD [[y]]',
    'internal-phoneme-marker': '[\x02h@loU w3:ld]] word',
    'armenian-emphasis': 'a\u055cword next',
    'comma-marker': 'a\u0557b',
    'readclause-bom-token': '\ufeffa b',
    'end-brackets': 'a [b] (c) {d}',
    'numeric-all-scripts': '١٢٣۴۵۶०१२३ １２３４ ²³ ¼',
  };
  for (const [id, value] of Object.entries(examples)) add(id, value);
  for (const size of [254, 255, 256, 257, 299, 300, 301, 511, 512, 513]) add('length-u8-' + size, 'a'.repeat(size));
  for (const size of [297, 298, 299, 300, 301, 310]) add('word-limit-' + size, 'a '.repeat(size));
  for (const size of [86, 87, 88, 89]) {
    add('hangul-capacity-' + size, '한'.repeat(size));
    add('hangul-pause-safe-' + size, 'a - ' + '한'.repeat(size));
  }
  add('upstream-sbuf-overflow', 'ab - ' + '한'.repeat(88), true);
  for (const command of 'PSARHTIVYMUBF') {
    add('embedded-default-' + command, '\x01' + command + ' word');
    add('embedded-value-' + command, '\x0112' + command + ' word');
    add('embedded-positive-' + command, 'a\x01+12' + command + 'word');
    add('embedded-negative-' + command, 'a \x01-12' + command + ' word');
  }
  for (const command of ['s', 'p', 'q', 'Q', '+', '?', 'é', '\x01']) add('embedded-unknown-' + command.codePointAt(0), 'a\x01' + command + 'word');
  for (const mode of [0, 18, 19, 20, 36, 64, 65, 66, 67, 68, 79, 193]) add('embedded-sayas-' + mode, '\x01' + mode + 'Y AbC-123456 78 word 😀');
  for (const size of [247, 248, 249, 250]) add('embedded-queue-' + size, '\x01P'.repeat(size) + ' word');
  for (const value of ['2147483647', '2147483648', '4294967295', '4294967296', '9223372036854775807', '9223372036854775808', '18446744073709551616']) add('embedded-integer-' + value, '\x01' + value + 'P word');
  add('embedded-key-single', '\x0136Y A B');
  add('embedded-emphasis-reset', '\x013F one \x010F Two');
  add('embedded-empty-word', '\x01F');
  add('embedded-voice-branch', 'a\x01Ven-us next');
  add('embedded-punct-disable', '\x01B0hello');
  add('embedded-punct-no-lookup', '\x01B1hello');
  add('embedded-punct-list-no-lookup', '\x01B., hello');
  add('embedded-punct-reset', '\x01B1hello \x01B0 world!');
  add('embedded-punct-all', '\x01B1 hello!');
  add('embedded-punct-list', '\x01B., hello, world');
  for (const c of '!"#$%&\'()*,-./:;<=>?@[\\]^_`{|}~…—–«»‘’“”') {
    for (const count of [1, 2, 3, 4]) add('announcement-' + c.codePointAt(0) + '-' + count, '\x01B1 a' + c.repeat(count) + 'b');
    add('announcement-end-' + c.codePointAt(0), '\x01B1 a' + c + ' Next');
  }
  for (const c of '+。！？、，；：') add('announcement-rules-' + c.codePointAt(0), '\x01B1 ' + c);
  add('announcement-phoneme-bypass', '\x01B1 [[x/y+z]] word');
  add('announcement-mode-changes', '\x01B/ a//b \x01B0 a+b \x01B! hi!');
  add('announcement-speed-queued', '\x01350S \x01B1 a//b');
  return cases;
}
