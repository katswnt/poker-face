# H1 hand-review handoff — 2026-11-21

D2 closing commit `1d90561` is pushed; all eight jobs passed in CI `44965504398`.
D1/D2 production is still the verified code `0851bed`. H1 code `6ca2f9a` is pushed,
but **not released**: its hosted WebKit screenshot capture failed. Read [the H1 contract](hand-review-h1-spec.md), then finish
its exact-commit, CI, clean-build deployment and public source/data verification gates.

H1 retains up to 20 completed `/play` hands / 8 MiB serialized data in tab memory, with
immutable original decision/range snapshots, price math, model-relative grades, separate
Worker equity and JSON download. No upload or persistence. Starting a new hand closes
review; a direct keyboard link leads to it after completion. No new solve or policy change.

The superseded candidate checkout has been retired. The isolated release checkout is
`/private/tmp/poker-h1-exact-0bjq5vd0` (copied dependencies). Eleven fail-first
unit cases; 26 focused tests pass. All 200 unchanged P5/E1 cases retain 1,031 decisions,
301 solve requests and every original log/ledger. Capture p95 11.001 ms, max 13.288 ms;
max serialized hand 194,022 bytes. All 27 new browser checks pass, zero skips/retries,
including three engines, narrow layouts, disclosures/downloads and Chromium real zoom.
The spec records failures, fixes, exact commands and scope. No gate was loosened.

Records and explicit ownership list: `build/hand-review-2026-11-21/`. Preserve all protected
work listed in the D2 handoff and the hashes in `build/drill-expansion-2026-11-21/protected.json`.
The trainer README hunks must survive. Do not touch the trainer/session files, paused
configurable-flop draft, its plan or the pre-existing poker-data-publication note. No
TypeScript exclusion. Do not deploy the dirty candidate; use a clean exact release build.

PF4 remains gated. Keep scripted preflop, hand-written ranges, 12 saved flops and the
23.4%-pot composed-policy warning. Physical devices remain unmeasured and nonblocking.
After H1, the agreed post-P5 teaching sequence is complete; choose subsequent research or
product work explicitly rather than silently promoting the preflop model.


## Current release gate

`6ca2f9a` passed full local exact-commit verification (1,133 units, 23 Rust tests,
tsc/lint, 18 audits, production build and full browser suites), but CI `44970183319`
failed on Linux WebKit's single-image height limit in two 200% text captures. No
production deployment occurred. The test now preserves full-page coverage with overlapping
viewport tiles and coverage assertions; nine focused three-engine checks pass locally.
See the spec for the failure, measurements and fix. Verify the fix-forward commit in
isolation, push and observe all eight CI jobs green, then rebuild/package/deploy and
verify public hashes and browsers. Never deploy the superseded failed-CI package.
