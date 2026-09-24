# Explainable solver lab — guiding plan

**Status:** Bounded joint flop/turn/river CPU solver, saved turn/river explorer, configurable two-street solver with restart checkpoints, guided river comparisons, benchmark exchange, Leduc/River Labs, bounded river solvers and exact multiway proofs implemented
**Last updated:** 2026-09-23

This document is the source of truth for the next solver project. It records what we
are building, what we are deliberately not building, how we will know the math is
right, and what the learner should gain from it.

**Active implementation plan:** [CPU-first heads-up postflop solver](cpu-postflop-solver-plan.md).
The user has prioritized solver capacity over a standalone turn lesson. That plan now
controls the implementation sequence, tradeoffs, budgets and acceptance gates. It is
implemented through M5. Separate turn and flop backends admit up to 64 combinations/player;
existing reference-engine and browser limits remain unchanged.

## Where we are now and what comes next

The bounded heads-up river engine and `/solver/river` teaching lab are implemented.
Kuhn, Leduc, compact/factorized CPU engines, configurable river v3, and the separate
multiway Stages 1–3 have accepted artifacts and audit records. Exact enumeration and
grading do not make their finite-iteration strategies exact equilibria.

The next independent solver milestone is now implemented: an **offline heads-up
turn-and-river reference** with tiny weighted ranges, one bet per street, and no raises.
Both streets are solved together with ordinary CFR. Exact river-card enumeration and
an independent legal best-response grade keep future cards hidden at turn decisions.
The 16,384-iteration fixture has 3,592 states and exploitability 0.014643152 chips,
below its pre-set 0.10-chip gate. See the [locked contract](heads-up-turn-v1-spec.md)
and [release audit](heads-up-turn-v1-audit.md).

**Completed CPU-first M0/M1:** the compact turn engine reproduces the complete accepted
ordinary-CFR policy, adds separately checked CFR+, resumes without restarting, and runs
in a cancellable offline process. The [compact audit](compact-turn-engine-audit.md) records
the locked contract, hashes and measured tradeoff: much smaller structural arrays, slower
iterations than repeated compact, and roughly unchanged total RSS with the readable grader.

**Completed CPU-first M2:** the separate vector engine and independent grader accept the
locked 64-by-64 synthetic-range fixture: 3,773 compatible deals, 35,584 information sets,
256 CFR+ iterations and 0.026707310-chip exploitability in a 100-chip pot. The accepted
policy reproduces on Node 20/24. Full disk checkpoints, cancellation, blocker/rank-kernel
oracles and independent wider grading are implemented; no old artifacts changed.
See the [vector audit](vector-turn-engine-audit.md) for exact gates, hashes and measurements.

**Completed CPU-first M3:** versioned turn-v2 rules add up to three opening sizes, three
raise targets, explicit all-in options and one raise per street. Five locked examples pass
at 256 CFR+ iterations; the wider 64-by-64 case has 147,840 information sets and
0.033587175-chip exploitability. Independent history/money replay, v1 reductions, conditional
river-v3 reductions, readable grading and explicit-pair kernels agree. See the
[M3 contract](configurable-turn-v2-spec.md) and [audit](configurable-turn-v2-audit.md).

**Completed CPU-first M4:** `/solver/postflop` exposes two accepted turn/river strategies
through every legal public history and compatible acting hand. It shows action values,
responses, posterior ranges and river previews with explicit rare/off-path handling.
Both examples retain three handcrafted combinations/player; the 64-hand probe remains
offline. The 98 bounded browser chunks reproduce on Node 20/24 without shipping source
policies. Native keyboard controls, load recovery, phone layouts and conditional math
are tested. See the [contract](saved-turn-explorer-spec.md) and
[audit](saved-turn-explorer-audit.md). No solver rules, grades or capacity limits changed.

**Completed CPU-first M5:** a tiny joint flop/turn/river reference plus the accepted
64-by-64 numeric backend: 3,755 deals, 5,017,600 information sets and 0.024089328-chip
exploitability at 256 CFR+ iterations. One opening size per street, no raises; no future
card peeking or independently solved-turn averaging. The complete results reproduce on
Node 20/24, with binary checkpoints and independent grading. **Active work:** build the
M6 saved library and explorer. See the [M5 audit](heads-up-flop-v1-audit.md)
and [M6 contract](saved-flop-library-spec.md).
See the [implementation plan](cpu-postflop-solver-plan.md).
The standalone turn lesson is deferred, not completed. This path does not depend on
collaboration and does not replace the **three-player** turn contract in multiway Stage 5.

