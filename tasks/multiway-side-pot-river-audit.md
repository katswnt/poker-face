# Three-player unequal-stack side-pot river — release audit

**Status:** passed the locked Stage 2 gate

**Audited:** 2026-09-15

**Specification:** [Three-player unequal-stack river with a side pot — v1](multiway-side-pot-river-spec.md)

## Plain result

Poker Face can now solve and independently grade one small three-player river game in
which one player has fewer chips than the other two. The short stack can call only with
the chips it has. If the deeper stacks put in more, that extra money forms a side pot.
Each pot is awarded only among the players who paid enough to enter it.

This is a bounded teaching experiment, not a full no-limit solver.

The game counts all 172 possible sets of private cards and all 5,676 endings. The saved
strategy comes from 65,536 fixed CFR iterations. A separate checker measures how much
each player could gain by changing their whole strategy while the other two keep theirs.

| Measurement | Saved result |
|---|---:|
| Player 0 value | `+9.919463311` chips/hand |
| Player 1 value | `+2.135977344` chips/hand |
| Player 2 value | `-12.055440655` chips/hand |
| Player 0 gain available by changing alone | `0.077093491` chip/hand |
| Player 1 gain available by changing alone | `0.097278356` chip/hand |
| Player 2 gain available by changing alone | `0.061199137` chip/hand |
| Largest gain available | **`0.097278356` chip/hand** |
| Locked maximum | `0.45` chip/hand |

The values sum to zero apart from `2.1e-14` chip of floating-point noise. The largest
possible improvement is about `0.108%` of the original 90-chip pot, below the
predeclared `0.5%` limit. In precise terms, this is an approximately `0.0973`-Nash
profile for this one finite game: no one player can gain more than that by changing
alone.

The strategy is not exact GTO. Cards, actions, payoffs, pot layers, saved-strategy
values, and best responses are counted exactly. The strategy itself comes from a finite
search and retains the measured room for improvement above.

## What was independently checked

### Action and all-in rules

- Player 0 has 30 chips left and cannot select the 60-chip opening bet.
- Players 1 and 2 have 60 chips left and may check, bet 30, or bet all 60.
- Calling a 60-chip wager costs Player 0 only the remaining 30. The code records that as
  a short all-in call rather than pretending the wager was fully matched.
- All-in players are skipped when later action is reopened.
- A raise to 60 is offered only when it is legal and another active player with chips
  can respond. There is no meaningless raise against opponents who are already all-in.
- Unmatched chips are returned before any pot is built and are never called winnings.

### Pot layers and showdowns

- A separately written replay engine, slow five-of-seven evaluator, and pot builder
  agree with the main engine on every one of the 5,676 endings.
- Agreement covers every deal probability, utility, return, contestable amount, pot
  layer, eligible-player list, winner, and award. Every measured difference is zero.
- A locked regression gives Player 0 the best overall hand and Player 2 the second-best
  hand. Player 0 wins the 180-chip main pot; Player 2 wins the 60-chip side pot; Player 1
  wins neither.
- Board ties are split separately within each layer. A player who did not contribute
  enough to a layer receives none of it even when that player's hand ties the board.
- Every ending conserves chips.

### Hidden cards and scorekeeping

- Decision keys contain the acting player's cards and public facts, including public
  stacks and all-in status, but no opponent cards.
- On a one-deal game, an exponential checker tried all 256, 2,592, and 864 complete
  strategies for Players 0, 1, and 2. It matched the scalable best-response checker
  exactly.
- A deliberately invalid checker that chooses after seeing hidden cards gains
  `2.901944090` extra chips against a uniform profile. That advantage is kept as a
  regression test: the real checker must not receive it.
- The accepted heads-up, no-raise, one-raise, and equal-stack two-size artifacts retain
  valid hashes.

### Teaching evidence

- Every decision preserves one joint distribution over the two opponents' hands.
  Blocked hands remain impossible after public actions.
- Every action stores its value from the beginning of the hand and its chip change from
  the current decision separately.
- Expected new contributions are stored too. This lets a future lesson verify the plain
  equation: awards plus returned chips minus new chips invested.
- The actual call price is capped by the acting player's remaining stack.
- Each possible pot layer records how often it exists, how large it is on average,
  whether the acting player is eligible, and the player's expected award from it.
- The first wording audit rejected “a short stack cannot win a side pot” as too broad.
  The accurate rule is that a player can win a layer only after contributing enough to
  enter that layer.
- This saved strategy reaches all 150 decision records. The data model will still
  withhold values rather than inventing advice on an unreachable branch.

## Convergence record

