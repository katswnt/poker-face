# Compact river scorekeeper — release audit

**Status:** accepted as the grading path for the isolated compact heads-up river library

**Contract:** [compact scorekeeper specification](compact-river-scorekeeper-spec.md)

## What changed

The compact river solver no longer has to rebuild a nested object tree and use string-keyed
maps to measure a saved strategy. A separate typed-array scorekeeper now calculates:

- the exact value of both players' saved strategies;
- each player's best response;
- each player's possible improvement;
- the Nash gap; and
- heads-up exploitability, defined as half the Nash gap.

The readable scorekeeper remains unchanged as the mathematical oracle. The compact
scorekeeper does not inspect CFR regrets and does not decide whether the solver has
converged from the solver's own internal numbers.

## Exact differential result

On the accepted 3,697-state river game, the readable and compact scorekeepers have:

| Comparison | Maximum difference |
|---|---:|
| Saved profile value | exactly `0` chip |
| Player 0 best-response value | exactly `0` chip |
| Player 1 best-response value | exactly `0` chip |
| Both improvement amounts | exactly `0` chip |
| Nash gap and exploitability | exactly `0` chip |
| Best action at every information set | no disagreement |

The tests repeat this comparison across 20 deliberately varied mixed strategies rather
than only checking a nearly solved profile. They also compare Kuhn poker, a reduced river
game, and the wider 15,751-state river fixture.

On the reduced river game, both information-set checkers match the value from exhaustive
pure-strategy enumeration. Exhaustive search can choose different actions on unreachable
or exactly tied branches without changing its value; the compact checker is required to
match the readable information-set checker's deterministic action choices.

## Hidden information

The compact best response assigns one action to one information set. It weights the
hidden states in that information set by chance and opponent reach, while deliberately
leaving out the responding player's own strategy.

A deliberately invalid checker that chooses separately after seeing the opponent's cards
still does strictly better on the regression fixture. The compact checker does not receive
that cheating advantage.

## Measured speed

The audit ran under Node `v24.10.0` on `arm64`. It warmed both scorekeepers, alternated
their order, and recorded the median of 15 complete grades. Compact time includes building
its information-set-to-node index.

| Game | States | Readable grade | Compact grade | Speedup |
|---|---:|---:|---:|---:|
| Accepted configurable river | 3,697 | `14.945 ms` | `0.304 ms` | **`49.13×`** |
| Wider river fixture | 15,751 | `58.935 ms` | `1.037 ms` | **`56.80×`** |

These are machine-specific observations, not universal promises. Both exceed the locked
`3×` local usefulness gate by a wide margin.

On the accepted game, the scorekeeper node index occupies `6,528` bytes and grading uses
`178,576` bytes of numeric working storage. On the wider fixture those figures are
`25,920` and `758,448` bytes. They exclude the already compiled game and JavaScript runtime
overhead, so they are not whole-process memory measurements.

## What the benchmark tells us

Grading is no longer the important local bottleneck. On the wider fixture, a 400-iteration
CFR+ solve takes roughly a quarter-second while a complete compact grade takes about one
millisecond.

That result justifies the next investigation: factor the repeated public betting tree
away from the blocker-compatible private-hand pairs. It does not justify claiming that a
full-range river solve is already practical. Iteration cost still grows with the number
of compatible private deals.

## Six-perspective review

### Expert CTO — pass

The new path is additive and identified by its exported method name. The readable checker
remains available as a fallback and test oracle. The compact library uses the faster
checker; accepted historical artifacts continue using their original code.

### Expert poker player — pass

No poker action, range, blocker, payoff, or betting rule changed. The checker measures
the same question faster: how much either player could gain by changing strategy against
the other player's fixed strategy.

### Expert math professor — pass

Counterfactual reach is stated explicitly, zero-sum units are chips per hand, and values
are checked against two independent methods on small games. Exact agreement across mixed
profiles is stronger evidence than agreement on one equilibrium-like answer.

### Expert poker teacher — pass as invisible infrastructure

Learners never see regret arrays or scorekeeper internals. Faster grading can eventually
make reliability information available sooner, but this milestone adds no learner-facing
claim or prose.

### Expert product person — pass with no trainer integration

The improvement is meaningful for solver-lab wait time and larger research fixtures. It
does not change the four-player trainer or imply its advice now comes from this heads-up
solver.

### Expert software engineer — pass

The scorekeeper has its own information-set node index, validates the complete behavioral
strategy, rejects non-finite probabilities, reports its storage, preserves deterministic
tie-breaking, and is differentially tested against both scalable and exhaustive oracles.

## Known limits

- The compact checker reuses the compact tree compiler. Its independence comes from a
  separate value/best-response algorithm and comparison with the object-tree oracle; it
  is not a separately parsed poker-rules implementation.
- It applies only to two-player, zero-sum games. Multiway quality continues to use each
  player's separate unilateral gain, never half a Nash gap.
- It temporarily allocates value and reach arrays proportional to the full compiled tree.
  A future factorized engine should grade its larger games without reconstructing that
  full tree.
- Exact action equality is meaningful between the two information-set implementations.
  Exhaustive search may select a different action on tied or unreachable branches.
- No UI changed.

## Defensible portfolio claim

> I replaced the scaling bottleneck in my river solver's independent scorekeeper with a
> typed-array implementation. It returns exactly the same values and information-set
> choices as the readable checker across varied mixed strategies, preserves the hidden-card
> boundary, and grades the 15,751-state audit game about 57 times faster locally.

## Verification record

The accepted milestone passed:

- exact profile, best-response, choice, gain, and exploitability differentials;
- exhaustive reduced-game and known-value Kuhn checks;
- deliberate hidden-card cheating and invalid-strategy regressions;
- deterministic repeat runs;
- the full compact river test suite;
- strict TypeScript checking and ESLint with no warnings; and
- the existing compact river solve audit without changing its strategy, value, or
  exploitability.
