# Heads-up flop, turn and river — M5 reference contract

Locked before implementation/acceptance solves, 2026-09-23. Baseline `ab0cc2e`.
Parent: [CPU-first plan](cpu-postflop-solver-plan.md). M5 has two separate gates:
this tiny reference proof, then a profiled wider-range backend (at least 64 hands/side).
Completing this reference alone does not complete M5 or the practical M6 library.

## Rules and observations

- Ordinary 52-card heads-up hold'em, three known distinct flop cards. Two explicit
  weighted physical-combination ranges; root deal weights are compatible products,
  normalized jointly. No rake, odd-chip rounding, preflop model or multiway claims.
- Same positive whole-chip starting contribution from each player, potentially unequal
  nonnegative behind stacks. Player 0 acts first on every street.
- One positive whole-chip opening bet per street, capped to the bettor's remaining
  stack (the turn-v1 convention). Check/bet when unopened, fold/call facing a bet;
  capped calls, no raises, no betting into an all-in opponent.
- Check/check and bet/call finish a street. Folds end immediately. Nonfolded all-ins
  still reveal remaining cards without later decisions. Unmatched chips are returned;
  net terminal utility includes the initial contribution and sums to zero.
- For a fixed compatible private deal: 45 legal turns, then 44 legal rivers, each
  ordered runout probability 1/1980. Public union: 49 turns, then 48 rivers, with
  private-card masking. Ordered runouts are never merged across intervening decisions.
- A decision observes own hand, flop, already revealed cards and all earlier public
  actions. Neither future card nor opposing hand enters an information key. A turn
  decision remembers the flop history. Earlier actions affect later conditional ranges.
- Enumerated chance/value calculations use float64. Finite-iteration strategies remain
  approximate for this finite menu game, not exact/universal GTO or Monte Carlo equity.

## Additive implementation

New `src/lib/solver/postflop/flop/` modules; preserve all accepted turn/river engines,
source artifacts and browser limits. Pure public rules plus a readable private-deal
adapter expose the existing extensive-form interface. Reuse the unchanged audited
full-tree ordinary CFR and compact CFR/CFR+ as numerical references, not as a new
flop scaling claim. A separately implemented history/cash/runout oracle uses the slow
5-of-7 evaluator; independent best response groups indistinguishable states.

Reference admission: at most 8 combinations/player, 16 compatible deals, 1,000,000
full states, 100,000 iterations and 16 checkpoints. Count one betting skeleton with
45/44 multiplicities before tree allocation. Chip/text bounds follow turn-v1. The
reference is offline only. Wide admission must be separately measured and locked.

## Locked first acceptance fixture

`heads-up-flop-v1`: board `Ks 8s 4d`; ranges `AsQs:0.5 KdKh` versus `QsJs 9h9d:2`.
Contributions 50 each, behind stacks 75 each, bets 25 / 25 / 25.
Three compatible deals, nonuniform root weights, one shared-card collision, draws and
legal decisions on all three streets. These ranges are handcrafted, not preflop advice.

Reference acceptance run: 1,024 alternating CFR+ iterations, order 0 then 1,
averaging delay 20, linear completed-iteration weighting, checkpoint 256 and final.
Required exploitability <=0.25 chip (0.25% of starting pot); <=0.10 chip preferred.
Maximum isolated run envelope: 10 minutes and 2 GiB sampled combined process RSS,
including compilation, grading and export. If quality or resources fail, report the
failure before changing implementation; never loosen the gate after seeing results.
No early acceptance solve until the ordinary-CFR equivalence tests pass.

Lock input/hash before the solve. Hash full rules/transitions and complete saved policy;
hash deterministic payload only, not timing, RSS or gzip measurements. Reproduction
must compare bytes without overwriting. Publish actual grade, both gains, net chip units,
counts, backend, precision, iterations and resource observations separately.

## Required proof and regression evidence

- Every legal chance edge and terminal agrees with independently enumerated runouts,
  slow showdown and money replay, including ties, zero/unequal stacks, short calls,
  folds on each street, returns and automatic two-card all-in runouts.
- Full index counts equal preflight. Root/chance mass normalizes; there are 1,980 legal
  ordered runouts per deal regardless of how many action histories reach them.
- Fixed flop-history/turn-card continuations reduce to unchanged turn-v1 rules with
  correctly carried contributions/stacks; this is not a claim about re-solving subgames.
- Information keys hide opponent/future cards and preserve full recall. Predeal both
  future cards invisibly: values and legal best responses agree. Deliberate turn-only,
  river-only and both-card peeking must give detectable illegal advantages in reduced
  tests; turn decisions additionally cannot peek at the river. Exhaustive reduced
  pure best responses agree with information-set and compact graders.
- Ordinary compact CFR matches the unchanged readable CFR at iterations 1, 2 and 10
  in a bounded three-street fixture (full policies/regrets), then test separately named
  CFR+ and independent saved-policy grading. Probability tolerance 1e-12, payoff/grade
  1e-10 * S, accumulated-regret 1e-9 * max(1, iterations * S), where S is maximum
  absolute terminal utility. No tolerance expansion to hide mismatches.
- Reject malformed policies, extra hidden-card keys, invalid chance/input/money, and
  over-budget inputs before expansion. Test weight scaling, suit relabeling, deterministic
  policies and serialization. Existing accepted artifacts must reproduce unchanged.

## Following gates, not implicit promises

After the reference: lock a separate memory-bounded public-board/range-vector flop
backend and a 64-by-64 acceptance fixture before its solve. Profile allocation and
independent grading before adding optional M7 acceleration. Exact indexing/storage
improvements may earn the budget; sampling, buckets, learned leaves, paid infrastructure
or third-party code require a new explicit decision. M6 then publishes a reproducible,
bounded saved catalog with accessible flop-to-river navigation and clear assumptions.