The **portable benchmark games and external-strategy grading** milestone is implemented
for four versioned v3 games, without changing the accepted solver or its old artifacts:

- [x] Define a small, versioned collection of game configurations and reference grades.
- [x] Export the game fingerprint, information sets, legal actions, and payoff convention.
- [x] Import a complete strategy, rejecting mismatched games, hidden-card-conditioned keys,
      missing actions, invalid probabilities, and incompatible sizing conventions.
- [x] Round-trip the existing CPU strategy without changing its independent grade.
- [x] Add a CLI report of values and both players' best-response gains in chips; do not
      require identical action percentages when comparing independently trained strategies.
- [ ] Inspect a collaborator's rules, algorithm, output format, and license before choosing
      an adapter. No GPU, neural-policy, or learned-value integration exists today.

The [exchange guide](river-strategy-exchange-guide.md),
[locked contract](river-strategy-exchange-spec.md), and
[release audit](river-strategy-exchange-audit.md) describe the shipped v1 protocol.
The CLI accepts policies for trusted local catalog games, not arbitrary game definitions.
It constrains the imported policy's observations, not the author's training process.
A value predictor alone is not a complete strategy and cannot receive exploitability.
The four public fixtures are not held-out evidence of a learned model's generalization.

Other remaining work is deliberately separated:

- **Verification:** extend explicit reproduction CI coverage to older river/multiway artifacts; deterministic
  setup for the known random-hand-dependent trainer keyboard check; broader browser and
  assistive-technology testing. CI now reproduces Kuhn, Leduc, reference/compact/vector/configurable
  turn, saved explorer chunks, v3, and the exchange manifest.
- **Teaching:** one-variable comparisons now cover opponent ranges, opening bet menus,
  and opponent stacks. Position, board/blocker, and pot/price comparisons need explicit
  matching semantics. An imperfect-opponent lesson needs a stated opponent model and
  a separate best-response workflow; it must not be presented as equilibrium play.
- **Scale research:** sampled multiway ranges under the separate Stage 4 contract, then its
  bounded three-player earlier-street experiment. The separate heads-up turn reference is
  implemented; wider bounded ranges, raises and more sizes now exist in turn-v2, not in the old reference. Profile any GPU/WASM/native candidate and prove parity
  on exact small games before expanding limits. Larger teaching views and scorekeeper
  memory remain engineering constraints, not reasons to relax mathematical quality gates.
- **Reuse:** settle the repository license before copying or combining implementation code.
  Sharing the repository for review does not decide its reuse terms.

