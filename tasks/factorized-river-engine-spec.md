# Factorized heads-up river engine — locked specification

## Why this exists

The audited compact solver still stores one complete betting tree for every compatible pair of
private hands. That is simple and useful as a reference, but it repeats the same public actions many
times. This experiment stores the public betting tree once and keeps a separate, exact list of the
private-hand pairs that are possible after card blockers.

This is a memory-layout improvement. It is **not** a new poker model, a full no-limit solver, or a
claim that large range-versus-range solving is finished.

## Fixed scope

- Two players only.
- River only; all five board cards are known.
- Explicit weighted ranges for both players.
- Exact card removal: a deal is included only when the two private hands and board do not overlap.
- Player 0 acts first and is out of position.
- Equal chips committed before the river decision.
- Integer chip amounts.
- A fixed list of opening bet sizes and raise-to sizes.
- At most one raise on the river.
- Exact showdown evaluation. No Monte Carlo sampling.
- Heads-up, zero-sum chip utility measured from the current river decision. Chips committed before
  the river are included in the pot but are not charged a second time.

The configurable river rules remain the readable source of truth. The factorized engine may change
storage and traversal, but it may not invent different actions, information sets, or payoffs.

## Resource limits

The first version rejects requests above any of these limits:

- 128 range entries per player after board blockers.
- 10,000 compatible private-hand pairs.
- 250,000 states in the equivalent repeated full tree.

The last number is an accounting guard. The factorized representation does not allocate that full
tree, but solving time still grows roughly with `compatible deals × public betting states`.

## Representation

The compiler must:

1. Build and validate the public betting tree once.
2. Store every compatible private-hand pair, its normalized probability, and its exact showdown
   result.
3. Create one information set for each reachable combination of a player's private hand and public
   action history.
4. Map a public decision plus the acting player's private hand to that information set.
5. Never include the opponent's private hand in an information-set key.
6. Store terminal chip results for a player-0 win, tie, and player-1 win. Fold results must not
   depend on hidden cards.

## Solver math

The engine supports two named algorithms:

- Ordinary full-tree CFR with simultaneous regret updates. On bounded fixtures this must match the
  readable and compact implementations, not merely look similar.
- Alternating CFR+ with regret matching+, non-negative cumulative regrets, and delayed linear
  averaging. This is the faster experimental path, not a claim of exact GTO play.

At an information set, one strategy is shared across every compatible hidden opponent hand. Chance
probability and the opponent's reach weight regret updates. A player's own reach weights the saved
average strategy. The implementation must check that own reach is identical wherever the same
information set appears.

## Scorekeeper

The factorized scorekeeper must report:

- expected chip value for both players;
- an information-set-valid best response for each player;
- each player's gain from deviating;
- Nash gap, equal to the sum of those two gains; and
- exploitability, equal to half the Nash gap, only because this game is heads-up and zero-sum.

A best response must choose one action for a whole information set. It must never choose a different
action after secretly looking at the opponent's private hand. The readable and compact
scorekeepers remain independent references for bounded differential tests.

## Acceptance gates

Before this milestone can be described as working:

- Public actions, terminal utilities, information-set keys, and action order match the readable
  configurable game.
- Ordinary CFR strategies and cumulative regrets match the readable and compact engines within
  `1e-10` on locked fixtures.
- Profile values, both information-set best responses, response choices, Nash gap, and
  exploitability match the existing independent scorekeepers within `1e-10`.
- A regression test proves the scorekeeper cannot improve its result by choosing separately for
  hidden opponent hands.
- Repeated solves with the same input are byte-for-byte reproducible at the numeric result level.
- A locked fixture above the compact engine's 50,000-state ceiling solves and grades within the new
  limits.
- Structural typed-array storage is measured and compared with the repeated compact tree. Timing is
  reported as machine-specific evidence, not a universal speed claim.
- Unit, property, regression, type-check, lint, full test, and production-build checks pass.

## Stop conditions

Stop and do not present the result as a successful milestone if:

- factorized and readable utilities or information sets disagree;
- a best response can condition on hidden cards;
- ordinary CFR cannot reproduce the existing solver on bounded inputs;
- numerical values become non-finite;
- a requested game breaches a declared limit; or
- evidence would require describing an approximation as exact GTO.

## Portfolio claim allowed after the gates pass

> Poker Face has an exact-card river experiment that stores one public betting tree and solves
> blocker-compatible weighted ranges with CFR or CFR+. Its results are differentially checked
> against a slower readable implementation on bounded games. It is still a finite river
> abstraction, not a complete hold'em solver.
