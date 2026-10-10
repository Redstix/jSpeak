# Original first-stage phoneme list

`src/core/phoneme-list.js` implements the list-building portion of
`translate.c:TranslateWord2`, beginning immediately before `stress = 0`.
The caller supplies the phonemes and state produced by the preceding word
translation. This boundary is a component of M05; its differential results
do not establish that a complete JS `TranslateWord2`, clause phonemizer,
prosody pipeline or synthesizer is finished.

```js
const builder = createPhonemeListSession(table, PHONEME_LIST_PROFILE, {
  list: priorList,
  state: priorState
});
const result = builder.appendWord(phonemes, {
  dictionaryFlags, wordFlags,
  sourceIndex, wordLength, wordBytes,
  prePause, switchPhonemes: -1, pitchRaised: 0
});
// result: {flags, phonemes, begin, end}
const snapshot = builder.snapshot(); // {list, state}, with owned arrays
```

`list` has `length` and six 1,000-element columns matching `PHONEME_LIST2`:

| Column | Storage | Original field |
| --- | --- | --- |
| `phcode` | `Uint8Array` | `phcode` |
| `stresslevel` | `Uint8Array` | `stresslevel` |
| `wordstress` | `Uint8Array` | `wordstress` |
| `tonePh` | `Uint8Array` | `tone_ph` |
| `sourceix` | `Uint16Array` | `sourceix` |
| `synthflags` | `Uint16Array` | `synthflags` |

The full arena is retained across words. No per-phoneme objects or conversion
back to text are required. An explicit snapshot copies all columns, including
inactive rows. `length()` reads the current count without allocating a
snapshot. Construction copies supplied columns and state. Without supplied
columns, a fresh zeroed arena starts with the original mandatory short-pause
row at index zero and count one. A zero-count arena is rejected: the original
tail accesses its predecessor, including for empty output.

Unwritten fields retain their previous values. In particular, `SetPlist2`
does not initialize `wordstress`; ordinary list writes do not initialize it
either. Empty phoneme output can update a source index in an inactive row.
The implementation preserves those writes rather than resetting a whole row.
Word lengths clamp to 31 for the packed source index, and typed columns retain
the original narrowing to eight or sixteen bits.

The builder preserves stress/tone markers, syllabic consonants, lengthening,
word-boundary markers, pause insertion, dictionary flags, initial-consonant
doubling, capital announcements, pitch-restore commands and stress promotion.
It retains the original 991/995 list thresholds and caller reservations.
Inputs stop at NUL and at most 199 non-NUL phoneme bytes fit the original word
buffer. Returned `phonemes` includes the original in-place insertion of a
short pause when empty output must carry an embedded command.

`state()` returns these values:

- `embeddedFlag`, `endStressedVowel`, `optionCapitals`: signed 32-bit values.
- `prevDictFlags0`, `prevDictFlags1`: unsigned 32-bit values.
- `anyStressedWords`: boolean.
- `embeddedIndex`: count within the 250-slot command arena.
- `embeddedList`: owned `Uint32Array(250)`.

`setState(patch)` validates and applies a partial update atomically. It copies
an incoming command array. `beginClause(patch?)` resets only row zero/count
and the original adjacent `prev_dict_flags[0..1]`/`end_stressed_vowel` fields;
the rest of the list remains intact. An optional state patch is applied before
those resets. The caller owns earlier embedded-command parsing and the
`any_stressed_words` clause reset, and can set their actual resulting state.

Two operations support the surrounding original control flow:

- `appendEmbeddedWordEnd()` implements the empty/deleted-word marker: with
  pending embedded state and room below count 998, it inserts `phonEND_WORD`,
  clears that state and sets this marker's `wordstress` to zero. It returns
  whether a marker was inserted.
- `finishClause(sourceIndex)` requires two reserved slots and appends the
  original two pauses. It writes only `phcode`, `stresslevel`, `sourceix` and
  `synthflags`, preserving `tonePh` and `wordstress`. Source indices narrow
  from unsigned 32-bit input to the original 16-bit column.

The builder does not run `Word_EmbeddedCmd`, translate or combine words,
retry spelling, or choose another language. The preceding orchestration
must supply the resulting pause, dictionary flags, capital/pitch state and
command arena. `switchPhonemes != -1` and an executed `phonSWITCH` byte throw
`PHONEME_LIST_UNSUPPORTED` with `alternate-translator` or
`phoneme-table-switch`; dynamic table changes are outside this fixed English
slice. Undefined arena accesses and missing original backing are rejected.

The independent oracle calls the real original `TranslateWord2`. A generated
copy of `translate.c` receives one observation-only call at the boundary;
the translation and list algorithms remain unchanged, and upstream source
is never edited. The observer records the actual translated phonemes,
dictionary flags, local pause/pitch/switch values and arena/state before the
tail. JS receives that captured boundary state, and its complete arena/state
is compared with original C after the function returns. The empty/deleted
word cases call the original function directly. Clause begin/end tests compile
the corresponding closed code blocks extracted verbatim from the pinned
original source, with strict unique anchors; they are reported separately.

```sh
node tools/oracle/phoneme-list-build.mjs
node tools/oracle/phoneme-list-export.mjs
node --test tests/phoneme-list.test.mjs
node tools/oracle/phoneme-list-selfcheck.mjs
```

The corpus contains 1,185 tail cases and 94 arena operations. It uses original
word translation and original phoneme-mnemonic encoding, actual English table
entries, stress/marker combinations, deterministic sequences, capital/pause
and embedded settings, list exhaustion, source-index narrowing and seeded
residue. Every comparison includes all 1,000 rows, six columns and 250 command
slots. Requests, implementation hashes and the original/helper identities
are saved under `artifacts/phoneme-list-*`.

The runtime and generated data are GPL-3.0-or-later; see
`licenses/espeak-ng/COPYING.txt`.
