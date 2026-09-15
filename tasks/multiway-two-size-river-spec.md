# Three-player river with two opening sizes — v1 specification

**Status:** implemented; passed the locked gate

**Locked:** 2026-09-15

**Depends on:** [the accepted one-raise game](multiway-raised-river-spec.md)

## What changes

This milestone keeps the accepted board, ranges, positions, starting pot, equal stacks,
30-chip opening bet, and one-raise rule. It adds one new opening choice: a player may bet
all 60 chips left instead of betting 30.

The purpose is to test a real no-limit idea in the smallest defensible way: bet size is
part of the choice. The solver must compare checking, betting one-third of the current
pot, and betting two-thirds of the current pot all-in.

This remains a fixed teaching experiment, not a full no-limit solver. It has two opening
sizes, one possible raise size, equal stacks, no side pots, no earlier streets, and six
exact combinations in each range. It stays separate from the live four-player trainer.

## Cards, ranges, positions, and money

These inputs are unchanged from the accepted games.

**Board:** `Ks 8s 4s 2c 9d`

```text
Player 0: AsQs ×3   QsJs ×2   KhQh ×4   KcJc ×3   9h9c ×1   7h6h ×2
Player 1: AsJs ×2   Ts7s ×2   KdQd ×4   8h8c ×1   9c8c ×3   6c5c ×2
Player 2: Js9s ×2   AcKc ×4   4h4d ×1   Ah9h ×3   QdTd ×2   7c6d ×2
```

- Exactly 172 of the nominal `6³ = 216` private-hand tuples are possible.
- Each player has already contributed 30 chips to the 90-chip pot.
- Each player has 60 chips left.
- Player 0 acts first, Player 1 second, and Player 2 last while no bet is open.

Chance removes card collisions before weights are normalized. Public actions update the
probability of whole three-hand tuples. The calculation never treats the two opponents'
hands as independent after cards and actions have linked them.

## Locked actions

With no bet open, a player may:

- check;
- bet 30; or
- bet all-in for 60.

Facing a 30-chip opening bet, a player may:

- fold;
- call 30; or
- raise all-in to 60 total river chips.

Facing a 60-chip all-in bet or the all-in raise, a player may only fold or call. Nobody
can raise beyond the 60 chips behind. There is at most one raise in the river round.

After any bet, both other active players must answer in cyclic seat order. A raise to 60
reopens action for every active player below 60, including someone who called 30 before
the raise. The hand ends when only one player remains or every active player has matched
the current bet. Three checks reach showdown.

The action names stored in the artifact are explicit: `check`, `bet-30`, `bet-all-in`,
`fold`, `call`, and `raise-all-in`.

## Locked complete tree

For each compatible private-hand tuple, the public tree has exactly:

```text
42 decision states
55 terminal states
97 total states
```

Across all 172 compatible tuples, plus the chance root, the game has exactly:

```text
1 chance state
7,224 decision states
9,460 terminal states
16,685 total states
252 information sets
55 distinct terminal action histories
```

Each player has 14 public decisions for each of six private hands. A one-deal version has
82,944 complete pure strategies per player. Any change to these counts, cards, weights,
money, or actions creates a new rules version and hash.

## Money and comparisons

Payoff is still net chip change from the beginning of the hand:

```text
payoff = chips returned to the player − all chips the player contributed
```

The teaching data also reports chip change from the current decision. Money already in
the pot is not charged a second time. A fold after an earlier 30-chip call costs no new
chips, even though the hand-start result includes that lost call.

Unmatched chips are returned before the remaining pot is awarded. For example, when a
player bets 60 and both opponents fold without adding river chips, all 60 comes back and
the player wins only the original 90-chip pot. Returned money and the pot that players
can contest remain separate fields.

At showdown, all active players have matched the same final bet. The best five-card hand
from seven wins; tied best hands split the contestable pot. Every terminal utility vector
must sum to zero within `1e-9` chip.

## Hidden information boundary

A strategy sees the acting player's cards and public facts only: board, active seats,
contributions, current bet, whether the raise was used, acting seat, and action history.
It cannot see either opponent's cards.

A best response chooses one action for all hidden states in the same information set. It
may not secretly choose a different action after looking at an opponent's hand.

## Candidate and fixed acceptance gate

The first candidate uses deterministic, simultaneous full-tree vanilla CFR for exactly
**65,536 iterations**. Checkpoints are fixed at 256, 1,024, 4,096, 16,384, and 65,536.
CFR proposes a candidate; it does not prove multiway convergence.

The independent grader reports each player's exact unilateral gain:

```text
gain[i] = best value player i can get by changing alone
          − saved value for player i
```

The maximum allowed gain remains **0.45 chip per hand**, or `0.5%` of the 90-chip
starting pot. This gate will not be changed after seeing the result. No multiway number
will be divided by two or called heads-up exploitability.

Release also requires:

- exact agreement with a separate slow payoff, return, and five-of-seven showdown oracle
  across all 9,460 terminals within `1e-9` chip;
- exact agreement between the scalable and exhaustive best-response checkers on a
  one-deal game against a uniform strategy, checking 82,944 pure strategies per player;
- valid hashes for the accepted no-raise, one-raise, and heads-up artifacts;
- normalized chance, strategy, joint range, marginal range, response, and outcome
  probabilities;
- byte-for-byte identical output from two complete runs;
- generation under 10 minutes, 4 GiB resident memory, and 100 MiB of stored output;
- all tests, solver audits, type-checking, lint, and production build passing.

If the final checkpoint misses the 0.45-chip gate, stop and record a failed candidate.
Do not choose an earlier checkpoint or change the gate after seeing the result.

## Teaching facts

Every decision record must store:

- saved frequencies for check, each bet size, fold, call, and raise where legal;
- exact value of each action and its difference from the highest measured action;
- chip change from now, separate from the hand-start result;
- exact probability of reaching the decision;
- blocker-aware joint opponent hands and displayed marginals;
- the next player's immediate response frequencies;
- eventual folds, immediate wins, showdown wins, splits, and losses;
- expected showdown pot share;
- uncalled chips returned separately from the contestable pot.

Plain-language copy should say what the sizes mean: betting 30 risks less and leaves room
for a raise; betting 60 risks the whole remaining stack and cannot be raised. It may say
the game enumerates every allowed card tuple and action exactly. It may not call the
finite saved strategy exact GTO or general poker advice.

## Accepted result

The one predeclared candidate passed without changing the rules, iteration count, or
quality gate:

```text
profile values       +12.404792924, +0.414147922, -12.818940846 chips/hand
unilateral gains       0.108965909,  0.049289817,   0.107123585 chip/hand
maximum gain           0.108965909 chip/hand
locked maximum         0.450000000 chip/hand
```

The slow oracle matched all 9,460 endings exactly. On the one-deal audit game, the
scalable best-response checker matched an exhaustive search of 82,944 complete
strategies for each player. The artifact is 4,318,245 bytes. The first accepted run took
197.12 seconds and ended at 154.3 MiB RSS, inside every locked local budget.

The complete review is in
[the two-size river release audit](multiway-two-size-river-audit.md).
