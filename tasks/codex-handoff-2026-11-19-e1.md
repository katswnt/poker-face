# E1 live action values — release candidate, 2026-11-19

**E1 is not committed, pushed or deployed.** R1 remains production: code `b509656`,
closing documentation `1a6ee2a`; both passed all eight CI jobs. The public release was
verified again at 20:12:20 UTC on November 19. No E1 release claim is warranted yet.

## Working copies and scope

Primary: `/Users/kathrynswint/Documents/poker-face`.
E1 candidate: `/private/tmp/poker-live-ev-87kic_rz`, detached at
`1a6ee2a7a0e982c13e39556e9b029743c573d748`, with copied dependencies.
All implementation, test and artifact work is in the candidate. Primary holds owned
spec/handoff checkpoints and ignored backups under `build/post-p5-2026-11-19/E1-progress/`.
The prospective contract and detailed measurements are in `tasks/live-decision-ev-spec.md`.
The explicit reviewed file list is `/private/tmp/e1-owned-files-01.json` (76 files, including
17 new artifact files); include the test expectation correction described below.

Implemented: optional shared native/WASM action-value export and admission reservation;
strict coverage/null/positive-support checks; Worker integration; explicit saved/local
value bases; immutable original human decision models; and a readable `/play` EV table
and model-relative action comparison. Values are terminal payout minus future contributions,
in chips. No strategy-generation, RNG, range, action-sampling or chip-settlement change.
AI hand-specific values remain hidden until completion. Unsupported/translated choices
remain ungraded. The visible 23.4%-pot warning and AGPL source links remain mandatory.

## Completed measurements and evidence

All native captures and the full serial browser queue completed successfully. All 184
files in `build/e1-release-inputs-01/source-freeze.json` remained unchanged. Existing
historical artifacts were preserved; six separately named successor bundles validated
before writing. They are now in `tasks/artifacts/hu-play-{p1,p2,p3,p4,p5}-e1-successor.*`
and `tasks/artifacts/hu-play-e1-values.*` (P1 has no separate summary).

- Two native 1,000-hand captures: 1,342 requests / 1,148 distinct policies each; unchanged
  old math, actions, complete logs and ledgers. P3 and P4 each replay all 1,000 hands twice.
- P1: all 64 full-range roots, no pruning; independent median 0.244491558% pot, maximum
  0.297718121%. P2 composed exploitability remains 23.399062636% pot, not a global bound.
- P3: 200 cases / 327 accepted solves, export off and on. Enabled cells: 1,069,302 numbers
  and 191,582 unavailable values. P4: 200 cases / 159 live solves; no refusal changes.
- P5: all 200 controller hands / 301 requests / 295 policies; old mathematical results,
  complete logs, actions, requests, replay and ledger unchanged. Teaching views checked separately.
- Enabled Chromium timing: turn-response p95 4,240.8 ms (gate 10,000), river p95 63.9 ms
  (gate 2,000). No claim that the small disabled/enabled difference is a speed improvement.
- All 600 enabled measured browser cases pass. Turn p95 Chromium/Firefox/WebKit:
  4,312.7 / 50,507 / 4,382 ms; river p95 66.6 / 162 / 52 ms. Each peaks at 31,260,672
  WASM linear bytes (29.8125 MiB), versus 29.6875 MiB disabled. This is not total browser
  memory. Firefox retains its existing observer/120-second contract, not a 10-second claim.
- Actual largest result: 241,051 / 241,071 / 241,052 bytes. Maximum measured `finish()`:
  68.800001 / 812 / 71 ms, including finalization/export, not isolated incremental cost.
  Worker JS heaps unavailable; only Chromium has separate coarse page-heap readings.
- Three tiny independent references: maximum discrepancies 0.0000339554147,
  0.0000332480847 and 0.0000304145231 chips (unchanged 0.0002 gate), exact native/WASM.
  Five frozen production rivers: maximum discrepancy 0.002390549696 chips, below their
  separate prospective 0.05-chip sample gate. Neither is a universal per-hand bound.
- All capability-off P1–P4 browser regressions also pass. Full tables are in the spec.
  No budgets, cohorts or mathematical tolerances were weakened; phones remain unvalidated.

## Checks and the remaining test rerun

Prepared app: 96/96. Three-browser `/play`: 28 pass / two explicit non-Chromium zoom-API
skips; added live-value visual checks 3/3. Live-solver suite: 34 pass / two same skips.
Zero retries. 320/390/1280px, enlarged-text and real Chromium 200% zoom images inspected.
Earlier focused math/Worker/adapter/snapshot/evidence tests: 51/51. Stable bridge, WASM,
saved example, river v3, library, wide, gadget and preflop reproduction audits pass.

The first post-capture full suite ran **1,101 tests: 1,100 pass / one fail / zero skips**
in 145.814 s. The only failure was an expected-error mismatch in
`test/hu-play-p5-evidence.test.ts`: its one-chip ledger mutation was correctly rejected
by the new full-identity guard, before the old hash guard. The test now expects the precise
identity error for version 2 evidence, retaining the old hash expectation for version 1.
No validator or gate changed. The corrected file passes **3/3**, zero skips, in 31.695 s.
It is outside the frozen measurement closure; all measured source hashes remain intact.
Original failure: `/private/tmp/e1-final-candidate-full-suite-01.log`.
Focused pass: `/private/tmp/e1-p5-evidence-test-fix-default-02.log`.

