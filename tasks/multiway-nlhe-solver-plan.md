# Multiway no-limit hold'em solver — staged research and delivery plan

**Status:** Stage 1 implemented and audited; Stage 2 is next

**Written:** 2026-09-14

**First build target:** a tightly bounded, three-player river game

## The plain answer

A useful multiway poker solver is possible as a portfolio project if we keep the first
game small enough to count and check. A full six-player, all-streets, any-bet-size solver
is not a realistic local project. Calling a small abstraction a full solver would weaken
the portfolio rather than strengthen it.

The staged approach is:

1. Build one exact three-player river game with tiny ranges and one bet size.
2. Prove its cards, pots, hidden information, and best responses with independent checks.
3. Add one source of complexity at a time: a raise, a second bet size, larger ranges, a
   fourth player, then sampled private cards.
4. Treat earlier streets as a separate research step because they need future-card trees
   and trustworthy values at any branch we choose not to finish.

The teaching goal stays concrete: show how position, the number of players, possible
opponent hands, folds, pot sharing, and price change the value of a choice.

## Why multiplayer poker is different

Heads-up poker is a two-player zero-sum game. If one player gains one chip, the other loses
one chip. That gives the game one value viewed from opposite sides. It also gives standard
counterfactual regret minimization, or CFR, its familiar guarantee: average strategies
approach a Nash equilibrium as regret falls.

Multiway poker still conserves chips across the whole table, but it is not pairwise
zero-sum. If Alice changes her strategy, the effect may be split differently between Bob
and Carol. Bob and Carol are not one opponent unless they are allowed to coordinate as a
team, which is a different game.

That changes three important things:

- There may be several equilibria with meaningfully different values for each seat.
- Low regret from ordinary CFR does not by itself prove that the average strategy is near
  a Nash equilibrium in a game with three or more independent players.
- “Half the Nash gap” is a two-player zero-sum convention. It is not a valid quality score
  for this project once a third player is added.

We can still ask a precise question for each player:

```text
unilateral gain for player i
  = best value player i can get against the other saved strategies
    − player i's value in the saved strategy profile
```

The release report will show every player's unilateral gain and the largest one. If all
gains are at most `ε`, the profile is an `ε`-Nash profile for this finite game: no one
player can gain more than `ε` by changing alone.

The sum of those gains may be shown as a diagnostic, but it will not be divided by two or
called exploitability. A coalition check—two players coordinating against one—would be a
separate collusion model, not a Nash check.

## How the game grows

### More players and wider ranges

If each player has `K` exact combinations, there are up to `K^N` joint private-card
assignments before removing card collisions.

| Players | 8 combinations each | Full physical deals on a known river board |
|---:|---:|---:|
| 2 | 64 | 1,070,190 |
| 3 | 512 | 966,381,570 |
| 4 | 4,096 | 792,432,887,400 |
| 6 | 262,144 | 391,070,384,529,224,400 |

The last column assigns two disjoint cards to every player from the 47 cards left after a
known five-card board. Real ranges remove many hands, but blockers also make the remaining
hands correlated. We cannot safely update each opponent's range on its own and multiply
the answers afterward.

### Earlier streets

The river has no future cards. A turn solve adds every possible river. A flop solve adds an
ordered turn and river, with a betting round between them.

Even before betting branches:

- A full-range heads-up turn state has about 51 million private-deal-and-river outcomes.
- A full-range heads-up flop state has about 2.52 billion private-deal-and-runout outcomes.
- A full-range three-player flop state has about 2.27 trillion.

Those counts are why a serious earlier-street solver samples, abstracts, stores reusable
values, or uses large distributed jobs.

### Deeper stacks and more bet sizes

No-limit poker allows many legal chip amounts. If every whole-chip bet from zero to a
100-chip stack is distinct, one opening decision can have roughly 101 choices. With three
players, the rough space of contribution totals alone can reach `101³`, or about one
million vectors, before considering action order, folds, and raises. A ten-chip grid would
have only `11³ = 1,331` such vectors.

That comparison is only a scale illustration; not every vector is legal or reachable.
The important fact is that deeper stacks create more raise sequences, and finer bet sizes
multiply nearly every betting branch. Truly continuous bet sizes form an infinite action
space. A finite computer solver must discretize them or use a specialized continuous-
action method. Poker Face will document its discrete menu and never call it unrestricted
no-limit play.

## Stage 0 — contracts before algorithms

Write these definitions before the first multiway solve:

- Utility is each player's net chip change from the start of the hand.
- Every terminal utility vector sums to zero within `1e-9` chip.
- A strategy may use only the acting player's private cards and public facts.
- A best response chooses once per information set after combining every joint hidden
  state the player cannot distinguish.
