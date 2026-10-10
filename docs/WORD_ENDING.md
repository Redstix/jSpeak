# English suffix removal

`src/core/word-ending.js` ports the pinned `dictionary.c:RemoveEnding` for the
initialized `en-us` translator. `WORD_ENDING_PROFILE` comes from the real C
translator (`suffixAddE = 101`); its `ion` exception and ten addition strings
are extracted from the original source. It uses the same exported letter
groups as the dictionary rule matcher.

```js
const result = removeEnding(wordBytes, endType, WORD_ENDING_PROFILE, {
  expectVerb: 0,
  copyWord: true
});
// {word: Uint8Array, wordCopy: Uint8Array|null, endFlags, expectVerb}
```

The function owns all returned storage and does not change input. It stops
input at NUL and supplies the caller's required trailing space internally.
It operates on the first space-delimited word while retaining later input
bytes. `word` preserves the original byte positions: removed suffix bytes
become spaces. If a zero-length suffix adds `e` over the supplied delimiter,
the output includes that extra byte. `wordCopy` contains at most 159 original
word bytes after normalization of silent-e marker `E` to `e`.

The suffix length is the low **six** bits of signed `endType`. The original
backward scan counts continuation bytes, even for malformed sequences. At
most 49 bytes are replaced with spaces, so remaining suffix bytes beyond
that bound stay in their original positions. The flags preserve the exact
`(endType & 0xfff0) | FLAG_SUFX` expression, including its overlap with length
bits. English `SUFX_I` restores `y`; `SUFX_E` uses the original groups and
exception lists. Plain signed C character semantics apply to byte-valued
letter checks. Plural `s`/`es`, apostrophe and `SUFX_V` flags update at the
original assignment points. Callers carry returned `expectVerb` into their
shared translator state.

The fixed profile is required explicitly. Suffixes that would read before
the logical word are rejected instead of assigning meaning to unrelated
caller memory. No other language profile is claimed.

The helper calls public `RemoveEnding` in the clean pinned C library. Its
report compares every returned byte, original copy, suffix flag and verb
state against JS. The 8,230-case corpus includes all valid lengths through
63, flag combinations and actual signed rule endings, English exception
words, Unicode and malformed continuations, capacities through 1,024
characters, embedded spaces/NUL, and deterministic raw-byte sequences.
Requests and source/reference identities are written under
`artifacts/word-ending-*`.

```sh
node tools/oracle/word-ending-build.mjs
node tools/build-word-ending/build.mjs
node --test tests/word-ending.test.mjs
node tools/oracle/word-ending-selfcheck.mjs
```

The implementation and generated tables are GPL-3.0-or-later; see
`licenses/espeak-ng/COPYING.txt`.
