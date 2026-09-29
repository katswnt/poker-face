# Preflop model diagnosis — 2026-09-29

Status: diagnosis complete; no payoff-model replacement or production range promotion.
Baseline: `0c53983`, PF3 fitted result. See [raw diagnostic report](preflop-model-diagnosis-v1.json)
for input hashes and full values, and the [Claude handoff](claude-handoff-2026-09-29.md).

## Bottom line

The current solver converges on its declared small game. The near-100% big-blind defence
is not explained away by insufficient iterations, the CFR+ averaging scheme, or chart
versus blocker-conditioned reporting. The questionable part is the approximation of what
happens **after a preflop call**, not demonstrated failure of the CFR implementation.

There are three distinct concerns: sparse/mismatched continuation-value coverage, a payoff
formula that cannot represent all future-betting values, and an estimator sensitive to its
hand-picked flop representatives. These checks establish limitations and sensitivity, not
the correct full-game defence percentage or the unique causal contribution of each issue.

Keep the hand-written library ranges and their labels. Do not feed PF3 into PF4 yet, and
do not tune realization factors until a chart looks familiar. Browser turn/river solving
and saved-flop heads-up play can progress separately with clearly stated input ranges.

## Reproduce (no artifact writes, no Rust required)

```bash
npm run audit:preflop
npm run --silent diagnose:preflop
node --import tsx --test test/preflop-diagnostics.test.ts
```

The diagnostic checks the published artifact hashes and library manifest, verifies that
the fitted table matches PF3, and prints deterministic JSON. It runs the published baseline,
nine numerical/model controls, and twelve delete-one-flop refits/re-solves. Every reported
solve is independently graded within its declared model. Inputs, outputs and assumptions
are not rewritten. The raw report is a diagnostic record, **not a new approved strategy**.
Runtime is tens of seconds on this machine; no browser-safety or hardware-performance claim.

The helper tests independently enumerate physical private-card pairs for conditional
defence, trace all 169 call-versus-fold margins, expose original-target fit errors, and
check scale invariance and the ratio-estimator counterexample below. Existing PF1
push/fold equivalence and separate grader checks remain the numerical anchors.

## 1. More solving does not remove the result

Numbers are BB defence in the usual combo-weighted chart convention. The baseline also
has a blocker-conditioned defence of 99.697736% after a BTN open, versus 99.708139% in
the chart: reporting convention is not the explanation.

| Same payoff model | Iterations | Exploitability (bb/hand) | BTN open | BB defend |
|---|---:|---:|---:|---:|
| Saved PF3, CFR+ | 500 | 0.000187618 | 51.865% | 99.708% |
| CFR+, 100× tighter stopping target | 5,700 | 0.000001979 | 50.809% | 99.998% |
| DCFR, original stopping target | 200 | 0.000105956 | 51.076% | 99.968% |

This is evidence against a convergence-only explanation. It is not a proof that every
individual action in the loose saved average is settled: 72o, for example, still folds
some of the time in the 500-iteration average despite its positive modeled call margin.
Whole-game exploitability is not a per-hand prediction-error bound.

## 2. Why the model calls weak hands

BB has already posted 1bb; calling the 2.5bb open costs another 1.5bb. With the dead 0.5bb
small blind, the pot after calling is 5.5bb. In the **current payoff model**:

`call EV − fold EV = 5.5 × modeled continuation share − 1.5`.

The break-even share is 27.272727%. This is a continuation-value threshold, not permission
to compare raw all-in equity directly with price when future betting is still possible.

| BB hand | Matrix equity vs fitted BTN opening range | Modeled continuation share | Call minus fold (bb) |
|---|---:|---:|---:|
| 72o | 30.4235% | 27.8730% | +0.033014 |
| 83o | 31.5770% | 28.7422% | +0.080823 |
| 32o | 30.6592% | 28.1236% | +0.046797 |

An independent calculation from the deal weights, opening probabilities and terminal
formula agrees with the saved action EVs for all 169 classes to their 0.00001bb rounding.
The optimizer is responding to payoffs that make these calls profitable in its model.
That does not validate those payoffs as actual postflop values.