- `unilateralGain[i]` is the improvement player `i` can make alone.
- `maximumUnilateralGain` is the multiway quality gate.
- The words “half-Nash-gap” and “exploitability” are not used as the multiway quality
  measure.
- Exact and sampled measurements are labeled separately.

The generic game interface must move from a fixed pair to `N` players without changing
the existing Kuhn, Leduc, or heads-up river results. That backward-compatibility test is a
release requirement.

## Stage 1 — exact three-player river proof

### Locked first game

Lock the final fixture in a specification before solving. The recommended initial shape
is deliberately modest:

- Three players: Player 0 acts first, then Player 1, then Player 2.
- One known five-card board.
- Six exact two-card combinations per player, with explicit positive weights.
- A 90-chip starting pot: 30 chips previously contributed by each player.
- 60 chips behind for every player.
- With no bet open: check or bet 30 chips.
- Facing a bet: fold or call 30 chips.
- No raises in the first proof.
- All active players checking reaches showdown.
- A call does not end action until every remaining player has either matched the bet or
  folded.
- Equal stacks mean no side pots in this first fixture.

The maximum nominal private-deal count is `6³ = 216`, small enough to enumerate. Card
collisions will reduce it. The full public betting tree will also be counted and locked in
tests before CFR runs.

### Candidate strategy and release gate

Ordinary deterministic CFR may generate the first candidate because it is readable and
already tested. In multiplayer it is a search method, not the proof.

The independent best-response checker supplies the proof. Before the large run, lock:

- maximum unilateral gain at no more than `0.5%` of the starting pot;
- every player's gain shown separately in chips per hand;
- the final strategy's values summing to zero within `1e-9` chip;
- exact agreement with the independent terminal oracle within `1e-9` chip;
- byte-for-byte reproducible output.

For the proposed 90-chip pot, the quality gate is `0.45` chip per hand. If the candidate
does not reach it, stop. Keep the result as a research artifact labeled “candidate,” or
change the algorithm in a new, pre-declared experiment. Do not weaken the gate after
seeing the answer.

## Stage 2 — betting depth, one change at a time

After Stage 1 passes:

1. Add one all-in raise after the 30-chip opening bet.
2. Recount the complete tree and re-run every oracle.
3. Only then add a second opening size, recommended at 60 chips all-in.
4. Keep equal stacks until fold, call, and raise behavior is independently verified.
5. Add unequal stacks and side pots only as a separate milestone.

When side pots arrive, each pot layer needs its own eligible seats and terminal award. A
single “win percentage” is no longer enough. The teaching data must say which pot a hand
can win and how much of that pot it expects to receive.

## Stage 3 — four-player bounded river

Use the same exact engine with four tiny ranges and the simplest Stage 1 betting tree.
This stage tests player-order permutations, more folds, and joint hidden-hand correlation.
It does not connect to the current trainer.

Do not add wide ranges, raises, and side pots at the same time. A four-player artifact is
accepted only when:

- reducing it to two players reproduces the existing river-v1 result;
- removing a player who always folds matches the equivalent smaller game;
- relabeling seats and applying the same relabeling to action order preserves values;
- every player's exact best-response gain passes the locked multiway gate;
- an independent small-game exhaustive grader agrees with the scalable checker.

## Stage 4 — larger river ranges through sampling

Exact enumeration stops when the joint range is too large for the local budgets below.
The public betting tree can remain exact while private hands are sampled jointly.

Sampling rules:

- Draw a whole compatible tuple of private hands without replacement.
- Preserve the input weights with a documented sampling or importance-weight formula.
- Never sample each opponent independently and discard collisions afterward.
- Keep joint hidden-state weights because blockers and observed actions make opponents'
  hands correlated.
- Use deterministic seeds and record the complete sample schedule.
- Use common random samples when comparing two actions so noise cancels rather than
  masquerading as a difference.
- Estimate uncertainty from the actual chip outcomes, including fractional pot shares;
  do not use a Bernoulli win/loss formula.
- Run independent batches and report confidence intervals and effective sample size.
- Withhold range or action explanations when rare branches have too little effective
  sample weight.

Every sampled implementation must agree with the exact Stage 1 and Stage 2 games within a
pre-declared confidence interval before it may solve anything larger.

## Stage 5 — turn, then flop research

A turn solver adds exact or sampled river cards and one later betting round. A flop solver
adds two future cards and two later betting rounds. If we stop a branch before showdown,
we need a value for that unfinished position.

Allowed first turn experiment:

- three players;
- tiny explicit ranges;
- one known turn board;
- one bet size per street;
- no raises;
- exact future river cards where the state count stays inside budget.

