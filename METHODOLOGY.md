# Methodology

The numbers this app shows aren't decoration — they come from a few small, testable
engines. This documents how each one works, how it's validated, and where its limits are.

---

## 1. Equity by Monte Carlo (`src/lib/poker/equity.ts`)

For a postflop spot, hero equity means the average share of the pot hero receives at
showdown against the modeled field. There's no simple closed form once opponents hold
ranges, so it's estimated by simulation.

**Each of N = 1,000 trials:**
1. Sample the complete set of opponent hole cards **from a range-filtered pool** — only hands
   with preflop tier ≤ the table style's cutoff (tight ≤ 4, loose ≤ 5, wild = any). This is
   the one modeling choice that matters most. It avoids treating every opponent as fully
   random, but it cannot know a real player's range and does not remove all modeling error.
   Each compatible whole-table combination has equal weight;
   a collision rejects the full set and starts again, so later seats are not biased by
   whichever hand happened to be selected first.
2. Complete the board uniformly from the remaining deck.
3. Score all hands (7-card evaluator) and credit hero 1 for a win or `1 ÷ tied winners`
   for a chop. A regression table checks forced ties from two through six players.

Equity = the average pot share across the N trials.

### Calls with side pots
A single call can reach pots with different fields. For example, a short all-in player may
contest the main pot while only two deeper stacks contest a side pot. Applying one
three-player estimate to every chip is wrong.

The call estimator therefore deals the whole modeled table once per trial, then:

1. scores hero against only the opponents eligible for each pot layer;
2. credits hero's exact share of that layer, including split pots;
3. adds the chip return from every layer; and
4. subtracts the call cost after averaging all trials.

`combinedShare = expectedReturn ÷ contestablePot` gives the decision engine one consistent
number while retaining the main-pot and side-pot estimates separately. Uncalled excess is
excluded because it is returned, not won.

This is a **current-price check**, not a complete expected-value model for an ordinary call.
It assumes the players still in the hand reach showdown and does not simulate later bets or
folds. The trainer can use that simplified check as a rule, but it must not describe the
result as the call's complete long-run profit.

### Determinism seam
The whole hand is recomputed inside one React `useMemo` on every hero action. Equity is
therefore seeded **purely from the spot** — `hash(dealSeed, hole, board, opponents, style)`
— not from a shared, order-dependent RNG stream. Consequences:
- **Reproducible:** the same spot returns the same estimate across re-runs, regardless of
  what the hero did earlier. (The earlier design used one sequential RNG for the whole
  hand, so a spot's value depended on how many draws preceded it — reproducible only if the
  exact same sequence of spots recurred. Per-spot seeding is strictly more robust.)
- **Memoizable:** because equity is now referentially transparent, re-simulated earlier
  streets are served from a cache. On the 2026-08-27 local benchmark, a 1,000-deal,
  two-opponent estimate took about **3.55 ms uncached** and **0.022 ms cached**—about
  **150× faster** for a repeated spot. Results vary by machine; `npm run bench` prints the
  current measurement.

### Uncertainty
Every readout reports the average result and the standard error measured from the actual
sample values: losses are `0`, wins are `1`, and split pots are their real shares. This uses
the usual sample variance divided by `N`. The simulation updates that variance with Welford's
running method, which avoids losing precision when the values are almost identical. A forced
four-way split therefore reports 25% equity with exactly zero sampling error, which is what a
constant result should report. A regression table checks the same forced-board result for every
table size from two through six players. The old Bernoulli shortcut overstated error by `tie
probability ÷ 4` in the variance; near a 50/50 result, a 1% tie rate made the reported error about
0.5% too large and a 20% tie rate made it about 11.8% too large.

For a layered call, the same running-variance method is applied to the **total chips returned
in each trial**. That preserves the correlation between pot layers. A result within two
standard errors of zero is marked close. This describes random-sampling error only;
uncertainty about real opponents and future action is larger.

