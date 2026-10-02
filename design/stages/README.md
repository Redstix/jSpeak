# eSpeak NG Pure-JS Port — Stage Index

This repository contains the stage-by-stage design contracts for a behavior-compatible pure-JavaScript
port of current eSpeak NG, intended ultimately for a constrained Xiaomi Vela RPK.

## Order

M00 → M01 → M02 → M03 → M04 → M05 → M06 → M07 → M08 → M09 → M10 → M11 → M12 → M13 → M14 → M15 → M16

## Critical gates

- M00: reference/oracle infrastructure exists.
- M06: text → phonemes works and is independently testable.
- M10: phonemes/text → PCM works.
- M12: actual Vela playback works.
- M14: production resource optimization.
- M16: maintainable upstream synchronization.

## Upstream references

- https://github.com/espeak-ng/espeak-ng
- https://github.com/espeak-ng/espeak-ng/blob/master/docs/building.md
- https://github.com/espeak-ng/espeak-ng/blob/master/docs/add_language.md
- https://github.com/espeak-ng/espeak-ng/blob/master/docs/phontab.md
- https://github.com/espeak-ng/espeak-ng/blob/master/docs/voices.md
- https://github.com/espeak-ng/espeak-ng/blob/master/emscripten/README.md

## Agent rule

Read `AGENT_PROTOCOL.md` and the current stage `DESIGN.md` before modifying code.
Do not implement later stages early merely because a dependency is inconvenient.
