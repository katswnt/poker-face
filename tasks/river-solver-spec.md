# Heads-up river hold'em solver — v1 specification

**Status:** implemented and passed the release audit

**Locked:** 2026-09-14

**Audited result:** 51,200 deterministic CFR iterations; `0.056340249` chip measured
exploitability; player-0 value within `0.016847979` chip of the pinned independent result.
See [the release audit](river-solver-audit.md).

**Purpose:** a finite, exact, explainable river subgame for the portfolio solver lab

## What this is

This solver answers one narrow question:

> On a known river board, with two explicit ranges and a short list of legal bet sizes,
> how often should each player take each action, and what is each action worth?

It is heads-up, zero-sum, and river-only. There are no future cards. Every compatible
pair of private hands is enumerated exactly. The solver may be useful for teaching value
bets, bluffs, bluff-catching, blockers, range changes, and bet sizing.

It is not a full hold'em solver. It does not solve preflop, flop, turn, multiway pots,
arbitrary stack depths, or continuous bet sizes. It must not feed recommendations into
the existing four-player trainer until its own math and product claims pass review.

## Locked first scenario

### Cards and ranges

ASCII card codes use rank followed by suit: `As` is ace of spades, `Td` is ten of
diamonds. A range entry is one exact two-card combination. Every entry below begins with
weight 1.

**Board:** `Ks 8s 4s 2c 9d`

**Player 0 — out of position, acts first**

```text
AsQs  QsJs  KhQh  KcJc  9h9c  AhQh  QhJh  7h6h
```

**Player 1 — in position, acts second**

```text
AsJs  Ts7s  KdQd  8h8c  9c8c  AcQc  QdJd  6c5c
```

Some range entries block entries in the other range. That is intentional. Build every
compatible ordered pair, give it raw weight `weight0 × weight1`, then divide by the total
compatible weight. Do not deal the two ranges independently and then discard collisions
without renormalizing.

These exact ranges contain 61 compatible pairs. Three of the nominal 64 pairs are
impossible because both players would hold the same physical card.

There is no Monte Carlo sampling in this game. Showdown uses the existing fast seven-card
evaluator, whose ordering is already checked against the independent five-of-seven
reference evaluator.

### Money and positions

- The pot entering the river is 100 chips: 50 previously contributed by each player.
- Each player has exactly 100 chips behind at the start of the river.
- Player 0 is out of position and acts first.
- Player 1 is in position and acts second.
- Stacks are deliberately equal in v1. Unequal stacks and returned excess are later work.

Every terminal payoff is **net chips from the beginning of the hand**:

```text
payoff = chips returned from the final pot − all chips contributed
```

The two payoffs must sum to zero at every terminal state. Teaching data must also expose
**expected chip change from the current river decision**, which adds back the player's 50
chips committed before the river plus any river chips committed before the current
decision. Already committed money is never allowed to distort a fold-versus-call choice.

### Legal actions and sizes

This is a no-limit abstraction with a finite menu, not continuous no-limit hold'em.

When no bet is open, the acting player may:

- `check`;
- `bet-half`: bet 50 chips, which is half the starting river pot;
- `bet-pot`: bet 100 chips, which is the full starting river pot and the player's all-in.

Facing `bet-half`, the other player may:

- `fold`;
- `call` 50;
- `raise-all-in` to 100 total river chips.

After `raise-all-in`, the original bettor may fold or call the remaining 50. There are no
further raises.

Facing `bet-pot`, the other player may fold or call. No chips remain for a raise.

The same menu applies after Player 0 checks and Player 1 bets. Checking around reaches
showdown. Any call that closes the action reaches showdown. The raise limit is one raise
per hand.

The action names and chip amounts are part of the versioned rules. A later version may add
other sizes, but v1 results must never be silently relabeled after its tree changes.

## Information a strategy may use

The full engine state contains both private combinations so it can reject collisions and
score showdowns. A player's information-set key may contain only:

- the scenario version;
- that player's own two cards;
- whether they are Player 0 or Player 1;
- the complete public river action history.

