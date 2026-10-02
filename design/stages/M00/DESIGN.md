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

# M00 — Upstream Pinning and Oracle Harness

## Goal

Establish a reproducible upstream eSpeak NG checkout and a C reference harness before porting any
algorithm.

## Deliverables

- `upstream/espeak-ng/` pinned to a recorded commit.
- `upstream.json` containing repository URL, commit, version/build metadata.
- `tools/oracle/` capable of invoking the pinned C build.
- `tests/golden/` schema and generator.
- `tools/compare/` producing machine-readable diffs.
- CI command that builds C oracle and runs smoke tests.

## Upstream facts

Current eSpeak NG builds its language/phoneme data as part of the project; CMake's data build creates
artifacts such as `intonations`, `phondata`, `phonindex`, `phontab`, and per-language dictionaries.
The project also has language tests whose expected results may be phoneme strings, MD5 hashes, etc.
Use the upstream build/test system as the reference rather than duplicating its semantics in this stage.

## Golden levels

Implement four independently comparable outputs:

1. normalized/input representation;
2. phoneme representation;
3. synthesis event/parameter representation where available;
4. PCM output.

PCM comparison must support both exact hashes and tolerance-based numeric comparison.

## Commands

Provide stable scripts such as:

- `npm run oracle:build`
- `npm run golden:generate`
- `npm run test:oracle`
- `npm run compare`

Do not require a global installation of eSpeak NG.

## Acceptance

- A clean checkout can build the pinned oracle.
- `"Hello world"` produces a recorded oracle result.
- At least 20 normal, punctuation, number and Unicode cases are recorded.
- A deliberate JS mismatch is detected by CI.
- The golden format is versioned.
