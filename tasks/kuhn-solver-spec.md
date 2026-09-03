# Kuhn solver — implementation specification

**Status:** mathematical core implemented and audited; UI intentionally not started
**Parent plan:** [Explainable solver lab roadmap](solver-lab-roadmap.md)
**Scope:** mathematical core, verification, and teaching data; no UI in this milestone

## What we are building

A small TypeScript program that learns a strong strategy for Kuhn poker, then hands that
strategy to an independent grader that tries to exploit it.

Kuhn poker is useful because it is small enough to count exactly but still contains real
poker ideas:

- a king can bet for value;
- a jack can sometimes bluff;
- a queen can sometimes call to catch that bluff; and
- the best strategy may deliberately mix between two actions.

The result is successful only when we can measure how beatable it is. A plausible-looking
chart is not enough.

### Implemented result

The committed 100,000-iteration solve currently reports:

| Measurement | Result |
|---|---:|
| Player 0 value | `-0.055554701` chips |
| Exact player 0 value | `-0.055555556` chips |
| Value error | `0.000000855` chips |
| Nash gap | `0.001352439` chips |
| Exploitability | `0.000676220` chips |
| Difference from Brown's independently generated value | `0.000002029` chips |

`npm run audit:kuhn` regenerates the answer, grades it with the information-set evaluator,
checks it against the pinned Brown fixture, verifies the payload hash, and fails if the
committed artifact has drifted. The test suite checks that evaluator against exhaustive
grading. CI runs both on every push and pull request.

## Definition of done

The Kuhn milestone is complete when:

- every possible deal and action path is generated from one locked rule engine;
- terminal chip changes are correct and zero-sum;
- the solver cannot distinguish states a real player cannot distinguish;
- a separate brute-force grader measures both players' best responses exactly;
- player 0's value is within `0.001` chip of the known value `-1/18`;
- measured exploitability is at most `0.001` chip;
- a controlled result agrees with the pinned Noam Brown reference;
- regenerating the saved strategy produces identical bytes; and
- teaching data is derived from numerical results rather than hand-written claims.

## 1. Lock the game before writing the solver

### Cards and deal

The deck is exactly:

```text
J  Q  K
```

Each player receives one different card. Order matters because `(J, K)` means player 0
has the jack while `(K, J)` means player 0 has the king.

The six deals are:

```text
(J,Q)  (J,K)  (Q,J)  (Q,K)  (K,J)  (K,Q)
```

Each deal has probability `1/6`. There is no random sampling.

### Antes and actions

Both players begin the hand by contributing one chip. Player 0 acts first.

```text
Player 0
├─ check
│  └─ Player 1
│     ├─ check → showdown
│     └─ bet
│        └─ Player 0
│           ├─ fold
│           └─ call → showdown
└─ bet
   └─ Player 1
      ├─ fold
      └─ call → showdown
```

There are no raises. A bet or call adds one chip.

Use explicit action names in code:

```ts
type KuhnAction = "check" | "bet" | "fold" | "call";
```

Do not use one ambiguous letter such as `c` for both check and call. Stable legal-action
order is `["check", "bet"]` when no bet is open and `["fold", "call"]` when facing a bet.

### Payoffs

Every utility is the player's net chip change, not the size of the pot they receive.

| Ending | Contributions | Net result |
|---|---:|---:|
| Check, check | `[1, 1]` | Higher card `+1`; lower card `-1` |
| Player 0 bets; player 1 folds | `[2, 1]` | Player 0 `+1`; player 1 `-1` |
| Player 0 checks; player 1 bets; player 0 folds | `[1, 2]` | Player 0 `-1`; player 1 `+1` |
| Any bet is called | `[2, 2]` | Higher card `+2`; lower card `-2` |

Because the two private cards are different, Kuhn v1 never splits a showdown.

### State representation

Keep the state minimal:

```ts
interface KuhnState {
  readonly cards: readonly [KuhnRank, KuhnRank] | null;
  readonly history: readonly KuhnAction[];
}
```

Derive the acting player, legal actions, contributions, terminal status, and payoff from
`history`. Do not store duplicate versions of those facts in the state; duplicated pot or
actor fields could disagree with the action history.

The initial state has no cards and is a chance node. Applying a deal creates player 0's
first decision. `next()` must reject an illegal deal or action instead of trying to repair
it.