Automatic approval review timed out twice before starting the requested combined rerun,
then also timed out on the narrower direct `npm test` request;
it reported no safety finding. A default-sandbox probe confirms `ps` is denied, so the
full native-runner suite still needs permission for process-memory sampling. Do not call
this a mathematical failure or silently skip those tests. The commands never started;
there are no rerun results from those approval attempts. Kat explicitly approved the
rerun on November 20. The approved run subsequently passed **1,101/1,101**, zero failures
and skips, in **144.988 s**. Log: `/private/tmp/e1-full-suite-approved-05.log`.
The tool-level permission block is resolved; no repeated approval request is needed.

All sandbox-safe checks completed successfully through 01:38:41 UTC on November 20
(November 19 locally): typecheck, lint, both Rust formatting/Clippy checks, **23/23 Rust
tests**, and all P1–P5/E1 saved-evidence audits. Script/log:
`/private/tmp/e1-safe-candidate-checks-03.py` / `.log`; session 85868 is closed.
The capture queue (33907) stopped on the test expectation failure; browser queue 35224
completed. No project process remains running from those queues.

The reviewed candidate, all 76 owned files, all 25 aggregate reports/source snapshots,
logs/scripts and inspected browser evidence are backed up under primary's ignored
`build/post-p5-2026-11-19/E1-candidate-verified/`. Its `owned-files.json` records hashes.
The original temporary candidate remains the working checkout; do not overwrite unrelated
primary work when resuming.

## Remaining release sequence

1. Candidate verification is complete: the approved full test run passed 1,101/1,101,
   zero skips. All earlier type/lint/Rust/audit/browser checks still apply to the unchanged
   source closure. Proceed to explicit-file landing and exact-commit verification.
2. Update this handoff/spec with completed candidate checks. Review the 76 explicit paths;
   preserve every old artifact and protected file. Transfer only owned files to primary.
   Stage README from clean HEAD plus E1 hunks, preserving its unrelated working changes.
3. Commit the milestone, then make a clean exact-commit copy with **copied** node_modules.
   `/private/tmp/e1-exact-verify-01.sh` is prepared but has NOT run. It rebuilds native/WASM,
   runs Rust/full-unit/type/lint/audit checks, saved/prepared builds and browser checks.
4. Push main only after exact-commit verification, and confirm all eight hosted CI jobs.
5. Use the existing R1 guarded Vercel 62.1.0 procedure from README; deploy the clean rebuilt
   assets. Verify all public asset/source hashes and both serving-page links, then exercise
   deployed live values, real hands, cancellation and retry. Do not deploy dirty candidate assets.
6. Close the task record/README/handoff with actual commit, CI, deployment and measured
   identities. Verify the closing documentation commit in isolation and keep CI green.

Candidate engine source hash: `f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981`.
Candidate WASM build hash: `65d34699542f04e479aaf52a7e480256a662b4fa3d0c30f817da274d2d3515f4`.
Clean release metadata can change build/archive bytes; prove source correspondence and
numerical parity, not a universal bit-identical-build claim. Raw measurements are in
`build/e1-release-01/`; inputs in `build/e1-release-inputs-01/`; per-phase logs in
`/private/tmp/e1-*-01.log` and the subsequent explicitly numbered fix/check logs.

## Untouched work and next scope

Protected tracked work: METHODOLOGY.md, trainer README hunks, e2e/keyboard.spec.ts,
src/app/globals.css, src/components/PokerSim.tsx, test/copy.test.ts. Protected untracked
work: src/lib/poker/session.ts, test/session.test.ts, src/lib/solver/postflop/configurable-flop/,
tasks/configurable-flop-v2-plan.md and tasks/poker-data-reuse-and-publication.md.
Last recheck: all 15 non-README safeguard hashes match, trainer README added/removed
lines match `build/post-p5-2026-11-19/trainer-readme.patch`, primary index empty.
Recheck before landing. Never exclude the paused draft from type-checking; use isolation.

After E1: prospective push/fold and equity-vs-range drill contracts, then `/play` hand
review. Scripted preflop, hand-written ranges, 12 saved flops, approximate local strategies;
PF4 stays gated. Physical phone checks remain open and nonblocking.

## November 20 network diagnosis

A separate read-only check found DNS resolution denied inside the restricted sandbox
for Poker Face/npm/GitHub/Vercel, while all four resolved and completed TLS outside it.
Poker Face, npm and GitHub returned HTTP 200 in under one second. Vercel's unauthenticated
HTTP 403 explicitly reports a missing token; the existing authenticated CLI login succeeds
as `katswnt`. No proxy variables were set in the checked shell. This does not reproduce
a general machine/network outage or establish the cause of an unseen Codex/browser error.
No DNS, firewall, credential or account settings were changed. Results are in primary's
ignored `build/network-diagnostic-2026-11-20.json`.
