# Heads-up river hold'em solver — release audit

**Reviewed:** 2026-09-14

**Scope:** one locked, heads-up river game; not full hold'em and not the four-player trainer

**Decision:** pass this mathematical milestone. Keep it separate from the live trainer.

## The plain answer

The solver studies one known river board, eight exact hands for each player, a 100-chip
pot, 100 chips left per player, and a short menu of bets. There are no more cards to deal.
That makes it possible to count every legal private-hand pairing and every showdown.

Three of the apparent 64 hand pairings are impossible because both players would need the
same physical card. The engine correctly keeps 61 pairings, adjusts their probabilities,
and walks all 793 ways those deals can end.

The saved strategy is close to perfect play under these rules, but it is not exact GTO.
Against the saved strategy:

- Player 0 could improve by about `0.0417` chip per hand.
- Player 1 could improve by about `0.0710` chip per hand.
- Their combined improvement is about `0.1127` chip.
- Using the stated heads-up convention, exploitability is half of that: about `0.0563`
  chip per hand, or `0.0563%` of the starting river pot.

An independent MIT-licensed solver produced a player-0 value within `0.0169` chip of
ours on the same tree. Our separate scorekeeper also reproduced that solver's two
best-response values and exploitability to within `1e-9` chip.

## Evidence at a glance

| Check | Result |
|---|---:|
| Compatible private-hand pairs | 61, exactly enumerated |
| Complete tree states | 1,282 |
| Player decisions | 488 |
| Terminal endings | 793 |
| Situations a player can distinguish | 64 |
| Monte Carlo samples | 0 |
| Terminal zero-sum error | 0 chips |
| Independent payoff disagreement | 0 chips |
| Saved solve iterations | 51,200 |
| Saved exploitability | 0.056340249 chips/hand |
| Pinned reference exploitability | 0.009169798 chips/hand |
| Player-0 value difference from reference | 0.016847979 chips/hand |

The release gate was fixed before the solve at `0.25` chip of exploitability and `0.25`
chip of player-0 value difference. Passing those gates means “within our measured error
limit,” not “perfect.”

## Review by perspective

### Expert CTO

**Pass for an isolated lab.** The rules, solver, scorekeeper, explanation data, generated
artifact, and external comparison have separate jobs. The artifact records the complete
input, rules hash, strategy, both best-response gains, convergence history, independent
reference, and payload hash. `npm run audit:river` solves from scratch and rejects a stale
committed result.

The strongest boundary is also the simplest: this code does not supply advice to the
four-player trainer. A heads-up river answer would be wrong if silently reused for more
players or earlier streets.

### Expert poker player

**Pass for the written abstraction.** Player 0 acts first. Both players begin the river
with 100 chips behind. With no bet open they may check, bet 50, or bet 100 all-in. A
50-chip bet may be raised all-in to 100 total. A 100-chip bet cannot be raised because no
chips remain. There is at most one raise after an opening bet.

The board, exact combinations, positions, pot, stacks, sizes, and raise cap are all saved
with the result. This is a useful river drill, not a claim about every stack depth or bet
size in no-limit hold'em.

### Expert math professor

**Pass.** Chance is exact: each legal hand pair receives its two input weights multiplied
together, impossible pairs are removed, and the remaining weights are normalized to
100%. Showdowns use no sampling.

The scorekeeper chooses one action for every situation a player can actually recognize.
It cannot choose one response when the unseen hand is one thing and another response when
the unseen hand is something else. A reduced-game test compares this scalable calculation
with exhaustive pure-strategy search, and a deliberate cheating test proves why that
information boundary matters.

Two money numbers remain deliberately separate:

- **Result from the hand's start** includes chips placed in the pot before the river.
- **Change from this decision** treats chips already committed as past and asks what each
  choice changes from now on.

That separation makes folding worth exactly zero additional chips, even though the
whole-hand result after folding is negative.

### Expert poker teacher

**Pass for structured teaching data.** Every decision record contains:

- what the player knows: position, own cards, board, pot, call price, and public actions;
- the opponent hands still possible after card blocking and earlier choices;
- how often this saved strategy takes each action;
- the average chip change from taking each action now;
- how far each action trails the best measured action;
- how the opponent responds immediately;
- how often the hand later ends in a fold, win, split, or loss;
- showdown equity only among branches that actually reach showdown.

The UI should teach in this order: choice, chip difference, reason, opponent response,
then range detail. It should say “this saved solve uses…” and “on average from here…” It
must not say “always,” “guaranteed,” or “exact GTO.”

### Expert product person

**Pass as a completed engine milestone; no production learner screen yet.** The best first
lesson is not a wall of 64 strategies. It is one selected hand with:

1. the exact cards, board, position, pot, and price;
2. one clear recommendation plus any meaningful mix;
3. the chip value of each choice from now;
4. a plain explanation of folds versus showdowns;
5. an expandable opponent range showing how an earlier action changed it;
6. a small, permanent scope note: two players, river only, fixed sizes.

Shipping the mathematical artifact before its UI is a feature, not a gap: product copy
cannot quietly become the source of the numbers.

### Expert software engineer

**Pass.** The tests cover malformed and duplicate cards, board collisions, empty and
weighted ranges, blocked combinations, every legal terminal history, exact contributions,
zero-sum payoffs, hidden-card grouping, Bayesian range updates, response and outcome
normalization, off-path decisions, deterministic solves, and stale artifacts.

Two independent paths provide unusually strong regression protection:

- The river payoff oracle uses a separate terminal contribution table and the slow
  five-of-seven evaluator. It agrees on all 793 terminal states.
- The best-response checker is independent of CFR regret totals and matches exhaustive
  pure-strategy grading on a smaller hold'em game.

The pinned reference exposed one upstream limitation rather than hiding it: its optimized
Python showdown path raises `KeyError` on these unequal strength sets. Our reproducible
adapter uses that repository's slower exact showdown path and records the reason.

## Claim boundaries

Allowed:

- “Every compatible private-hand pair and showdown is counted exactly.”
- “This saved strategy is measured at about 0.056 chip of exploitability per hand under
  the half-Nash-gap definition.”
- “The two independent implementations agree on player-0 value within 0.017 chip.”
- “An earlier action changes the opponent range by giving more weight to hands that take
  that action more often.”

Not allowed:

- “This is exact GTO.”
- “This solves hold'em.”
- “These frequencies apply with different ranges, positions, stacks, sizes, or players.”
- “Showdown equity alone tells you which action is best.”
- “The solver knows the opponent's cards.”
- “Exploitability is half the Nash gap in multiplayer poker.”

## Remaining limits

- One board and two eight-combination ranges.
- Equal stacks and equal prior contributions.
- River only, heads-up only, and a finite action menu.
- Ordinary CFR is intentionally readable rather than the fastest available method.
- Action frequencies are approximate. Exact enumeration removes card-sampling error, not
  finite-solver error.
- The result is not connected to the current trainer.

These limits are part of the result, not footnotes to remove later.
