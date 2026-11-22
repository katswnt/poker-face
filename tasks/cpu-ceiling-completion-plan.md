# CPU-ceiling completion run — 2026-11-22

Authorization: Kat said “Keep going!” and “one shot this entire project” after the
verified H1 release. Interpret this as completing the remaining **written CPU roadmap**,
steps 10–14, and their release/documentation work. The earlier steps and D1/D2/H1 are
already shipped. Baseline: `16f6460`; production remains the verified `de7f0d6` build.

This is an execution plan, not a promise that an untested research hypothesis will pass.
The [CPU roadmap](cpu-ceiling-roadmap.md) working rules remain binding. Each milestone
must meet its frozen gates, be tested as an exact isolated commit with copied dependencies,
and pass hosted CI before dependent work starts. A failed gate gets a measured report;
its dependents stay blocked while independent work continues. Never count blocked work
as shipped or call the entire research program complete when required gates remain open.

## Completion boundary

1. **Step 10 — prospective preflop validation contract.** Freeze a versioned board/range
   corpus, the joint private-card/board measure, payoff conventions, comparison metrics,
   compute budgets and failure behavior before any new fit or solve. Add fail-first
   tests for its executable input/measure/accounting checks. No production model change.
2. **Step 11 — payoff-model v2 research.** Use a representation that permits future-chip
   transfers and conserves value. First test exact tiny joint games; then compare the
   declared candidate with fresh held-out continuation observations. Preserve original
   targets and uncertainty. Record a failed model honestly if the gates do not pass.
3. **Step 12 — conditional PF4.** Only after the complete v2 validation gate passes:
   generate a separate `bridge-v2` library, keep v1 artifacts, retain the 0.3%-pot solve
   gate and B4-style checks, and switch consumers by explicit version. Numerical
   convergence within a fitted model alone never opens this gate.
4. **Step 13 — independent formation coverage.** Lock separate benchmarks for SB–BB,
   CO–BTN and BTN–BB 3-bet pots. Freeze labelled hand-written inputs and menus informed
   by the B3 sizing experiment; estimate before solving. Add versioned saved-library
   coverage with per-spot quality, byte/reproduction and independent referee checks.
   Do not silently change `/play`'s existing game or promote unvalidated preflop ranges.
5. **Step 14 — bounded multiway research.** Start with the existing R0 contract in
   [robopoker evaluation](robopoker-evaluation.md): pinned dependency/licence review,
   exact information-set/action identity, deterministic replay, independent per-player
   gains, full-tree score agreement, ≤60 s and <1 GB. Only on success proceed to a
   separately frozen tiny three-player turn/river continuation contract. No full 6-max
   blueprint, GPU training, paid/server compute or unmeasured browser admission.
6. **Close the run.** Reconcile README/current roadmap status, preserve historical
   results, finish `tasks/codex-handoff-2026-11-22.md` with commits, measured results,
   failed/open gates and protected work. Any new app release gets fresh clean-checkout
   native/WASM assets, pinned guarded Vercel deployment and public source/hash checks.

Physical-device checks remain nonblocking and explicitly unmeasured. Review persistence,
arbitrary history import, multiplayer hosting and redesign are not inferred from “entire
project”; they are not in the remaining CPU roadmap. The protected trainer/session work
and paused configurable-flop draft remain outside this run's ownership.

## Tradeoffs and controls

- **Validation before scope expansion:** avoids fitting another misleading model; costs
  fresh solves and may produce a negative research result. Freeze inputs and budgets,
  measure failures, and advance independent formation/multiway work when permitted.
- **Small exact references plus larger external solves:** gives independent accounting
  checks and practical capacity. Large external grades remain identified as such; a
  small-game referee is not a certificate for every large game or composed strategy.
- **Separate versions and namespaces:** preserves reproducibility and the live product;
  costs duplicate data and integration work. Use explicit immutable manifests and lazy
  downloads, size budgets, and consumer regression tests.
- **Limited laptop compute:** keeps the work reproducible locally; limits coverage.
  Use estimates before allocations, one heavy solve at a time, measured RSS/time limits,
  and deterministic restartable records. Never shrink a frozen test after seeing failure.
- **No aggregate chart-shape targets:** protects against tuning toward familiar poker
  percentages. Check original chip values, card-removal weighting, individual decision
  uncertainty and the declared finite-game strategies instead.

## Release procedure and ownership

Every milestone: prospective spec → failing tests → implementation/measurement → exact
isolated commit (full units, tsc, lint, relevant audits, build when app code changes) →
explicit-file push to main → all CI jobs green. README uses an isolated staged blob;
unrelated hunks remain in the worktree. For UI work use baseline-ui and accessibility
skills, local Next.js guides, keyboard/three-engine/reflow checks and visual inspection.

Step 10 prospective ownership: this plan, `tasks/preflop-validation-v2-spec.md`, new
`src/lib/solver/preflop-v2/` validation/fixture files, a new contract test/audit script,
its package/CI wiring, and current-status documentation hunks in `README.md`,
`tasks/cpu-ceiling-roadmap.md`, `tasks/solver-lab-roadmap.md` and the dated handoff.
Existing preflop-v1 code/artifacts, B4 data and all play source-bound evidence stay unchanged.
Later milestone ownership must be declared in its contract before implementation.

Safeguard: `build/cpu-finish-2026-11-22/` holds the starting HEAD/status, protected hashes
and copies, the trainer README patch and current checkpoint. Step 10 was verified in the
clean, copied-dependency checkout `/private/tmp/poker-pf10-exact-jhxtywnl`, now the next
candidate. Its redundant predecessor was retired only after all source matched the
verified commit. Preserve
`/private/tmp/poker-h1-fixed-90bavjbh` as the exact deployed build until a verified successor.

## Progress

- [x] Step 10 contract and executable validation gates landed, CI green.
- [ ] Step 11 candidate measured and its complete pass/fail result landed, CI green.
- [ ] Step 12 PF4 shipped **only if** step 11 passes; otherwise record the blocking evidence.
- [ ] Step 13 independently gated formation coverage landed and any UI release verified.
- [ ] Step 14 R0 measured; follow-on work only if its frozen gate passes.
- [ ] Closing documentation/handoff and all required release checks complete.


Step-11 measurement: [research record](preflop-v2-research.md). The tiny reference and
504 preflights pass; the first large calibration root fails the frozen ten-minute gate.
Zero accepted calibration/held-out observations and no fitted candidate. PF4 is blocked
by incomplete required validation, not by an established failure of the untested additive
model. Continue independent steps 13 and 14 only after this release's exact checks and CI.