## 3. Coverage is a large, measured uncertainty

Only 101 of 169 BB classes have direct measurements in the hand-written BB-call library.
The other 68 classes comprise 652 of 1,326 physical combinations. They supply 648.139
defending combos in PF3: **49.022% of the chart's defending mass**. This includes some
premium hands omitted from a call-only range, not just weak hands.

For example, 72o has no measured row. It inherits the `offsuit-other` bucket estimate;
that bucket is measured from K9o, Q9o, J9o, T9o, K8o, Q8o, J8o, T8o, 98o, K7o, 87o, 76o
and 65o. There is no direct evidence here that their average future-play behavior transfers
to 72o. The fit turns its borrowed ratio 0.85744 into R=0.90316 after joint normalization
and target adjustment. **All 3-bet/4-bet-pot realization values remain defaults.**

Two declared arbitrary stress inputs isolate this missing-coverage lever. Change only
unmeasured BB single-raised-pot R cells, then let both players adapt:

| Stress input, not a fitted estimate | BTN open | BB defend |
|---|---:|---:|
| Set those R cells to 0.7 | 61.056% | 84.623% |
| Set those R cells to 0.5 | 69.610% | 62.406% |

**Do not ship either value.** They show substantial model sensitivity, not correctness of
the new percentages. In particular, landing in a familiar defence band is not validation.

## 4. The fit's small stopping residual is not its original-value error

The leaf formula is `share_IP = a / (a + b)`, with `a = equity × R_IP` and
`b = (1 − equity) × R_OOP`. Positive R bounds every matchup share between zero and one.
Increasing the R cap cannot remove that bound. Scaling all R by the same positive constant
changes nothing: these parameters identify **relative**, not absolute, realization.

Actual postflop payoff divided by the starting pot can exceed one, because future bets
can add chips. That is not an equity probability. Conditional per-hand values can do this
without violating the game's overall chip conservation.

| IP AA in the existing fit | Starting-pot units |
|---|---:|
| Weighted sample value from saved flop roots | 1.392791 |
| Original target after ratio adjustment and shrinkage | 1.292171 |
| Value achieved by the fitted bounded model | 0.901378 |
| Adjusted target after pinning | 0.901378 |

The original-target error for AA is **0.390793 of a pot**, while its adjusted-target error
is zero by construction. The worst BB original-target error is 0.263818 (TT). Six sampled
IP class values and three sampled BB class values exceed one. These are values of the
hand-picked sample, not established unbiased all-board values.

The fit pins 28 cells (19 IP, 9 BB), excludes them from its stopping residual, and adds
**0.024323 of a pot** to every unpinned target to enforce consistency. The published
maximum residual 0.004615 is against those adjusted targets. It is a valid description
of what the algorithm stops on, **not** a 0.5%-pot guarantee against original observations.

Additional controls:

| Change | BB defend | Interpretation |
|---|---:|---|
| No conservation shift | 98.568% | Shift contributes, but is not the whole explanation; this refit's original stopping criterion fails (error 0.039463) |
| No shrinkage for measured classes | 97.894% | Missing classes still borrow buckets; this does not supply new measurements |
| Widen R clamps to [0.05, 8] | 98.208% | Still a bounded-share model, not a structural repair |
| All R = 1 | 99.998% | Raw-equity/checkdown-payoff control, not a realistic postflop game |
| All fitted R × 0.9 | 99.708% | Identical rounded policy: a mathematical no-op |

Each resulting game solve converged; a failed fit and a converged game solve are different
facts. In particular, the no-shift row is diagnostic only, not an acceptable fitted table.

## 5. Twelve texture representatives do not validate an estimator

Deleting one representative, refitting, and resolving produces BB defence from **92.183%
to 99.933%**, and BTN openings from 49.908% to 57.348%. The largest BB change comes from
omitting **8s8d3h** (99.708% → 92.183%; about 99.788 combos of L1 defence change). Removing
it also renormalizes the remaining texture weights. This is a leverage test, not a claim
that this board's value is wrong or that omitting it is preferable.

