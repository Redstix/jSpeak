# C Oracle smoke harness

Requires Git, CMake, a C compiler and Node 24. User authorization to fetch/build upstream was obtained for this workspace.

```sh
npm run oracle:build
npm run test:oracle
```

The build script fetches the exact repository/commit in `upstream.json` if missing, refuses a dirty or differently checked-out source tree, and builds out-of-tree in `build/oracle/`. It does not install into the operating system. A build stamp binds the requested options, source commit, binary hash and CMake cache hash; generation refuses stale or changed binary/configuration.

The smoke harness runs 22 input cases twice in separate CLI processes with explicit UTF-8, en-us, speed/pitch/amplitude and deterministic random mode (`-D`). It compares exact phoneme-mnemonic stdout and complete WAV hashes. It validates WAV format and records sample rate/count, data hashes and build metadata in a new `artifacts/oracle-*/` directory each run. Empty/whitespace inputs may produce no WAV; that result is explicitly recorded, not replaced with invented silence. A missing WAV for nonempty text is an error.

## Limitations

- This is CLI reference repeatability, **not** C-vs-JS validation.
- CLI phoneme mnemonics are not the canonical internal numeric phoneme representation.
- Internal segmentation, VM, prosody and wave-command instrumentation is not implemented.
- `tools/compare/pcm.mjs` and `wav.mjs` are separately unit-tested comparison primitives. A complete versioned trace comparator is still pending.
- The CMake cache hash is local-build provenance, not a claim of bit-identical binaries across machines. Compiler settings can be inspected in `build/oracle/CMakeCache.txt`.
- The full upstream test suite has not yet been imported or run as part of this smoke harness.
- Chinese-containing smoke input tests the selected English profile's response, not Mandarin support.

Upstream build reference: https://github.com/espeak-ng/espeak-ng/blob/ba90c8e9f440ad544f674a790bb5f53878b6ffc5/docs/building.md
