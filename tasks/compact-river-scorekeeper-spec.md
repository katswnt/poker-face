# Compact river scorekeeper — specification

**Status:** implemented and accepted; see the
[release audit](compact-river-scorekeeper-audit.md)

**Depends on:** [the accepted compact river engine](compact-river-engine-spec.md) and its
[release audit](compact-river-engine-audit.md)

## Purpose

Make exact strategy evaluation and heads-up best-response grading scale with the compact
river solver without weakening the hidden-information rule.

The current scorekeeper is intentionally readable. It rebuilds a nested JavaScript tree,
stores reach and values in maps, and recursively looks up string information-set keys.
That remains the independent oracle. The new scorekeeper reads the accepted compiled
tree, uses typed numeric arrays, and turns results back into the same human-inspectable
information-set choices.

## Mathematical boundary

This milestone grades two-player, zero-sum, finite, perfect-recall games. It may report:

```text
gain0 = bestResponseValue0(opponent strategy) - profileValue0
gain1 = bestResponseValue1(opponent strategy) - profileValue1
Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

All values are expected net chips per hand. These definitions must not be reused for a
multiway game.

## Hidden-information rule

A responding player chooses one action for an entire information set. The checker must
first combine every hidden opponent hand the player cannot distinguish, weighted by
chance reach and the opponent's strategy. It must never maximize separately at each full
state.

The responding player's own reach is omitted from the best-response weights. At their
decision nodes, all actions remain reachable for the counterfactual comparison. Chance
and opponent action probabilities remain in the weights.

## Compact representation

The scorekeeper reuses the compiled tree's:

- stable node and edge IDs;
- terminal utilities;
- chance probabilities;
- information-set IDs and action slots; and
- depth-first postorder.

It separately compiles a small information-set-to-node index. That index is not added to
the accepted solver's storage measurement, so the previous compact-engine audit remains
reproducible.

Strategy evaluation walks nodes in postorder. Best response first calculates
counterfactual reach in preorder, then resolves one action per responding information set.
The old object-and-map checker remains unchanged and is the differential oracle.

## Required evidence

- Profile values match the readable evaluator within `1e-12` chip.
- Each player's best-response value matches within `1e-12` chip.
- Best-response actions match exactly, including deterministic first-action tie breaks.
- Gains, Nash gap, and exploitability match within `1e-12` chip.
- Comparisons cover Kuhn, the reduced exhaustive river game, the accepted river game,
  multiple generated river games, and the wider 15,751-state fixture.
- On a tiny fixture, compact and readable best responses both match exhaustive pure
  strategy enumeration.
- A deliberately cheating statewise grader still does strictly better on at least one
  fixture.
- Invalid, missing, non-normalized, and non-finite strategies are rejected.
- Repeated grading is deterministic.

## Performance evidence

After warm-up, record median end-to-end grade time for the readable and compact checkers
on both the accepted 3,697-state game and the wider 15,751-state game. Runtime is an
observation, not a CI correctness assertion.

The milestone is useful only if the wider fixture is at least three times faster locally.
If it is not, keep the implementation as an experiment rather than presenting it as the
next scaling layer.

## Stop conditions

Stop rather than weakening the claim if:

- choices or values differ beyond tolerance and action ties do not explain it;
- a player can condition on an opponent's hidden cards;
- counterfactual reach includes the responding player's own strategy;
- the checker grades itself from regret totals;
- a strategy accepted by one checker is rejected by the other without an explained
  contract difference; or
- faster grading does not materially change the measured scaling bottleneck.

## Definition of success

For the same saved strategy, a reviewer can run a readable scorekeeper and a compact
scorekeeper, see the same profile value and the same legal best response at every
information set, and measure the speed difference. The fast checker is useful because it
preserves the information boundary, not because it silently chooses with extra knowledge.
