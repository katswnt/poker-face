# Exact three-player river proof — release audit

**Status:** passed the locked Stage 1 gate

**Audited:** 2026-09-15

**Specification:** [Exact three-player river proof — v1](multiway-river-proof-spec.md)

## Plain result

Poker Face can now solve and independently grade one small, exact three-player river
game. It has not built a general multiway no-limit solver.

The game counts all 172 physically possible private-hand tuples and all 2,236 terminal
outcomes. The saved strategy comes from 65,536 deterministic CFR iterations. Each
player's independent best response asks, “How much could this player gain by changing
alone while the other two keep playing the saved strategy?”

| Measurement | Exact saved result |
|---|---:|
| Player 0 value | `+9.874553349` chips/hand |
| Player 1 value | `+3.100669360` chips/hand |
| Player 2 value | `-12.975222709` chips/hand |
| Player 0 unilateral gain | `0.245424174` chip/hand |
| Player 1 unilateral gain | `0.234192519` chip/hand |
| Player 2 unilateral gain | `0.141993197` chip/hand |
| Maximum unilateral gain | **`0.245424174` chip/hand** |
| Locked maximum | `0.45` chip/hand |

The three values sum to zero apart from floating-point noise below `1e-14`. The maximum
gain is about `0.273%` of the 90-chip starting pot and passes the predeclared `0.5%` gate.
This makes the saved profile an approximately `0.2455`-Nash profile for this finite game:
no one player can gain more than that by changing alone.

That sentence is deliberately not “exact GTO.” The card enumeration and grading are
exact. The strategy came from a finite search and retains a measured amount of
improvability.

## What was independently checked

### Cards, action order, and money

- The game engine and a separate slow oracle agree on all 172 chance outcomes and all
  2,236 terminal payoffs with zero measured disagreement.
- The oracle uses a separate 13-row contribution table and the slow five-of-seven hand
  evaluator. It does not reuse the engine's fast showdown path or betting updates.
- Every terminal utility vector sums to zero.
- After a bet, both other active players must answer in seat order. Earlier checks do not
  make a player lose the right to respond to a later bet.
- Folded chips remain in the pot, folded hands cannot win it, and tied active hands split
  the complete pot.

### Hidden information and best responses

- Information-set keys include the acting player's cards and public state, but neither
  opponent hand.
- The scalable best-response checker chooses one action after combining every hidden
  state in an information set.
- On an eight-deal reduced river game, an exponential checker tested all 256 pure
  strategies for each player. Its best-response values match the scalable checker
  exactly.
- A deliberately cheating checker that chooses separately after seeing both hidden
  opponent hands gains `0.244252874` extra chip against a uniform profile. That regression
  proves why state-by-state maximization would be wrong.
- The N-player adapter reproduces the shipped heads-up river tree, values, and both
  best-response values exactly. The older artifact hash remains valid.

### Joint ranges and teaching facts

- Chance removes card collisions before normalizing the product of all three range
  weights.
- After a public action, the teaching calculation reweights whole three-hand tuples. It
  never updates each opponent independently and multiplies the answers afterward.
- All 72 decision records have normalized joint posteriors and normalized opponent
  marginals derived from those joint posteriors.
- Every action exposes saved frequency, hand-start value, chip change from now,
  difference from the best measured action, immediate response, fold outcome, showdown
  outcomes, and expected showdown pot share.
- A fold facing a bet is correctly worth zero new chips from that decision. The 30 chips
  committed before the river are not charged again.

## An important convergence finding

Three-player CFR did not improve monotonically:

| Iterations | Maximum unilateral gain |
|---:|---:|
| 256 | `0.587177563` |
| 1,024 | `0.266144685` |
| 4,096 | `0.157645507` |
| 16,384 | `0.086311584` |
| 65,536 | `0.245424174` |

The final locked checkpoint passes, but it is worse than the 16,384-iteration checkpoint.
That is not treated as a failed test or hidden by selecting the prettiest checkpoint.
Ordinary CFR has its familiar convergence guarantee in two-player zero-sum games; the
same guarantee does not carry over to three independent players. Here CFR creates a
candidate, and the separate unilateral-gain measurement decides whether that candidate
passes.

This is one of the strongest lessons in the milestone: more training did not certify a
better multiway strategy. Only the independent grade could answer that question.

## Engineering measurements