| Iterations | Largest gain available to one player |
|---:|---:|
| 256 | `1.109740070` chips/hand |
| 1,024 | `0.708874488` chip/hand |
| 4,096 | `0.232547123` chip/hand |
| 16,384 | `0.156877780` chip/hand |
| 65,536 | `0.097278356` chip/hand |

The checkpoints improve, but this does not create a general convergence guarantee for
three-player CFR. The search proposes a strategy. The separately computed unilateral
gains decide whether that candidate passes.

## Engineering measurements

The first accepted generation measured:

- 70.56 seconds wall time;
- 154.4 MiB resident memory at the end of the run;
- 2,841,176 artifact bytes, about 2.71 MiB;
- 9,977 complete game states and 150 information sets;
- rules SHA-256
  `bdbc723d1a03eb4a11a277312f8e46745eac6aa6eb2db8aa1e14ca13957c72e4`;
- payload SHA-256
  `ef9d42778a34820abff7e821127a6789d0658180520a6d144a1a508871e68b35`.

The artifact hash covers the exact board, weighted ranges, positions, stacks, action
order, legal choices, call costs, all-in status, pot layers, awards, and utilities. A
second full generation produced identical bytes in 68.12 seconds and ended at 156.7 MiB
RSS.

## Verification record

The release candidate passed all 289 repository tests. The checks also included:

- exact comparison of both settlement implementations on all 172 deals and all 5,676
  endings;
- exact agreement between scalable and exhaustive one-deal best responses;
- the hidden-card cheating regression and all four earlier artifact hashes;
- a second complete 65,536-iteration run with identical rules hash, payload hash,
  strategy, grade, teaching facts, and generated bytes;
- exhaustive evaluation of all 2,598,960 five-card poker hands;
- Next.js route generation, strict TypeScript checking, and ESLint with no warnings;
  and
- a production build covering `/`, `/solver`, and `/solver/lab`.

No live trainer or learner-interface code changed in this milestone.

## Review by perspective

### Expert CTO — pass for an offline research milestone

The solver runs before deployment and adds no browser-time work or production service.
The previous artifacts are checked every time this one is created. Rules, search,
independent grading, independent settlement, teaching data, and hashing have separate
responsibilities.

The next milestone should add a fourth player with the simplest earlier betting tree.
It should not carry side pots, two sizes, and raises forward at the same time.

### Expert poker player — pass for the written game

The short call, reopen rule, all-in skipping, unmatched return, dead folded money, and
pot eligibility behave like poker. The main and side pots may have different winners.
Calling one person “the winner” is intentionally insufficient when two pots are awarded.

The strategy applies only to this board, these small ranges, these three stack sizes,
and this exact action menu. It says nothing universal about short-stack play.

### Expert math professor — pass, with the scopes separated

The payoff function now sums awards across eligible layers before subtracting each
player's own contribution. A second algorithm reaches the same vector by repeatedly
peeling off the smallest remaining contribution. That is meaningful independent
evidence rather than a second call to the same helper.

Strategy quality is still reported as three unilateral gains and their maximum. No
multiplayer number is halved or mislabeled as heads-up exploitability.

### Expert poker teacher — pass for teaching evidence

A single overall win percentage would misteach this spot because a hand can be eligible
for the main pot but not the side pot. The stored facts can instead say which money the
player is allowed to win, what a call actually costs, and how each action changes
expected chips from now.

The learner language uses “paid enough to enter this pot” rather than relying on the
term “eligibility” without explanation.

### Expert product person — pass because no unsupported control was added

The live trainer remains unchanged. An arbitrary stack-size control would imply that
the app can solve many unverified games. This milestone produces one audited example
that could later become a clearly labeled lesson.

The future lesson should lead with the main-pot/side-pot split, then allow the learner
to open the detailed expected-value arithmetic.

### Expert software engineer — pass

The complete tree counts are locked. Unit tests cover different winners, short calls,
returns, ties, invalid sizes, legal raises, and hidden-card boundaries. Property tests
vary all range weights and sample exact endings. The separate oracle covers every
ending, and prior artifact hashes protect earlier work.

The side-pot engine remains versioned instead of silently changing the accepted
equal-stack game. This duplicates a small amount of transition code, but makes the
rules and artifact history much easier to audit.

## Safe claim and next boundary

Safe claim:

> I built one bounded unequal-stack river experiment that awards main and side pots
> separately, checks every possible ending with a second implementation, and measures
> that no player can gain more than 0.098 chip per hand by changing alone.

Unsafe claim:

> I built an exact multiway no-limit GTO solver for arbitrary stacks.

The next milestone is a four-player bounded river with the simplest no-raise betting
tree. Its specification must lock a smaller range if necessary, exact player order,
tree counts, seat-relabeling checks, and a new resource estimate before solving.