### Exact tree audit

Before solving, walk the complete tree and assert these counts:

| Item | Exact count |
|---|---:|
| Chance nodes | 1 |
| Ordered deals | 6 |
| Player decision nodes | 24 |
| Terminal nodes | 30 |
| Total states | 55 |
| Information sets | 12 |

Each deal has four decision nodes and five terminal endings. Locking these counts catches
missing branches and accidental extra actions.

## 2. Model only what a player can know

The full state contains both cards because the rule engine needs them at showdown. The
solver must not use both cards to choose an action.

An information-set key contains only:

- the acting player;
- that player's own card; and
- the public action history.

For example:

```text
kuhn:v1:p0:card=J:history=start
kuhn:v1:p1:card=Q:history=check
kuhn:v1:p1:card=K:history=bet
kuhn:v1:p0:card=Q:history=check-bet
```

There are four decision situations with three possible private cards each:

| Acting situation | Information sets |
|---|---:|
| Player 0 starts | 3 |
| Player 1 acts after a check | 3 |
| Player 1 faces player 0's bet | 3 |
| Player 0 faces a bet after checking | 3 |

Total: 12. Each information set groups exactly two underlying states—the two cards the
opponent could hold. The legal actions must be identical in both states.

This boundary receives direct tests. If changing only the hidden opponent card changes
the information-set key, the test must fail.

## 3. Build the grader before the learner

The first mathematical component will evaluate a supplied strategy. It does not learn.

### Exact strategy value

For each of the six deals:

1. Follow every possible action.
2. Multiply each branch by the supplied action probability.
3. Calculate the exact terminal net chips.
4. Add the branches together.
5. Weight the deal by `1/6`.

This returns `[value0, value1]`. Their sum must be zero within floating-point tolerance.

### Brute-force best response

Each player acts at six information sets and has two choices at each one. Therefore each
player has only:

```text
2⁶ = 64 pure strategies
```

To find player 0's exact best response to player 1:

1. Generate all 64 legal player-0 strategies.
2. Evaluate each against player 1's supplied mixed strategy.
3. Keep the largest player-0 value.

Repeat from player 1's perspective. A best response to a fixed mixed strategy can always
be chosen as a pure strategy, so this exhaustive search is exact for Kuhn.

Crucially, a pure strategy chooses one action for an entire information set. It cannot
choose “call when the hidden card is J, fold when it is K” if those states look the same
to the player.

The grader lives in `best-response.ts` and does not import the CFR implementation. It may
use the shared game rules and public strategy type, but it must not use regret totals as
evidence that the strategy is good.

### Scalable information-set best response

The release grader now calculates the same exact answer without trying every combination
of choices. For each information set, it:

1. groups together every full state that looks the same to the player;
2. weights those states by chance and by the opponent's fixed strategy;
3. compares the total value of each legal action across the whole group; and
4. chooses one action for the group.

The player's own earlier action probabilities are left out of those weights. That is what
makes this a counterfactual best response: it asks what the player could earn by changing
their plan, including at decisions their current plan rarely reaches.

This removes the exponential `2⁶` strategy search. It still walks the complete game tree,
so it is suitable for Leduc but is not a claim that full no-limit hold'em is now cheap to
solve. The implementation also rejects a game if one information set would require a player
to forget one of their own earlier choices.

The original 64-strategy search remains in the code as an independent oracle. Tests compare
the two graders on 100 reproducible mixed Kuhn strategies, including a case that proves a
full-state `max()` would cheat by reacting to a hidden card.

### Nash gap and exploitability

For saved strategy `σ = (σ0, σ1)`:

