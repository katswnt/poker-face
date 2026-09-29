# Handoff to Claude — docs reconciliation and preflop diagnosis

Date: 2026-09-29. Repository: `/Users/kathrynswint/Documents/poker-face`.
Reviewed committed baseline: `0c53983` (your PF0–PF3 commit).

## User request and what was done

Kat asked Codex to read your new work, then specifically to:

1. Reconcile the README and roadmap with what actually exists.
2. Diagnose the preflop model before promoting its ranges.
3. Write you this handoff explaining findings, judgment and changes.

Those are the scope of this handoff. No new WASM implementation, playable AI, payoff-model
replacement, PF4 library regeneration, deployment, commit or push is included.

The main [README](../README.md) and [roadmap](solver-lab-roadmap.md) now reflect bridge
B0–B4, the 12-flop library, solver-backed drills, experimental PF0–PF3, and the actual
unfinished WASM/play work. Stale "no page uses the library" and "no solver-backed decisions"
claims are removed. The README distinguishes audited referee cases from arbitrary CLI
solves whose grades are still external self-reports.

Read the [diagnosis](preflop-model-diagnosis.md) and
[hash-bound raw report](preflop-model-diagnosis-v1.json) next. The report can be reproduced
with `npm run --silent diagnose:preflop`. It is read-only and needs no Rust binary.

## What I think about the new work

The native bridge is the major capacity advance. Our original TypeScript engines now
serve a particularly useful role as independent small-game referees, rather than needing
to compete with the Rust dependency on range size. The bridge attribution and limited
large-game verification should remain explicit. The saved library plus drills already
delivers a practical teaching use for that capacity.

The preflop implementation has valuable numerical safeguards: independent profile/BR
grading, tiny-game cross-checks, exact-enumeration all-in inputs, PF1 push/fold equivalence,
hashes and reproducible solves. **These validate the declared model, not its continuation
assumptions.** Keeping the flagged output out of the library was the right boundary.

I would not resume the old configurable-flop-v2 TypeScript expansion automatically.
The bridge covers much of its intended capacity gain. A targeted richer **turn referee**
could still be useful for player- and pot-dependent menus, but should have its own narrow
verification contract rather than expanding every solver at once.

## Main findings, with evidence rather than guesses

1. **More iterations are not the remedy.** PF3 BB defence is 99.7081% in the chart and
   99.6977% conditioned on the BTN open with blockers. A 100× tighter CFR+ target reaches
   0.000001979bb/hand exploitability at 5,700 iterations and **99.9985% defence**. DCFR
   gives 99.9680%. This is not just an averaging/convergence or reporting-convention issue.
2. **The model explicitly makes weak calls profitable.** BB calls another 1.5bb to a 5.5bb
   pot; its modeled continuation share must exceed 27.2727%. PF3 gives 72o 27.8730%, a
   +0.033014bb margin over folding. A separate direct calculation matches the saved
   call/fold action-value difference for all 169 classes within output rounding.
3. **Almost half the defending mass is unmeasured.** The 68 BB classes without direct
   library measurements cover 652 combos and 49.022% of defending chart mass. This includes
   premium hands excluded from a call range, not just trash. Only SRP is measured; all
   3BP/4BP R cells still use defaults. Arbitrarily setting unmeasured BB SRP cells to R=0.7
   or 0.5 produces 84.623% or 62.406% defence. **Do not ship those values or tune to a band.**
   These are deliberately unvalidated stress tests demonstrating sensitivity.
4. **Fit convergence hides a large original-target mismatch.** IP AA: sampled share
   1.392791; original shrunk/adjusted-for-equity target 1.292171; achieved bounded-model
   share 0.901378. The pin changes the target to the achieved value, making its adjusted
   residual zero. The 0.004615 stopping error excludes pinned cells. Original-target
   errors reach 0.390793 pot for IP and 0.263818 for BB. The 28 pins and +0.024323 shift
   are diagnostics of the fit procedure, not evidence those original values were matched.
