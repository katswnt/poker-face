# Compact heads-up river engine — specification

**Status:** implemented and accepted; see the
[release audit](compact-river-engine-audit.md)

**Depends on:** [configurable river v2](configurable-river-v2-spec.md), which remains
the readable reference implementation and rules oracle

## Why this milestone exists

Configurable river v2 does the right calculation, but it represents every game state as
a JavaScript object and repeatedly looks up strategies by long string keys. That design
is easy to inspect and was the right way to establish the math. It is too slow and too
memory-heavy for wider ranges.

This milestone changes the machinery, not the poker game. It compiles the already audited
finite game into numbered arrays, then runs the same counterfactual-regret calculation on
those arrays. The readable engine stays in the repository as an independent oracle.

## Deliberately finite scope

- Heads-up hold'em, river only, known five-card board.
- Explicit weighted ranges and exact blocker-compatible private-hand enumeration.
- The configurable-v2 finite betting tree: explicit bet and raise-to sizes, with at most
  one raise.
- Exact terminal money and exact seven-card showdown scores.
- CPU-only and deterministic. The first implementation is single-threaded.
- No trainer integration, no new learner UI, no earlier streets, no multiway solving, no
  continuous bet sizing, and no claim of exact GTO.

## Preservation rule

The accepted Kuhn, Leduc, river v1, configurable river v2, and multiway engines and
artifacts must remain byte-for-byte reproducible. This engine is additive. It may consume
an accepted `ExtensiveFormGame`, but it may not replace that game's rules, settlement,
showdown evaluator, artifact, best-response checker, or slow oracle.

## Compact representation

Compilation walks the complete audited game once and assigns stable integer IDs to:

- every tree state;
- every tree edge;
- every information set; and
- every information-set action.

The hot loop uses typed numeric arrays for node kinds, players, child IDs, chance
probabilities, terminal utilities, information-set IDs, regrets, strategies, reach
probabilities, and node values. Strings and maps are used only while compiling and while
turning the final result back into the existing public strategy format.

The compiler must preserve the source game's state count, chance probabilities, legal
action order, information-set grouping, and terminal utilities. It must reject a game
that changes while it is compiled or that violates perfect recall.

The compact library entry point raises only the compatible-deal ceiling, from 500 to
2,000. It keeps the accepted limits of 128 range entries per player and 50,000 projected
states. The wider ceiling is explicit, tested, and unavailable to the learner UI. The
generic research API can receive a separately constructed game, but it never bypasses
that game's own preflight.

## Ordinary CFR equivalence

The first solver mode is simultaneous-update, full-tree, ordinary CFR. It must use the
same definitions as the readable solver:

- regret matching uses only positive cumulative regret and otherwise plays uniformly;
- both players' regret changes are calculated from one frozen strategy per iteration;
- regret changes are weighted by chance reach and the opponent's reach;
- the saved average strategy is weighted by the acting player's own reach; and
- all arithmetic uses 64-bit floating point numbers.

Floating-point addition order can differ, so exact bytes are not expected between
engines. On bounded fixtures, cumulative regrets, current strategies, average strategies,
profile values, and independent exploitability must agree within stated numerical
tolerances.

## CFR+ candidate

After ordinary CFR passes differential testing, a separately named candidate may use
alternating-update CFR+:

1. calculate one player's counterfactual regret changes from a frozen current strategy;
2. add them and replace negative cumulative regrets with zero;
3. rebuild the strategy before updating the other player;
4. after both updates, save a reach-weighted average strategy with documented delayed
   linear iteration weights.

The artifact or result must record the algorithm name, version, averaging delay, and
iteration count. CFR+ is accepted only if the existing independent best-response checker
shows that it converges on audited fixtures. It is never graded by its own regret table.
Different equilibrium frequencies can all be valid; comparisons therefore focus on
profile value and exploitability, not identical mixed strategies.

## Independent checks

The compact engine continues to use the existing object-based systems for:

- exact strategy evaluation;
- information-set best responses and heads-up exploitability;
- exhaustive pure-strategy checks on tiny games;
- slow settlement and showdown audits; and
- comparison with the pinned external solver fixture.

The compact engine must never choose an action separately for hidden opponent hands.
Its strategy output is keyed by the same information sets as the readable game, so the
existing cheating-oracle regression remains applicable.

## Required tests

- Compiled state, edge, terminal, decision, and information-set counts match the source.
- Compiled chance probabilities, action order, and terminal utilities match the source.
- Perfect-recall violations are rejected before solving.
- Ordinary compact CFR matches readable CFR after short and longer runs.
- Differential tests cover multiple boards, ranges, weights, stack sizes, and legal bet
  trees, not only the accepted demonstration.
- A fixed request produces the same result on repeated runs.
- All returned probabilities are finite and normalized; all regrets and values are
  finite; CFR+ regrets are non-negative.
- Longer CFR+ runs materially reduce independently measured exploitability on controlled
  fixtures.
- Every previous solver audit and artifact check still passes.

## Performance evidence

Performance is measured after a warm-up on the accepted configurable-v2 demonstration.
The report records Node version, architecture, state count, iteration count, median wall
time, and iterations per second for both engines. Runtime is observational rather than a
CI gate because shared machines vary.

The milestone stops rather than claiming success if compact ordinary CFR is not at least
three times faster in the local controlled benchmark, or if typed arrays do not reduce
the measured numeric working-set estimate. Optimize measured bottlenecks before proposing
workers, Rust, C++, WebAssembly, or a GPU.

## Acceptance gates

- Ordinary-CFR strategy and regret maximum difference on differential fixtures: `1e-9`.
- Profile-value and independent exploitability difference: `1e-9` chip on the locked
  equivalent runs.
- Terminal and chance differences introduced by compilation: exactly zero.
- CFR+ accepted demonstration exploitability: no worse than configurable v2's locked
  `0.25` chip gate.
- Repeated runs: identical strategies and regrets.
- No non-finite value at any checkpoint.
- Local median speedup for compact ordinary CFR: at least `3x` on the locked benchmark.
- Full tests, type-check, lint, solver audits, and production build: passing.

## Stop conditions

Stop and report instead of weakening the claim if:

- any compiled action, chance weight, information set, payoff, or independent grade
  disagrees beyond tolerance;
- a hidden opponent card enters a decision key;
- CFR+ appears fast only because it uses fewer full-tree traversals than reported;
- convergence is inferred only from internal regret rather than an independent best
  response;
- parallel execution changes deterministic output;
- a larger workload exceeds an explicit memory or state limit; or
- an optimization cannot be explained and tested in plain language.

## Definition of success

A reviewer can run two implementations of the same finite river game: one designed for
inspection and one designed for numeric throughput. They produce the same ordinary-CFR
answer, the faster engine is independently graded, and every speed claim is tied to a
reproducible benchmark rather than to a vague assertion.
