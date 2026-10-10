# Fixed English word-stress service

`src/core/word-stress.js` ports `dictionary.c:GetVowelStress` and
`SetWordStress` for the actual initialized `en-us` translator. It consumes the
original selected phoneme table from `createPhonemeTables`; it does not contain
word-specific answers or invoke a phoneme VM.

```js
const session = createWordStressSession(selectedTable, WORD_STRESS_PROFILE);
const result = session.setWordStress(phonemeBytes, {
  dictionaryFlags: flags[0], tonic: -1, control: 0
});
// result.phonemes: Uint8Array without a terminal NUL
// result.prevLastStress: the resulting Translator.prev_last_stress
```

`WORD_STRESS_PROFILE` is exported from both the service and
`data/stress/profile.js`. Its values come from an independent initialized C
export: table index 80, stress rule 0, stress flags 8, unstressed-word values
1 and 3, vowel pause 0, Italian length adjustment 0, and word capacity 200.
The service requires this explicit profile and rejects unsupported settings.
The inactive language-specific stress-rule branches and syllable weights that
cannot affect this profile are omitted. Generic stress markers, priority and
preceding-vowel stress, automatic primary/secondary/diminished stress,
dictionary positions, unstressed-word flags, and tonic replacement retain
their original behavior.

`createWordStressSession(table, profile, {prevLastStress: 0})` preserves
`prevLastStress` across words. Empty strings and consonants leave it unchanged;
pause and vowel processing update it at the original C assignment points.
`state()` returns `{prevLastStress}`. Inputs are copied, and the returned
phoneme slice contains the result of C's in-place transformation.

`getVowelStress(phonemes, table, profile, {stressedSyllable: 0, control: 1})`
returns `{phonemes, vowelStress, vowelCount, stressedSyllable, maxStress}`.
`vowelStress` is an `Int8Array` including index zero and the trailing sentinel;
`vowelCount` is the original count of syllables plus one. This preserves the
distinction between unknown stress (`-1`), diminished (`0`), and unstressed
(`1`), as well as the separate syllabic-consonant marker behavior.

Both functions stop at input NUL and allow a slice to omit its terminator.
At most 199 non-NUL input bytes fit the original 200-byte capacity. The C vowel
scan's limit and the output pointer's 197-byte threshold remain in effect.
Tonic values are restricted to `-1..6`, the defined range of the C stress-code
array. These bounds reject undefined original-memory accesses. Unknown or
missing phoneme codes become SCHWA in `SetWordStress`; `GetVowelStress` skips
missing slots, matching its different original contract.

The independent oracle calls the real public C functions in the clean pinned
library. It does not copy their algorithms. Build/export/check commands are:

```sh
node tools/oracle/word-stress-build.mjs
node tools/oracle/word-stress-export.mjs
node --test tests/word-stress.test.mjs
node tools/oracle/word-stress-selfcheck.mjs
```

The full differential run checks 19,062 cases: all input byte values with
dictionary/tonic variations, stress-marker combinations for every actual
English vowel, buffer and vowel-count boundaries, and deterministic raw-byte
sequences. It compares transformed phonemes, stress arrays and counts,
selected syllable, maximum stress, and `prevLastStress`, and writes requests
plus source/reference identity evidence under `artifacts/word-stress-*`.

The implementation is GPL-3.0-or-later; see `licenses/espeak-ng/COPYING.txt`.