It must not contain the opponent's cards. Physical card order inside a two-card hand has no
meaning and must be canonicalized. Two full states that differ only in the opponent's hand
must share one information set.

Earlier actions update a range by Bayes' rule. In plain language: hands that choose the
observed action more often become more likely; hands that rarely choose it become less
likely. Teaching percentages must use chance reach and both saved strategies up to the
decision. They may never read the actual hidden hand from one full state.

## Solver and independent scorekeeper

Reuse the generic game contract, ordinary full-tree CFR, behavioral strategy format, and
information-set best-response checker already proven on Kuhn and Leduc. Do not add
hold'em branches inside those generic modules.

The solver and scorekeeper have separate responsibilities:

- CFR creates a saved average strategy.
- The exact value walker evaluates that saved strategy from the chance root.
- The best-response checker chooses once per information set after combining every hidden
  opponent hand the player cannot distinguish.
- A river-specific audit independently enumerates compatible private-hand pairs and
  terminal chip payoffs. It must agree with the generic tree on deal probability,
  showdown winner, pot size, and zero-sum utility.

For saved strategy `σ = (σ0, σ1)`:

```text
gain0 = bestResponseValue0(σ1) − value0(σ0, σ1)
gain1 = bestResponseValue1(σ0) − value1(σ0, σ1)
Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

Those definitions are valid here because this v1 game has two players and is zero-sum.
Every report must say the unit is net chips per hand. The committed result may be called
“within the acceptance gate,” not “exact GTO.”

## Teaching facts

For every information set, derive:

- legal actions and saved action frequencies;
- expected net chips from the hand's start for each action;
- expected chip change from the current decision for each action;
- difference from the highest measured action;
- probability of reaching the decision under the saved profile;
- posterior opponent range after the public actions;
- immediate fold probability after a bet or raise;
- eventual player fold, opponent fold, showdown win, split, and showdown loss;
- showdown equity conditional on reaching showdown;
- an explicit off-path marker, with unavailable values represented as `null`.

Generated teaching sentences remain outside the mathematical result object. Labels such
as value bet, bluff, and bluff-catch require evidence from the outcomes and ranges. A tiny
frequency left by finite CFR is not automatically a meaningful mix.

## Reproducible artifact

The committed artifact must include:

- schema version and scenario/rules version;
- canonical board, ranges, range weights, prior pot contributions, stacks, positions,
  action sizes, and raise cap;
- algorithm and iteration count;
- exact tree counts;
- full saved strategy;
- profile value, both best-response values, both gains, Nash gap, and exploitability;
- convergence checkpoints;
- teaching facts;
- independent reference provenance and comparison status;
- a SHA-256 fingerprint of every chance edge, information set, action edge, and terminal
  payoff;
- a SHA-256 payload hash.

`npm run audit:river` must solve from the locked inputs and reject stale bytes. Runtime and
memory are observations, not correctness gates.

## Independent open-source comparison

First try the MIT-licensed Noam Brown `poker_solver` repository pinned at commit
`6a10442877ffc8fd28af93e16e279b9bbdd97b2a`. Run it only on controlled input that matches
our board, ranges, pot, stacks, action order, sizes, and raise cap.

Known audit warnings stay in force: its river path can fail on some unequal ranges, does
not reject every duplicate board, and can allow an under-raise with custom sizing. Validate
the fixture before trusting its output.

If that implementation cannot express the exact v1 tree, record the mismatch and do not
change our rules merely to manufacture agreement. A comparison of a smaller shared
subgame is acceptable if its assumptions are explicit. AGPL code may be used as an
offline referee but must not be copied or linked into this repository without a separate
license decision.

## Tests required before acceptance

### Rules and money

- reject malformed cards, duplicate cards, board collisions, duplicate range entries,
  non-positive weights, and empty compatible joint ranges;
- prove every chance probability is finite, positive, and sums to one;
- lock the number of compatible deals, full tree states, terminals, and information sets;
- test every legal public history and reject every illegal action;
- test half-pot, pot, call, all-in raise, fold, and called-raise contributions;
- compare flushes, sets, pairs, high cards, and split boards with the slow evaluator;
- prove every terminal utility sums to zero;
- prove a fold changes zero additional chips from the current decision.

### Hidden information and ranges

- prove information sets contain the acting player's cards and never the opponent's;
- prove swapped physical order of a private combo has the same key;
- prove blocked opponent combinations have zero probability;
- prove posterior weights sum to one after every reached action history;
- include a regression where an observed action materially changes the opponent range.

### Solver and scorekeeper

- prove short solves are byte-for-byte reproducible;
- reject incomplete or invalid strategies;
- compare the scalable best response with exhaustive pure-strategy grading on reduced
  river games small enough for exhaustive enumeration;
- include a deliberate cheating-oracle regression that would choose different actions
  for hidden opponent hands and prove the real checker refuses that advantage;
- require the large solve to improve on a deliberately short solve without demanding
  every checkpoint be monotone.

### Artifact and teaching

- regenerate the same payload hash twice;
- recompute the strategy grade independently from the committed artifact;
- recompute every teaching record from the committed strategy;
- prove all action and outcome probabilities normalize;
- reject a changed rule fingerprint or stale artifact;
- test plain-language claims against their numerical evidence.

## Locked acceptance gates

- Exact chance and showdown enumeration: required; no sampling error.
- Terminal zero-sum error: at most `1e-9` chip.
- Committed exploitability: at most `0.25` chip per hand under the half-Nash-gap
  convention above. This is 0.25% of the starting river pot.
- Either player's best-response gain: report both; never hide one behind the average.
- Independent shared-fixture value difference, when an exact reference match is possible:
  at most `0.25` chip per hand.
- Artifact bytes: exactly reproducible.
- Production integration: forbidden until all six audits pass.

The `0.25`-chip threshold is locked before the large solve. If ordinary CFR cannot reach
it within a reasonable local run, stop and explain the failure instead of weakening the
gate after seeing the result.

## Planned files

```text
src/lib/solver/river/
  cards.ts             ASCII card parsing and canonical combinations
  game.ts              locked river rules and state transitions
  fixture.ts           v1 board, ranges, pot, stacks, sizes, and positions
  explain.ts           structured teaching facts
  artifact.ts          browser-safe schema and serialization
  artifact-node.ts     Node-only fingerprints and payload hashing
  artifacts/river-v1.json