The first clear implementation produced the same mathematical result but took `71.07`
seconds, over the locked 60-second budget. Reusing one value vector per compiled tree node
removed repeated temporary allocations without changing the algorithm, rules, or result.

The final accepted generation measured:

- `28.25` seconds wall time;
- `138.4` MiB end-of-run resident memory;
- `1,191,767` artifact bytes, about `1.14` MiB;
- identical rules SHA-256 across optimization:
  `70a925be7d2d970f070f076f6ff178c60c3e65b88834082c04c0311742ac981c`;
- final payload SHA-256:
  `61a283f27b744a77bad69cea75fa5febecbd7e565a9a1b6b1b7366931de963b8`.

A check-only regeneration took `27.80` seconds before the reduced-fixture strengthening;
the final generation took `28.25` seconds. Runtime and memory are machine observations,
not mathematical quality scores. The script does enforce the locked local stop budgets
while creating or checking this small artifact.

## Review by perspective

### Expert CTO — pass, within the bounded scope

The milestone adds no production dependency and does no browser-time solving. The game,
candidate solver, scorekeeper, slow oracle, teaching derivation, and hash layer are
separate. The existing trainer receives no multiway recommendation. Reproducible content-
addressed data makes the exact rule input reviewable.

The main operational limit is intentional: wider ranges will quickly make a readable JSON
strategy too large. The next stage should keep the exact oracle and profile before adding
storage or speed machinery.

### Expert poker player — pass for the written game

Position is real action order, not a label. A bet remains open until every other live
player calls or folds. Checks before a later bet do not close action. Folded contributions
remain in the pot, showdowns compare exact best-five hands, and ties divide the pot.

This is a highly simplified river abstraction: one 30-chip size, no raise, equal stacks,
and no side pots. Its frequencies should not be copied into unrestricted live poker.

### Expert math professor — pass, with the convergence warning kept prominent

The result reports a vector of values and a vector of unilateral gains. It does not reuse
the heads-up “half the Nash gap” formula. The hidden-card distribution stays joint, and
conditioning after actions uses Bayes' rule over compatible tuples.

The non-monotone training record is material evidence that the candidate generator is not
the proof. The independent information-set best response supplies the finite-game quality
statement. There is still no matching external open-source multiway result, so the release
relies on multiple internal checks designed to fail differently.

### Expert poker teacher — pass for data, no learner screen claimed

The stored facts can explain why a third player matters: someone can act behind, both
opponents' responses affect whether a bet wins immediately, and showdown equity is an
expected share rather than a simple win/loss flag. “Chips from now” is kept separate from
the result measured from the hand's start.

No learner UI has been connected. Before showing this data, the page should lead with the
action difference in chips, then explain seat order and opponent responses, with joint-
range detail expandable.

### Expert product person — pass because the claim stays small

The artifact is one audited lesson input, not a control panel that pretends to solve any
range or table size. The plain label is “bounded multiway river proof.” The product still
has no player-count switch backed by unaudited calculations.

The next product decision should wait until the raised version passes. A no-raise lesson
can teach multiway range and position effects, but it does not yet resemble enough normal
river play to deserve a primary trainer surface.

### Expert software engineer — pass

The implementation keeps the N-player contract beside the proven two-player contract.
Properties vary all 18 positive range weights, exact tests cover action closure and pot
splits, exhaustive reduced grading checks the scalable algorithm, a cheating regression
checks the information boundary, and hashes bind all rules and results. All prior solver
artifacts reproduce unchanged.

The readable recursive implementation remains the source of truth. The allocation
optimization reuses scratch values but does not memoize across strategies or skip states.

## Verification record

- 208 unit, property, regression, solver, and copy tests passed.
- ESLint passed.
- Next.js route type generation and TypeScript passed.
- The optimized production build passed for `/`, `/solver`, and `/solver/lab`.
- The exhaustive 2,598,960-hand evaluator audit passed canonical category counts.
- Kuhn, Leduc, heads-up river, and three-player river artifacts regenerated exactly.

## Release claim and next boundary

Safe claim:

> I built a bounded, exact three-player river proof of concept. It preserves correlated
> hidden ranges, checks all terminal cards and chips with a second oracle, and measures how
> much each player could gain by changing alone.

Unsafe claim:

> I built a full multiway no-limit hold'em solver.

The next mathematical milestone is Stage 2: add one all-in raise after the 30-chip bet,
recount the complete tree, and rerun every check. A second opening bet size comes only
after the raised game passes.
