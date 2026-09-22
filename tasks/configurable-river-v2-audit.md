# Configurable heads-up river solver v2 — release audit

**Status:** accepted as an isolated CPU solver library and reproducible portfolio artifact

**Contract:** [configurable river v2 specification](configurable-river-v2-spec.md)

## What was actually built

V2 solves a finite heads-up river game from:

- a known five-card board;
- two explicit weighted ranges, optionally expanded from the documented small range syntax;
- the chips already committed, each remaining stack, and fixed OOP/IP action order;
- explicit whole-chip opening bets and raise-to targets;
- one permitted raise.

It enumerates all compatible private hands and showdowns. The accepted artifact is not a
claim about arbitrary full ranges, continuous bet sizes, earlier streets, multiway play,
or exact GTO. It is not connected to the four-player trainer.

## Accepted demonstration

```text
board                     Ks 8s 4s 2c 9d
out-of-position range     AA, AQs, 76s (14 exact combinations)
in-position range         JJ, ATs, 65s (14 exact combinations)
starting pot              100 chips (50 already committed by each player)
stack behind              100 chips each
opening choices           check, bet 50, bet 100
raise choice              raise to 100 after a 50-chip bet
raise cap                 one
```

After card collisions, the game contains:

| Measurement | Result |
|---|---:|
| Compatible private-hand pairs | 176 |
| Public states per private deal | 21 |
| Full states | 3,697 |
| Decision states | 1,408 |
| Terminal states checked exactly | 2,288 |
| Information sets | 112 |
| Ordinary full-tree CFR iterations | 51,200 |
| Artifact size | about 550 KiB |
| Observed local solve and artifact time | about 16 seconds |

Runtime is an observation, not a correctness gate.

## Mathematical result

All values below are expected net chips per hand from the hand's start.

| Measurement | Result |
|---|---:|
| Player 0 value | +18.722320306 |
| Player 1 value | −18.722320306 |
| Player 0 best-response gain | 0.073063007 |
| Player 1 best-response gain | 0.059288393 |
| Nash gap | 0.132351400 |
| Exploitability, half the Nash gap | 0.066175700 |
| Locked exploitability limit | 0.25 |

The result is inside the predeclared gate. “Exploitability” has the heads-up, zero-sum
meaning above; it is not reused for the multiway artifacts.

The checkpoint exploitability fell from `2.9809` chips after 100 iterations to `0.0662`
after 51,200 iterations. The evidence shows material improvement; the product does not
claim every solver checkpoint must improve monotonically.

## Independent rules and hidden-information checks

A separate slow oracle:

- independently constructs the 176 blocker-compatible weighted deals;
- replays money from every terminal public history;
- uses the slow five-of-seven evaluator rather than the optimized river evaluator;
- checks all 2,288 deal/terminal combinations;
- finds zero probability, payoff, and zero-sum disagreement.

The scalable information-set best response matches exhaustive pure-strategy grading on a
reduced river game. A deliberately invalid grader that chooses separately after seeing
the opponent's hidden hand does strictly better on the regression fixture. That test is
important: it proves the real checker refuses a useful cheating advantage rather than
merely omitting an opponent-card string from a key.

The v2 adapter also reproduces the accepted v1 fixture's 61 compatible deals, 1,282
states, 793 terminal utilities, 64 information sets, profile value, and exploitability.
The v1 implementation and artifact remain unchanged.

## Independent open-source referee

