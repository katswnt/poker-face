# Methodology

The numbers this app shows aren't decoration — they come from a few small, testable
engines. This documents how each one works, how it's validated, and where its limits are.

---

## 1. Equity by Monte Carlo (`src/lib/poker/equity.ts`)

For a postflop spot, hero equity = P(hero wins the pot at showdown) against the current
field. There's no closed form once opponents hold ranges, so it's estimated by simulation.

**Each of N = 1,000 trials:**
1. Deal each opponent a hole-card combo sampled **from a range-filtered pool** — only hands
   with preflop tier ≤ the table style's cutoff (tight ≤ 4, loose ≤ 5, wild = any). This is
   the one modeling choice that matters most: equity-vs-*random* systematically overstates
   hero strength because real opponents don't stack off with junk. Filtering to plausible
   holdings removes that bias.
2. Complete the board uniformly from the remaining deck.
3. Score all hands (7-card evaluator) and credit hero 1 for a win, ½ for a chop.

Equity = wins / N.

### Determinism seam
The whole hand is recomputed inside one React `useMemo` on every hero action. Equity is
therefore seeded **purely from the spot** — `hash(dealSeed, hole, board, opponents, style)`
— not from a shared, order-dependent RNG stream. Consequences:
- **Reproducible:** the same spot returns the same estimate across re-runs, regardless of
  what the hero did earlier. (The earlier design used one sequential RNG for the whole
  hand, so a spot's value depended on how many draws preceded it — reproducible only if the
  exact same sequence of spots recurred. Per-spot seeding is strictly more robust.)
- **Memoizable:** because equity is now referentially transparent, re-simulated earlier
  streets are served from a cache. Measured: **~91 ms cold, ~0.02 ms warm — a ~4,000×
  speedup** on repeated spots (`npm run bench`).

### Uncertainty
Every readout reports **~X% ± SE**, where SE = √(p(1−p)/N). At N = 1,000, SE ≈ 1.6% near
p = 0.5. This is the honest precision of a 1,000-sample estimate; it is not hidden.

### Validation — is the estimator unbiased?
`exactEquity()` computes ground truth by **full enumeration** against one range-filtered
opponent (feasible only heads-up — multiway enumeration is combinatorially infeasible,
which is exactly why the app samples). The test suite asserts the Monte Carlo estimate
converges to the exact value **within its own confidence interval** on both the river and
the turn (`test/equity.test.ts`). This is the load-bearing check: it proves the sampler is
unbiased rather than merely plausible-looking.

**Throughput:** ~11,000 sims/sec, ~11 equities/sec/core (Node 20). A full 4-player hand is
~12,000 sims, run once at deal time.

---

## 2. Heads-up push/fold Nash solver (`src/lib/solver/`)

Separate from the heuristic trainer: a **real, computed Nash equilibrium** for the
heads-up preflop shove-or-fold game, verifiable against published charts.

- **Equity matrix** (`equityMatrix.ts`, `equity-matrix.json`): the 169×169 all-in equity of
  every canonical starting hand vs every other, precomputed (2,000 seeded sims each) and
  committed. Shared-card collisions are handled by re-randomizing both hands' suits per
  trial. A dedicated fast 7-card evaluator (`score7`) is used here and is **proven
  byte-identical to the main `handScore` over 100k random hands** (locked in as a test so
  the two evaluators can't drift).
- **Solver** (`pushfold.ts`): fictitious play — each player best-responds to the opponent's
  time-averaged strategy under the standard chip-EV push/fold model; in this zero-sum game
  that converges to Nash. Hands are weighted by combo counts (pairs 6, suited 4, offsuit
  12).
- **Validation** (`test/pushfold.test.ts`): equity symmetry `eq(i,j)+eq(j,i) ≈ 1`; AA is
  shoved and called at every depth; 72o is not called at 15bb; shove-range width increases
  monotonically as the stack shrinks. At **10bb effective: SB shoves 58.0%, BB calls 37.5%**
  — squarely in the published Nash ballpark (BB ~35–45%). The known textbook simplification
  (no card-removal in the calling model) accounts for SB sitting a hand or two off the
  widest published charts.

Try it at `/solver` — a 13×13 grid re-solving live across stack depths.

---

## 3. Testing philosophy

- **Import the real code.** Every test runs against the shipped `src/lib/` modules — no
  re-implemented copies that can silently drift.
- **Invariants over examples.** `test/invariants.test.ts` fuzzes with `fast-check`:
  chip conservation (`Σ payouts = Σ contributions`, no chips created or destroyed) across
  1,000 random pots; side-pot eligibility (a short stack never scoops a pot it didn't
  match); betting-round conservation; evaluator ordering consistency. These caught nothing —
  which, after thousands of random inputs, is the point.
- **Ground-truth checks.** The Monte Carlo is pinned to exact enumeration; `score7` is
  pinned to `handScore`; ranges are pinned to their exact shipped thresholds.

Run it all: `npm test` (58 assertions) · `npm run bench` · CI runs lint + types + tests +
build on every push.
