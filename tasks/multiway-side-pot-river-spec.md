# Three-player unequal-stack river with a side pot — v1 specification

**Status:** implemented; passed the locked gate

**Locked:** 2026-09-15

**Depends on:** [the accepted two-size game](multiway-two-size-river-spec.md)

## What changes

This milestone changes one thing that matters a great deal in real poker: the players do
not all have the same number of chips left. Player 0 has 30 chips behind. Players 1 and 2
have 60 chips behind.

That creates a side pot. If all three players continue for 30 and the two deeper players
continue for another 30, Player 0 can win the main pot but cannot win the extra chips
that only Players 1 and 2 put in.

The board, ranges, positions, starting contributions, two nominal bet sizes, and
one-raise limit stay fixed. This remains one small river experiment. It is not a full
no-limit solver, general poker advice, or part of the live trainer.

## Cards, ranges, positions, and money

**Board:** `Ks 8s 4s 2c 9d`

```text
Player 0: AsQs ×3   QsJs ×2   KhQh ×4   KcJc ×3   9h9c ×1   7h6h ×2
Player 1: AsJs ×2   Ts7s ×2   KdQd ×4   8h8c ×1   9c8c ×3   6c5c ×2
Player 2: Js9s ×2   AcKc ×4   4h4d ×1   Ah9h ×3   QdTd ×2   7c6d ×2
```

- Exactly 172 of the nominal `6³ = 216` private-hand tuples are possible.
- Each player has already contributed 30 chips to the 90-chip pot.
- Player 0 has 30 chips left. Players 1 and 2 each have 60 chips left.
- Player 0 acts first, Player 1 second, and Player 2 last while no bet is open.

Chance removes card collisions before weights are normalized. Actions update the
probability of whole opponent-hand pairs. The two opponent ranges are never multiplied
as though their blocked cards were independent.

## Locked actions

With no bet open:

- every player may check or bet 30;
- Players 1 and 2 may instead bet all 60 chips they have left;
- Player 0 cannot choose the 60-chip action because Player 0 has only 30 chips left.

Facing a bet:

- a player may fold;
- a player may call with the smaller of the amount owed and the chips they have left;
- a deep player facing 30 may raise to 60 if the raise limit is unused and another
  active player still has chips that can respond;
- nobody may raise after the wager reaches 60.

A call by Player 0 against a 60-chip wager costs only Player 0's remaining 30 chips. It
is a legal short all-in call; it does not pretend Player 0 matched 60. An all-in player
is skipped on later action. A raise reopens action only for active players who still
have chips and have not matched the new wager.

The stored action names remain `check`, `bet-30`, `bet-all-in`, `fold`, `call`, and
`raise-all-in`. The teaching data must store the actual call cost, because `call` can
cost 30 or 60 in this game.

## Locked complete tree

For each compatible private-hand tuple, the public tree has exactly:

```text
25 decision states
33 terminal states
58 total states
```

Across all 172 compatible tuples, plus the chance root, the game has exactly:

```text
1 chance state
4,300 decision states
5,676 terminal states
9,977 total states
150 information sets
33 distinct terminal action histories
```

Player 0 has 8 public decision histories, Player 1 has 9, and Player 2 has 8. With six
private hands each, that is 48, 54, and 48 information sets. On a one-deal audit game,
the players have 256, 2,592, and 864 complete pure strategies respectively. These
counts are release tests, not informal estimates.

## Pot construction and settlement

Settlement follows four explicit steps:

1. Add each player's old 30 chips and any river chips they put in.
2. Return the unmatched top part if exactly one player contributed more than everyone
   else. Returned chips are not winnings.
3. Build pot layers at each remaining contribution level. A layer includes chips from
   every player who reached that level, including folded players. Only active players
   who reached that level may win it.
4. Score each layer separately. The best eligible hand wins that layer; tied best hands
   split it.

The central side-pot example is:

```text
total contributions: Player 0 = 60, Player 1 = 90, Player 2 = 90
main pot:             180, eligible Players 0, 1, and 2
side pot:              60, eligible Players 1 and 2 only
```

