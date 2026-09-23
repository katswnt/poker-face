# Heads-up turn and river — reference v1 contract

Status: implementation contract, locked before the first solve (2026-09-22).

## Scope and claims

This is a small **offline two-player** experiment, separate from the river UI and
the multiway Stage 4/5 plan. It solves both remaining streets together, not a set of
independently solved rivers. There is no sampling, learned leaf value, GPU work, rake,
flop/preflop model, or claim of universal/exact GTO. Full enumeration is exact (up to
floating-point arithmetic); a finite-iteration CFR strategy is approximate.

## Game

- Four distinct known board cards, ordinary 52-card hold'em deck.
- Each player supplies a small explicit weighted range using the existing parser.
  Compatible ordered private deals have probability proportional to the product of
  weights. Board collisions and shared private cards cannot be dealt.
- Player 0 acts first on **both** streets; player 1 acts second. Both begin with the
  same positive whole-chip contribution. Behind-stack sizes may differ or be zero.
- One positive whole-chip opening bet amount per street. A bet is capped at the
  bettor's remaining stack. Check/bet when unopened; fold/call when facing a bet.
  No raises. Calls are capped at the caller's stack. No betting into an all-in player.
- Check/check or bet/call ends a street. After the turn ends without a fold, reveal
  each of the 44 physically legal river cards with conditional probability 1/44.
  All-ins still run out the board, with no meaningless later betting choices.
- A fold ends the game immediately. Every other branch reaches real showdown.
  Uncalled chips are returned. Utility is net chips including the initial contribution;
  ties split the contestable pot equally, with no odd-chip rounding. Utilities sum to zero.
- A decision observes only its owner's private hand, public board, both public action
  histories and public money. Turn decisions cannot observe a future river or the other
  hand. River decisions remember the turn history. Joint chance/action reach carries
  blocker correlations and range filtering into later decisions.

## Bounds and algorithm

Hard reference caps: 8 unblocked combinations per range, 16 compatible private deals,
25,000 full tree states, 100,000 iterations and 16 saved checkpoints. Input text and chip amounts are bounded.
Preflight counts the public betting skeleton before multiplying private deals and
river outcomes, and refuses excess work before expanding the full tree. It reports
exact state counts, not a runtime prediction.

Use the existing simultaneous-update full-tree **ordinary CFR**, not CFR+, and its
own-reach average. Use the separate information-set-aware best-response scorekeeper.
Exploitability is half the sum of the two best-response gains, in net chips per hand.
Neither training nor grading may choose different turn actions for different future
rivers. No React or browser worker is needed for this bounded offline milestone.

## Locked teaching fixture and acceptance

Board `Ks 8s 4d 2c`; first player's range `AsQs:0.5 KdKh`; second player's range
`QsJs 9h9d:2`. Initial contribution 50 each (100-chip pot), stacks 150 each,
turn bet 50, river bet 100. The shared queen of spades removes one private pairing:
three compatible deals, with probabilities 1/4, 1/4 and 1/2 (by combo identity).

Start at 16,384 ordinary CFR iterations; checkpoints 256, 1,024, 4,096 and final.
Maximum accepted exploitability **0.10 chip per hand**, plus passing all independent
rules/hidden-information checks. If more iterations are necessary, record that fact
without weakening this quality gate. Timing is measured, not an acceptance threshold.

The artifact includes the complete average strategy, both best-response gains,
convergence grades, input, tree counts, algorithm/version/iterations, and SHA-256
fingerprints for all game nodes (including information-set keys) and the payload.
Elapsed time stays outside the hashed result. A check command must reproduce bytes
without overwriting a stale artifact.

## Required evidence

- Exact blockers, weighted deal probabilities, all 44 river outcomes, and preflight counts.
- Independent slow showdown and money oracle on every fixture terminal; unequal-stack,
  zero-stack, ties, short calls and returned-chip cases.
- River continuations reduce to the existing no-raise river v3 rules.
- Perfect recall and private-hand masking; deliberate future-card peeking must produce
  an unattainable advantage in a positive cheating regression.
- Information-set best response agrees with exhaustive pure strategies in a reduced
  all-in game; the reduction retains hidden future cards and exact runouts.
- Earlier actions and revealed-card blockers update joint range reach correctly.
- Reproducible strategies/artifact, rejected malformed policies, existing solver artifacts
  unchanged, full unit/type/lint/build and relevant end-to-end regressions.

Next, after this proof: teach one cross-street decision in a bounded UI. Larger ranges,
multiple sizes, raises, sampled multiway games and acceleration remain separate work.
