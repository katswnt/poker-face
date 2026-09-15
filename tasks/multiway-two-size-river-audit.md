# Three-player two-size river — release audit

**Status:** passed the locked Stage 2 gate

**Audited:** 2026-09-15

**Specification:** [Three-player river with two opening sizes — v1](multiway-two-size-river-spec.md)

## Plain result

Poker Face can now solve and independently grade one small three-player river game with
two opening bet sizes. A player can check, bet 30, or bet all 60 chips left. A 30-chip
bet may be raised once to 60. A 60-chip bet cannot be raised.

This is a bounded teaching experiment, not a full no-limit solver.

The game counts all 172 possible sets of private cards and all 9,460 endings. The saved
strategy comes from 65,536 fixed CFR iterations. A separate checker measures how much
each player could gain by changing their whole strategy while the other two keep theirs.

| Measurement | Saved result |
|---|---:|
| Player 0 value | `+12.404792924` chips/hand |
| Player 1 value | `+0.414147922` chip/hand |
| Player 2 value | `-12.818940846` chips/hand |
| Player 0 gain available by changing alone | `0.108965909` chip/hand |
| Player 1 gain available by changing alone | `0.049289817` chip/hand |
| Player 2 gain available by changing alone | `0.107123585` chip/hand |
| Largest gain available | **`0.108965909` chip/hand** |
| Locked maximum | `0.45` chip/hand |

The three values sum to zero apart from `2.5e-14` chip of floating-point noise. The
largest possible improvement is about `0.121%` of the 90-chip starting pot, below the
predeclared `0.5%` limit. In precise terms, this is an approximately `0.1090`-Nash
profile for this one finite game: no one player can gain more than that by changing
alone.

The strategy is not exact GTO. Exact counting is used for the cards, action tree,
payoffs, saved-strategy values, and best-response grade. The strategy itself comes from
a finite search and still has the measured room for improvement shown above.

## What was independently checked

### Both sizes, action order, and money

- A separate replay engine and slow five-of-seven evaluator agree with the main game on
  all 9,460 endings. Payoffs, uncalled returns, and contestable pots have zero measured
  disagreement.
- A 30-chip bet can be folded, called, or raised all-in to 60. The raise makes every
  active player below 60 answer, including someone who called 30 earlier.
- A 60-chip opening bet can only be folded or called. No player has chips left to raise.
- After either bet, both opponents answer in cyclic seat order unless only one player
  remains.
- If everyone folds to a 60-chip bet, all 60 chips come back to the bettor. The player
  wins only the old 90-chip pot. The data does not call returned chips winnings.
- Folding after an earlier 30-chip call costs no new chips at that decision. The earlier
  call remains part of the whole-hand result.
- Every ending conserves chips, including folds, ties, calls, raises, and returns.

### Hidden cards and scorekeeping

- Decision keys contain the acting player's cards and public facts, but no opponent
  cards.
- On a one-deal two-size game, an exponential checker tried all 82,944 complete
  strategies for each player against a uniform profile. It matched the scalable
  best-response checker exactly.
- A deliberately invalid checker that chooses after seeing hidden cards gains
  `6.907194551` extra chips against a uniform profile. That large advantage is kept as a
  regression test: the real checker must not get it.
- The accepted heads-up, no-raise multiway, and one-raise multiway artifacts all retain
  valid content hashes.

### Teaching evidence

- All 252 decision records preserve one joint list of possible opponent-hand pairs.
  Blocked combinations stay impossible, and actions update the whole joint list rather
  than two falsely independent ranges.
- Every reached action records its saved frequency, exact value, chip change from now,
  difference from the best measured action, immediate response, eventual outcomes,
  showdown pot share, uncalled return, and contestable pot.
- The explanation distinguishes the sizes in ordinary language: 30 risks less and
  leaves room for a raise; 60 risks the whole remaining stack and closes raising.
- Any future unreachable branch will withhold values rather than invent an explanation.
  This particular saved strategy gives positive reach to all 252 decision records.

## Convergence record

| Iterations | Largest gain available to one player |
|---:|---:|
| 256 | `1.235659937` chips/hand |
| 1,024 | `0.747679756` chip/hand |
| 4,096 | `0.441603413` chip/hand |
| 16,384 | `0.220359961` chip/hand |
| 65,536 | `0.108965909` chip/hand |

These five checkpoints improve steadily, but that does not create a general convergence
guarantee for three-player CFR. The CFR run proposes a strategy; the separate exact
best-response grade is still the release authority.

## Engineering measurements

The first accepted generation measured:

