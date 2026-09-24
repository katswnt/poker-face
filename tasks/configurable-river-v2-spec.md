# Configurable heads-up river solver — v2 specification

**Status:** implemented and accepted; see the
[release audit](configurable-river-v2-audit.md)

**Depends on:** [the accepted fixed river v1](river-solver-spec.md) and its
[release audit](river-solver-audit.md)

## Purpose and honest boundary

Build a configurable, exact, heads-up no-limit hold'em river subgame solver that can
answer more than one hand-written fixture without weakening the evidence behind river
v1.

The solver accepts a known five-card board, two explicit weighted ranges, equal chips
already committed before the river, each player's remaining stack, action order, a finite
menu of opening bets and raise-to amounts, and a one-raise cap. It enumerates every
compatible pair of private hands and every showdown exactly. It may stop CFR at a finite
error, which must be measured independently and reported in chips.

This is not a preflop, flop, turn, multiway, continuous-bet-size, or real-time commercial
solver. It is not connected to the four-player trainer. Oversized requests are rejected
before the full tree is built.

## Compatibility and preservation

- River v1 code, artifact bytes, hashes, command, and tests remain unchanged.
- V2 lives in a separate `river/configurable` module and has separate schema and rules
  versions.
- The v1 scenario is adapted into v2 as a required regression fixture. V2 must reproduce
  v1's complete public tree, compatible deals, terminal utilities, value, and strategy
  grade within the locked tolerances.
- Kuhn, Leduc, push/fold, and every multiway solver remain unchanged.

## Inputs

### Cards and ranges

- The board contains five distinct ASCII cards such as `Ks` and `Td`.
- Each internal range is a list of exact two-card combinations and positive finite
  weights.
- Exact combinations are canonicalized, duplicates are rejected, board collisions are
  removed before solving, and mutually blocked hand pairs are omitted from the joint
  range.
- An outer parser may accept `AA`, `AKs`, `AKo`, `AK`, exact combinations, and optional
  decimal or percentage weights. It expands them to exact combinations before the game
  is created. It does not support `+` or dash syntax in v2.
- Chance probabilities are proportional to the product of the two input weights after
  card collisions are removed, then normalized exactly once.

### Money and positions

- Player 0 acts first and is out of position. Player 1 acts second and is in position.
- `committed` records chips already in the pot before this river decision. Both values
  must be equal because the previous betting round is closed and both players remain
  active.
- `stackBehind` records each player's chips still available on the river and may be
  unequal.
- Utilities are net chips from the start of the hand: award minus total contribution.
  They sum to zero at every terminal.
- Teaching output also reports expected additional chip change from the current decision:
  expected net value plus chips already contributed by that player. Sunk chips and new
  chips are never conflated.

### Finite betting menu

- Opening bets are explicit positive whole-chip amounts.
- Raises are explicit whole-chip river contribution targets, not increments.
- The artifact stores resolved chip amounts, never only a pot percentage.
- Checking, folding, calling, and all legal configured bet or raise targets are generated
  from public state.
- No player may invest more than their remaining stack.
- A full raise must increase the wager by at least the previous full bet or raise size.
- A smaller increase is legal only when it puts the actor all-in. It does not reopen a
  second raise.
- V2 permits at most one raise in a hand. Once that increase is made, the other player
  may fold or call.
- A caller contributes only what remains in their stack. Any unmatched excess is returned
  to the bettor before the contestable pot is awarded.
- Two checks reach showdown. A call that closes action reaches showdown. A fold ends the
  hand immediately.

## Public state and hidden information

The immutable public state records:

- acting player;
- river contributions;
- current wager;
- last aggressor;
- size of the last full raise;
- raises used;
- consecutive checks;
- terminal reason;
- public action history.

The full engine state also contains both private hands so it can score showdowns. An
information-set key contains only the scenario/rules version, acting player's own hand,
position, and the full public state. It never contains the opponent's cards.

After an observed action, posterior opponent weights are calculated from chance reach and
the saved strategies along that public history. The actual hidden opponent hand is never
used to choose an action or write an explanation.

## Workload preflight

Before building the full tree, v2 counts compatible deals and traverses the public betting
tree once without private cards. It calculates:

- compatible private-hand pairs;
- public states per deal;
- projected full states and terminals;
- an explicitly labeled rough memory estimate.

The default local limits are:

- at most 500 compatible private-hand pairs;
- at most 50,000 projected full states;
- at most 128 opening range entries per player after expansion.

Callers may lower these limits but may not silently raise them through the learner UI.
Crossing a limit returns a plain error containing the measured count and limit before CFR
allocates a full tree. Larger ranges belong to a later optimized or sampled milestone.

## Solver and independent grade

Reuse the generic deterministic full-tree CFR only after the v2 game passes validation
and preflight. CFR creates a saved average strategy; it does not grade itself.

The independent value and information-set best-response checker reports:

