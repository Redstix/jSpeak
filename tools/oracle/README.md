# C Oracle harnesses

Requires Git, CMake, a C/C++ toolchain and Node 24. Builds are local; no system-wide eSpeak installation is needed.

```sh
npm run oracle:build
npm run test:oracle
node tools/oracle/build-trace.mjs
node tools/oracle/generate-trace.mjs
```

`build.mjs` fetches the exact commit in `upstream.json` if absent, refuses a dirty/moved source tree and builds the uninstrumented reference in `build/oracle/`. `generate.mjs` runs 22 smoke inputs twice with explicit UTF-8, en-us and deterministic random mode, recording mnemonic stdout, exact WAV hashes and format. Empty input may produce no file; this is explicitly represented.

`build-trace.mjs` preserves both that source and reference build, creates `build/oracle-trace/source/`, applies the versioned `patches/frontend-trace.patch`, and builds into `build/oracle-trace/build/`. Its stamp binds clean/instrumented binaries, CMake cache, config.h, compiler/platform, exact patch and complete compiled-data fingerprints. The generated data must match the clean reference byte-for-byte. Unknown checkout changes, stale patches, changed configuration or data are refused.

`generate-trace.mjs` verifies 22 smoke + 12 boundary + 16 fixed-seed cases (50 total by default). Each input runs in four fresh CLI processes: clean twice and instrumented twice. All mnemonics and WAVs must match; both internal event streams must match. It then runs all CTest tests registered by the fixed build and saves output/JUnit. Failed or timed-out CTest makes the command fail. Missing raw traces for synthesized text cannot pass. All artifacts, including failure input bytes, are retained in a fresh `artifacts/oracle-trace-*/` directory.

```sh
node tools/oracle/generate-trace.mjs --seed 1592594996 --fuzz-count 64
node tools/oracle/generate-trace.mjs --skip-upstream --replay artifacts/oracle-trace-.../smoke-000/trace.json
node tools/compare/trace.mjs expected.json candidate.json
node --test tests/trace.test.mjs
```

The fixed seed generates valid UTF-8 token combinations; this is semantic corpus expansion, not invalid-byte fuzz. `--replay` also accepts a saved `failure.json`; it reruns clean/instrumented outputs with current validated builds. It does not assert historical metadata equivalence; use the comparator on old/new `trace.json` to check that. Unknown arguments fail. `--skip-upstream` explicitly records the skipped tests and is useful for single-case replay.

Trace comparison returns exit 0 for equality, 1 for mismatch/incompatible metadata and 2 for invalid schema. Unit tests invoke this CLI and verify deliberately incorrect candidate data fails.

Coverage is partial: decode output, ReadClause output, completed word table, selected numeric fields before MakePhonemeList. See [trace contract](../../docs/TRACE_FORMAT.md), [source mapping](../../docs/SOURCE_MAPPING.md) and [evidence](../../docs/ORACLE_TRACE.md). Classification now has an independent Unicode oracle and [M01 C/JS validation](../../docs/UNICODE.md); bounded Unicode failure reduction is described in [FUZZ](../../docs/FUZZ.md). Dictionary/rule choices, full phoneme fields, VM/prosody/DSP and arbitrary-boundary state replay remain pending. The frontend harness establishes C instrumentation transparency and repeatability, not full engine C/JS compatibility or full M00 completion.

## Unicode primitive oracle (M01 reference)

```sh
node tools/oracle/build-unicode.mjs
node tools/oracle/test-unicode.mjs
node tools/oracle/unicode.mjs < requests.json
```

Build this after the isolated trace build. It links a standalone C helper independently against the clean and instrumented static libraries without changing either. Its stamp additionally validates the helper source, headers, linked archives, compiler/options and helper binaries. The mandatory selfcheck compares three UTF-8 termination modes and malformed boundaries against both libraries, checks all 1,114,112 Unicode code points via a compact binary export, and records a fresh `artifacts/oracle-unicode-*/report.json`.

The JSON CLI supports single requests or ordered batches. `createUnicodeOracle()` validates the build once and returns a bounded request function; pass `{reference:true}` as its second argument for the clean library. The API covers explicit decoder cursor/peek/EOF, actual common.c and fixed UCD classifications, lower/upper mapping and utf8_out bytes. `exportUnicodeTable`/`unpackUnicodeTableRow` provide a compact independent reference for exhaustive M01 validation. See [contract](../../docs/TRACE_FORMAT.md#独立-unicode-primitive-oracle-v1).

This helper does not define JS UTF-16 string handling or call getc after a non-null decoder has reached EOF. Default c-string mode matches the existing CLI's first-NUL truncation; bounded and nul-terminated modes are separate contracts. Other C encoding modes and common.c:utf8_in/utf8_in2 are not covered. The focused protocol tests in `tests/trace-unicode.test.mjs` explicitly skip when the development helper has not been built; `test-unicode.mjs` requires it and fails if missing or stale.
