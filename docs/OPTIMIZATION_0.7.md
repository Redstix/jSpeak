# 0.7.x optimization plan — 2026-10-17

Baseline: 0.6.0-en / 0.6.0-cmn (exact C/JS PCM, but device performance and stability are unacceptable).

## Device baseline (user-reported, Redmi Watch 5 eSIM / Vela QuickJS)

| Item | Mandarin | English |
|---|---:|---:|
| Init | 8,689ms (acceptable) | 1,121ms |
| Single synthesis | median 5,436ms | 5,637ms |
| RTF | 3.6519 | ≈5.36 |
| 10 consecutive runs | crash on #5 | crash on #7 (stable) |

The watch environment is not reproducible here. Use a local QuickJS harness as a proxy for memory/GC/leak behavior; Node/V8 numbers are not device numbers.

## Quality budget (relaxed; error limits doubled from the prior proposal)

C exact is **no longer a gate**. Keep the C oracle as the reference for loss measurement.

For each corpus case, align optimized and oracle WAV, then require:

- Duration drift ≤ **2%**
- Energy drift ≤ **6%**
- NRMSE ≤ **10%**
- SNR ≥ **20 dB**
- LSD (0–8kHz, 20ms frames) ≤ **3.0 dB**
- No dropouts or clicks; no truncation

Final acceptance also needs the user's listening check. Report every metric per corpus and the worst case, not only averages.

Implementation: `docs/QUALITY_BUDGET.md` + `tools/compare/quality-budget.mjs`; corpus = fixed en 67 cases, cmn 30 cases, plus long/stress cases.

## Workstreams

### P0: lifecycle and crash

- One synthesizer per language per page, not per run.
- Release PCM/command buffers, WAV bytes, readback buffers, and file handles after each run.
- Clear `audio` callbacks; wait for `onended`/cleanup before the next run; add a bounded watchdog.
- Delete generated WAV; verify deletion.
- Serialize runs; no overlapping synthesis.
- Check openvela QuickJS quirks: TypedArray/ArrayBuffer release, GC timing, `setTimeout`, promise job queue, file/audio native handles.

### P0/P1: memory

- Single-language residency; do not keep both en and cmn data.
- M13 data minimization: prune unused dictionary entries/tables after proving they are unreachable for the fixed corpus and general text.
- Reuse arenas and buffers; cap in-flight PCM; avoid 2.3MB cmn data being re-read/re-allocated every run.
- Target: no monotonic heap/RSS growth across 10/30 runs.

### P1: CPU (QuickJS)

- Profile per stage: data load, front-end, Generate, Wavegen, WAV write, playback.
- Hot loop: reduce calls/property lookups/allocation; precompute sine/table data; integer paths; block processing.
- Allowed low-loss algorithm changes: fewer peaks/harmonics, lower internal sample rate/bandwidth, coarser formant updates, silence skipping. Each must pass the quality budget.
- Optional runtime cache for repeated text/command sequences, with a memory-cost accounting.

### P2: front-end/init

- Mandarin init 8,689ms is acceptable but can be reduced; cmn dictionary lookup cache, lazy data init.
- Do not trade correctness for startup time.

## Iteration rules

- One round = at most 2–3 related changes. Measure Node + QuickJS proxy + quality; commit only if improved and within budget.
- Stop when two consecutive rounds improve median RTF by <5% and do not reduce memory/crash risk, or after 5 rounds without a material win.
- No per-phrase special cases, no hardcoded test-text paths, no giant rewrites for tiny gains.
- Every round gets a short record: hypothesis, diff scope, before/after RTF, heap/RSS, quality metrics, decision.

## Exit criteria for 0.7.x

- 10/10 (then 30/30) en and cmn runs without crash in the local QuickJS proxy.
- Node and QuickJS proxy RTF materially lower; target ≤1.0, report the achieved floor if not reached.
- Quality within the budget above; user device listening confirms acceptable Mandarin and English.
- RPKs built with identity; docs updated; all commits pushed.