### Validation — does the estimate agree with a full count?
`exactEquity()` computes ground truth by **full enumeration** against one range-filtered
opponent (feasible only heads-up — multiway enumeration is combinatorially infeasible,
which is exactly why the app samples). The test suite asserts the Monte Carlo estimate
agrees with the exact value within its measured sampling error on pinned river and turn
cases (`test/equity.test.ts`). This is a strong independent check for sampling bias, but two
examples do not prove every possible input is unbiased.

The production loop uses the fast shared `score7` evaluator. The slower `handScore` remains
an independent reference rather than becoming a second production ranking path.

---

## 2. Heads-up push/fold model (`src/lib/solver/`)

Separate from the heuristic trainer: a deliberately small heads-up game in which the small
blind may shove or fold and the big blind may call or fold. Fictitious play searches for a
stable strategy for the committed input matrix; this is not presented as an exact chart for
real poker.

- **Equity matrix** (`equityMatrix.ts`, `equity-matrix.json`): the 169×169 all-in equity of
  every canonical starting hand vs every other, precomputed (2,000 seeded sims each) and
  committed. Shared-card collisions are handled by re-randomizing both hands' suits per
  trial. The shared fast 7-card evaluator (`score7`) is used here and in the trainer. A
  deterministic test compares it with the slower reference evaluator over **100,000 random
  hands** so the fast path cannot silently change hand ordering.
- **Solver** (`pushfold.ts`): fictitious play — each player best-responds to the opponent's
  time-averaged strategy under the chip-based push/fold model. Hands are weighted by combo
  counts (pairs 6, suited 4, offsuit 12).
- **Validation** (`test/pushfold.test.ts`): exact equity symmetry `eq(i,j)+eq(j,i) = 1`; AA is
  shoved and called at every depth; 72o is not called at 15bb; shove-range width increases
  as the stack shrinks; every self-matchup is exactly 50%; and the remaining strategy gap is
  at most **0.0005 big blinds** at every displayed depth after 20,000 rounds.

The UI reads 37 precomputed solutions from 2 to 20 big blinds, so moving the slider does not
run the solver on the browser's main thread. Its status separates two questions:

- **Did the solving method settle for this fixed matrix?** Measured by the strategy gap.
- **Is the matrix itself exact?** No. Every non-self matchup uses 2,000 random boards, which
  gives a standard error of about ±1.1 percentage points per cell near a 50/50 matchup. That
  is a typical error, not a worst case: across the matrix's 14,196 cells, some are off by
  3–4 points (for example, the stored AKs vs QQ cell is 49.0% against a true ≈46.0%).
  Self-matchups are exactly 50% by symmetry. Card removal between the two ranges is also not
  modeled.

The broad range widths are useful, but an individual hand at the edge can move when the random
boards change. The explorer therefore labels those cells as `edge` instead of presenting their
solver frequency as a precise real-poker recommendation.

Try it at `/solver` — a 13×13 grid using the saved, measured solutions.

---

## 3. Testing philosophy

- **Import the real code.** Every test runs against the shipped `src/lib/` modules — no
  re-implemented copies that can silently drift.
- **Invariants over examples.** `test/invariants.test.ts` fuzzes with `fast-check`:
  chip conservation (`Σ payouts = Σ contributions`, no chips created or destroyed) across
  1,000 random pots; side-pot eligibility (a short stack never scoops a pot it didn't
  match); best eligible hand wins every pot layer; betting-round conservation; and evaluator
  ordering consistency.
- **Ground-truth checks.** The Monte Carlo is pinned to exact enumeration; `score7` is
  pinned to `handScore`; ranges are pinned to their exact shipped thresholds.
- **Seams get their own regressions.** Layered calls are tested through the complete path
  from pot eligibility to the trainer's final action, including a case where a heads-up side
  pot makes a call profitable even though its three-way main-pot share alone does not cover
  the price.

Run it all: `npm test` · `npm run typecheck` · `npm run test:e2e` · `npm run audit:math` · `npm run bench`.
The math audit checks all 2,598,960 five-card hands against the canonical category totals.
CI runs lint, types, domain/property tests, a production build, and Chromium smoke tests on
every push.