These are **not held-out prediction tests**: no fresh postflop game is solved to score
predictions. One hand-picked board per stratum does not estimate variation within the
stratum. Kish size describes weight concentration; it does not turn these observations
into random samples or justify a confidence interval.

The claim that the ratio removes "flop luck" is not generally true. Counterexample: two
equally likely boards have equities 0.2/0.8 and continuation payoffs 0.1/1.2 pot. The true
mean payoff is 0.65. Observing only the second gives ratio 1.2/0.8=1.5; multiplying by the
true mean equity 0.5 predicts 0.75, still biased by 0.10 pot. A ratio can help under extra
assumptions, but varying realization across boards defeats a general cancellation claim.

## 6. What these checks do not establish

- No correct real-poker BB defence percentage has been established. The old secondary-source
  bands mix assumptions and serve as warnings, not numerical equilibrium targets.
- No new held-out native postflop solves or representative all-board value estimates were
  produced here. More library coverage may help; its adequacy is not yet demonstrated.
- The bounded formula has a proven representational limitation, but its exact causal share
  of the 99.7% result has not been isolated by a validated alternative payoff model.
- The 37.5% "MDF-style" guard still in v1 code/tests is a legacy fixture expectation, not
  an established universal preflop theorem. Its simple risk/reward derivation omits future
  equity and blocker-conditioned responses; label or retire it explicitly in a new model
  version rather than treating it as certification. Likewise AA/KK-never-fold checks apply
  to these fixtures, not every possible game.
- Numerical solver/grader agreement shares the declared terminal rules. It catches many
  implementation errors, but cannot independently validate the economic assumptions those
  rules encode. The PF1 all-in oracle does not exercise flop-continuation assumptions.

## 7. Recommended next research contract, before PF4

1. Freeze a small **training/held-out board and range split before running new fits**.
   Include weak offsuit/suited classes missing from the current call range, strong hands,
   multiple boards within major texture groups, and the relevant SRP/3BP/4BP formations.
   Choose explicit solve, memory and validation-error budgets before generating data.
2. Diagnose the sampling measure: compatibility of both private ranges, board probabilities,
   texture weights and normalized reaches. Check it against complete tiny-game enumeration.
   Per-combo renormalization over available representatives is not automatically the correct
   joint private-hand/board distribution.
3. Compare predicted **from-now chip values** with independently solved continuation values,
   including original-target maximum/weighted errors, class coverage and uncertainty.
   Validate error small enough to support the call/fold margins being used; the present
   72o margin is only 0.033bb. A root exploitability gate alone is not a per-class EV bound.
4. Make an explicit, versioned choice of continuation representation. It must permit
   physically legal future-chip transfers, preserve payoff conventions and constant-sum
   accounting, and pass exact tiny-game reductions. Merely lifting R's cap does not fix
   `a/(a+b)`. Paying `equity × R` independently to both players can create/destroy value.
   Per-hand marginal EVs also do not uniquely identify a pairwise payoff matrix.
5. Prefer a manageable jointly solved preflop/postflop abstraction as a reference where
   feasible. If fitting range-dependent leaf values, report the approximation and validate
   it on held-out ranges; changing leaves as ranges evolve is not ordinary fixed-game CFR.
   A stable outer loop is not proof of a full-game equilibrium.
6. Only then consider PF4, in a **new versioned library**, keeping B4/v1 and PF3/v1 intact.
   If evidence is insufficient, retain the hand-written inputs. This research need not
   block WASM turn/river work or practice starting from the already saved flop scenarios.

## Changes deliberately not made

No solver algorithm, payoff formula, fitted table, published policy, source library, app
strategy, dependency, license, or browser limit was changed. The fit implementation has
only a comment correction. New diagnostic helpers/tests/script are separate from solving;
README, roadmap and the original preflop spec now distinguish implemented features,
research assumptions, measured errors and uncompleted work.
