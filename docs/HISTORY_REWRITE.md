# Git history rewrite — 2026-10-17

The entire jSpeak repository history was rewritten on 2026-10-17 (UTC), at the user's request.

## Scope

- All branches: `main`, `perf/quickjs-vela-optimization`, `work/bootstrap`, `work/vela-performance`.
- 50 commits reachable from all refs.
- No file contents were changed; only commit identity, commit message, and the resulting object hashes.
- Author and committer are now both `redstix <RedstixTick@outlook.com>`.
- All commit messages are English. `Co-Authored-By` and AI-session trailers were removed.
- Original author/committer dates were preserved.
- All branches were force-pushed to `origin`.

## Hash mapping

The full old-to-new commit map is stored in [history-rewrite-20261017.txt](history-rewrite-20261017.txt).

References in historical build/device records were updated to the new hashes. If an external note or older clone cites a pre-rewrite hash, resolve it through that map.

A pre-rewrite bundle was kept on the machine that performed the rewrite at `~/backups/jSpeak-pre-rewrite-20261017.bundle`.

## After the rewrite

`perf/quickjs-vela-optimization` was fast-forwarded into `main`; both branches point to the 0.6.0 delivery commit.
