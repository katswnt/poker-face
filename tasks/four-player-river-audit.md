# Four-player bounded river — release audit

**Status:** passed the locked Stage 3 gate

**Audited:** 2026-09-15

**Specification:** [Four-player bounded river — v1](four-player-river-spec.md)

## Plain result

Poker Face can now solve and independently grade one small four-player river game. All
four players have equal stacks. They may check or bet 30 chips; after a bet, each of the
other three players may fold or call. There are no raises.

This is a bounded research and teaching example, not a full poker solver and not advice
for arbitrary four-player hands.

The game counts all 174 physically possible sets of four private hands and all 5,742
endings. The saved strategy comes from 65,536 fixed CFR iterations. A separate checker
measures how much each player could gain by changing their whole strategy while the
other three keep theirs.

| Measurement | Saved result |
|---|---:|
| Player 0 value | `+28.123770106` chips/hand |
| Player 1 value | `+5.206539397` chips/hand |
| Player 2 value | `-5.792667643` chips/hand |
| Player 3 value | `-27.537641860` chips/hand |
| Player 0 gain available by changing alone | `0.092378494` chip/hand |
| Player 1 gain available by changing alone | `0.371437026` chip/hand |
| Player 2 gain available by changing alone | `0.386124096` chip/hand |
| Player 3 gain available by changing alone | `0.066206438` chip/hand |
| Largest gain available | **`0.386124096` chip/hand** |
| Locked maximum | `0.60` chip/hand |

The four values sum to zero apart from `1.4e-14` chip of floating-point noise. The
largest possible improvement is about `0.322%` of the 120-chip starting pot, below the
predeclared `0.5%` limit. More formally, the saved profile is within `0.3862` chip of a
Nash equilibrium for this one finite game: no single player can gain more than that by
changing alone.

The strategy is not exact GTO. The cards, actions, payouts, saved-strategy values, and
best responses are counted exactly. The strategy itself is an approximation produced by
a finite search.

## What was independently checked

### Four hands, action order, and money

- A separate four-loop deal builder found the same 174 compatible private-hand tuples
  with the same probabilities.
- A separately written action replay and slow five-of-seven hand evaluator matched the
  main engine on every deal and all 33 public endings: 5,742 comparisons in total.
- Pot size, awards, utility, and deal probability had zero measured disagreement.
- After a bet, all three opponents answer in circular order. That includes a player who
  checked before someone else bet.
- If all opponents fold, the bettor receives the pot. Otherwise every caller and the
  bettor reach showdown. Ties split the pot among all tied active players.
- Every payoff vector sums to zero.

### Hidden cards and best responses

- A decision key includes the acting player's cards and public facts, but none of the
  other six private cards.
- On a one-deal game, an exponential checker tried all 256 complete strategies for each
  player. It matched the scalable best-response checker exactly.
- A deliberately invalid checker that sees every hidden hand gains
  `0.591925182` extra chip against a uniform profile. That difference is kept as a test:
  the real checker must never receive the same advantage.
- Moving every hand, stack, position, and action-order entry to new seat labels preserved
  all 174 probabilities and all 5,742 utility vectors exactly.
- The generic multiway engine still reproduces the accepted heads-up result exactly.
- The heads-up artifact and all four earlier multiway artifacts retain valid hashes.

### Folded chips and teaching evidence

- The dead-money reduction checks all 2,088 endings where Player 3 folded without
  calling. Player 3's old 30 chips stay in the pot, but Player 3 cannot win them. A
  smaller independent settlement gives the same awards and utilities.
- Every teaching record preserves one joint distribution over all three opponent hands.
  It never multiplies three separate ranges and accidentally creates impossible hands.
- Every action stores value from the hand start, chip change from the current decision,
  new chips invested, expected award, fold and showdown outcomes, and showdown pot
  share.
- All 128 saved decision records are reached by the strategy. The data model still
  withholds values instead of inventing an explanation if a future strategy makes a
  branch unreachable.
- Learner copy says the answer is a four-player calculation and labels the saved strategy
  as approximate. It does not turn “more opponents” into a false rule to always fold.

## Convergence record

| Iterations | Largest gain available to one player |
|---:|---:|
| 256 | `0.810953384` chip/hand |
| 1,024 | `0.549462444` chip/hand |
| 4,096 | `0.352524572` chip/hand |
| 16,384 | `1.362601859` chips/hand |
| 65,536 | `0.386124096` chip/hand |

The checkpoints are not steadily improving. The large 16,384-iteration reversal is
important evidence, not a number to hide: ordinary CFR does not have the familiar
heads-up convergence guarantee in this four-player setting. The search proposes a
candidate; the separately calculated final unilateral gains decide whether that exact
candidate passes. We do not interpolate between checkpoints or claim the run converged
smoothly.