```text
value0 = value for player 0 when both follow σ
value1 = value for player 1 when both follow σ

gain0 = best value player 0 can get against σ1 - value0
gain1 = best value player 1 can get against σ0 - value1

Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

All values use net chips per hand. We report both the Nash gap and exploitability so the
factor-of-two convention cannot remain hidden.

### One exact equilibrium fixture

Kuhn has a family of equilibria. Use this particular member to test the grader:

| Player and situation | Jack | Queen | King |
|---|---|---|---|
| Player 0 starts | Bet `1/3` | Check `1` | Bet `1` |
| Player 0 checked and now faces a bet | Fold `1` | Call `2/3` | Call `1` |
| Player 1 acts after player 0 checks | Bet `1/3` | Check `1` | Bet `1` |
| Player 1 faces player 0's bet | Fold `1` | Call `1/3` | Call `1` |

Each omitted alternative receives the remaining probability. This profile has player-0
value `-1/18` and zero Nash gap in exact arithmetic.

This fixture certifies the evaluator and best-response calculation. It does **not** require
CFR to return these exact percentages. Another member of the equilibrium family can have
the same value and zero exploitability.

## 4. Implement ordinary full-tree CFR

Counterfactual regret minimization learns by repeatedly asking:

> Looking back at this decision, how much better would each action have performed?

Actions that repeatedly would have done better receive more probability.

### Regret matching

At information set `I`, let `R(I,a)` be the accumulated regret for action `a`. Keep only
the positive part:

```text
positiveRegret(I,a) = max(R(I,a), 0)
```

If their sum is positive:

```text
strategy(I,a) = positiveRegret(I,a) / sumOfPositiveRegrets(I)
```

If every regret is zero or negative, use equal probabilities. With two actions, that is
`50% / 50%`.

### One iteration

One deterministic iteration will:

1. Convert the current regret table into one frozen strategy snapshot.
2. Walk the entire tree for player 0 and collect player 0's regret changes.
3. Walk the same tree for player 1 and collect player 1's regret changes.
4. Accumulate the average strategy from the frozen snapshot.
5. Apply both players' regret changes after both walks finish.

Freezing the strategy and delaying the updates prevents “player 0 happened to update
first” from changing the meaning of an iteration.

At terminal nodes, return exact chip utility. At the chance node, calculate the weighted
average across all six deals. At player nodes, calculate the weighted average across all
legal actions.

### The counterfactual weight

For player `i`, regret for action `a` at information set `I` is updated by summing over
the hidden states `h` inside that information set:

```text
chanceReach(h)
× opponentReach(h)
× [valueIfActionA(h) - valueOfCurrentMix(h)]
```

Do **not** multiply this regret by player `i`'s own reach probability. The question is
counterfactual: “If I had reached this decision, which action would I wish I had used?”

This is one of the easiest places to write a solver that converges to the wrong answer.

### The average strategy

CFR's guarantee applies to its average strategy, not necessarily the strategy from the
last iteration.

For each information set, accumulate:

```text
playerOwnReach(I) × currentStrategy(I,a)
```

The player's own reach is the probability created by that player's earlier actions. It
does not include chance or the opponent's actions. With perfect recall, that own reach is
the same for every hidden state grouped into the information set. The tree index should
assert that equality and add the information set only once per iteration.

Notice the deliberate difference:

- regret uses **chance reach × opponent reach**;
- average strategy uses the **acting player's own reach**.

Reversing those weights is a common silent bug.

### Why start with ordinary CFR?

Kuhn is tiny, so speed is not the problem. Ordinary CFR gives us a short reference that is
easier to inspect. CFR+ or discounted CFR can be added later, but the ordinary version stays
as a second implementation to compare against.

## 5. Stable inputs and outputs

Proposed files:

```text
src/lib/solver/toy/
  game.ts
  kuhn.ts
  cfr.ts
  best-response.ts
  artifact.ts
  explain.ts

scripts/
  solve-kuhn.ts

test/
  solver-kuhn-rules.test.ts
  solver-kuhn-value.test.ts
  solver-kuhn-cfr.test.ts
  solver-kuhn-artifact.test.ts

test/fixtures/solver/
  kuhn-brown-6a104428.json

src/lib/solver/toy/artifacts/
  kuhn-v1.json
