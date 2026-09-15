# Four-player bounded river — v1 specification

**Status:** implemented; passed the locked gate

**Locked:** 2026-09-15

**Audited:** 2026-09-15

**Depends on:** [the accepted multiway roadmap](multiway-nlhe-solver-plan.md)

## What changes

This milestone adds one fourth player and removes the later Stage 2 complications. All
four players have equal stacks. There is one 30-chip bet size and no raise. Keeping the
betting simple makes the extra player—and the extra hidden hand—the only new source of
complexity.

This is one fixed river experiment. It is not a full no-limit solver, an arbitrary table-
size solver, exact GTO, or part of the live trainer.

## Cards, ranges, order, and money

**Board:** `Ks 8s 4s 2c 9d`

```text
Player 0: AsQs ×3   QsJs ×2   KhQh ×4   KcJc ×3
Player 1: AsJs ×2   Ts7s ×2   KdQd ×4   8h8c ×1
Player 2: Js9s ×2   AcKc ×4   4h4d ×1   Ah9h ×3
Player 3: QcTc ×3   9c8c ×2   7c6c ×2   AdJd ×4
```

- Exactly 174 of the nominal `4⁴ = 256` private-hand tuples are physically possible.
- Each player has already contributed 30 chips to the 120-chip pot.
- Each player has 60 chips left.
- Player 0 acts first, then Player 1, Player 2, and Player 3.
- The positions are stored as `first`, `second`, `third`, and `last`.

Chance removes every colliding card tuple before multiplying the four range weights and
normalizing. Public actions update one joint distribution over all three opponent hands.
The calculation must not update three opponent ranges separately and multiply them back
together.

## Locked betting rules

With no bet open, a player may check or bet 30. Facing a bet, a player may fold or call
30. There are no raises and no other sizes.

Four checks reach showdown. After a bet, all three other active players answer in cyclic
table order, including players who checked earlier. The hand ends early only when one
active player remains. Otherwise it reaches showdown after the last response.

Equal stacks and a single matched bet mean this fixture has no side pot or unmatched
return. The existing unequal-stack game remains the separate proof for those rules.

The engine may validate a permuted seat-label fixture for audit purposes, but this saved
artifact locks the order to `0,1,2,3`.

## Locked complete tree

For each compatible private-hand tuple, the public tree has exactly:

```text
32 decision states
33 terminal states
65 total states
```

Across all 174 compatible tuples, plus the chance root, the game has exactly:

```text
1 chance state
5,568 decision states
5,742 terminal states
11,311 total states
128 information sets
33 distinct terminal action histories
```

Each player has eight public decision histories for each of four private hands, or 32
information sets. A one-deal audit game has 256 complete pure strategies per player.
These are locked test values.

## Payoff and hidden information

At a terminal state, the best five-card hand among active players wins the pot. Tied
best hands split it. Payoff is net chip change from the beginning of the hand:

```text
payoff = chips awarded − all chips contributed
```

Every four-value payoff vector must sum to zero within `1e-9` chip.

An information set contains only the acting player's two cards and public facts: board,
seat order, active players, contributions, bet status, and action history. It contains
none of the other six private cards.

A best response must choose one action for every hidden state the player cannot tell
apart. It may not choose after secretly inspecting any opponent's hand.

## Candidate and fixed acceptance gate

The one predeclared candidate uses deterministic, simultaneous full-tree vanilla CFR for
exactly **65,536 iterations**. Checkpoints are fixed at 256, 1,024, 4,096, 16,384, and
65,536. CFR proposes a candidate; it does not prove convergence in a four-player game.

For each player:

```text
unilateral gain = best value available by changing that player's whole strategy
                  − value under the saved four-player strategy
```

The maximum allowed gain is **0.60 chip per hand**, or `0.5%` of the 120-chip starting
pot. This limit will not change after seeing the candidate. The report will show all
four gains. It will not halve a multiplayer number or call it heads-up exploitability.

Release also requires:

- exact agreement with a separately written deal, action, slow-showdown, and payoff
  oracle on all 5,742 endings within `1e-9` chip;
- exact agreement between scalable and exhaustive best responses on a one-deal game,
  checking 256 complete strategies per player;
- a seat-label permutation audit that preserves chance weights and permutes utilities;
- a dead-money reduction showing that, after one player folds, an equivalent smaller
  settlement gives the same awards to the remaining players;
- the existing heads-up adapter still reproducing the accepted heads-up artifact;
- valid hashes for all four accepted multiway artifacts and the heads-up artifact;
- normalized chance, strategy, joint-range, response, and outcome probabilities;
- byte-for-byte identical output from two complete runs;
- generation under 10 minutes, 4 GiB resident memory, and 100 MiB of stored output; and
- all repository tests, solver audits, type checks, lint checks, and production build
  passing.

If the candidate misses 0.60 chip, stop and record a failed candidate. Do not change the
game, iteration count, or limit after seeing the result.

## Teaching facts

Every decision record must store:

- the acting player's cards, position, current pot, call cost, and players still active;
- exact reach probability and one blocker-aware joint distribution over all three
  opponent hands;
- display marginals derived from that joint distribution;
- action frequencies, values from the hand start, chip change from now, and difference
  from the highest measured action;
- immediate next-player responses and eventual fold/showdown outcomes;
- chance everyone else folds, chance of reaching showdown, and expected showdown pot
  share; and
- the exact player count and an honest note that the saved strategy is approximate.

Plain copy should explain that adding a fourth player usually makes it harder for one
hand to beat the whole field, but it also puts more chips in contested pots and gives
more players chances to fold. It must not reduce that tradeoff to “more players means
always fold” or show one percentage without saying it is a four-player calculation.

## Stop condition and next boundary

Stop if the independent oracle, seat permutation, dead-money reduction, hidden-card
boundary, or fixed quality gate fails.

Passing proves one exact four-player, no-raise river abstraction. It does not justify a
table-size selector. The next planned stage is wider river ranges through jointly sampled
private-hand tuples, first validated against this exact game.
