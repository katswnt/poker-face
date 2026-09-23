# Trainer equity accuracy audit

## Scope and outcome

The heuristic trainer now uses exact heads-up river enumeration and fixed-budget
10,000-deal sampling elsewhere. This is showdown equity under a selected opponent
model, **not** an equilibrium strategy or a forecast of full future betting profit.
The finite-game river and turn solvers remain separate and unchanged by this work.

The existing four-player replay moved out of React into `trainer-hand.ts`. Each
hand replay runs in a worker, with no main-thread calculation fallback. Request
identity, worker termination and immutable snapshots keep stale results out of the
view. Old choices remain seeded identically when replayed. New workers start cold;
this audit does not claim previous-street work is free after a new request.

## Mathematical checks

- The production fast seven-card evaluator agrees with the independent readable
  five-card enumeration oracle for three opponent styles on a pinned river.
  The unrestricted population has exactly C(45, 2) = 990 hands after seven known
  cards; range-filtered populations are smaller.
- Seeds and sample-budget arguments do not affect exact river results. Exact
  enumeration reports zero **sampling** standard error and explicit method
  metadata, without calling its allowed hands random samples.
- Exact layered returns include uncontested chips. A heads-up layer inside a
  multi-opponent joint deal stays sampled; it is not incorrectly evaluated as
  an independent heads-up deal with different blockers.
- Wins, forced ties, mixed outcomes, invalid cards, invalid budgets and
  inconsistent layer totals are covered. Calls exactly at the modeled price
  stay close and are described as break-even, not as random error or a slight gain.
  Enumerated close classification allows 64 machine epsilons times the chip
  scale for accumulation roundoff; the raw returned EV is not rounded. A mixed-
  outcome exact-oracle-price regression covers this, not just forced ties.
- Sampled results retain actual-share / total-return variance, fixed 10,000
  accepted samples, deterministic per-spot seeds, and whole-tuple rejection.
  No optional stopping or fabricated confidence guarantee is introduced.
- Twenty independently seeded river runs compare 1,000 and 10,000 samples to
  exact truth. This is a pinned regression, not proof of universal coverage.
- Pure replay conserves chips, does not mutate inputs, and is unaffected on
  earlier streets by changing later board cards. Worker tests exercise actual
  postflop decisions, serialization, real elapsed-time arithmetic, invalid
  requests, errors, stale IDs, unsubscribe and strict-mode restarts.

## Local benchmark

Run `node --import tsx bench/trainer-equity-accuracy.ts` (also `npm run bench:trainer`).
Measured on Apple M1 Pro, macOS arm64, Node v24.10.0. Twenty cold-cache spots per
case, deterministic seeds, unrestricted opponent range. These are local mean
times, not a browser/device performance promise.

| Spot | 1,000 sampled deals | 10,000 sampled deals |
|---|---:|---:|
| Flop, one opponent | 4.87 ms | 23.78 ms |
| Flop, three opponents | 4.54 ms | 44.10 ms |
| Flop, five opponents | 6.93 ms | 66.84 ms |
| Turn, one opponent | 2.37 ms | 23.60 ms |
| River, one opponent | 2.25 ms | 21.76 ms |

Enumerating all 990 heads-up river hands took 1.07 ms per spot. The pinned
75%-equity river's observed RMS sampling error across seeds 200–219 fell from
1.061 to 0.389 percentage points. Mean measured standard error fell from 1.368
to 0.432 points. Both sets happened to cover exact truth in all 20 approximate
95% intervals; that observation is not a guaranteed coverage claim.

Near 50% win/loss equity, the rough planning figures are 1.58 percentage points
for **one** standard error at 1,000 samples, versus 0.50 points at 10,000. The
corresponding normal-approximation 95% margins are about 3.10 and 0.98 points.
Ties can lower measured variance. Range assumptions and future betting are
outside these sampling margins; a zero empirical variance is not proof of no
sampling error.

## UI, accessibility and verification

The baseline-ui and fixing-accessibility skills guided minimal native loading,
error and retry controls, no animation, retained keyboard retry focus and clear
failure messages. Screen-reader status text is not itself marked busy, to avoid
deferring its loading announcement. The existing uncommitted teaching readouts
were adapted to worker estimates without committing those features.

- Focused equity, decision and worker tests: 34 passing (including 19 new tests).
- Earlier equity plus decision regression run: 31 passing.
- Targeted production-build Playwright run: 17 passing across the existing
  keyboard suite and new trainer accuracy suite. It covers real worker startup,
  unavailable workers, accessible retry focus, responsive controls while work is
  pending, stale-message rejection, termination on replacement and close-call
  grading through a controlled worker response.
- Ready-state screenshots at 320, 390 and 1280 CSS pixels; pending/error desktop
  captures; document-level overflow assertions. The preexisting 320-pixel card
  grid can still clip the rightmost seat internally even though the document
  does not scroll sideways; this audit does not call that an accessibility pass.
- Final integrated checks: 483 unit tests and 38 Chromium browser tests,
  type-checking, lint and the production build passed. A separate clean export
  of the staged release passed 472 unit tests and 35 Chromium browser tests
  (no retries), type-checking, lint and the production build. Extra working-tree
  tests belong to the preserved uncommitted features; they were not omitted
  from the working-tree run.
- The clean browser run caught one new test relying on uncommitted mode-reset
  behavior. It now verifies a current-request error, keyboard retry, replacement
  worker and navigation/unmount cleanup supported by both versions. Product
  behavior was not changed to make the test pass.
- All existing solver artifact reproductions, the new turn reproduction,
  exhaustive five-card math audit, compact/scorekeeper/factorization audits and
  boundary profiling passed; see the [turn release audit](heads-up-turn-v1-audit.md).

## Unrelated-work preservation

`PokerSim.tsx` and `e2e/keyboard.spec.ts` already contained substantial local
features. Their committed candidates are derived from HEAD, not by staging the
whole working files. Chip tracking, session helpers, the new teaching readout,
expanded grading rules, and their previously dirty tests remain unstaged.

The working readouts needed owned compatibility changes: async estimates,
method-aware copy, explicitly labeled uncertainty, loading/error states and
retry. Existing keyboard tests gained waits for worker completion; their new
unstaged readout test now expects 10,000 random deals and an approximate sampling
margin. No original test coverage was removed. Optional money snapshots in the
pure replay preserve the original dirty readout's two contributions snapshots.
The close-call early return is independently added after the existing match
return; the original dirty expanded grading condition remains untouched.