scripts/
  solve-river.ts

test/
  solver-river-cards.test.ts
  solver-river-rules.test.ts
  solver-river-cfr.test.ts
  solver-river-best-response.test.ts
  solver-river-artifact.test.ts
  solver-river-teaching.test.ts
```

## Six review questions

- **CTO:** Is the narrow engine isolated, reproducible, supportable, and honest about what
  is not production-ready?
- **Poker player:** Do the ranges, action order, sizing, raise rule, blockers, and chips
  match the written subgame?
- **Math professor:** Are the probability conditioning, utilities, action values, and
  quality definitions correct and clearly distinguished?
- **Poker teacher:** Can a learner connect price, range, blockers, folds, and showdown
  strength to one decision?
- **Product person:** Does the experience teach one useful idea without presenting a toy
  abstraction as ordinary hold'em truth?
- **Software engineer:** Can hidden information, stale inputs, evaluator drift, or a rule
  change silently corrupt the answer?

## Stop conditions

Stop rather than widening scope if:

- any information-set key reveals an opponent card;
- the best response can choose separately for hidden opponent hands;
- exact deal probabilities or terminal utilities fail to normalize;
- the committed solve misses the locked `0.25`-chip exploitability gate;
- an independent result disagrees outside tolerance and the rule difference cannot explain
  it;
- a requested bet tree requires unequal-stack or side-pot behavior not defined in v1;
- performance work would remove the readable reference implementation before an
  independent faster path agrees with it;
- licensing would require distributing code under terms not chosen for Poker Face.

## Definition of success

The milestone is complete when a reviewer can run one command, reproduce the exact river
artifact, inspect the entire finite betting contract, see both players' deviation gains,
verify that ranges update without hidden-card leakage, and follow one plain-language
lesson from pot price through opponent range to action value.