## Engineering measurements

The first accepted generation measured:

- 90.22 seconds wall time;
- 153.3 MiB resident memory at the end of the run;
- 3,783,332 artifact bytes, about 3.61 MiB;
- 11,311 complete game states and 128 information sets;
- rules SHA-256
  `41f88ee7590220ff597bb60173c8a3f47e7ce188909e5cb3c39d71475afa0a58`;
- payload SHA-256
  `1a3c79a9698771a3eb8875f06dcfb5ffd449dd3a535c618da0ba5b694f9c1b7e`.

The artifact hash covers the exact board, four weighted ranges, positions, action order,
legal actions, contributions, active players, awards, utilities, strategy, grade, and
teaching facts. A changed rule or number makes the stored artifact stale.

A second full generation produced identical bytes in 89.48 seconds and ended at 146.2
MiB RSS.

## Verification record

The release candidate passed all 315 repository tests. The checks also included:

- exact comparison of both settlement implementations on all 174 deals and all 5,742
  endings;
- exact agreement between scalable and exhaustive one-deal best responses;
- the hidden-card, seat-permutation, dead-money, and heads-up-reduction checks;
- a second complete 65,536-iteration run with identical rules hash, payload hash,
  strategy, grade, teaching facts, and generated bytes;
- byte-for-byte reproduction of every earlier Kuhn, Leduc, heads-up river, and multiway
  artifact;
- exhaustive evaluation of all 2,598,960 five-card poker hands;
- Next.js route generation, strict TypeScript checking, and ESLint with no warnings;
  and
- a production build covering `/`, `/solver`, and `/solver/lab`.

No live trainer or learner-interface code changes are part of this milestone.

## Review by perspective

### Expert CTO — pass for an offline, bounded milestone

The solve runs before deployment and adds no browser-time calculation or service. The
rules engine, independent settlement, strategy search, best-response grading, teaching
data, and content hashing remain separate. Earlier artifacts are checked rather than
silently replaced.

The next stage should validate sampling against this exact reference before attempting
wider ranges. It should not add earlier streets or a general table-size control at the
same time.

### Expert poker player — pass for the written game

The action order, checks, calls, folds, dead money, four-way ties, and showdown awards
behave like the narrow poker rules in the specification. Calling still depends on the
price, possible opponent hands, position, and later responses; the fourth player is not
reduced to a crude penalty.

The result applies only to this board, these four tiny ranges, equal stacks, one size,
and no raises. It is not a general four-handed chart.

### Expert math professor — pass, with the unstable search shown openly

The exact probability model is joint across four hands, so card removal and action
evidence remain coherent. The best response chooses one action for states a player
cannot distinguish. A separate exhaustive calculation confirms that constraint on a
small complete game.

The 16,384-iteration checkpoint gets worse. That is consistent with why the final grade
must be a directly measured vector of four unilateral gains, not a borrowed heads-up
exploitability formula or an assertion that CFR converged.

### Expert poker teacher — pass for evidence, not yet a lesson screen

The stored facts can explain the current pot, price, position, field size, possible
three-hand combinations, expected folds, chance of showdown, and chip difference between
actions. Those are the ingredients a learner needs to understand why another player can
change a decision.

A future lesson should reveal this in layers. Start with price and expected chip change;
then show how all three opponents' possible hands and responses change the answer.

### Expert product person — pass because the control surface does not overpromise

The live trainer is unchanged. Adding a “four players” selector today would suggest the
app can solve arbitrary four-player spots, which this experiment cannot. The saved data
is suitable for a clearly labeled solver-lab example after a separate interface review.

The player count must always appear next to a probability or value derived from this
artifact; otherwise users may mistake it for a heads-up number.

### Expert software engineer — pass

The complete tree shape is locked. Unit tests cover response order, prior checkers,
four-way ties, invalid money, hidden information, and permuted seats. Property tests vary
all 16 range weights and sample legal endings. The slow oracle covers every ending, while
the content hash prevents mismatched rules and results.

The dedicated four-player rules module duplicates some narrow three-player transition
code. That is acceptable at this boundary: it keeps the accepted artifacts stable and
makes the fourth-player assumptions easy to inspect. Shared machinery should be
extracted only when exact regression hashes prove behavior did not change.

## Safe claim and next boundary

Safe claim:

> I built one bounded four-player river experiment that counts every possible private-
> hand tuple and ending, checks its payoffs with a second implementation, and measures
> that no player can gain more than 0.387 chip per hand by changing alone.

Unsafe claim:

> I built an exact four-player no-limit GTO solver.

The next milestone is wider river ranges through deterministic joint sampling. The
sampled calculation must first reproduce this exact fixture within a confidence interval
declared before seeing the result.
