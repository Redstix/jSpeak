# MakePhonemeList preparation and VM boundary

`src/core/phoneme-list-prepare.js` ports the beginning of
`phonemelist.c:MakePhonemeList`, ending immediately before its first
`InterpretPhoneme` loop. It accepts the six-column `PHONEME_LIST2` arena from
the word/clause builder, including the original two terminating pauses.

```js
const prepared = preparePhonemeList(list2, selectedTable, PHONEME_PREPARE_PROFILE);
// {list2, working, bodyLength, endSourceIndex, selectedTableIndex}
```

`list2` is an owned full 1,000-row arena with the original `length` count.
`working` uses `count` for its row count and eight typed columns of capacity
1,000: `phcode`, `stresslevel`, `wordstress`, `tonePh`, `type` (`Uint8Array`),
and `sourceix`, `synthflags`, `phonemeId` (`Uint16Array`). Only its first
`count` rows represent initialized original C data; unused working rows are
zero storage, not a claim about C stack residue. `bodyLength = count - 2`
excludes the two trailing pauses. `endSourceIndex` is captured before list
mutation, matching the original function.

For this fixed English table, `phonemeId = code + 1` references
`selectedTable.entries[code]`, and zero represents a null pointer. It is a
separate column because the original may change the pointer without changing
`phcode`: at this boundary row zero has code 10, but its pointer references
pause code 9 (`phonemeId = 10`). The later transfer loop resolves that pointer
again. Dynamic language-table switches remain unsupported.

The module preserves last-word stress promotion, redundant phoneme-table
switch removal, source-marker movement, real voice substitutions, deletion
of missing phonemes, and word maximum-stress assignment. Input arrays are
not mutated. It does not assume an absent voice replacement table: the
initialized `en-us` export contains `126 -> 37` and `113 -> 37`, both with
flags 3 (word end only and unstressed only). Its measured regression, vowel
pause, word gap and global wordgap settings are zero, and stress flags are 8.
Self-switches to table 80 are retained or removed by the original conditions;
a live switch to another table throws `PHONEME_PREPARE_UNSUPPORTED`.

The C oracle executes the original `MakePhonemeList` preparation. Its generated
source adds a capture and return at the actual boundary before the VM loop;
upstream source is unchanged. Comparison includes the complete mutated
`ph_list2`, all initialized working rows, source metadata and pointer IDs.
This proves only preparation. It does not substitute cached C answers for
the VM or establish final `phoneme_list` equivalence.

```sh
node tools/oracle/phoneme-prepare-build.mjs
node tools/oracle/phoneme-prepare-export.mjs
node --test tests/phoneme-list-prepare.test.mjs
node tools/oracle/phoneme-prepare-selfcheck.mjs
```

The next boundary is the real phase-one interpreter:

```js
const vm = createPhonemeInterpreter(originalPhonindexBytes, selectedTable);
vm.interpret(list, index, {
  start: 0, control: 0x100, translator: true,
  reduce: actualInitializedReduce,
  wordData
}, phonemeData);
```

Its layout is shared with `PHONEME_LIST_FIELDS` and
`createPhonemeListBuffer` in `src/core/phoneme-interpreter.js`. Add the original
`length` (`Uint32Array`), `env`, `prepause`, `amp`, `newword`, `pitch1`, `pitch2`,
`stdLength` (`Uint8Array`), `phontabAddr` (`Uint32Array`), `soundParam`
(`Int32Array`) and `tonePhId` (`Uint16Array`) columns to the working layout.
The row count remains `count`, so it cannot be confused with phoneme lengths.
`createPhonemeData()` provides the full integer parameter/sound/transition
arrays and IPA bytes; `createWordPhonemeData()` holds a complete prior-vowel
row or null phoneme ID.

The interpreter changes resolved pointer IDs in queried neighboring rows,
not only the current row. It also writes current `stdLength`, `phontabAddr`
and `soundParam`, and copies a prior-vowel row before those final writes.
`MakePhonemeList` must honor the returned change/replace/insert/append actions
and its re-interpretation calls before applying default lengths and clause
flags. Missing VM support must remain an explicit error; original standard
lengths alone are not a replacement for running phonindex instructions.

The implementation and data are GPL-3.0-or-later; see
`licenses/espeak-ng/COPYING.txt`.
