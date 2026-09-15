# Three-player raised river — release audit

**Status:** passed the locked Stage 2 gate

**Audited:** 2026-09-15

**Specification:** [Three-player river with one raise — v1](multiway-raised-river-spec.md)

## Plain result

Poker Face can now solve and independently grade one small three-player river game in
which a player may raise once. This is a tested step toward a multiway solver, not a full
no-limit poker solver.

The game counts all 172 possible sets of private cards and all 7,396 endings. The saved
strategy comes from 65,536 fixed, repeatable CFR iterations. A separate checker then asks
how much each player could gain by changing their entire strategy while the other two
keep theirs unchanged.

| Measurement | Saved result |
|---|---:|
| Player 0 value | `+10.732029731` chips/hand |
| Player 1 value | `+2.179621582` chips/hand |
| Player 2 value | `-12.911651314` chips/hand |
| Player 0 gain available by changing alone | `0.114439025` chip/hand |
| Player 1 gain available by changing alone | `0.068522158` chip/hand |
| Player 2 gain available by changing alone | `0.087536290` chip/hand |
| Largest gain available | **`0.114439025` chip/hand** |
| Locked maximum | `0.45` chip/hand |

The values sum to zero apart from floating-point noise of `3.6e-15` chip. The largest
available improvement is about `0.127%` of the 90-chip starting pot, below the
predeclared `0.5%` limit. In precise terms, this is an approximately `0.1145`-Nash
profile for this one finite game: no single player can gain more than that by changing
alone.

The strategy is not exact GTO. The cards, action tree, payoffs, saved-strategy values,
and best-response grades are counted exactly. The strategy itself is the result of a
finite search and has the measured improvement shown above.

## What was independently checked

### Raises, turns, and money

- A separate replay engine and slow five-of-seven hand evaluator agree with the main
  game on all 7,396 endings. Utility, returned chips, and the pot players can contest
  have zero measured disagreement.
- If Player 0 bets, Player 1 calls, and Player 2 raises, Player 0 responds first. If
  Player 0 calls, Player 1 must decide again because the earlier call matched only 30,
  not the new total of 60.
- Nobody can raise twice. After the one raise, the only choices are fold or call.
- If a 60-chip raise receives only a 30-chip match, the unmatched 30 comes back to the
  raiser. It is stored as returned money, not called winnings.
- Money put in before the current choice stays separate from money at risk now. If a
  player called 30 and later folds to a raise, the fold costs zero new chips. The earlier
  30 still counts in the result for the whole hand.
- Every ending conserves chips, including ties and returns.

### Hidden cards and best responses

- Every decision groups together all states that look the same to the acting player.
  The key contains that player's hand and public facts, but neither opponent's cards.
- On a one-deal raised game, an exhaustive checker tried all 6,912 complete strategies
  for each player. It agreed exactly with the scalable checker across a uniform profile
  and two different mixed profiles.
- A deliberately cheating checker that sees hidden opponent cards gains
  `3.563750532` extra chips against a uniform profile. That large gap is a regression
  test: a real checker must never choose separately for hidden hands.
- The accepted no-raise multiway artifact and the accepted heads-up artifact still pass
  their content hashes. The raised game lives beside them rather than changing their
  rules after the fact.

### Teaching data

- All 198 decision records keep the two opponents' possible hands as one joint list.
  This preserves card blockers and the link created when one opponent's action gives
  information about the other's possible cards.
- Each on-path action stores its frequency, value from the hand's start, chip change
  from now, difference from the best measured choice, immediate next-player response,
  eventual fold and showdown results, showdown pot share, returned chips, and the pot
  players can actually contest.
- Two saved-strategy decisions are effectively unreachable. Their values and
  explanations are withheld instead of inventing precise numbers for a branch the
  strategy does not reach.
- Plain-language copy explains that raising may make an earlier caller act again. It
  calls the exact counting exact and calls the finite strategy an approximation.

## Convergence record

| Iterations | Largest gain available to one player |
|---:|---:|
| 256 | `1.269448033` chips/hand |
| 1,024 | `0.397778936` chip/hand |
| 4,096 | `0.184061391` chip/hand |
| 16,384 | `0.202300956` chip/hand |
| 65,536 | `0.114439025` chip/hand |

The measurement rose slightly between 4,096 and 16,384 iterations. That is reported,
not smoothed away. In a three-player game, more ordinary CFR iterations do not provide
the same convergence guarantee as they do in a two-player zero-sum game. CFR proposes a
strategy; the independent best-response grade decides whether it passes.