The [README collaboration guide](../README.md#what-this-could-contribute-to-a-gpu-or-training-project)
maps these contributions to the current APIs. No claim is made about what another project
lacks until its implementation is available to inspect. The historical milestones below
remain as evidence of how this point was reached, not an unfinished to-do list.

## The decision

Build a small solver we can understand and verify from end to end:

1. **Kuhn poker** proves the basic solver and its tests. Its detailed, implementation-ready
   contract is in [Kuhn solver — implementation specification](kuhn-solver-spec.md).
2. **Leduc poker** proves the design works with a public card and two betting rounds.
3. **Heads-up river hold'em** becomes the first portfolio-sized real-poker lab.

Keep this lab separate from the four-player trainer. None of the audited open-source
projects solves live four-player no-limit hold'em, and a two-player answer must never
be presented as a four-player answer.

The goal is not to put a “GTO” badge on the app. The goal is to make an answer we can
defend:

> For this precisely defined game, these actions have these average values. The
> strategy is this far from perfect play, under these stated assumptions.

## Why start with toy poker?

Kuhn and Leduc are small, but they contain the ideas that make poker interesting:
hidden information, bluffing, value betting, calling, folding, ranges, and mixed
strategies.

They are small enough that we can count every possible deal and walk every possible
action. That removes random-sampling error and makes subtle bugs visible before we add
the much larger hold'em card tree.

- **Kuhn** is the unit test for the mathematical method.
- **Leduc** is the integration test for cards, public information, betting rounds, and
  range changes.
- **River hold'em** is the product-sized result.

## Plain-language glossary

- **Strategy:** how often a player chooses each legal action in each situation they can
  recognize.
- **Information set:** situations that look identical to a player. The player knows
  their own card and the actions so far, but not the opponent's card.
- **Expected value (EV):** the average number of chips an action earns if the same spot
  is repeated many times.
- **Regret:** how much better an action would have performed than the choices made so
  far. Counterfactual regret minimization, or CFR, gradually gives more weight to
  actions with positive regret.
- **Best response:** the most profitable strategy against one fixed opposing strategy.
- **Nash gap:** the combined amount both players could gain by switching to their best
  responses. Smaller is better; zero means neither player can improve.
- **Exploitability:** half of the Nash gap in this two-player zero-sum project. Every
  report must state that convention and its chip units because solver libraries do not
  all use the word the same way.

## Audited references and how we may use them

The audit used pinned versions so later upstream changes cannot rewrite our evidence.

| Project | Pinned commit | What it is useful for | Why it is not the product engine |
|---|---|---|---|
| [Noam Brown's solver](https://github.com/noambrown/poker_solver) | `6a10442877ffc8fd28af93e16e279b9bbdd97b2a` | A readable MIT-licensed Kuhn/Leduc/river reference | Its Python river path crashes on some unequal ranges, accepts duplicate board cards, and can permit an under-raise with custom sizing. We use controlled fixtures, not blind trust. |
| [b-inary postflop-solver](https://github.com/b-inary/postflop-solver) | `9d1509fe5077d019825f833eed04b16d342dfda1` | A strong second opinion for heads-up postflop values | It is AGPL, maintenance is suspended, and a clean build currently needs reconstructed dependency pins. It is an offline referee unless licensing and maintenance are deliberately resolved. |
| [amaster97 poker_solver](https://github.com/amaster97/poker_solver) | `f78f1b2bc338dd8cbb5226ecb8398bbdb3635676` | Experimental preflop and postflop research | Its 27 bundled files passed their intended checksum check, but their final exploitability fields are empty, action-level EV export is unfinished, and the full Brown parity test timed out after 660 seconds in this audit. |

The earlier claim that amaster97's blueprint files failed their checksums was wrong: it
hashed the compressed bytes instead of the canonical uncompressed JSON. The corrected
audit loaded and verified all 27 files. This correction stays in the record.

We will write our own implementation from the game rules. Reference projects are
independent test oracles. Do not copy AGPL implementation code into this repository.
Before incorporating any third-party code, settle Poker Face's own license and record the
source and license in a third-party notice.

## Locked game rules

Comparing two solvers is meaningless if they are solving slightly different games. These
rules are part of the test contract and must change only through a reviewed decision.

### Kuhn poker v1

- Two players and a three-card deck: jack, queen, king.
- Each player antes one chip and receives one private card without replacement.
- Player 0 acts first.
- A player may check or bet one chip when no bet is open.
- Facing a bet, a player may call or fold. There are no raises.
- Two checks or a called bet reaches showdown; the higher card wins.
- A fold awards the pot to the other player.
- Utility is **net chip change**, including the ante and any bet. Player 0's utility must
  always be the negative of player 1's.

The equilibrium value for player 0 in this version is `-1/18` chip. Kuhn poker has more
than one equilibrium strategy, so tests must not demand one exact set of action
percentages. They should test value and exploitability.

### Leduc poker v1

Use the same convention as the pinned Brown reference:

- Two players and six physical cards: two copies each of jack, queen, and king.
- Each player antes one chip and receives one private card without replacement.
- Player 0 acts first in both betting rounds.
- Round one has fixed one-chip bets. Round two has fixed two-chip bets.
- At most two betting increments are allowed per round: the opening bet and one raise.
- Checking around or calling the current bet ends a round.
- After round one, reveal one public card from the remaining four physical cards.
- At showdown, pairing the public rank beats an unpaired hand. Otherwise, the higher
  private rank wins; equal ranks split the pot.
- Utility is net chip change and remains exactly zero-sum.

There are `6 × 5 × 4 = 120` ordered private-card-and-board deals. The engine should model
their exact probabilities rather than sample them.

### Implemented Leduc tree audit

The TypeScript rule engine and the pinned Brown implementation independently produce the
same complete tree:

| Item | Exact count |
|---|---:|
| Physical private-card deals | 30 |
| Complete private-card-and-board deals | 120 |
| Chance nodes | 151 |
| Player decisions | 3,780 |
| Terminal endings | 5,520 |
| Total states | 9,451 |
| Information sets | 288 |

The count comes from structure, not from accepting one program's output: each private deal
has a six-decision first-round tree, four immediate fold endings, and five paths to a board
card. Each board chance has four physical cards, followed by another six-decision tree with
nine possible endings.

### Implemented Leduc solve audit

The committed deterministic solve uses 12,800 ordinary-CFR iterations. Its exact
information-set best-response grade is:

| Measurement | TypeScript result | Pinned Brown result |
|---|---:|---:|
| Player 0 value | `-0.053274276` | `-0.053539972` |
| Exploitability | `0.005268743` | `0.008071216` |
| Iterations | 12,800 | 1,600 |

The player-0 values differ by `0.000265695` chip, inside the locked `0.001` tolerance.
Both independently graded strategies are below the `0.01` exploitability gate.

The local 2026-09-03 audit took about 12 seconds and ended at roughly 247 MiB RSS. Those
numbers describe one machine and are printed for engineering visibility; CI does not use
runtime or memory as a correctness test. The reproducible artifact hash, exact value,
reference difference, and exploitability are the release gates.

Artifact schema 2 also records exact teaching facts for all 288 information sets. Those
facts include values from the hand's start and from the current decision, opponent-rank
weights, terminal-outcome weights, immediate fold response to aggression, and explicit
off-path markers. The artifact is also bound to a SHA-256 fingerprint of the complete
game tree: chance edges, action edges, information-set grouping, and terminal payoffs.

To make the full-tree run practical, CFR builds the immutable game tree once and collects
both players' frozen-strategy regret changes and own-reach weights in one traversal per
iteration. Kuhn regenerated to the exact same payload hash after this optimization, which
guards the claim that the optimization changed execution cost rather than solver math.

## Technical design

Start in TypeScript beside the existing push/fold model. Clarity is more valuable than
speed at this size.

```text
src/lib/solver/toy/
  game.ts              generic game contract and shared types
  kuhn.ts              Kuhn rules only
  leduc.ts             Leduc rules only
  leduc-explain.ts     Leduc teaching facts; no UI prose
  cfr.ts               deterministic full-tree CFR
  best-response.ts     exact value, best responses, Nash gap
  artifact.ts          stable, versioned result format
  explain.ts           structured teaching facts; no UI prose

scripts/
  solve-kuhn.ts        regenerates the Kuhn reference result
  solve-leduc.ts       regenerates the Leduc reference result

test/
  solver-kuhn.test.ts
  solver-leduc.test.ts
  solver-cfr.test.ts
  solver-artifact.test.ts
```

The game interface should provide only the operations the solver needs:

```ts
interface ExtensiveFormGame<State, Action, ChanceOutcome> {
  initialState(): State;
  node(state: State):
    | { kind: "chance"; outcomes: readonly Weighted<ChanceOutcome>[] }
    | { kind: "player"; player: 0 | 1; actions: readonly Action[] }
    | { kind: "terminal"; utility: readonly [number, number] };
  next(state: State, action: Action | ChanceOutcome): State;
  informationSet(state: State, player: 0 | 1): string;
}
```

Important boundary: the complete state may contain both private cards so the rules can
score the hand. The information-set key must contain only what the acting player is
allowed to know. Accidentally putting the opponent's card into that key would create a
superhuman solver that cheats.

Each result artifact should record:

- schema version and game-rule version;
- algorithm and implementation version;
- iteration count;
- average strategy at every reached information set;
- exact expected value for both players;
- best-response values, Nash gap, and our stated exploitability convention;
- convergence checkpoints and runtime as observations, not accuracy claims;
- a stable hash of the configuration and strategy payload.

This is the same shape the later river solver will need. The UI should consume this
structured result, never scrape numbers out of explanation strings.

## Mathematical implementation

### Reference algorithm

Implement ordinary, deterministic, full-tree CFR first:

1. Enumerate every chance outcome with its exact probability.
2. At each information set, turn positive accumulated regrets into a strategy. If no
   action has positive regret, use equal probabilities.
3. Walk every action and calculate its counterfactual value.
4. Add the difference between each action's value and the current strategy's value to
   that action's regret.
5. Accumulate the average strategy, weighted by how often the acting player reaches the
   information set.
6. Apply both players' regret changes from a frozen start-of-iteration strategy so the
   answer does not depend on which player happened to update first.

Use JavaScript `number` values, validate every number is finite, and use stable iteration
order. Kuhn and Leduc do not need randomness. Given the same version and iteration count,
the saved artifact should be byte-for-byte reproducible.

CFR+ or discounted CFR may be added only after ordinary CFR passes the entire reference
suite. The simple version remains as an independent oracle instead of being deleted when
the faster version arrives.

### Independent scorekeeper

The solver is not allowed to grade itself with its regret totals. Implement a separate
tree walk that calculates:

- the exact value of the saved average strategy;
- player 0's best response without seeing player 1's hidden card;
- player 1's best response without seeing player 0's hidden card;
- Nash gap and exploitability from those values.

The best-response calculation must choose once per information set, after combining all
hidden states the player cannot distinguish. Choosing separately for each hidden opponent
card would let the scorekeeper cheat and report a false result.

The implemented scorekeeper does this directly and checks that each player remembers their
own earlier decisions. Kuhn's original 64-strategy exhaustive search remains as an
independent oracle: the tests require both methods to agree across 100 reproducible mixed
strategies. This makes the scorekeeper ready for Leduc without claiming it can avoid walking
Leduc's complete game tree.

For a saved strategy profile `σ = (σ0, σ1)`, use these definitions:

```text
gain0 = bestResponseValue0(σ1) - value0(σ0, σ1)
gain1 = bestResponseValue1(σ0) - value1(σ0, σ1)
Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

All four values are expected **net chips per hand**. In a zero-sum result,
`value0 + value1` must equal zero apart from a small floating-point tolerance.

An action EV shown to a learner means:

> Expected net chips from the start of the hand, conditioned on reaching this information
> set, taking this action now, and then following the saved average strategy.

Its hidden-card weights must come from the cards and actions actually consistent with the
information set. If the saved strategy essentially never reaches that information set, mark
the result **off path** instead of presenting a confident recommendation.

## Delivery checklist

### Milestone 0 — contract before algorithm

- [x] Add the generic game, action, strategy, and result types.
- [x] Encode the locked Kuhn rules in code comments and tests.
- [x] Implement the documented Nash-gap and exploitability formulas and chip units.
- [ ] Add a repository license before borrowing any implementation code. No third-party
      implementation code has been copied into the current solver.

### Milestone 1 — Kuhn rule engine

- [x] Enumerate all six ordered private-card deals with probability `1/6` each.
- [x] Implement legal actions and immutable state transitions.
- [x] Implement every fold and showdown payoff.
- [x] Prove with tests that terminal utilities sum to zero.
- [x] Prove information-set keys do not contain the opponent's card.
- [x] Enumerate the entire tree and lock its node/terminal counts as a regression fixture.

### Milestone 2 — Kuhn solver and scorekeeper

- [x] Implement deterministic full-tree CFR.
- [x] Implement average-strategy normalization.
- [x] Implement the independent expected-value and best-response evaluator.
- [x] Implement the scalable information-set best response.
- [x] Match it against exhaustive grading across 100 reproducible mixed strategies.
- [x] Reject games that require a player to forget an earlier choice.
- [x] Assert all probabilities are finite, within `[0, 1]`, and sum to one.
- [x] Assert player 0's solved value is within `0.001` chip of `-1/18`.
- [x] Assert exploitability is at most `0.001` chip before calling the fixture solved.
- [x] Compare value and exploitability with the pinned Brown reference.
- [x] Do not require identical action frequencies where multiple equilibria are valid.
- [x] Show that a large solve has a smaller gap than a deliberately short solve; do not
      claim the gap must decrease at every single checkpoint.

### Milestone 3 — reproducible artifact and teaching facts

- [x] Add `npm run solve:toy` to regenerate the result.
- [x] Commit one human-readable Kuhn artifact.
- [x] Regenerating twice must produce the same bytes, excluding separately recorded
      wall-clock time.
- [x] Export structured facts for each decision: legal actions, frequencies, action EVs,
      EV difference, reach probability, and exploitability of the whole strategy.
- [x] Explain value betting, bluffing, bluff-catching, and mixing from those facts.
- [x] Keep generated sentences out of the mathematical result object.

### Milestone 4 — Leduc generalization

- [x] Implement the locked six-card deck and exact chance probabilities.
- [x] Enumerate all 120 ordered complete deals without duplicates.
- [x] Implement the public-card chance node and two betting rounds.
- [x] Test bet size, raise cap, round ending, folding, pairs, high cards, and splits.
- [x] Reuse the Kuhn CFR and best-response code without game-specific branches.
- [x] Compare expected value and exploitability with the pinned Brown Leduc reference.
- [x] Lock a maximum exploitability of `0.01` chip for the committed Leduc artifact.
- [x] Record convergence and memory measurements, but do not use a laptop-specific timing
      assertion in CI.

### Milestone 5 — product review before UI

- [x] Have the math audit answer: “Can either player gain materially by deviating?”
- [x] Have the poker audit answer: “Do the rules and chip payoffs match the written game?”
- [x] Have the engineering audit answer: “Can hidden information, stale artifacts, or a
      changed rule silently corrupt the answer?”
- [x] Have the teaching audit answer: “Can a learner understand why two actions mix?”
- [x] Have the product audit answer: “Does the planned page teach one useful idea without implying
      this toy strategy applies directly to ordinary hold'em?”
- [x] Only then add a separate `/solver/lab` experience. Do not replace the current trainer
      or the existing push/fold explorer.

The five reviews and their claim boundaries are recorded in
[Leduc solver lab — product-readiness audit](leduc-product-readiness-audit.md).

### Milestone 6 — bounded heads-up river hold'em

- [x] Lock the board, exact ranges, prior pot, stacks, position, bet sizes, and one-raise cap
      before solving.
- [x] Enumerate all 61 compatible private-hand pairs and all river showdowns exactly.
- [x] Keep hidden opponent cards out of all 64 information-set keys.
- [x] Keep net result from the hand's start separate from chip change at the current choice.
- [x] Export exact action values, response frequencies, fold probability, showdown equity,
      opponent ranges, and action differences for the saved strategy.
- [x] Compare the scalable scorekeeper with exhaustive grading on a reduced hold'em game.
- [x] Compare the exact shared tree with Noam Brown's solver at the pinned MIT commit.
- [x] Bind the artifact to the full rule tree and reject stale bytes.
- [x] Pass the locked `0.25`-chip exploitability and reference-value gates.
- [x] Complete CTO, poker, math, teaching, product, and engineering audits.
- [x] Keep this solver separate from the four-player trainer.

The full contract is in [Heads-up river hold'em solver — v1 specification](river-solver-spec.md).
The measured result and six-perspective review are in
[Heads-up river hold'em solver — release audit](river-solver-audit.md).

### Milestone 6b — configurable bounded heads-up river

- [x] Lock an additive v2 contract without changing v1 artifacts or claims.
- [x] Expand a small documented range syntax into exact weighted combinations.
- [x] Generate a finite betting tree from explicit whole-chip opening and raise targets.
- [x] Handle unequal stacks, short all-ins, calls, and returned unmatched chips.
- [x] Reject oversized exact games through a measured preflight before building CFR state.
- [x] Reproduce the v1 joint deals, public tree, terminal money, and solver grade.
- [x] Export exact action values, posterior ranges, response frequencies, and showdown facts.
- [x] Bind one accepted demonstration to versioned rules and reproducible hashes.
- [x] Re-audit a current external heads-up river solver as an offline numerical referee.
- [x] Pass the locked math, poker, teaching, product, CTO, and engineering gates.
- [x] Keep the result separate from the four-player trainer.

The locked contract is in
[Configurable heads-up river solver — v2 specification](configurable-river-v2-spec.md).
The measured result and six-perspective review are in the
[configurable river v2 release audit](configurable-river-v2-audit.md).

### Milestone 6c — compact heads-up river CPU engine

- [x] Keep configurable river v2 as the readable rules and ordinary-CFR oracle.
- [x] Compile the same finite game into deterministic typed numeric arrays.
- [x] Match ordinary-CFR strategies, regrets, values, and exploitability exactly.
- [x] Differential-test different boards, weights, stacks, short all-ins, and bet trees.
- [x] Add separately named alternating CFR+ with documented work counts and averaging.
- [x] Recover Kuhn poker's known value and grade CFR+ with independent best responses.
- [x] Clear the locked `3×` local speed gate without changing accepted artifacts.
- [x] Raise only the compatible-deal ceiling, retain the 50,000-state preflight, and keep
      the compact entry point out of the trainer.
- [x] Pass CTO, poker, math, teaching, product, and engineering reviews.

The locked contract is in the
[compact river engine specification](compact-river-engine-spec.md). The measurements and
six-perspective review are in the
[compact river engine release audit](compact-river-engine-audit.md).

### Milestone 6d — compact independent scorekeeper

- [x] Keep the readable object-tree scorekeeper as the differential oracle.
- [x] Evaluate saved strategies on typed arrays without using CFR regret totals.
- [x] Choose once per information set after combining hidden opponent hands.
- [x] Match profile values, best-response values, and action choices exactly.
- [x] Match exhaustive pure-strategy values on the reduced river fixture.
- [x] Preserve the deliberate hidden-card cheating regression.
- [x] Reject missing, malformed, non-normalized, and non-finite strategies.
- [x] Clear the locked `3×` wider-fixture speed gate.
- [x] Use the faster scorekeeper only in the isolated compact river entry point.
- [x] Pass CTO, poker, math, teaching, product, and engineering reviews.

The contract is in the
[compact river scorekeeper specification](compact-river-scorekeeper-spec.md). The measured
result and six-perspective review are in the
[compact river scorekeeper release audit](compact-river-scorekeeper-audit.md).

### Milestone 6e — factorized exact-card river engine

- [x] Keep configurable river v2 as the readable poker-rules source of truth.
- [x] Store the public betting tree once instead of once per compatible private deal.
- [x] Keep an exact blocker-compatible weighted deal list and exact river showdowns.
- [x] Preserve every information-set key, legal action, terminal utility, and state count.
- [x] Match readable and repeated-compact ordinary CFR exactly.
- [x] Match repeated-compact CFR+ on a fixture representing more than 100,000 states.
- [x] Match readable and compact profile values and legal best responses.
- [x] Preserve the deliberate hidden-card cheating regression and exhaustive reduced-game check.
- [x] Reduce locked wider-fixture structural typed storage below 25% of the repeated layout.
- [x] Keep finite deal/state limits and leave the engine disconnected from the trainer.
- [x] Pass CTO, poker, math, teaching, product, and engineering reviews.

The contract is in the
[factorized river engine specification](factorized-river-engine-spec.md). The measured result and
six-perspective review are in the
[factorized river engine release audit](factorized-river-engine-audit.md).

### Milestone 6f — configurable river solver v3

- [x] Profile private-deal growth, public-tree growth, solve time, grade time, and working storage.
- [x] Raise the measured factorized boundary to one million equivalent states.
- [x] Add up to five opening sizes, five raise targets, and two raises after the opening bet.
- [x] Enforce minimum raises, short all-ins, returned chips, and no raises into an all-in player.
- [x] Reduce exactly to v2 when configured with one raise.
- [x] Match readable CFR and readable legal best responses on the richer tree.
- [x] Check all 7,216 locked deal/terminal outcomes with an independent money and showdown oracle.
- [x] Preserve the hidden-card cheating regression and generated-profile differential checks.
- [x] Export structured teaching facts below a separate 100,000-state bulk-data limit.
- [x] Commit and reproduce a hashed 1,000-iteration CFR+ artifact below the quality gate.
- [x] Recheck the pinned MIT referee and withhold a false comparison when its sizing semantics differ.
- [x] Pass CTO, poker, math, teaching, product, and engineering reviews.

The contract is in the
[configurable river v3 specification](configurable-river-v3-spec.md). The profile, accepted result,
open-source compatibility finding, and six-perspective review are in the
[configurable river v3 release audit](configurable-river-v3-audit.md).

### Milestone 6g — River Solver Lab

- [x] Add `/solver/river` while retaining the Leduc lab and existing trainer.
- [x] Open an instant checked-in example and accept explicit custom v3 game inputs.
- [x] Count exact deals and public states before solving; enforce a 100,000-state browser ceiling.
- [x] Resume one CFR workspace in a Web Worker with real iteration counts, measured grades, and cancellation.
- [x] Inspect all decisions, frequencies, chip values, responses, call prices, and blocker-aware ranges.
- [x] Update opponent ranges after a response without revealing hidden cards or inventing off-path values.
- [x] Preserve accepted strategy bytes and the independent scorekeeper's existing results.
- [x] Add worker/session, mathematical teaching, UI, keyboard, and responsive checks.
- [x] Use scoped styling and plain-language approximation claims; preserve unrelated local work.

The browser contract is in [River Solver Lab specification](river-solver-lab-spec.md).
Verification evidence and known limitations are in [River Solver Lab release audit](river-solver-lab-audit.md).

The multiway stages are specified in
[Multiway no-limit hold'em solver — staged research and delivery plan](multiway-nlhe-solver-plan.md).

### Milestone 7 — exact three-player river proof

- [x] Lock the board, three weighted six-combination ranges, money, action order, one bet
      size, and no-raise boundary before solving.
- [x] Enumerate all 172 compatible joint private states and all 2,236 terminals exactly.
- [x] Add a separate N-player contract without changing the two-player solver artifacts.
- [x] Keep both opponent hands out of every information-set key.
- [x] Preserve the blocker-aware joint range through every public action.
- [x] Compare the scalable best response with 256 exhaustive pure strategies per player on
      an eight-deal reduced game.
- [x] Prove the hidden-information boundary with a deliberately cheating statewise grader.
- [x] Pass the locked maximum unilateral gain of `0.45` chip per hand.
- [x] Bind the rules, strategy, checks, and teaching facts to reproducible SHA-256 hashes.
- [x] Pass CTO, poker, math, poker-teaching, product, and engineering reviews.
- [x] Keep the proof out of the four-player trainer.

The exact contract is in
[Exact three-player river proof — v1 specification](multiway-river-proof-spec.md).
The measurements and six-perspective review are in
[Exact three-player river proof — release audit](multiway-river-proof-audit.md).

## Teaching experience: delivered and proposed

The delivered teaching pages are Leduc at `/solver/lab` and heads-up river at
`/solver/river`; Kuhn remains the non-UI mathematical reference. Leduc has four curated
lessons. River lets the learner inspect a hand and action history, compare frequencies
and chip values, see possible opponent responses and hands, and inspect the independently
measured quality of the saved strategy. Neither replaces the four-player trainer.

The first guided comparison layer is implemented: pin an inspected decision, then change
only the opponent range, opening bet menu, or opponent stack. It reuses the pinned result,
solves the changed game in a resumable worker, and compares the exact same player, private
hand, and public history. Missing decisions are not replaced; off-path values stay unknown.
Both games together must fit 100,000 equivalent repeated states. Independent grades and
whole-game value bounds stay separate from conditional action values, with rare-decision
warnings. See the [comparison contract](river-comparison-spec.md) and
[release evidence](river-comparison-audit.md).

Price, action-order, and board/blocker comparisons are deferred. A later “imperfect
opponent” lesson could change how often the opponent calls or bluffs and calculate a best
response. That would be an exploitative strategy against an explicit model, not automatically
GTO. Opponent-locking and a collaborator-specific adapter are not implemented.

## Stop conditions

Pause instead of expanding scope if any of these is true:

- We cannot reproduce the known Kuhn value.
- Our best-response evaluator can see hidden cards.
- Brown and our Leduc result disagree beyond the locked tolerance and we cannot explain why.
- A heads-up result is labeled solved without a measured Nash gap, or a multiway result
  is accepted without every player's measured unilateral gain.
- The planned UI needs a multiway or earlier-street claim the engine does not support.
- Performance work would replace the readable reference before an independent fast version
  agrees with it.

## Definition of success

The first portfolio milestone is complete when a reviewer can run one command, reproduce
the Kuhn and Leduc artifacts, inspect the game rules, see an independently measured error,
and understand one mixed strategy in plain language.

The portfolio story is then honest and strong:

> I started with a game small enough to count exactly, separated the solver from its
> scorekeeper, tested hidden-information boundaries, checked the result against an
> independent implementation, and used the measured action values to teach the strategy.
