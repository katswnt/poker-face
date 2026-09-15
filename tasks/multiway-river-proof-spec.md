# Exact three-player river proof — v1 specification

**Status:** implemented and passed the locked release gate

**Locked:** 2026-09-15

**Audited result:** 65,536 deterministic CFR iterations; maximum unilateral gain
`0.245424174` chip per hand. See the
[release audit](multiway-river-proof-audit.md).

**Purpose:** test whether Poker Face can solve and independently grade one small,
three-player hold'em river game without pretending it has built general multiway poker

## What this proof does

This program answers one deliberately narrow question:

> On this river, with these three small ranges and this one allowed bet size, what
> strategy can the program find, and how much could each player gain by changing their
> own strategy alone?

Every compatible set of private cards is counted. Every betting branch ends in a fold or
an exact showdown. There is no card sampling and no Monte Carlo estimate.

This is not a full poker solver. It does not cover user-entered ranges, earlier streets,
raises, side pots, unequal stacks, a fourth player, or arbitrary bet sizes. It must not
feed advice into the four-player trainer.

## Locked cards and ranges

Card codes use rank followed by suit: `As` means ace of spades. Each entry is one exact
two-card combination. The number after it is its relative starting weight.

**Board:** `Ks 8s 4s 2c 9d`

**Player 0 — first to act**

```text
AsQs ×3   QsJs ×2   KhQh ×4   KcJc ×3   9h9c ×1   7h6h ×2
```

**Player 1 — second to act**

```text
AsJs ×2   Ts7s ×2   KdQd ×4   8h8c ×1   9c8c ×3   6c5c ×2
```

**Player 2 — last to act when nobody has bet**

```text
Js9s ×2   AcKc ×4   4h4d ×1   Ah9h ×3   QdTd ×2   7c6d ×2
```

The ranges create `6³ = 216` nominal tuples. Exactly **172** are physically possible
after card collisions are removed. A tuple's raw weight is the product of its three
range-entry weights. The program normalizes only after it removes impossible tuples.
It must preserve that joint distribution; three separately updated opponent ranges are
not an acceptable substitute.

## Locked money and legal actions

- The starting pot is 90 chips. Each player contributed 30 before this river decision.
- Every player has 60 chips left, but this version permits only one 30-chip bet.
- Player 0 acts, then Player 1, then Player 2.
- With no bet open, a player may check or bet 30.
- After a bet, every other active player acts once in seat order and may fold or call 30.
- There are no raises.
- Three checks reach showdown.
- If one player remains after folds, that player wins immediately.
- Otherwise, action ends only after every remaining player has called the bet.
- All players have equal stacks, so this version has no side pots or returned excess.

The complete public tree after any one private-card tuple contains 25 states: 12
decisions and 13 terminals. The full tree is therefore locked at:

```text
1 chance state
2,064 decision states
2,236 terminal states
4,301 total states
72 information sets
```

Changing any card, weight, chip amount, action, action order, or tree count creates a new
rules version. It may not silently replace this result.

## Money and showdowns

A terminal payoff is net chips from the beginning of the hand:

```text
payoff = chips returned from the final pot − all chips contributed
```

Folded players remain entitled to nothing, but their earlier chips stay in the pot. At
showdown, the active hand or hands with the best exact five-card poker hand divide the
pot equally. Every terminal utility vector must sum to zero within `1e-9` chip.

Learner-facing data must separately show expected chip change from the current decision.
The 30 chips each player committed before the river are not a new cost of checking,
betting, folding, or calling.

## What a strategy is allowed to know

The engine must hold all three private hands so it can reject duplicate cards and score a
showdown. A player's strategy may use only:

- the rules version and board;
- their own two cards and seat;
- public checks, bets, folds, calls, contributions, and active seats.

It may not use either opponent's cards. Full states that differ only in opponents' hidden
cards must share one information set. A best response must choose one action for that
whole information set; it may not choose separately after secretly inspecting each
opponent hand.

## Candidate solver and independent grade

Deterministic, simultaneous-update, full-tree vanilla CFR will create the candidate. In a
three-player game, ordinary CFR is a search method, not proof that its saved average is a
Nash equilibrium.

The proof comes from a separate grader. For each player `i`, it keeps the other two saved
strategies fixed and calculates:

```text
unilateral gain[i]
  = best value player i can get by changing alone
    − player i's value in the saved profile
```

It reports all three gains and their maximum. It does not divide their sum by two and
does not call the result heads-up exploitability.

The first committed experiment is locked at **65,536 CFR iterations**, with checkpoints
at 256, 1,024, 4,096, 16,384, and 65,536. The acceptance gate, fixed before seeing the
result, is:

- maximum unilateral gain no greater than **0.45 chip per hand**;
- every profile value and best-response value finite;
- profile values sum to zero within `1e-9` chip;
- the separate terminal oracle agrees within `1e-9` chip;
- the scalable best-response checker agrees with exhaustive pure-strategy grading within
  `1e-9` chip on a reduced three-player river fixture;
- two generations produce byte-for-byte identical artifacts;
- runtime under 60 seconds, memory under 1 GiB, and artifact under 10 MiB.

If this experiment misses the 0.45-chip gate, the program stops and records a candidate,
not an accepted solution. The gate will not be relaxed after seeing the answer. A new
algorithm would require a new, pre-declared experiment.

## Checks that must fail differently

1. The game engine scores every terminal normally.
2. A slow oracle uses a separate table for all 13 terminal histories and the existing
   slow five-of-seven evaluator.
3. A scalable information-set best response combines hidden states before choosing.
4. An exponential pure-strategy grader checks that method on an eight-deal reduced
   fixture, enumerating all 256 pure strategies for each player.
5. A deliberately cheating test may see every hidden hand and must obtain an improperly
   higher value on a fixture, proving the real checker's information boundary matters.
6. Adapting the shipped heads-up river game to the N-player contract must preserve its
   tree, values, best-response grade, and committed artifact hash.

## Exact teaching facts

For each decision, the stored facts may include only information available to that seat:

- action frequencies and action values in chips;
- chip change from now, kept separate from hand-start net chips;
- difference from the best measured action;
- exact probability of reaching the decision;
- exact joint hidden-state posterior after public actions;
- opponent range summaries derived from that joint posterior;
- immediate responses, chance everyone folds, and chance one or more players continue;
- showdown win, split, loss, expected pot share, and showdown equity conditional on a
  showdown.

Plain-language copy must say this is one saved strategy for one small exact game. It may
say the action frequencies and card enumeration are exact. It may not call the finite-
iteration candidate “exact GTO.”

## Artifact contract

The committed JSON binds the result to the schema, rule version, board, joint ranges and
weights, money, action menu, action order, evaluator, solver algorithm, iteration count,
complete strategy, all three values and unilateral gains, convergence checkpoints,
teaching facts, tree counts, oracle result, and independent-check result.

A SHA-256 rules fingerprint covers every chance edge, information set, legal action, and
terminal payoff. A second SHA-256 hash covers the full payload. Any mismatch rejects the
artifact as stale.
