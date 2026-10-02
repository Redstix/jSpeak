# eSpeak NG Pure-JS Port — Agent Contract

## Project definition

This project is a behavior-compatible, pure-JavaScript downstream implementation of current eSpeak NG.
The upstream C implementation is the behavioral oracle. The goal is not to redesign TTS or create an
"eSpeak-like" engine.

## Non-negotiable constraints

1. No WASM.
2. No native modules.
3. No browser Web Speech API.
4. No neural TTS.
5. No external pronunciation engine/dictionary unless explicitly approved.
6. Do not invent pronunciation rules.
7. Do not silently omit behavior. Unsupported behavior must be reported and tested.
8. Preserve integer/fixed-point semantics where the C implementation depends on them.
9. Keep language/source data separate from JS runtime code.
10. Do not optimize by changing behavior before differential tests pass.
11. Do not couple core code to Vela, browser, Node audio, or filesystem APIs.
12. Every migrated behavior needs a deterministic test or an explicit documented exception.

## Repository model

- `upstream/espeak-ng/`: immutable upstream checkout pinned to a commit.
- `src/`: pure-JS implementation.
- `data/`: generated JS-runtime data packs, never hand-edited.
- `tools/`: build, oracle, conversion, comparison and benchmark tooling.
- `tests/`: unit, differential, regression, fuzz and performance tests.

## Required implementation style

Prefer typed arrays, integer IDs and reusable buffers over large object graphs.
Avoid per-phoneme object allocation in hot paths.
Do not use JS strings as a substitute for internal Unicode code-point arrays when code-point
semantics matter.

## Definition of done

A stage is complete only when:
- its public/internal contract is documented;
- tests cover normal and boundary cases;
- C-vs-JS differential tests pass where applicable;
- unsupported behavior is enumerated;
- no unexplained allocations or dependencies were introduced;
- the stage's acceptance criteria below are satisfied.

## Agent behavior

If the C implementation is ambiguous, stop and inspect the upstream source/tests. Do not guess.
If an upstream dependency crosses the current stage boundary, create a minimal interface rather than
implementing the next stage early.

# M03 — Dictionary Runtime and Data Loader

## Goal

Implement the runtime dictionary reader and a deterministic JS data-pack format.

## Upstream data model

eSpeak NG's build system compiles language dictionary sources into runtime dictionary artifacts.
Language sources include `*_rules`, `*_list`, optional extra lists and emoji data. Voice metadata
selects a dictionary and phoneme set.

## Deliverables

- `tools/build-data/` converter.
- versioned binary data format.
- `src/data/binary.js`.
- `src/core/dictionary.js`.
- one language pack, preferably `en`, first.

## Binary format requirements

Include:

- magic;
- format version;
- upstream commit;
- language/dictionary ID;
- offsets/lengths;
- integrity checksum;
- compact lookup structures.

Do not serialize the dictionary as a JS object.

## Runtime requirements

- no filesystem access;
- random/streamed access through `Uint8Array`/`DataView`;
- bounds checks;
- deterministic lookup;
- clear error for incompatible data version.

## Tests

Compare dictionary decisions against the C oracle for:
- common words;
- exception words;
- capitalization;
- punctuation;
- unknown words;
- long words;
- non-ASCII words.

## Acceptance

A generated pack can be loaded without Node/browser/Vela APIs and produces the same dictionary
decision data as the oracle for the golden corpus.
