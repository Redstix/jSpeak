# Third-party provenance

## eSpeak NG (build/test reference only in the initial probe)

- Source: https://github.com/espeak-ng/espeak-ng
- Pinned commit: see `upstream.json`.
- Upstream root `COPYING` contains GPL version 3. Other upstream files include `COPYING.APACHE`, `COPYING.BSD2`, `COPYING.UCD`; file-specific notices must be preserved when porting or redistributing their content.
- The upstream checkout, executable, compiled language data and generated oracle WAVs remain local, ignored build/test artifacts. The initial device probe does not bundle them.
- This notice is not a completed license audit or a substitute for upstream license text. Audit code and data provenance before distributing the actual derived TTS engine.

## Vela build tooling

- `apps/vela-probe/package-lock.json` records npm dependencies and integrity hashes.
- `aiot-toolkit` 2.0.5 and `@aiot-toolkit/jsc` 1.0.9 are build-only dependencies. Installation reported 14 advisories (3 low, 11 high) on 2026-10-02. These are not fixed in this bootstrap; do not expose the development server to untrusted networks. Review transitive licenses/security advisories before production use; no blind `npm audit fix --force` was applied.
- Debug RPK uses the toolkit's standard development certificate. No device key has been extracted or included in source control.

## Probe assets

`apps/vela-probe/tools/generate-assets.mjs` generates the icon, deterministic 64 KiB test resource and a 440 Hz test-tone WAV. No third-party speech recording or upstream speech data is used in these assets.