A depth-limited solve may use a leaf-value model only after that model is tested against
completed smaller subgames. Until then, every branch must run to a fold or showdown. An
unverified neural or lookup value at the leaves would move the largest error into the
least visible part of the system.

Multiway flop solving with broad ranges, deep stacks, and several sizes is a research-
scale project. It is not on the local delivery path unless earlier stages produce evidence
that the storage, sampling, and quality checks scale.

## Required software abstractions

### N-player game contract

Add a new interface instead of weakening the two-player contract in place:

```text
playerCount
initialState
node → chance | one acting player | terminal utility vector
nextChance
nextAction
informationSet
```

Utilities become length-`N` vectors. Tree validation checks every finite value and the sum
of the entire vector. The two-player adapter must reproduce the current artifact hashes
before the new engine is trusted.

### Public betting state

Represent explicitly:

- active, folded, and all-in seats;
- acting seat and last aggressor;
- each seat's total and current-street contribution;
- amount to call;
- last full raise and whether action is reopened;
- pot layers and eligibility;
- public action history and configured size identifiers.

Do not infer this state from prose labels. Legal-action generation and contribution
updates remain pure functions with exhaustive small-tree tests.

### Joint private-state model

The solver needs a blocker-aware distribution over compatible hand tuples. It may expose
marginal ranges for teaching, but the calculation must preserve the joint distribution.

After an action, reweight each compatible tuple by the acting hand's probability of that
action, then normalize. This is Bayes' rule over the joint states. Marginalizing each
opponent separately before the update loses correlations and can create impossible
explanations.

### Strategy and reach tables

Each information set includes:

- rules version;
- acting seat;
- that seat's own cards;
- board;
- public contributions, active seats, and action history.

It includes no other private cards. Counterfactual reach for Player `i` multiplies chance
and every other player's reach while leaving out Player `i`'s own reach. Perfect-recall
checks must prove the player never forgets an earlier private observation or action.

### Independent value and best-response checker

For each player in turn:

- hold every other player's saved strategy fixed;
- combine all joint hidden states at each information set;
- choose one action for that information set;
- report the player's best-response value and unilateral gain.

For tiny fixtures, enumerate all pure information-set strategies and require exact
agreement with the scalable checker. Keep a deliberate cheating version in tests and show
that seeing the full hidden tuple produces an improperly higher value on at least one
fixture.

## Independent checks

No audited open-source project in the current evidence set supplies a pinned, matching
multiway no-limit river result. The Brown river solver and b-inary postflop solver are
heads-up. We therefore need several checks that fail differently:

- A slow terminal oracle with a separate contribution table and slow hand evaluator.
- Exhaustive pure-strategy grading on very small three-player fixtures.
- Analytic fixtures with dominated actions and known best responses.
- Player-label permutation checks.
- “Always folds” reduction to a smaller game.
- Two-player reduction to the committed river-v1 value and strategy grade.
- Exact-versus-sampled comparisons using held-out deterministic sample batches.
- A second solver algorithm, such as CFR+ or discounted CFR, used as a comparison after
  ordinary CFR is stable—not as a silent replacement for the oracle.

If a suitable independent multiway solver is found later, pin its commit, inspect its
license, match every rule, and record disagreement. Do not copy AGPL code or change our
tree merely to obtain matching numbers.

## Artifact and storage model

Every result is content-addressed and bound to its exact inputs. Store:

- schema, rule, solver, evaluator, and teaching-data versions;
- player count, board, ranges and weights, positions, pot, stacks, sizes, and raise cap;
- exact-enumeration or sampling method, seed, batches, and sample count;
- public tree counts and compatible private-state count or estimate;
- all player values, best-response values, unilateral gains, and maximum gain;
- convergence checkpoints without claiming they must improve monotonically;
- confidence intervals and effective sample sizes for sampled results;
- full strategy or a losslessly encoded strategy reference;
- terminal-oracle and independent-check results;
- rules fingerprint, input hash, payload hash, and upstream reference provenance;
- observed runtime, peak memory, and artifact size as engineering facts, not math gates.

Small exact fixtures may stay as readable JSON. Larger strategies should use a versioned,
compressed binary file plus a small readable manifest and teaching summary. The browser
never downloads the full strategy when a lesson needs only one decision. Display pruning
may hide tiny frequencies, but stored math is never rounded or pruned before grading.

Any mismatch in schema, rules fingerprint, range hash, action menu, evaluator version, or
sample schedule rejects the artifact as stale.

## Subgame solving