Player 0 may win the 180-chip main pot while a different player wins the 60-chip side
pot. The result must not label Player 0 the winner of all 240 chips.

Payoff remains net chip change from the beginning of the hand:

```text
payoff = returned uncalled chips + chips awarded from all eligible pot layers
         − all chips contributed
```

Every terminal utility vector must sum to zero within `1e-9` chip.

## Hidden information boundary

A strategy sees only the acting player's cards and public facts: board, active and
all-in seats, contributions, current wager, raise use, acting seat, stacks, and public
action history. It cannot see either opponent's cards.

A best response chooses one action for every hidden state in the same information set.
It may not choose separately after secretly inspecting an opponent's hand.

## Candidate and fixed acceptance gate

The one predeclared candidate uses deterministic, simultaneous full-tree vanilla CFR for
exactly **65,536 iterations**. Checkpoints are fixed at 256, 1,024, 4,096, 16,384, and
65,536. CFR proposes a strategy; it does not prove general convergence in a three-player
game.

The independent grader reports each player's exact unilateral gain:

```text
gain[i] = best value player i can get by changing alone
          − saved value for player i
```

The maximum allowed gain stays **0.45 chip per hand**, or `0.5%` of the original
90-chip pot. This limit will not be changed after seeing the candidate. The report will
show all three gains and will not divide a multiplayer number by two or call it heads-up
exploitability.

Release also requires:

- exact agreement with a separately written slow pot-layer and showdown oracle on all
  5,676 endings within `1e-9` chip;
- exact agreement between scalable and exhaustive best responses on the one-deal game;
- explicit regression cases for a short all-in call, a returned unmatched raise, a
  short-stack main-pot win, and a different deep-stack side-pot winner;
- valid hashes for the heads-up and all three accepted multiway artifacts;
- normalized card, strategy, range, response, and outcome probabilities;
- byte-for-byte identical generated output from two complete runs;
- generation under 10 minutes, 4 GiB resident memory, and 100 MiB of stored output;
- every repository test, solver audit, type check, lint check, and production build
  passing.

If the candidate misses the 0.45-chip gate, stop and record it as a failed candidate.
Do not change the rules, iteration count, or limit after seeing the answer.

## Teaching facts

Every decision record must store:

- the saved frequency and exact measured value of every legal action;
- expected chip change from this decision, without charging old chips again;
- expected new chips contributed after the decision, so the displayed value can be
  reconciled as awards plus returns minus new contributions;
- the actual cost to call with this player's remaining stack;
- exact reach probability and blocker-aware joint opponent ranges;
- immediate response frequencies and eventual fold/showdown outcomes;
- expected uncalled chips returned;
- every possible pot layer, who is eligible, its expected size, and how many chips the
  acting player expects to receive from it; and
- the difference between each action and the best measured action.

Plain-language explanations must distinguish the main pot from the side pot. They must
say that a short stack can win only pots it paid enough to enter. They must never use one
overall “win percentage” when different pot layers have different eligible players.

## Stop condition and next boundary

This milestone stops if pot construction, the independent oracle, or the hidden-
information best response disagrees, even if the candidate passes its numeric gate.

Passing this fixture would prove one exact unequal-stack, two-size, one-raise river
abstraction. It would not justify arbitrary stack controls. The next planned complexity
step remains a four-player bounded river using a simpler betting tree.

## Accepted result

The one predeclared candidate passed without changing the rules, iteration count, or
quality gate:

```text
profile values       +9.919463311, +2.135977344, -12.055440655 chips/hand
unilateral gains      0.077093491,  0.097278356,   0.061199137 chip/hand
maximum gain          0.097278356 chip/hand
locked maximum        0.450000000 chip/hand
```

The separately written oracle matched all 5,676 endings, including every pot layer,
winner, award, and return. On the one-deal audit games, the scalable best-response
checker matched exhaustive searches of 256, 2,592, and 864 complete strategies. The
2,841,176-byte artifact reproduced byte for byte in a second complete run.

The complete review is in
[the unequal-stack side-pot release audit](multiway-side-pot-river-audit.md).