```

The canonical artifact contains:

```ts
interface KuhnSolveArtifact {
  readonly schemaVersion: 1;
  readonly game: "kuhn-v1";
  readonly algorithm: "full-tree-cfr";
  readonly algorithmVersion: 1;
  readonly iterations: number;
  readonly strategy: Readonly<Record<InformationSetKey, ActionProbabilities>>;
  readonly value: readonly [number, number];
  readonly bestResponseValue: readonly [number, number];
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityUnits: "net-chips-per-hand";
  readonly convergence: readonly ConvergenceCheckpoint[];
  readonly payloadHash: string;
}
```

Information-set keys and actions are sorted before serialization. Runtime, timestamps,
machine details, and absolute paths stay outside the hashed artifact. The same command and
iteration count must therefore produce identical bytes on repeated runs.

## 6. Validation plan

### Rule tests

- All six deals exist once and their probabilities sum to one.
- A player never receives the same physical card as the opponent.
- Every legal history produces the expected next actor and actions.
- Illegal deals, calls, bets, and actions after a terminal state throw an error.
- The tree has exactly 55 states, 24 decisions, 30 terminals, and 12 information sets.
- Every terminal payoff matches the locked payoff table.
- Every terminal utility satisfies `u0 + u1 = 0`.

### Information tests

- Changing only the opponent's hidden card preserves the acting player's key.
- Changing the acting player's card changes the key.
- Changing the public action history changes the key.
- Each information set contains exactly two underlying hidden states.
- Every state in one information set exposes the same ordered legal actions.

### Grader tests

- A fixed strategy's exact value equals a separately hand-calculated fixture.
- Exactly 64 pure strategies are generated for each player.
- The brute-force best-response value is never worse than the saved strategy's value.
- Gains, Nash gap, and exploitability are finite and non-negative within tolerance.
- An intentionally bad strategy has clearly positive exploitability.
- A known equilibrium fixture has value `-1/18` and zero exploitability within numerical
  tolerance.

### CFR tests

- Every generated probability is finite, lies in `[0,1]`, and sums to one.
- The same input and iteration count produce the same strategy.
- A long solve is less exploitable than a deliberately short solve.
- The test does not require exploitability to fall at every checkpoint; CFR can wobble on
  the way down.
- The saved **average** strategy reaches the acceptance threshold.
- The final-iteration strategy is never substituted for the average by accident.
- Player 0's value is within `0.001` of `-1/18`.
- Exploitability is at most `0.001` chip at the locked iteration count.

### Independent comparison

Run the pinned Brown Kuhn implementation outside normal CI and save a small fixture that
records:

- repository URL and commit;
- exact game convention;
- algorithm and iteration count;
- strategy value and exploitability;
- command used to generate it; and
- the fixture's checksum.

Compare value and exploitability. Do not demand identical action percentages because Kuhn
has multiple equilibria.

## 7. Teaching data

For each reached information set, calculate:

- the player's card and action history;
- the opponent cards still possible;
- each legal action's frequency;
- each action's conditional expected net chips;
- the difference between the best and other action;
- how often the information set is reached; and
- the exploitability of the complete strategy.

“Conditional action EV” means:

> The expected net result from the start of the hand, given that this decision was
> reached, forcing this action now, and then following the saved average strategy.

If a situation has essentially zero reach, label it **off path** instead of making a
confident recommendation.

The first lesson should explain the connection among three hands:

- The king can bet because worse hands may call.
- The jack can sometimes bet even though it cannot win at showdown; that bluff stops a bet
  from always revealing a king.
- The queen can sometimes call so bluffing with the jack is not free.

The exact wording and percentages come from the result. We must not hard-code “bluff one
third” and then assume the generated strategy agrees.

When two actions mix, show their action EVs next to each other. A mixed strategy makes
sense when the opponent's response has made those values nearly equal. Because a finite
solve still has error, describe them as “nearly equal within the measured solver gap,” not
perfectly identical.

## 8. Where this is most likely to go wrong

### 1. The grader secretly sees the opponent's card — highest risk

**How it happens:** a recursive best-response function calls `max()` separately in every
full game state. The state includes both private cards, so it chooses different actions for
hidden situations the player cannot tell apart.

**Symptom:** spectacularly high best-response values or a strategy that appears much more
exploitable than it really is.

**Prevention:** brute-force only the 64 strategies keyed by legal information sets. Require
the generic best-response algorithm to match this brute-force answer across reproducible
mixed strategies, and keep a test where a hidden-card-peeking implementation scores higher.

### 2. Pot received is confused with profit — highest risk

**How it happens:** a winner of a four-chip pot is credited `+4`, forgetting that they
contributed two of those chips.

**Symptom:** the game is no longer zero-sum and the known `-1/18` value cannot be reproduced.

**Prevention:** calculate `chips received - total contribution`, lock every payoff in a
table test, and assert `u0 + u1 = 0` at every terminal node.

### 3. Hidden states become separate strategies — highest risk

**How it happens:** the strategy table is keyed by the complete state or the full deal.

**Symptom:** a player bluffs only when it somehow “knows” the opponent has a particular
card.

**Prevention:** make the information-set key an explicit game operation and test that both
possible opponent cards map to the same key.

### 4. The reach probabilities are applied to the wrong calculation

**How it happens:** own reach is included in counterfactual regret, or opponent/chance reach
is used to average the player's strategy.

**Symptom:** the output remains numerically tidy but settles at the wrong value or stops
improving.

**Prevention:** keep regret updates and average-strategy updates in separate functions, name
all three reach values explicitly, and pin the known value and brute-force exploitability.

### 5. The last strategy is reported instead of the average

**How it happens:** the UI or artifact serializes the current regret-matched strategy.

**Symptom:** results wobble between runs or checkpoints even though average play is
converging.

**Prevention:** give current and average strategy different types or field names, and allow
only `AverageStrategy` into the artifact and grader used for release.

### 6. In-place updates make player order matter

**How it happens:** player 1 sees player 0's newly updated regret during the same iteration.

**Symptom:** reversing traversal order changes the artifact.

**Prevention:** calculate from a frozen snapshot, accumulate regret deltas, then apply them
together. Add a test that visits the two target players in reverse order and obtains the
same result.

### 7. We test one equilibrium's percentages instead of equilibrium quality

**How it happens:** a reference chart says one hand bluffs at one percentage, so the test
requires that exact number.

**Symptom:** a valid but different Kuhn equilibrium fails, or someone tunes code merely to
match a chart.

**Prevention:** gate on the known game value and brute-force exploitability. Use action
frequencies only as diagnostic evidence.

### 8. “Exploitability” differs by a factor of two

**How it happens:** one source calls Nash gap exploitability while another divides by two.

**Symptom:** two matching solvers appear to disagree exactly twofold.

**Prevention:** save both numbers, the formula, and `net-chips-per-hand` units in every
artifact and comparison fixture.

### 9. Rounding becomes fake precision

**How it happens:** internal probabilities are rounded during solving or displayed action
percentages add to 99% or 101%.

**Symptom:** convergence changes when formatting changes, or the lesson shows impossible
totals.

**Prevention:** calculate with full-precision numbers, round only for display, and use a
largest-remainder display helper if whole percentages must sum to 100.

### 10. Reproducibility is broken by metadata

**How it happens:** timestamps and runtime are included in the canonical JSON or its hash.

**Symptom:** an unchanged solve dirties the repository every time it is regenerated.

**Prevention:** keep environmental measurements in a separate audit report. Canonicalize
key order and hash only the mathematical payload and locked configuration.

## 9. Implementation sequence

### Slice A — rules and complete-tree index

- Add the generic game types and Kuhn state machine.
- Add payoff, legality, tree-count, and information-set tests.
- Do not write CFR yet.

### Slice B — independent exact grader

- Add exact profile evaluation.
- Enumerate the 64 pure strategies per player.
- Add best-response, Nash-gap, and known-equilibrium tests.
- Add the scalable information-set best response and compare it with exhaustive grading.
- Reject games that violate perfect recall.
- This gives us a trustworthy scoreboard before training begins.

### Slice C — ordinary CFR

- Add regret matching, exact traversal, frozen updates, and average strategy.
- Measure convergence using only the independent grader.
- Lock an iteration count that clears `0.001` exploitability reliably and quickly.

### Slice D — artifact and external reference

- Add `npm run solve:kuhn` and the canonical JSON artifact.
- Record the pinned Brown comparison fixture.
- Prove two regenerations are byte-identical.

### Slice E — teaching facts

- Calculate reach and conditional action EVs.
- Add fact-level tests for value betting, bluffing, bluff-catching, and off-path states.
- Review the facts with math, poker, teaching, engineering, and product lenses before any
  interface work.

## 10. Commands and release gate

The implementation should finish with these commands:

```text
npm run solve:kuhn
npm run audit:kuhn
npm test
npm run typecheck
npm run lint
```

`audit:kuhn` should print the rule version, exact tree counts, value, both best responses,
Nash gap, exploitability, iteration count, and payload hash. It exits unsuccessfully if a
locked mathematical threshold fails.

No Kuhn interface ships until this audit passes from a clean checkout.
