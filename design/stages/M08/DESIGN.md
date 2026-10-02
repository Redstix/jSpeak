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

# M08 — Phoneme Tables and Synthesis Data

## Goal

Port the runtime representation of eSpeak NG phoneme tables and their instructions.

## Upstream model

The upstream phoneme table format defines phonemes, properties and executable instructions such as
`length`, `ipa`, `WAV`, `FMT`, vowel transitions, phoneme insertion/change and conditional tests.
It supports inherited phoneme tables and voice-specific phoneme sets.

## Critical design

Do NOT translate the source `phsource` text directly into JavaScript at runtime.

Build a compact binary representation:

```text
phoneme table header
phoneme definitions
properties
instruction bytecode
condition bytecode
formant/vowel references
wave references
```

## Interpreter

Implement a small deterministic VM/interpreter for the compiled phoneme instructions.

The interpreter must preserve:
- phase 1 mutation semantics;
- phase 2 sound-generation semantics;
- condition evaluation;
- phoneme neighborhood queries;
- inheritance resolved at build time.

## Tests

For each instruction opcode and condition:
- unit test;
- one integration test;
- differential test against the C result.

## Acceptance

The selected voice's phoneme table compiles and executes without runtime parsing of source files.
