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

# M16 — Upstream Synchronization and Long-Term Maintenance

## Goal

Prevent the project from becoming another abandoned snapshot like old browser-oriented eSpeak ports.

## Upstream update workflow

1. Update `upstream/espeak-ng`.
2. Record new commit/version.
3. Build the C oracle.
4. Run upstream tests.
5. Generate differential results against existing JS.
6. Identify changed C/data files.
7. Map changed files to JS/data equivalents.
8. Port only required behavior changes.
9. regenerate data packs.
10. run full JS regression + fuzz + benchmark.
11. review resource deltas.
12. update compatibility manifest.

## Change classification

- `DATA_ONLY`
- `ALGORITHM_PORT_REQUIRED`
- `API_IRRELEVANT`
- `PLATFORM_IRRELEVANT`
- `UNKNOWN_REQUIRES_REVIEW`

Never automatically discard `UNKNOWN`.

## Compatibility manifest

Record:

```json
{
  "upstreamCommit": "...",
  "supportedLanguages": ["en-us"],
  "supportedFeatures": [],
  "knownDifferences": [],
  "dataFormatVersion": 1
}
```

## Acceptance

A documented upstream update can be reproduced from a clean checkout and produces a complete
pass/fail report.