5. **Changing R's cap is not a structural fix.** `a/(a+b)` remains between 0 and 1 with
   any positive R. Genuine future-betting values divided by the starting pot can exceed
   1. Scaling all R equally is also a no-op. Wider clamps still yield 98.208% defence.
   Removing the conservation shift yields 98.568%, and that refit fails its fit criterion.
6. **The chosen boards have leverage.** Delete-one-flop refits give defence from 92.183%
   to 99.933%; removing 8s8d3h produces the largest change. This is NOT held-out validation
   or proof the board is erroneous: removing it also redistributes the stratum weights.
   The ratio estimator does not generally cancel flop-selection bias; the new tests include
   a two-board counterexample. Kish size is weight concentration, not an accuracy bound.

I found limitations of the payoff model and evidence of sensitivity, not a uniquely
identified cause with a validated numerical replacement. No new native held-out solves
were generated. The diagnosis explicitly distinguishes those facts.

The original preflop spec now corrects its overconfident "PF4 is the fix" / "flop luck
cancels" statements and misleading fit-error interpretation. Its old MDF-style 37.5%
check is labelled a legacy fixture guard, not a universal preflop theorem. The v1 code,
saved validation rows and tests still retain that legacy guard; changing it belongs in
an explicit validation/model version, not a silent rewrite of historical evidence.

## What I recommend next

For **preflop research**, first write a versioned continuation-value validation contract:

- Freeze held-out boards and ranges before fitting, including missing weak classes,
  premium hands, multiple boards per texture and relevant pot types. Set compute/error
  budgets before generating data.
- Verify the joint hand/board measure, then compare original from-now EV predictions
  against fresh continuation solves. Bound per-class value errors where decisions are
  close; the old root exploitability figure is not such a bound.
- Choose a payoff representation that allows future-chip transfers while conserving
  value, and validate against exact tiny joint games. Unnormalizing two independent
  `equity × R` values can violate constant-sum accounting. Marginal per-hand EVs do not
  uniquely define a pairwise payoff matrix. An outer range/leaf-value loop is not standard
  fixed-game CFR or proof of full-game equilibrium.
- Keep PF4 gated. Preserve existing B4 and PF3 artifacts and use a new version if a
  replacement passes. Do not optimize toward a published aggregate defence percentage.

For the **product path**, the next useful milestone remains bounded **WASM turn/river
solving → heads-up play**, using the already labelled hand-written saved flop inputs.
That can proceed without pretending the preflop model is solved. Follow
[WASM W0–W4](postflop-solver-wasm-spec.md) and [play P0+](heads-up-play-resolving-spec.md),
starting with single-thread parity, real memory/export admission, resumable iterations,
cancellation and device measurements. W0 is only a policy helper today, not a measured
WASM implementation. P0 is rules/replay/leak protection, not a real policy source or UI.
Local subgame re-solving is not a global unexploitable-agent guarantee.

## Files from this handoff

Modified (owned hunks only):

- `README.md` — shipped status, drill description, experimental-preflop boundary, roadmap,
  links and read-only diagnostic commands. **Already dirty before this task; see below.**
- `tasks/solver-lab-roadmap.md` — current priority/status overlay, old completed milestones
  retained, CI/native status corrected.
- `tasks/preflop-solver-v1-spec.md` — diagnostic addendum and corrected interpretation;
  PF4 explicitly gated on model validation.
- `src/lib/solver/preflop/realization-fit.ts` — comment only; no numerical change.
- `package.json` — adds `diagnose:preflop`; no dependency or lockfile change.

New:

- `src/lib/solver/preflop/diagnostics.ts` — coverage, original/adjusted residuals, direct
  call/fold trace and a ratio-estimator counterexample; no solver integration.
- `scripts/diagnose-preflop.ts` — hash checks, numerical controls, model stress tests,
  delete-one-flop sensitivity; prints JSON, never writes artifacts.
- `test/preflop-diagnostics.test.ts` — independent combo-pair enumeration, all-class EV
  trace, residual/bound/scale checks.