Each solve begins at one public state: known board, seats still active, public action
history, contributions, stacks, and a blocker-aware joint distribution over private hands.
That complete input is the subgame. A river subgame ends naturally at a fold or showdown,
so it needs no guessed value at the edge.

For an earlier street, every branch must either continue through the river or stop at a
leaf with an independently tested continuation value. Replacing a branch with an
unverified estimate can make every action above it look precise while being wrong.

The first implementation is offline and whole-subgame:

- create and validate one immutable subgame input;
- solve it to a pre-declared unilateral-gain target;
- grade it from the root with the independent checker;
- write a content-addressed artifact;
- publish only small teaching slices derived from that artifact.

Later public-state re-solving must carry forward the exact joint range implied by earlier
actions. It may not restart opponents from convenient independent ranges. Splicing a new
subgame strategy into an older strategy also needs a safety check; until that check exists,
the product describes the answer only as a solve for the stated local input.

## Subgame service and performance boundaries

Solve offline first. The browser reads audited teaching slices; it does not run a large
solver during a lesson.

### Local budgets

| Milestone | Wall time | Memory | Stored result | CI check |
|---|---:|---:|---:|---:|
| Exact 3-player river proof | under 60 seconds | under 1 GiB | under 10 MiB | under 2 minutes |
| Raised/two-size 3-player river | under 10 minutes | under 4 GiB | under 100 MiB | reduced smoke under 2 minutes |
| Exact tiny 4-player river | under 10 minutes | under 4 GiB | under 100 MiB | reduced smoke under 2 minutes |
| Sampled wider-range river research | under 30 minutes | under 8 GiB | under 500 MiB | deterministic small audit only |

These are stop budgets, not targets to game. Optimize only after profiling. Preserve the
readable exact implementation as the oracle when adding vectorization, workers, native
code, or GPU work.

Default exact-enumeration stop conditions:

- more than one million compatible private tuples;
- more than ten million full terminal states;
- more than 8 GiB estimated peak memory;
- more than 30 minutes in a measured local dry run.

Crossing one limit moves the experiment to sampling or research-scale infrastructure. It
does not justify quietly skipping states.

### Research-scale work

The following would normally need distributed generation, native vector code, GPUs, large
storage, learned leaf values, or a research collaboration:

- six-player full ranges;
- preflop through river;
- broad flop ranges with several sizes and raises;
- deep stacks with fine-grained bet amounts;
- real-time solving for arbitrary user-entered spots;
- neural counterfactual value models with independently established error bounds.

Those can appear on a future-work page. They cannot appear as shipped capability.

## Teaching-data model

For one learner decision, save only facts the learner could know:

- their cards, board, position, active players, pot, call price, and effective stacks;
- the legal discrete choices and their saved frequencies;
- expected chip change from now for each choice;
- difference from the best measured choice;
- each opponent's marginal range for display, derived from the joint hidden-state model;
- important correlations or blockers that make independent range pictures misleading;
- immediate response frequencies for every remaining opponent;
- chance everyone folds, one or more players continue, and each showdown outcome;
- showdown equity and pot share, including splits, only when showdown occurs;
- each side pot's size, eligible seats, and expected share when side pots exist;
- exact-versus-estimated label, confidence interval, and sample support;
- the full profile's per-player unilateral gains and maximum gain.

The first explanation should sound like this:

> Calling costs 30 chips. If you call, three players can still reach the showdown, so
> winning half the time is not required and not guaranteed. Against the hands still
> possible after these actions, this call gains about 2.1 chips on average in this saved
> example. Player 2 acts after you, which changes both the price and how often you reach
> showdown.

Avoid:

- “You have 40% equity, so call.” Equity alone omits future action and fold value.
- “This is GTO.” The profile has a measured maximum unilateral gain instead.
- “Your opponents have these independent ranges.” Their hands can be correlated.
- “Win chance” when a split or side pot makes expected pot share the useful number.
- percentages without the number of players and the exact-vs-estimated label.

The UI hierarchy should be: recommendation, chip difference, why the number of players
and position matter, opponent responses, then expandable range and method detail. Copy
tests must bind every numerical sentence to structured evidence.

## Pre-implementation review by perspective

### Expert CTO

The staged boundary is the product strategy. Exact small games establish trust; sampling
and performance work earn their way in through comparison. Keep solver jobs offline,
artifacts immutable, and browser payloads small. Do not let an adjustable UI imply that
arbitrary inputs already have audited answers.

### Expert poker player

The first game must get action closure right: after a bet, every active player must call
or fold before showdown. Later stages must handle a player acting after the learner,
short all-ins, action reopening, uncalled excess, and side-pot eligibility exactly. Position
is action order, not decoration.