- 197.12 seconds wall time;
- 154.3 MiB resident memory at the end of the run;
- 4,318,245 artifact bytes, about 4.12 MiB;
- 16,685 complete game states and 252 information sets;
- rules SHA-256
  `ac3de071e6bf890e25a78a131005adbfd626ce3501b744a73baa015ca6f1df02`;
- payload SHA-256
  `1937f943381c74afcd7b437a540e6297031f8b60b5041f9e9ce41beb36fc948e`.

The artifact binds every stored number to the exact board, weighted ranges, money,
action order, two sizes, raise cap, evaluator, complete tree, and teaching facts. Any
change invalidates its hash. A second check-only generation must reproduce identical
bytes. That second run produced identical bytes in 196.89 seconds and ended at 146.9 MiB
RSS.

## Verification record

The release candidate passed all 259 repository tests. The checks also included:

- Next.js route type generation and strict TypeScript checking;
- ESLint with no warnings;
- a production build covering `/`, `/solver`, and `/solver/lab`;
- exact evaluation of all 2,598,960 five-card poker hands;
- byte-for-byte reproduction of the Kuhn, Leduc, heads-up river, no-raise multiway,
  one-raise multiway, and this two-size multiway artifact;
- a second full 65,536-iteration run of this solver with the same rules hash, payload
  hash, strategy, grade, and generated bytes; and
- focused regression checks after locking the action labels to the exact 30-chip and
  60-chip sizes specified by this version.

No live trainer or learner-interface code changed in this milestone.

## Review by perspective

### Expert CTO — pass for an offline, bounded milestone

The solver runs before deployment and adds no browser-time computation or production
dependency. The live trainer is unchanged. Rules, strategy search, independent grading,
slow payoff checks, teaching data, and hashing remain separate.

The next step—unequal stacks and side pots—changes money semantics, not just tree size.
It needs its own specification and cannot be folded casually into this artifact.

### Expert poker player — pass for the written game

The two bet sizes mean what the labels say. Betting 30 leaves 30 behind and permits one
all-in raise. Betting 60 uses the remaining stack and cannot be raised. Calls match the
current wager, previous callers respond again after a raise, and uncalled money returns.

The result applies only to this board, these tiny weighted ranges, these equal stacks,
and this exact size menu. It is not a chart for unrestricted live poker.

### Expert math professor — pass, with the finite scope explicit

The action comparison is now genuinely three-way at unopened decisions. Hidden states
remain joint, and the best response makes one choice across every state a player cannot
distinguish. Quality is reported as three unilateral gains and their maximum—not half of
a multiplayer gap mislabeled as exploitability.

The exhaustive checker is especially valuable here because it independently exercises
the new three-action decision. No matching pinned open-source multiway solver exists, so
external numeric agreement remains unavailable and is not implied.

### Expert poker teacher — pass for teaching data, not yet a lesson screen

This milestone can teach why size matters: a larger bet may win more or lose more, puts
a different price in front of both opponents, and changes which later actions are legal.
The data can compare the two sizes in chips from the current decision without confusing
old committed chips with a new cost.

It is not wired into the learner interface. A future lesson should show the best action
comparison first, then explain opponent reactions and range changes in expandable detail.

### Expert product person — pass because the product claim stays narrow

Adding a size is meaningful only because every displayed comparison now has audited
evidence. No generic size slider or table-size selector has been exposed. Such controls
would suggest the app can solve positions it has not actually solved.

A fixed two-size lesson is now reasonable to prototype, but it should remain visibly
labeled as one example rather than silently replacing the trainer's advice system.

### Expert software engineer — pass

Exact tree counts are locked. Unit tests cover both action menus, reopened action, ties,
and full returns. Properties vary all 18 range weights and sample exact legal endings. The
slow oracle checks every terminal. Exhaustive and scalable best responses agree, a
cheating regression protects the information boundary, and hashes protect all earlier
artifacts.

The versioned transition modules intentionally favor auditability over a premature
generic betting engine. Before unequal stacks, shared card-distribution and teaching
machinery can be extracted only if all committed hashes reproduce unchanged.

## Safe claim and next boundary

Safe claim:

> I built a bounded three-player river experiment that compares two bet sizes, checks
> every possible ending with a second implementation, and measures that no player can
> improve by more than 0.109 chip per hand by changing alone.

Unsafe claim:

> I built an exact multiway no-limit GTO solver.

The next mathematical milestone is unequal stacks and side pots. Before solving, it must
specify exact stack sizes, legal all-in behavior, pot layers, eligibility, uncalled
returns, and a smaller tree if necessary to keep exhaustive checks practical.