The audit rechecked the repository currently served from
[`noambrown/poker_solver`](https://github.com/noambrown/poker_solver). Its `main` branch is
still commit `6a10442877ffc8fd28af93e16e279b9bbdd97b2a`, the MIT-licensed commit already pinned
by Poker Face.

The reference ran as a separate Python process with the same board, exact ranges, weights,
pot, stacks, action order, opening sizes, and single later raise. No third-party
implementation code was copied or linked into Poker Face.

| Reference measurement | Result |
|---|---:|
| Reference iterations | 25,600 |
| Independently regraded reference exploitability | 0.004702692 chips |
| Reference Player 0 value | +18.714495561 chips |
| Difference from Poker Face value | 0.007824745 chip |
| Locked value-difference limit | 0.25 chip |

The adapter accounts for two naming differences: the reference counts the opening bet in
its `max_raises` field, and its constant-sum payoffs include the 100-chip starting pot.
Poker Face subtracts each player's 50 previously committed chips to express net value.
The mapped strategy is regraded by Poker Face rather than trusting the reference's printed
summary.

The b-inary AGPL solver remains an offline-only possible referee, with suspended public
development. The substantially changed amaster97 MIT project remains a possible second
opinion, not an input to this milestone. Neither is needed to accept this exactly matched
Brown comparison.

## Resource boundary

The default exact limits are 128 expanded combinations per player, 500 compatible private
deals, and 50,000 projected full states. Preflight counts the public tree and compatible
deals before CFR builds its full numeric tree. Requests beyond a limit fail with the
measured count and limit.

Those numbers are deliberately conservative for the current readable TypeScript engine.
An unrestricted river board has 1,070,190 ordered compatible private-hand pairs before
the betting tree. V2 does not pretend the current object tree can solve that locally.
Wider ranges require a separately checked compact/vector engine or the sampled-range
stage already described in the multiway roadmap.

## Six-perspective review

### Expert CTO — pass for an isolated library

V2 is additive, versioned, content-addressed, deterministic, resource-capped, and not
wired into the trainer. The accepted artifact stores the full expanded inputs and tree
fingerprint. Existing solvers remain independent regression oracles.

### Expert poker player — pass for the written subgame

Position controls action order. Calls, folds, full raises, short all-ins, unequal stacks,
and returned unmatched chips are explicit and tested. Bet and raise labels store actual
chips. The limits remain one river street, heads-up, and one raise.

### Expert math professor — pass

Chance weights normalize after blockers. Showdowns are exact. Saved strategies are graded
by exact value and information-set best responses. Both unilateral gains are visible, the
half-gap convention is stated, and sunk chips are separate from expected chip change now.

### Expert poker teacher — pass for numerical teaching data

Every decision exports action frequencies, action EVs, difference from the best measured
action, opponent responses, folds, showdown outcomes, conditional showdown equity, and
the action-updated opponent range. These are structured facts, not confident generated
prose. A learner interface still needs a separate copy and usability review.

### Expert product person — pass with no trainer integration

The engine refuses oversized inputs instead of freezing, reports exactly what it solved,
and does not use “exact GTO.” It is appropriate for a future solver-lab interface. It is
not yet appropriate as live advice inside the four-player trainer.

### Expert software engineer — pass

Game rules, parsing, CFR, best responses, slow oracle, teaching derivation, hashing, and
external import are separate. Property and regression tests cover blockers, canonical
cards, minimum raises, short stacks, zero-sum settlement, hidden information, stale
artifacts, and v1 equivalence.

## Known limits and next engineering step

- The documented input syntax intentionally excludes `+` and dash ranges.
- Bet and raise targets are finite whole-chip menus. They do not approximate continuous
  no-limit betting.
- The readable full-tree CFR implementation is not suitable for unrestricted ranges.
- The rough preflight memory estimate is labeled as an estimate; exact state counts are
  the enforceable gate.
- Only the accepted fixture has a committed, externally compared artifact. Other user
  inputs produce measured local results but are not automatically portfolio-certified.
- There is no learner UI for arbitrary inputs yet.

The next meaningful performance milestone is a compact range-vector river engine checked
against this implementation on many bounded fixtures. The readable engine should remain
as the oracle. GPU training is neither required nor justified for this river milestone.

## Defensible portfolio claim

> I built a configurable, exact, CPU-only heads-up river solver for bounded weighted
> ranges and finite bet trees. It rejects oversized games before solving, keeps hidden
> hands out of decisions, measures both players' deviation gains with an independent
> checker, reproduces the earlier solver, and agrees within 0.008 chip with a pinned MIT
> implementation on an identical game.

Do not shorten that to “I built a full no-limit hold'em solver.”

## Verification record

The accepted milestone passed:

- 342 repository unit, property, regression, solver, session, and copy tests;
- Next.js route type generation and strict TypeScript checking;
- the complete ESLint run with no warnings;
- the optimized production build for `/`, `/solver`, and `/solver/lab`;
- byte-for-byte regeneration of Kuhn, Leduc, river v1, configurable river v2, every
  three-player river artifact, and the four-player river artifact.

The first sandboxed production build could not reach the configured Google Fonts URL.
The same build passed when network access was allowed. No application code was changed to
hide that environmental failure.