- `tasks/preflop-model-diagnosis.md`, `tasks/preflop-model-diagnosis-v1.json`, and this file.

No published solver artifact, fitted R table, bridge library file, production range,
algorithm, payoff rule, UI, dependency, license or browser limit was changed.

## Verification

Verified on Node 24.10.0 an isolated export of `0c53983` plus only the files/hunks listed above, at
`/private/tmp/poker-preflop-handoff.qntznT` (a temporary convenience, not a required input):

- **835/835 unit tests passed, zero skips**, including the new four diagnostic tests and
  binary-dependent bridge tests. `SOLVER_BRIDGE_BIN` pointed to the existing local native
  binary. The suite ran with permission for its `ps` process-memory checks (~91 seconds).
- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- **11/11 Chromium drill checks passed** against the production build: keyboard answers,
  review/storage, failed-load retry and 320/390px layouts. This is the targeted drill suite,
  not a new all-browser or full-device certification.
- `npm run --silent diagnose:preflop` reproduced the saved diagnostic JSON
  **byte for byte** (`cmp`). SHA-256:
  `d95b71e978f0c98650fe4583182d8ed99a2406060d0065a51b94590e96cc508d`.
- `npm run audit:preflop` reproduced the original PF2/PF3 results and fit unchanged and
  independently re-graded them. `npm run audit:bridge:library` passed all library hashes,
  schemas, reach/value consistency checks and the saved river referee sample.
- `git diff --check` passed. Original dirty README hunks still reverse-apply cleanly;
  all seven other pre-existing unrelated files retain their starting SHA-256 hashes.
  No index changes were made; published preflop artifacts and bridge library have no diff.

The preceding read-only review of the same committed baseline also passed the native
11-test Rust suite, the full bridge referee audit and four direct-enumeration equity-matrix
spot checks. Those were not all rerun for this documentation/diagnostic-only change.
No expensive full twelve-flop native regeneration or full wider-flop solve was performed.

The **full working tree still fails type-checking solely in the old untracked draft**
listed below; it is excluded from the isolated verification. Do not describe the dirty
working tree as a clean release or quietly disable type-checking to make its build pass.

## Worktree preservation and the old draft

Read `AGENTS.md` and the relevant local `node_modules/next/dist/docs/` guides first; Next is
16.3.3 with breaking differences. This task read the local TypeScript guide. Do not stage
everything, overwrite other edits, or treat a working-tree test as proof of a partial commit.

The pre-existing unrelated work is still present:

```text
M  METHODOLOGY.md
M  README.md                 # trainer/session hunks, separate from this task's solver hunks
M  e2e/keyboard.spec.ts
M  src/app/globals.css
M  src/components/PokerSim.tsx
M  test/copy.test.ts
?? src/lib/poker/session.ts
?? test/session.test.ts
```

There is ALSO a paused, untracked **Codex draft**, not your committed work:

```text
tasks/configurable-flop-v2-plan.md
src/lib/solver/postflop/configurable-flop/
  rules.ts, compiled.ts, session.ts, scorekeeper.ts,
  binary-node.ts, protocol.ts, artifact-node.ts
```

It is unfinished and **does not type-check**: `policy.ts` is missing, and `binary-node.ts`
has stale `FlopV2`/`FlopV2Game` type names. Some scaffolding was added on resume before
Kat clarified that you had advanced the repo. I stopped that implementation, kept it
separate and did not delete, stage or disguise it. Do not blame these errors on your
committed solver. Do not include it in a handoff commit or resume it just because a plan
file exists. Preserve it until its disposition is decided.

If committing this handoff later, use the explicit file list above, review README hunks
individually, and test the exact proposed commit in isolation. Keep the unrelated trainer
and session edits out. An isolated `git archive` plus copied dependencies works; a
`node_modules` symlink to outside the root makes this Turbopack version reject a build.

The current changes are left uncommitted for you. Do not infer approval to publish
experimental ranges from this handoff or from the fact that their numerical tests pass.
