# Original English dictionary rules

`src/core/dictionary-rules.js` implements the pinned `dictionary.c:MatchRule`
and `TranslateRules` algorithm against the original loaded dictionary's rule
groups. It uses `loadDictionary`'s `groups1`, `groups2`, `groups3`, and
`letterGroups` offsets; no generated pronunciation-answer map replaces the
rule bytecode.

```js
const rules = createDictionaryRulesSession(dictionary, selectedTable, RULE_PROFILE, {
  dictionarySession, lookup, lookupLetter
});
const result = rules.translate(wordBytes, {
  wordFlags: 0,
  dictFlags: Uint32Array.of(0, 0), // or null
  phonemes: new Uint8Array(),
  endPhonemesEnabled: true,
  phSize: 200,
  expectVerb: 0,
  prePause: 0,
  prefixBytes: Uint8Array.of(32, 32)
});
```

The result contains `{endType, word, phonemes, endPhonemes, dictFlags,
stateBefore, stateAfter}`. `word` reflects the original restoration behavior;
the input buffer is not modified. Phoneme arrays omit their NUL terminator.
All output slices own their storage, including when the original dictionary is
a Node `Buffer`. State includes `wordVowelCount`, `wordStressedCount`,
`prePause`, `repeatCount`, and `skipWords`. Source backing grows with the input,
so a short word followed by long clause text is accepted. The original local
word copy restores only its first 159 bytes; this is not a source-length cap.
The 200-byte maximum supplied phoneme capacity and all-or-nothing append
checks are enforced.

`setState({wordVowelCount, wordStressedCount, prePause})` restores any subset
of those three signed 32-bit fields; it rejects unknown keys before applying
any change. `translate` captures the restored state in `stateBefore`, then
resets the vowel/stress counters at the original C reset point.
`appendPhonemes(input, added, capacity = 200)` exposes the real
`AppendPhonemes` operation to the outer word translator. It returns owned
phoneme bytes, stops strings at NUL, rejects a whole addition that would
reach the supplied capacity, and updates vowel/stress counters only for a
successful addition. Unstress markers, unknown phonemes and signed counter
overflow preserve the original behavior; inspect `state()` for the result.

`prefixBytes` supplies exactly the two bytes before the word. The default
keeps the old `[0, 32, 32]` padding. An explicitly supplied prefix uses
`[32, prefixBytes[0], prefixBytes[1]]` before the word to bound backward rule
scans, which stop at space rather than NUL.
This represents two bytes of prior context followed by the supplied word,
not an arbitrary unbounded preceding sentence. For example `a` with the
default prefix gives phoneme `77`, while prefix `[32, 95]` gives `23`.
Incomplete UTF-8 leading bytes whose decode would cross from the prefix into
the word are rejected: the original backward scanner can otherwise jump
past this bounded context. Complete two-byte sequences and continuation-only
tail fragments are supported.

`translateBuffer(buffer, wordOffset, options)` is the integration interface
for a word within an actual clause or replacement buffer. It copies all
supplied bytes, including NULs before the word and readable bytes after its
terminator. No synthetic prefix or suffix is added. `wordOffset` must be at
least one, and the backing must contain the word's terminating NUL plus any
context that the original rule reads. The method rejects simultaneous
`prefixBytes`. Its result adds `source`, the complete owned buffer after
translation; `word` remains the slice from the original word offset to its
original first NUL. Callers can write `result.source` back to their working
buffer. Backward or forward accesses outside the provided backing throw;
the interface never invents earlier clause text.

Rule selection preserves common-phoneme groups, conditions, score adjustments,
left/right distance penalties, later-rule tie preference, and the 35-point
two-letter-group adjustment. It retains byte-level UTF-8 pointer movement,
context groups, vowel/stress tests, suffix and prefix results, forward silent-e
replacement, accent removal and restart, and dictionary alternative flags.
Ending flags retain the pinned C build's signed `char` behavior: for example,
`testing` returns `endType = -8382205`. Treating this field as a positive
24-bit integer would change its contract.

`RULE_PROFILE` is measured by initializing the real English translator. Its
256 letter-bit values, eight letter-group pointers (all null for this
profile), and complete 606-byte raw accent table are exported into
`data/rules/profile.js`. The actual options include `letterBitsOffset = 0`,
`toneNumbers = 0`, `suffix = 0`, `diereses = 0`, `bracketPause = 4`, and
`bracketPauseAnnounced = 2`. The runtime requires the explicit matching
profile. `dictCondition` may be passed per translation, as may `expectVerb`.

The supplied dependency callbacks represent real upstream services:

- `dictionarySession.lookup` handles `$list`/`$p_alt` flag lookups. The same
  session must be shared with outer dictionary and character-name operations.
  Rule matching synchronizes its repetition and skipped-word state, and uses
  `resetRepeat()` at the original reset points.
- `lookup(keyBytes)` returns phoneme bytes with the complete C `Lookup`
  semantics. The rule path uses this for digit names. A dictionary miss or
  text replacement may require the later `TranslateWord` service.
- `lookupLetter(codepoint, {nextLetter: -1, control: 0})` returns phoneme bytes
  from the full C `LookupLetter` service. The smaller `LookupLetter2` accent
  helper is not interchangeable with it.

If a required callback is missing on an executed branch, the service throws
`DICTIONARY_RULES_UNSUPPORTED` with `lookup-flags`, `digit-lookup`, or
`letter-lookup`. It never fabricates a fallback pronunciation. Foreign-script
language switches retain the real `phonSWITCH` byte sequence for the caller
to handle; this module does not silently run another language translator.

The development oracle compiles the pinned original `dictionary.c` verbatim
into a helper linked with the clean C library. It calls the original public
`TranslateRules` and `AppendPhonemes`; source inclusion also permits raw static accent-table
export without copying algorithms. The build binds source, library, binary,
dictionary, and phoneme-data hashes.

```sh
node tools/oracle/rules-build.mjs
node tools/build-rules/build.mjs
node --test tests/dictionary-rules.test.mjs
node tools/oracle/rules-selfcheck.mjs
```

The differential corpus has 2,596 rule cases: every ASCII letter and
two-letter pair, deterministic longer letter sequences, real words and
Unicode examples, flags and conditions, suffix extraction, initial phonemes,
buffer boundaries, 308 preceding-context cases, and 75 long-source cases
through 4,096 bytes with restoration boundaries. The 146 full-buffer cases
include earlier words, embedded NUL, Unicode context, trailing readable
bytes, offset two and bounded empty input at offset one. A nonempty word
with only one preceding space can require bytes before the provided buffer;
that undefined original access is an explicit JS rejection. Another 3,397 cases
compare `AppendPhonemes`, including every byte code with stress markers,
whole-addition rejection, embedded NUL, buffer sizes and signed counter
boundaries. It compares phonemes, signed ending types, endings,
restored words, dictionary flags, and state. Digit cases use actual dictionary
entries. This corpus does not claim coverage of unprovided `LookupLetter` or
`TranslateWord` fallbacks; `mother-in-law` is an explicit missing-dependency
contract test until the full letter-name service is supplied.

The implementation and data are GPL-3.0-or-later; see
`licenses/espeak-ng/COPYING.txt`.
