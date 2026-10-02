---
name: vela-rpk-dev
description: Develop, build, and sideload Xiaomi Vela JS quick-app (.rpk) for Redmi/Mi Watch devices via pure CLI (no AIoT-IDE GUI). Use when scaffolding a Vela project, building an .rpk, adapting to a specific watch model, or debugging a sideloaded rpk that shows empty/missing content. Covers the AIoT-toolkit command line, Redmi Watch 5 sizing, and community Bluetooth sideload via watchface helper + official key.
---

# Vela RPK CLI Development (Xiaomi Vela JS Quick App)

Develop Xiaomi Vela JS quick-apps (packaged as `.rpk`) using **only the command line** — no AIoT-IDE GUI needed. Official docs: https://iot.mi.com/vela/quickapp/ (English: `/en/`).

## When this skill applies

- Scaffolding or building a Vela JS quick-app to `.rpk`.
- Targeting a specific watch model (sizing / designWidth).
- Debugging a sideloaded `.rpk` that installs but shows empty content.
- Pure-CLI workflow questions (no AIoT-IDE).

## Key facts

- **Vela JS quick-app is an official, open ecosystem.** The official toolkit is a CLI — GUI (AIoT-IDE) is optional. This is NOT the Apache "Vela" CI project, and NOT Huami ZeppOS. The JS-API device names are `@system.*` (e.g. `@system.device`, `@system.battery`, `@system.router`, `@system.configuration`).
- API feature declarations use `{ "name": "system.xxx" }` in `src/manifest.json` under `"features"`.
- Redmi Watch 5 = **432×514 square, `designWidth: 432`**. (Xiaomi Watch S5 480 round, S3/S4/H1 466 round, Band 9 192 track.)

## Environment prerequisites

- Node.js >= 16 (v24 works). npm.
- `aiot`/`create-aiot` packages come from npm; registry may need `npm config set registry https://registry.npmjs.org/` if a mirror is flaky.

## Pure-CLI workflow

### 1. Scaffold a project

```bash
npx create-aiot ux --name <app>   # interactive; answers "prject template" → pick "vela-demo"
```

Creates a subdir named `<app>`. It ships `src/manifest.json`, `src/app.ux`, `src/pages/index|detail/index.ux`, `package.json` (scripts: `start`=aiot start --watch, `build`=aiot build, `release`=aiot release).

### 2. Install deps & configure device

```bash
cd <app> && npm install
```

In `src/manifest.json` set the target device's `designWidth` (e.g. Redmi Watch 5 → 432), `package` (e.g. `com.application.watch.demo`), and add `"features"` entries for every API you import.

### 3. Build the rpk

```bash
npm run build   # outputs dist/com.application.watch.demo.debug.1.0.0.rpk
npm run release # release build
```

## Components & data binding (critical)

- Valid container/scroll component is `<scroll>` (NOT `<scroll-view>` — unknown element warning; if the open tag is `<scroll>` but the close tag is `</scroll-view>`, template parse breaks and the page renders blank).
- List rendering: `<div class="item" for="item in list">` then bind `{{item.label}}`, `{{item.value}}`.
- Data is per-page in the `<script>` block under `private: { ... }`.
- Default `text` color inherits and page bg may be dark: **always set explicit colors** on every text/div — a black-on-black text looks like "no content".

## Debugging a sideloaded rpk that shows labels but no values

Symptom: headings/labels render, values are blank, tapping a refresh button does nothing.

Diagnose by isolation — replace async API data with a static initial list, then:

1. If **static values also blank** → template/color binding bug (e.g. font color == bg color, or unclosed tags).
2. If **static shows but async (API) is blank** → the system API is failing or returning empty. Common cause: **debug rpk is signed with the dev cert in `node_modules/@aiot-toolkit/.../signature/pem/*.pem`, which differs from the watch's official signing key** — system APIs can be silently refused under a mismatched sideload key. A community sideload (watchface helper + extracted official key) usually keeps APIs working.

## Community sideload (Redmi/Mi Watch)

Official real-device debugging is partner-only and docs currently list only Xiaomi Watch S4. To get a `.rpk` onto a Redmi Watch 5 by yourself, the working community route is **Bluetooth sideload via a watchface customizer tool** that extracts the official signing key, not USB/ADB. Works with the debug rpk as long as colors/signature constraints above are respected.

## Pitfalls to avoid

- `designWidth` mismatch → layout off. Match the exact watch model.
- Missing `"features"` entry for an imported `@system.*` module → API silently unavailable.
- Omitting explicit text colors on a dark watch bg → "app works but shows nothing".
- A closed-tag typo on `<scroll>` → whole page blank.