### Expert math professor

Report a vector of player values and unilateral gains. Do not compress it into the
heads-up half-gap formula. Preserve the joint hidden-state distribution, state every
conditioning event, and put uncertainty beside every sampled answer. An exact showdown
does not make a finite-iteration strategy exact.

### Expert poker teacher

Teach why the third player changes the choice: someone may act behind, folds change who
contests the pot, and a split or side pot changes the value of “winning.” Lead with chips
from now, then use showdown equity and range movement to explain that chip result.

### Expert product person

Start with one guided three-player spot, not a solver control panel. A later player-count
control should switch among separately audited artifacts. It must not manufacture advice
for an unsolved seat count. Keep method, ranges, and uncertainty available without making
them the first thing a learner has to read.

### Expert software engineer

The main risk is a plausible result built on the wrong information boundary. Make joint
private states, public betting state, terminal pots, the candidate solver, and the grader
separate modules. Keep reduced exhaustive tests and the slow terminal oracle even after a
faster implementation exists.

## Stop conditions

Stop a milestone and report it honestly if any condition occurs:

- terminal chips do not sum to zero;
- any information-set key or best response can see hidden opponent cards;
- opponent marginals are updated independently where joint correlation matters;
- scalable best responses disagree with exhaustive small-game grading;
- the largest unilateral gain misses the pre-declared gate;
- training diagnostics improve but independent unilateral gains do not;
- two algorithms converge to materially different values and the difference is unexplained;
- sampled confidence intervals exceed the teaching claim or effective sample size is too low;
- an exact run crosses its state, time, or memory budget;
- an artifact cannot prove which rules, ranges, evaluator, and samples produced it;
- a reference license is incompatible or unclear;
- a product screen would need to imply full, exact, multiway no-limit solving.

Failure at one stage is a useful portfolio result if it is measured and explained. It is
not permission to relabel the result.

## Measurable definitions of success

### Stage 1 success

- The game contract and fixture are written before the solver result.
- Every compatible deal and terminal is exact.
- Terminal oracle disagreement and chip-sum error are at most `1e-9` chip.
- Scalable and exhaustive best responses agree within `1e-9` chip on reduced fixtures.
- Every player's unilateral gain is reported; the maximum is at most `0.45` chip on the
  proposed 90-chip game.
- Two runs produce identical artifact bytes.
- The full tests, type-check, lint, solver audits, and production build pass.
- Six-perspective review passes before any learner UI is connected.

### Sampled-stage success

- Exact small-fixture values fall inside their reported 95% confidence intervals in at
  least 90 of 100 pre-declared, independently seeded validation batches.
- A displayed action-value interval has a half-width no larger than `0.5%` of the starting
  pot. A recommendation is called meaningfully better only when its advantage is larger
  than the combined 95% uncertainty; otherwise the UI says the choices are too close to
  separate.
- Every displayed sampled posterior has an effective sample size of at least 1,000;
  thinner branches are withheld.
- Results reproduce from the saved seed and sample schedule.

### Portfolio success

A reviewer can see exactly what was solved, reproduce it, inspect a second checker, and
understand why adding a player changes both the mathematics and the product language.

The defensible claim is:

> I built and audited a sequence of finite poker abstractions, ending in a bounded
> multiway river proof of concept. I measured how much each player could gain by changing
> alone, preserved correlated hidden ranges, and stopped where local evidence stopped.

The claim is not: “I built a full multiway no-limit hold'em solver.”

## Implementation checklist for the next work session

- [x] Write the exact three-player river fixture and lock its final cards and ranges.
- [x] Add an N-player game contract beside the two-player one.
- [x] Adapt tree indexing, strategy validation, and utility validation to `N` players.
- [x] Build joint compatible-deal enumeration and action-based reweighting.
- [x] Build the pure public betting state with no raises.
- [x] Build a separate multiway terminal and pot oracle.
- [x] Implement per-player profile value and information-set best response.
- [x] Compare the scalable checker with exhaustive reduced fixtures.
- [x] Add deterministic candidate generation and checkpoint grading.
- [x] Lock the `0.45`-chip maximum-unilateral-gain gate before the full solve.
- [x] Generate a versioned, hashed artifact and exact teaching facts.
- [x] Run CTO, poker, math, poker-teaching, product, and engineering audits.
- [x] Keep all multiway output out of the existing trainer until those checks pass.

Stage 1's locked rules and measured result are recorded in
[the exact fixture specification](multiway-river-proof-spec.md) and
[the release audit](multiway-river-proof-audit.md). Stage 2 adds one all-in raise after
the 30-chip opening bet and repeats every proof before adding a second opening size.
