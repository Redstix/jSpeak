# Original phoneme-table service

`src/core/phoneme-table.js` loads original `phontab` bytes supplied by an adapter.
It ports the table portion of `synthdata.c:LoadPhData`, recursive
`SelectPhonemeTable`, and `dictionary.c:DecodePhonemes`. It does not read files,
load acoustic data, execute phoneme programs, or synthesize speech.

```js
const tables = createPhonemeTables(phontabBytes);
const english = tables.select(80);
const mnemonicBytes = decodePhonemes(phonemeCodes, english);
```

The original header has a one-byte table count in four reserved bytes. Each
table has a four-byte header, a 32-byte NUL-terminated name, and 16-byte
`PHONEME_TAB` records. The module reads the pinned little-endian binary format
explicitly; it checks buffer bounds, the 150-table limit, parent indices, and
inheritance cycles. As in C, unused header bytes and bytes after the consumed
tables have no effect. `consumedBytes` exposes the parsed extent. Unterminated
names and out-of-bounds structures throw rather than performing undefined C
memory accesses.

`tables.tables` preserves each original `{index, name, includes, records}`.
`includes` is zero for no parent, otherwise the parent's index plus one.
`select(index)` applies ancestors first, then the table's own records in order.
Later records override the same phoneme code. It returns a frozen
`{index, name, nPhonemes, entries}` with 256 slots containing original record
objects or `null`. Selections share inherited record identity, retain gaps, and
never leak entries from a previously selected table. `nPhonemes` matches C's
highest code plus one, including gaps; an empty selection has count one.

Records expose `{mnemonic, phflags, program, code, type, startType, endType,
stdLength, lengthMod}`. Numeric values retain the binary field widths, including
unsigned flags. The file's table hierarchy remains available; no generated
flattened phoneme table replaces the original data.

`decodePhonemes(codes, selection)` returns mnemonic bytes without a final NUL.
It stops at the first input NUL, allows a slice to omit its terminal NUL, skips
code 255 and missing slots, implements the original stress-marker exceptions,
and copies an ASCII alphabetic language name after a present `phonSWITCH`
record. The initial C `sprintf("* ")` is overwritten by the final output and
does not introduce a prefix in the returned mnemonic.

The independent development oracle calls the real C functions against the
clean pinned library. Its results are used only for verification, never to
generate the runtime parser or decode implementation:

```sh
node tools/oracle/phoneme-table-build.mjs
node --test tests/phoneme-table.test.mjs
node tools/oracle/phoneme-table-selfcheck.mjs
```

The selfcheck compares all original tables and all 256 selected slots, then
checks each byte code, switch/stress edge cases, and deterministic byte
sequences through C `DecodePhonemes`. It writes requests and a provenance-bound
report under `artifacts/phoneme-table-*`. The oracle verifies source, library,
binary, and original-data identities; the full run checks identities again at
completion.

The implementation is GPL-3.0-or-later; see `licenses/espeak-ng/COPYING.txt`.
