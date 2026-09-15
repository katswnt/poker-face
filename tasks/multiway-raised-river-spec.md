# Three-player river with one raise — v1 specification

**Status:** implemented; passed the locked gate

**Locked:** 2026-09-15

**Depends on:** [the accepted no-raise proof](multiway-river-proof-spec.md)

## What changes in Stage 2

This game keeps the same board, weighted ranges, positions, starting pot, and opening bet
as the accepted three-player river proof. It adds exactly one action: a player facing the
30-chip opening bet may raise all-in to 60 chips.

The purpose is to prove the difficult part of multiway action order: a raise makes every
active player who has not matched it respond, including a player who already called the
smaller bet.

This is still not a full poker solver. It has one opening size, one fixed raise size,
equal stacks, no side pots, no earlier streets, and six exact combinations per range.
It must remain separate from the four-player trainer.

## Cards, ranges, and starting money

These inputs are unchanged from Stage 1.

**Board:** `Ks 8s 4s 2c 9d`

```text
Player 0: AsQs ×3   QsJs ×2   KhQh ×4   KcJc ×3   9h9c ×1   7h6h ×2
Player 1: AsJs ×2   Ts7s ×2   KdQd ×4   8h8c ×1   9c8c ×3   6c5c ×2
Player 2: Js9s ×2   AcKc ×4   4h4d ×1   Ah9h ×3   QdTd ×2   7c6d ×2
```

- Exactly 172 of the nominal `6³ = 216` private-hand tuples are physically possible.
- Each player contributed 30 chips to the 90-chip starting pot.
- Each player has 60 chips left.
- Player 0 acts first, Player 1 second, and Player 2 last while no bet is open.

Chance removes card collisions before normalizing the product of all three range weights.
Public actions reweight whole three-hand tuples. Opponents are never treated as two
independent ranges after blockers and actions have linked them.

## Locked action rules

With no bet open, a player may:

- check; or
- bet 30.

Facing the 30-chip opening bet, an active player may:

- fold;
- call 30; or
- raise all-in to 60 total river chips.

After that all-in raise, every active player below 60 acts in seat order after the raiser.
Each may fold or call enough to reach 60. No one may raise again.

Important examples:

- Player 0 bets, Player 1 calls, and Player 2 raises. Player 0 acts next. If Player 0
  calls, Player 1 must still call the extra 30 or fold.
- Player 0 checks, Player 1 bets, and Player 2 raises. Player 0 responds, then Player 1
  responds if still active and below 60.
- A fold never skips another active player's required response.
- The hand ends immediately if only one active player remains. Otherwise it ends only
  when every active player has matched the current bet.

Three checks reach showdown. There is at most one raise in the entire river betting
round.

## Locked complete tree

For each compatible private-hand tuple, the raised public tree has exactly:

```text
33 decision states
43 terminal states
76 total states
```

Across all 172 compatible tuples, plus the chance root, the complete game is locked at:

```text
1 chance state
5,676 decision states
7,396 terminal states
13,073 total states
198 information sets
43 distinct terminal action histories
```

Each seat has 11 distinct public decisions for each of its six private hands. Any change
to these counts, actions, cards, weights, or chip amounts creates a new rules version.

## Pot settlement and returned chips

Payoff remains net chip change from the beginning of the hand:

```text
payoff = all chips returned to the player − all chips the player contributed
```

If every opponent folds to a bet or raise, any unmatched excess is returned before the
remaining pot is awarded. For example, if one player reaches 60 river chips while the
largest opposing river contribution is 30, the unmatched 30 is returned rather than
described as winnings.

This return and the contestable pot must be recorded separately in teaching facts even
when their combined net utility would be numerically identical. At a showdown, every
active player has matched the final bet, so equal stacks produce no side pot. Tied best
hands split the contestable pot equally. Every terminal utility vector must sum to zero
within `1e-9` chip.

Previously committed chips remain separate from expected chip change at a current
decision. Folding to a raise loses the earlier 30-chip call in the hand total, but the
fold action itself does not charge those 30 chips again.

## Hidden information boundary

A strategy may use the acting player's own cards and the complete public state: board,
active seats, contributions, current bet, whether the raise has been used, seat to act,
and public action history. It may not use either opponent hand.

A best response chooses once for all full states in the same information set. It may not
choose a different answer after secretly inspecting an opponent hand.

## Candidate and acceptance gate

The first candidate uses deterministic, simultaneous-update, full-tree vanilla CFR for
**65,536 iterations**. Checkpoints are locked at 256, 1,024, 4,096, 16,384, and 65,536.
As in Stage 1, CFR is a candidate generator rather than proof of convergence in a
three-player game.

The independent grader reports every player's exact unilateral gain and the maximum:

```text
gain[i] = best value player i can obtain by changing alone − saved profile value[i]
```

The locked mathematical gate remains **0.45 chip per hand**, or `0.5%` of the 90-chip
starting pot. It will not be loosened after seeing the result. The result does not use or
report heads-up half-gap exploitability.

The release also requires:

- exact agreement with a separate slow payoff and five-of-seven showdown oracle within
  `1e-9` chip across all 7,396 terminals;
- agreement between scalable and exhaustive best responses within `1e-9` on a one-deal
  raised fixture, where each player has exactly 6,912 pure strategies;
- the accepted Stage 1 and heads-up artifact hashes remain valid;
- all chance, strategy, posterior, response, and outcome probabilities normalize;
- two runs produce byte-for-byte identical output;
- generation stays under the Stage 2 local stop budgets: 10 minutes, 4 GiB memory, and
  100 MiB stored output;
- all tests, solver audits, type-checking, lint, and production build pass.

If the final checkpoint misses the 0.45-chip gate, stop and label it a failed candidate.
Do not select the prettiest earlier checkpoint after the fact.

## Teaching facts

Every decision record must keep its statements tied to structured evidence:

- saved action frequencies and exact action values;
- chip change from now, separate from hand-start net chips;
- difference from the highest measured action;
- exact probability of reaching the decision;
- blocker-aware joint opponent range and its displayed marginals;
- immediate next-player responses;
- eventual player fold, all-opponents-fold, showdown win, split, and loss;
- expected showdown pot share;
- uncalled chips returned separately from the contestable pot.

Learner copy should explain the raise in ordinary language: it asks every remaining
player to put in more, and someone who called 30 earlier may still have to decide again.
It may call the enumeration exact. It may not call the finite-iteration strategy exact
GTO.

## Accepted result

The one predeclared candidate passed without changing the rules, iteration count, or
quality gate:

```text
profile values       +10.732029731, +2.179621582, -12.911651314 chips/hand
unilateral gains       0.114439025,  0.068522158,   0.087536290 chip/hand
maximum gain           0.114439025 chip/hand
locked maximum         0.450000000 chip/hand
```

The rules oracle matched all 7,396 terminal states exactly. The scalable best-response
checker matched an exhaustive checker across three profiles; the exhaustive checker
tried 6,912 complete strategies per player in each profile. The generated artifact is
3,389,606 bytes. The first accepted run took 116.29 seconds and ended at 127.7 MiB RSS,
inside every locked local budget.

The complete review is in
[the raised river release audit](multiway-raised-river-audit.md).