## Engineering measurements

The accepted generation measured:

- 116.29 seconds wall time;
- 127.7 MiB resident memory at the end of the run;
- 3,389,606 artifact bytes, about 3.23 MiB;
- 13,073 complete game states and 198 information sets;
- rules SHA-256
  `2e32265b79cb0262dcca513f0153178ba8d1246dc1a0910cb6c390e6d1e585e7`;
- payload SHA-256
  `c4be1dc3dd54af574352a728275d24849e9b2049cc6158046446c1cc79a95fa5`.

The artifact binds the saved numbers to the exact board, weighted ranges, action order,
money, action menu, evaluator, tree, and teaching facts. Changing any of them invalidates
the hash. A check-only command rebuilds the whole result and requires identical bytes.
The independent check-only run produced identical bytes in 116.38 seconds and ended at
136.6 MiB RSS.

## Verification record

- All 233 unit, property, regression, solver, session, and copy tests passed.
- ESLint passed.
- Next.js route generation and TypeScript passed.
- The optimized production build passed for `/`, `/solver`, and `/solver/lab`.
- The exhaustive 2,598,960-hand evaluator category audit passed.
- Kuhn, Leduc, heads-up river, no-raise multiway river, and raised multiway river
  artifacts regenerated exactly.
- Two complete raised runs produced the same rules and payload hashes and identical
  artifact bytes.

## Review by perspective

### Expert CTO — pass for an isolated research milestone

The raised solver adds no runtime dependency and is not wired into the live trainer. Its
fixed artifact is generated before deployment, and stale or altered output fails closed.
The rules, candidate generator, independent grader, slow oracle, teaching facts, and hash
layer have separate jobs.

The next step must stay equally narrow. Adding a second opening size is reasonable;
adding a fourth player, unequal stacks, and side pots in the same change is not.

### Expert poker player — pass for the written rules

The action reopens correctly after a raise, including for someone who already called.
The raise is all-in to 60 river chips, not 60 more. Folded money stays in the pot, an
uncalled excess comes back, active tied hands split the pot, and the best five-card hand
from seven decides showdowns.

These frequencies apply only to the shown board, tiny weighted ranges, equal stacks, and
fixed bet sizes. They are not general live-poker advice.

### Expert math professor — pass with an honest limit

The result reports one value and one possible unilateral improvement for each player. It
does not divide a three-player gap by two or call that exploitability. Exact enumeration
keeps the opponents' hidden hands correlated, and best responses choose one action for
all hidden states a player cannot tell apart.

The independent oracle and exhaustive checker are strong internal evidence. There is no
pinned open-source solver that matches this exact three-player game, so external numeric
agreement is still unavailable and is not claimed.

### Expert poker teacher — pass for the evidence layer

The data can teach the most important new idea plainly: after a raise, everyone who has
not paid the new price must answer—even a player who paid the old price. It can also show
the difference between chips already spent and chips at risk now, and between money
returned and money won.

There is still no learner screen for this artifact. A future lesson should reveal one
idea at a time and keep range tables and convergence details behind optional detail.

### Expert product person — pass because it is not over-shipped

This milestone improves the evidence before expanding the interface. It does not add a
player-count control that pretends to solve unsupported games, and it does not insert a
small research fixture into the four-player trainer.

The next useful product prototype can compare the no-raise and one-raise lessons, but it
should remain labeled as a fixed example until several separately audited fixtures exist.

### Expert software engineer — pass

The exact tree count is locked. Unit tests cover reopening and invalid second raises.
Properties vary every range weight and 100 valid money configurations. The separate
oracle checks every deal and ending. The exhaustive checker validates the scalable best
response. Hash tests reject stale math and protect both earlier artifacts.

The main technical cost is intentional repetition between the no-raise and raised rule
engines. That keeps the accepted Stage 1 fingerprint stable and makes the new action
logic reviewable. Generalizing both should wait until a second bet size shows which parts
are truly shared.

## Safe claim and next boundary

Safe claim:

> I added one all-in raise to a bounded three-player river game, checked every possible
> ending with a second implementation, and measured that no player can improve by more
> than 0.115 chip per hand by changing alone.

Unsafe claim:

> I built an exact multiway no-limit GTO solver.

The next locked milestone is one more opening choice: check, bet 30, or bet 60 all-in.
It should keep the same board, ranges, equal stacks, and one-raise rule, then recount and
reaudit the entire game before unequal stacks or side pots are considered.
