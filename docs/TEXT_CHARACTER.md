# M02.2 character preprocessing primitives

These modules implement the pinned eSpeak NG `common.c:utf8_in/utf8_in2`,
`translate.c:TranslateChar/SubstituteChar/FindReplacementChars`, and
`tr_languages.c:AlphabetFromChar` behavior required by the fixed `en-us`
tokenizer. They do not translate words or synthesize speech.

`src/core/utf8-scan.js` exports `readForward(bytes, offset)` and
`readBackward(bytes, offset)`. Both return `{codepoint, bytes, start}`. A backward
offset addresses the last byte to inspect, normally `cursor - 1`. The returned
`bytes` is exactly the C return value: it excludes continuation bytes skipped
before reaching the decoded character. `start` records the resulting character
start for diagnostics.

This scanner differs from M01's string decoder. It skips leading continuation
bytes, accepts non-continuation bytes inside a multibyte character, preserves
surrogates and values above U+10FFFF, and returns a partial code point when a
multibyte sequence reaches NUL. The caller supplies the actual backing buffer,
including any terminator/padding. Reads outside that buffer throw; undefined C
memory accesses are not assigned invented behavior.

`src/core/text-character.js` exports:

- `createTextCharacterSession()`: owns replacement state for a text session.
- `session.translate(source, nextOffset, prevIn, codepoint, nextIn, insert = 0,
  wordFlags = 0)`: returns `{codepoint, insert, wordFlags}`. `nextOffset` is the C
  pointer to the next source character. Inserted characters must be processed
  through the same session again, following the tokenizer's inserted-character
  branch. A session persists across clauses; `state()` exposes `{ignoreNextN}`.
- `alphabetFromChar(codepoint)`: returns a stable frozen alphabet record or
  `null`, preserving the upstream ranges and gaps.
- `shouldSplitIdeographs(codepoint, previous)`: uses the exported fixed-profile
  `ideographs` and `altAlphabet` settings.
- `TEXT_CHARACTER_PROFILE`, `FLAG_CHAR_REPLACED`, and `ALPHABET_FLAGS`.

Hangul syllables expand through the original staged insertion path, including
the upstream U+D7A4–U+D7AF behavior and compatibility-jamo table. Replacement
uppercase handling treats the first and inserted second character separately.
The `af`/`nl` source-mutating branch is unreachable in this profile; the module
does not offer other translator settings. The fixed English replacement list
has single-character source entries, so `ignoreNextN` remains zero with this
data; the original matching/state algorithm is retained.

`node tools/build-text/build.mjs` compiles a development-only exporter against
the clean pinned C library, initializes `en-us`, and writes `data/text`.
Initialization produced 18 replacement rules in 116 bytes, including both
strings' NUL terminators and the separate four-NUL entry sentinel. The exporter
also records all 28 alphabet ranges and the actual translator options:
`letterBitsOffset`, `toneNumbers`, `capsInWord`, `apostrophe`, `ideographs`, and
`altAlphabet` are zero; `punctWithinWord` is `[39]`; `charPlusApostrophe` is empty.
These values are measured from initialized data, not inferred from defaults.

The manifest binds the upstream commit, clean executable/build/data identity,
source and library hashes, exporter and generator hashes, raw export hash,
replacement-stream hash, and generated module hash. Generation checks the
reference again before writing. It exports initialization data only, never a
table of C `TranslateChar` answers. Runtime code has no filesystem, host text
codec, host Unicode, or asynchronous dependency.

Run the targeted contracts with:

```sh
node --test tests/utf8-scan.test.mjs tests/text-character.test.mjs
node tools/build-text/verify.mjs
```

The independent primitive differential uses the tokenizer helper's thin C
wrappers: 3,110 scanner cases, 11,650 translations (including the entire Hangul
range and every replacement), 390 ideograph-split cases, and 130 alphabet
boundaries. It preserves requests and source/reference identities in
`artifacts/text-primitives-*`.

The implementation and generated data are GPL-3.0-or-later; see
`licenses/espeak-ng/COPYING.txt`.