```text
gain0 = bestResponseValue0(opponent strategy) - saved profile value0
gain1 = bestResponseValue1(opponent strategy) - saved profile value1
Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

These definitions apply because this game is heads-up and zero-sum. Units are expected
net chips per hand. A reduced fixture must also pass exhaustive pure-strategy grading.
A deliberate cheating grader that chooses separately for hidden opponent hands must do
strictly better on at least one test fixture, proving the real checker respects information
sets.

## Structured output

For every information set, derive:

- saved action frequencies;
- action EV from the hand's start;
- expected chip change from the current decision;
- difference from the best measured action;
- immediate opponent responses and fold probability;
- probability of player fold, opponent fold, showdown win, split, and showdown loss;
- showdown equity conditional on reaching showdown;
- posterior opponent range;
- reach probability and an explicit off-path marker.

These are numerical teaching inputs, not generated prose and not claims of exact GTO.

## Artifact and reproducibility

Every committed v2 result includes:

- schema, rules, range-parser, solver, evaluator, and teaching-data versions;
- canonical board and exact expanded weighted ranges;
- committed chips, stacks, positions, opening sizes, raise targets, and raise cap;
- preflight counts and limits;
- algorithm, iterations, checkpoints, full saved strategy, values, best responses, gains,
  Nash gap, and exploitability;
- exact teaching facts;
- external-reference provenance and comparison status;
- a SHA-256 rules/tree fingerprint and SHA-256 payload hash.

Two runs with the same input and iteration count must produce identical artifact bytes.
Changed inputs, rules, action menus, range expansion, or evaluator versions make an
artifact stale.

## Outside references

No third-party implementation code enters Poker Face in this milestone. Outside projects
run separately as numerical referees.

- Preserve the existing Noam Brown commit and fixture as the v1 historical reference.
- Pin and audit a current MIT commit separately before using its configurable river path.
- Treat b-inary's AGPL solver only as an offline process; do not copy, link, or package it.
- Treat amaster97's current MIT Python/Rust project as a possible second referee after a
  controlled rule-matching audit.
- A disagreement is evidence to investigate. Do not change Poker Face's game merely to
  force matching output.

## Required tests

- Card, range-syntax, weight, blocker, duplicate, and normalization tests.
- Property tests for expansion order, card-order invariance, normalized joint weights,
  zero-sum terminals, legal contributions, and seat-swapped symmetric fixtures.
- Exhaustive legal-history tests covering both opening positions, every bet size, legal
  and illegal raises, short all-ins, calls, folds, two checks, unequal stacks, and returned
  excess.
- Independent slow showdown and terminal-money checks for every terminal in the accepted
  fixture.
- Information-set and cheating-oracle regressions.
- V1 adapter equivalence for all compatible deals and public terminals.
- Solver reproducibility, short-versus-long convergence, best-response, and exhaustive
  reduced-fixture tests.
- Artifact hash, stale-input, structured teaching, and plain-language claim tests.

## Acceptance gates

- Exact chance and showdown enumeration: required.
- Maximum terminal zero-sum error: `1e-9` chip.
- V1 adapter terminal utility difference: `1e-9` chip.
- V1 adapter profile value and exploitability difference: `0.05` chip using equal solver
  settings.
- Accepted demonstration exploitability: at most `0.25%` of the starting pot, locked
  before its large solve.
- Independent matching reference value difference: at most `0.25%` of the starting pot
  when a truly identical external tree is available.
- Artifact bytes: exactly reproducible.
- Tests, type-check, lint, all existing solver audits, and production build: passing.

## Stop conditions

Stop and report rather than weakening the claim if:

- a hidden opponent card reaches an information set, best response, or explanation;
- preflight miscounts the full tree;
- the slow oracle disagrees on chance, showdown, money, or zero-sum utility;
- v2 changes river v1 artifact bytes or any previous solver artifact;
- scalable and exhaustive best responses disagree on the reduced fixture;
- the accepted solve misses its pre-declared exploitability gate;
- an outside solver disagrees beyond tolerance and rule differences do not explain it;
- a workload crosses the locked local limits;
- third-party licensing becomes incompatible or unclear.

## Definition of success

A reviewer can enter a bounded river spot, see exactly what game will be solved, reproduce
the result on a CPU, inspect an independent quality measurement, and trace a recommendation
from price and opponent range to expected chips—without believing the software solved
earlier streets, arbitrary ranges, or continuous no-limit poker.

## Changelog

**2026-09-24 — tree edge-case fixes (rules version unchanged).**

- *No raise against an all-in player.* A raise is offered only when the opponent still has
  chips behind to respond, matching v3. Previously v2 could offer a raise whose only answer
  was a forced call.
- *Uncallable overbets collapse.* Any bet or raise target above the opponent's remaining
  stack is replaced by a single bet-to-their-stack action, since every such target has the
  same payoff once the excess is returned. This removes payoff-identical duplicate actions.

Neither fix changes a committed v2 artifact (they reproduce byte for byte), so the v2 rules
version is not bumped. Scenarios that did reach these branches now build smaller trees.
