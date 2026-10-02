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

# M12 — Vela Adapter

## Goal

Integrate the core with the Xiaomi Vela RPK environment without contaminating the core with Vela APIs.

## Architecture

```text
Pure JS TTS core
      |
      | Int16 PCM
      v
Vela adapter
      |
      v
Vela audio API
```

The adapter owns:
- audio API calls;
- chunk scheduling;
- device-specific sample-rate/format conversion if required;
- cancellation;
- lifecycle handling.

## Constraints

- no Vela imports in `src/core`;
- adapter must be replaceable;
- provide a Node/mock adapter for tests.

## Device validation

Measure on the actual Redmi Watch 5 target:
- initialization time;
- synthesis speed;
- audio underruns;
- peak memory;
- storage size;
- battery/thermal behavior if measurable.

## Acceptance

A short sentence plays end-to-end on the target RPK without native/WASM components.
