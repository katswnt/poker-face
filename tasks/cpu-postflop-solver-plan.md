# CPU-first heads-up postflop solver — implementation and delivery plan

**Created:** 2026-09-22

**Baseline:** `7d2ea37` — audited turn reference and worker-backed trainer equity

**Status:** M0–M4 implemented; the remaining stages are planned, not implemented.

**Active next milestone:** M5, starting with a tiny joint flop/turn/river reference.
See the [compact turn audit](compact-turn-engine-audit.md),
[M2 vector turn audit](vector-turn-engine-audit.md),
[M3 configurable turn audit](configurable-turn-v2-audit.md), and
[M4 saved explorer audit](saved-turn-explorer-audit.md).

**Purpose:** The working reference for subsequent solver-capacity work. Update the
execution record at the end of this file after each milestone.

## 1. Decision and intended outcome

Prioritize a more capable solver over a standalone lesson for the existing tiny turn
game. Build an independently checked, CPU-first heads-up postflop engine, generate our
own saved solutions offline, and expose those results through an accessible explorer.

The intended sequence is:

```text
Existing readable turn reference (keep unchanged)
  -> compact two-street engine with equivalent math
  -> hand-range-vector calculations and scalable independent grading
  -> wider ranges and richer turn/river betting
  -> bounded joint flop/turn/river solving
  -> reproducible saved-solution library and explorer
```

This is not a promise of a particular date, an unrestricted poker solver, or parity
with an unseen implementation. Each expansion earns its own numerical and resource gate.
The useful stopping points are a wider-range turn solver and then a selected-scenario
flop solver; neither requires completing every later item.

### What “without training” means here

- No neural policy, learned leaf-value model, GPU backend, training corpus, or paid
  compute service is required by this plan.
- CFR still repeatedly improves a strategy for a specified game. That computation is
  sometimes called training; it cannot be removed while still claiming we solved a game.
- Practice drills, player scoring and trainer features are not dependencies of this work.
- The existing four-player heuristic trainer remains separate. Its equity estimates
  and the new heads-up strategies have different guarantees.

### Concrete product target

Eventually let a user choose a supported heads-up scenario, inspect both ranges, walk
from flop through river, and see each hand's action mix and chip values. Show the exact
betting menu, range assumptions, solver version and independently measured quality.
Saved scenarios should load without rerunning a large solve in the browser. Custom
large solves remain local/offline initially.

Griffin's public app was inspected on 2026-09-22: its page loads saved result packs,
and its [public manifest](https://fold-poker.gtarpenning.workers.dev/pack/index.json)
lists 72 flop entries and nine positional formations. That is a useful visible product
comparison, not a certification of its solver, range provenance or published grades.
We will create our own fixtures, implementation and artifacts, not copy its data or code.
We do not need to match an arbitrary scenario count to demonstrate progress.

## 2. Verified starting point and what is actually missing

Repository, history and relevant code were inspected for this plan. Numerical results
below are the recorded accepted baseline, not a claim that all long audits were rerun
during this documentation-only task.

| Area | Implemented at the baseline | Remaining gap |
|---|---|---|
| River v3 | Weighted ranges, exact blockers/showdowns, finite bet/raise menus, CFR+, independent grade, resumable browser lab | Admission caps and pair-by-pair work limit scale |
| River capacity | At most 128 combinations/player, 15,000 compatible deals, 1,000,000 equivalent repeated states; browser teaching cap 100,000 | A public-tree representation alone does not remove private-pair computation |
| Turn reference | Joint turn/river game; 8 combinations/player, 16 compatible deals, 25,000 states; one capped bet/street, no raises | Readable full-tree implementation, tiny ranges and narrow betting rules |
| Turn fixture | 3 compatible deals, 132 deal–river pairs, 3,592 states, 1,088 information sets | Correctness evidence, not a realistic-range performance benchmark |
| Turn quality | 16,384 ordinary-CFR iterations; exploitability 0.014643152343495558 chips; original acceptance limit 0.10 chip | New games need their own convergence evidence |
| Flop | No ordinary hold'em flop-to-river solver | Two public-card transitions and three betting rounds |
| Product | River inspection/comparisons, Leduc lessons, portable river benchmarks | No turn/flop solution explorer or large saved-scenario library |

Read before implementation:

- [Turn v1 rules](heads-up-turn-v1-spec.md) and [audit](heads-up-turn-v1-audit.md).
- [River v3 rules](configurable-river-v3-spec.md) and [audit](configurable-river-v3-audit.md).
- [Factorized river specification](factorized-river-engine-spec.md) and
  [audit](factorized-river-engine-audit.md).
- [Strategy exchange contract](river-strategy-exchange-spec.md).
- [Main roadmap](solver-lab-roadmap.md) and the separate
  [multiway research plan](multiway-nlhe-solver-plan.md).

The old full-suite evidence is 483 working-tree unit tests/38 browser tests, versus
472/35 in the clean release without unrelated local features. Test counts can change;
rerun and record actual results for each implementation milestone.

## 3. Scope, assumptions and non-goals

### Committed direction

- Heads-up, zero-sum, no rake, no tournament/ICM model.
- Explicit weighted physical two-card combinations; card removal remains exact.
- Finite, declared betting menus. Actions outside the menu are not secretly available.
- Solve all included streets jointly, carrying earlier action information forward.
- Enumerate legal public cards initially; no card buckets, sampled leaves or guessed EVs.
- CPU implementation first, with readable TypeScript retained as an independent reference.
- Start from a supplied postflop board, ranges, equal declared prior contributions and
  stacks. Do not imply that a preflop strategy has also been solved.
- Player 0 acts first and player 1 second on each postflop street. Seat labels describe
  the scenario; they do not substitute for an explicit action-order convention.

### Deferred, not quietly included

Neural/GPU work; live-game assistance; unrestricted preflop solving; more than two
active players; rake; arbitrary continuous bets; automatic bet-size search; folded-player
card-removal/bunching models; imported proprietary solutions; hosted custom-solve services;
and modifications to the trainer's playing strategy.

No third-party solver implementation will be incorporated without resolving its license
and this repository's reuse terms. Rust is an optional later implementation choice,
not a shortcut around that requirement. Reading papers and performing compatible
black-box numerical comparisons do not mean copying a reference engine.

## 4. Implementation architecture

### 4.1 Preserve the existing references

Leave `src/lib/solver/turn/`, the toy CFR/scorekeeper, and accepted river versions/artifacts
intact. Add a separate `src/lib/solver/postflop/` implementation. Adapters map small new
games to existing references; do not raise old limits or alter old hashes to make a
new benchmark fit.

The current factorized river compiler explicitly rejects chance after the private deal.
It also uses a representative private deal to build its public betting tree. Neither
assumption can simply be carried into a turn compiler with public-card branches.

Proposed modules, introduced only as their milestone needs them:

```text
src/lib/solver/postflop/
  contract.ts                 versioned requests, normalized game and result types
  rules.ts                    public betting transitions and settlement
  preflight.ts                bounded counting and peak-workspace estimates
  public-tree.ts              compact public actions, chance edges, histories
  ranges.ts                   combo IDs, weights, card incidence, compatibility
  chance.ts                   legal runouts and chance-factor accounting
  terminal-naive.ts           explicit-pair terminal oracle for small cases
  terminal-vector.ts          rank-ordered, blocker-aware range sums
  cfr.ts                      ordinary CFR and separately versioned CFR+
  session.ts                  resumable workspace and immutable snapshots
  checkpoint.ts               restartable offline session format and validation
  scorekeeper.ts              independent profile value and legal best responses
  explain.ts                  conditional decision facts, not UI strings
  artifact-node.ts            Node-only hashing, canonical files and verification
  adapters/                   turn-v1 and river-v3 reduction mappings
  fixtures/                   versioned development and held-out audit scenarios
scripts/
  profile-postflop.ts          phase timings, work counts, memory, target-quality time
  solve-postflop.ts            preflight/solve/resume/grade CLI
  audit-postflop.ts            independent reductions and artifact reproduction
  build-postflop-catalog.ts    checked library manifest and browser slices
```

These paths and commands are proposed, not present APIs. Keep the new core free of
React, browser APIs, timers and Node filesystem dependencies. The offline runner owns
time/resource policy; later worker adapters own browser scheduling.

### 4.2 First fast implementation: public tree plus explicit compatible pairs

M1 prioritizes equivalence and inspectability over maximum scale:

1. Compile public betting histories, chip states and public-card branches into typed
   arrays. Store topology once, not once for every pair of private hands.
2. Store normalized compatible private pairs separately, with hand indices and weights.
3. Store regrets and average-strategy sums by **public history + acting player's hand**.
   Private pairs must not each receive a different strategy for the same information set.
   Omit structurally impossible hand/history combinations, but retain legal information
   sets that merely have zero reach under the current strategy.
4. Traverse legal pair/runout combinations with reusable work buffers. Cache showdown
   ranks outside the iteration loop; share immutable structural data where valid.
5. Add resumability without changing accumulation order or restarting the solver.
6. Grade small compiled results with the unchanged readable scorekeeper first.

For a turn board, the public union contains 48 candidate river cards. A fixed private
pair permits only 44. The compiler must not use the first private pair's 44-card deck
as the public deck for every other pair. Private-card-invalid branches are masked.

This cuts duplicated structures, but iteration work can still grow like compatible
pairs × public betting branches × legal runouts. It is a bridge, not the final scaling
solution. Report that limitation instead of interpreting smaller storage as faster solving.

### 4.3 Second implementation: hand-range-vector traversal

M2 removes avoidable pair-by-pair work at every public node:

- At a public node, carry each player's hand-indexed reach vector, its public-card mask,
  and the chance factors. Reach means the weight with which a hand arrives through the
  earlier actions, not a fresh independent guess about the range.
- For an action, multiply the acting player's vector by that hand's action probability.
- At a public-card edge, mask hands containing the card and account for the conditional
  chance probability exactly. Do not independently normalize both players' vectors.
- Aggregate opponent-weighted terminal values for all of a player's hands in batches.
- Back up those values through the public tree, updating one regret/average slot per
  hand and information set. Retain the joint compatibility constraint throughout.

The root distribution and public-history mass factor as:

```text
root(h0,h1) = w0(h0) * w1(h1) * compatible(h0,h1) / Z

mass(h0,h1,history) = root(h0,h1)
                    * player0_action_reach(h0,history)
                    * player1_action_reach(h1,history)
                    * legal_public_card_chance(history | h0,h1)
```

`Z` is computed once from the compatible root mass. The compatibility term never goes
away merely because we use two vectors. When a UI asks for a conditional range or
probability, sum the appropriate joint masses and then normalize that query's answer.
In the scalable backend, compute root normalization and compatible-deal counts using
card-incidence sums rather than requiring a materialized all-pairs list. Small explicit
lists remain the oracle. Preflight counts and memory bounds must not first allocate the
private-pair/runout tree whose allocation they are supposed to prevent.

Counterfactual regret uses chance and the **opponent's** action reach, excluding the
updating player's action reach. Preserve all root-hand/chance scale factors needed to
match the readable regret arrays. The average strategy uses the player's own reach
once per information set, with the specified iteration weight—not once per opponent
hand or future-card occurrence. Write these conventions into tests before optimizing.

### 4.4 Terminal kernels: remove the repeated quadratic inner loop

Keep a straightforward explicit-pair kernel as the differential oracle. Optimize in
this order:

1. **Folds:** for hero cards `a,b`, the compatible opposing weight is
   `total - weightContaining(a) - weightContaining(b) + weightOfExactCombo(a,b)`.
   The final term corrects double subtraction; it does not make the overlapping hand legal.
2. **Showdowns:** score each legal hand on a completed board once. Sort/group by exact
   rank, including ties. Sweep rank groups while maintaining total and per-card weighted
   sums. Query weaker/equal/stronger compatible opponent mass for each hero hand, applying
   the same blocker inclusion–exclusion correction within each rank region.
3. Combine those masses with the rules engine's win/tie/loss chip utilities. Return
   uncalled chips before awarding the contestable pot; no money formula is inferred
   from a displayed equity percentage.
4. Reuse bounded scratch buffers and cache immutable rank orderings by board/range
   fingerprint. Opponent reach weights change by action history, so weighted sums must
   be rebuilt for that history, not cached as though the opponent never acts.

The target is near-linear weighted terminal sweeps after rank ordering, rather than a
fresh all-pairs comparison per terminal. This is a proposed algorithmic improvement,
not a measured speed claim. Incompatible identical hands, tied ranks, asymmetric ranges
and zero weights must all agree with the naive kernel before enabling it by default.

Use 64-bit floating-point accumulation initially. Represent 52-card masks with two
32-bit words or explicit card indices; JavaScript's single-word bitwise operators do
not safely encode the whole deck. Precision compression is deferred.

### 4.5 Independent grading must scale too

Build a separate public-tree/hand-vector profile evaluator and best-response pass.
It may share immutable rules, hand ranks and validated terminal primitives, but not
regrets, the solver's asserted quality, or its traversal/update implementation.

- At the responding player's node, combine hidden-opponent possibilities before
  selecting one action for the player's hand and observable history.
- At an opponent node, follow that opponent's fixed strategy.
- At a chance node, average legal outcomes with their actual weights.
- A turn choice is `max(action, sum(future outcomes))`, not a separate choice after
  peeking at each future river. Later decisions may depend on cards actually revealed.
- Use bounded depth-first/public-branch buffers, not arrays for every pair × public
  state. Record and enforce the grader's own workspace budget.
- Return profile values, both legal best-response values/gains, Nash gap, exploitability
  and the player's equilibrium-value interval. Reject non-finite output explicitly.

Cross-check against the old scorekeeper, naive pair grading, exhaustive pure policies
on reduced games, and deliberate hidden-card/future-card cheating tests. This gives
multiple independent failure detectors without claiming the whole stack is external.

## 5. Poker rules and mathematical safeguards

### Chance and information

- Turn: 44 rivers per fixed legal private deal, each with probability `1/44`.
- Flop: 45 turns and then 44 rivers per fixed legal private deal: 1,980 ordered runouts.
  The public union has 49 candidate turns and then 48 candidate rivers; private blockers
  remove invalid edges. Do not assign uniform `1/49` or `1/48` as the joint-deal chance law.
- Public-card probabilities conditional on an action history are derived from reached
  compatible hands. They need not be uniform after the hidden ranges are integrated out.
- Keep card masks, root chance, past chance reach and future chance expectations distinct
  so a chance factor is neither omitted nor multiplied twice.
- All-ins enumerate the remaining cards but introduce no later betting choices.
- Do not merge ordered flop runouts when betting occurs between the two cards.
- Information keys contain own hand, visible board and the full remembered action history,
  never the opponent's hand, a future card, an internal private-deal ID or a future label.

### Betting expansion, after arithmetic equivalence

M3 defines a new rules version rather than editing turn v1:

- First support up to three opening targets and three raise-to targets per street,
  with zero or one raise after the opening bet. Then test up to two raises as a separate
  locked expansion. More menu entries are not an initial success requirement.
- Amounts are whole chip units and raise targets mean **total contribution on the current
  street**, not total contribution across the hand. Reset the street counter, not stacks
  or total contributions, at a new public card.
- Permit an explicit all-in option. Skip ordinary menu targets beyond the stack; never
  silently reinterpret an oversized normal target. Deduplicate identical legal targets.
  The maximum legal street target is current street contribution plus remaining stack;
  a call costs the smaller of the outstanding street difference and that remaining stack.
- Enforce minimum full raises, short all-ins, action reopening, no raising into an all-in
  opponent, capped calls, and returned unmatched money.
- The v1 adapter explicitly maps its old capped opening bet to the corresponding target
  at each state. Preserve that behavior when testing reductions; new menus do not alter it.
- Start with the same menu definition for either actor on a street. Asymmetric menus,
  percentages of pot and rounding conventions need later explicit schema versions.
- A UI percentage preset may only become available after a deterministic conversion to
  canonical integer targets is specified and displayed. There is no floating-point wager.

Preserve the current zero-sum utility convention: net chips relative to the declared
equal starting contributions, plus later payments/returns. Do not infer real preflop
profit or dead-blind ownership from a position label. A chip-unit metadata field can
express fractional big blinds without changing whole-chip core arithmetic.

### Algorithms

Ordinary simultaneous-update CFR is the equivalence mode. Freeze the strategy for the
iteration, aggregate all required regret changes, then apply them. Match the reference's
own-reach averaging and deterministic action/hand ordering.

Only after equivalence, add separately versioned alternating CFR+ with an explicit
player-update order, zero-floor regrets, averaging delay and linear averaging schedule.
Reuse the already documented river convention where applicable, but test the two-street
implementation independently. DCFR, pruning, suit-isomorphism reduction and floating-point
compression are optional later experiments, not ingredients changed all at once.

Research basis: [original CFR](https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html)
and [CFR+](https://arxiv.org/abs/1407.5042). The release is graded from its saved strategy,
not accepted because a paper describes the algorithm or a regret total became small.

## 6. Execution, cancellation and saved results

### Proposed core API

Conceptual interfaces; precise types are locked in M0/M1 before coding:

```text
preflightPostflop(request, limits) -> counts + memory estimate + warnings/refusal
compilePostflop(request, preflight) -> immutable compiled game
createPostflopSession(game, options) -> resumable workspace
session.advance(workBudget) -> completed-iteration/work counters
session.snapshot() -> detached completed strategy snapshot
session.checkpoint() -> versioned restartable state at an iteration boundary
restorePostflopSession(game, checkpoint) -> validated continuation
gradePostflopStrategy(game, snapshot) -> independent quality report
inspectPostflopDecision(game, snapshot, decisionKey) -> conditional facts
```

One snapshot is tied to one game fingerprint and completed iteration. A saved average
policy is not a resumable checkpoint: restarting needs regrets, strategy sums, iteration
number, algorithm/averaging settings and backend version. Keep the two formats distinct.

The Node runner owns a worker thread/child process so the controller can receive cancel
requests even if one iteration is long. Start with iteration-boundary checkpoints. A
hard cancel may terminate the process and retain the last complete checkpoint; do not
advertise instant graceful continuation from a partially applied iteration. If later
work-sliced inner iterations are necessary, freeze strategy and hold pending deltas until
the whole iteration completes. Never apply a partial update or restart for an animation.

Progress reports stages separately: validation, compilation, solving, grading, export.
Report elapsed time, completed iterations, actual work counts and the last grade with
its iteration number. Percent-of-iteration-budget is not percent-of-accuracy. A requested
quality target is checked at explicit checkpoints and at completion; it need not improve
monotonically. Exhausting time/iterations without meeting it yields an incomplete result,
not a passed artifact. Grading and snapshot/export allocations count against budgets.

### Artifacts and the offline-first library

Keep a complete research artifact/checkpoint locally and generate separate browser
presentation slices. Do not import all full policies into a Next.js client bundle.

Required metadata:

- Canonical board, weighted physical ranges, accounting convention, stacks, action menus,
  supported streets, card/rules version, and game fingerprint.
- Algorithm/backend version, precision, iterations, averaging settings and checkpoints.
- Complete average policy or content-addressed policy chunks; public action/card ordering.
- Profile values, both deviation gains, Nash gap, exploitability convention and units.
- Acceptance result, limitations, range/preset provenance and independent audit evidence.
- Hashes for canonical data, manifests and chunks. Timing/environment observations live
  in a separate run report so wall-clock time does not break result reproduction.

Byte reproduction is required within the pinned backend/runtime contract. A future
native backend gets numerical parity tests and a different backend identity; do not
demand identical bytes from a differently ordered floating-point implementation.

Catalog generation validates every source artifact, derives small per-board/history
inspection chunks, and refuses missing/corrupt/mismatched data. Cached results are reused
only for identical canonical game and solver identities. Changing a range, stack or menu
invalidates that result. Unknown boards or out-of-tree wagers remain unsupported; do not
silently substitute a nearby solve. Large catalog hosting or storage changes require a
separate capacity/cost decision before publishing.

## 7. Quality gates and resource budgets

### Numerical and strategy quality

1. Preserve all existing fixture limits, strategies and artifact bytes. In particular,
   turn v1 retains its existing 0.10-chip acceptance gate; this plan does not weaken it.
2. For newly published wider games, initial project gate: exploitability no greater than
   **0.25% of the starting pot**, with **0.10% preferred**. These are chosen project targets,
   not measured results or an assertion of agreement with Griffin. Lock each fixture's
   exact threshold and maximum run budget before its first acceptance solve.
3. Report chips and `100 * exploitability / startingPot`; exploitability is half the sum
   of both best-response gains. Also show each gain. Never call percent of pot “percentage
   accuracy,” or confuse it with percentage-point frequency error or sampling uncertainty.
4. A globally small exploitability does not bound every rare decision's action-EV error.
   Inspection must show reach/rare-state warnings and refuse undefined conditional values.
5. A result is approximate for its finite game. Small solver error does not measure error
   from missing bet sizes, assumed ranges, absent rake or unsupported real-game history.

Initial differential tolerances, to be locked before running new acceptance fixtures:

- Exact equality for legal actions, information grouping, card counts and discrete money
  rules; finite checks precede every numeric comparison.
- Probability normalization within `1e-12`; payoff/evaluation comparisons use absolute
  tolerance `1e-10 * S`, where `S = max(1, maximum absolute legal terminal utility)`.
- Same-algorithm short-run regret/strategy-sum comparisons at iterations 1, 2, 10 and 100:
  document one fixed scale-aware tolerance, starting at `1e-9 * max(1, iterations * S)`
  for accumulated chip quantities and `1e-9` for normalized probabilities. Review any
  mismatch; do not just widen the tolerance until tests pass.
- Long-run solvers/algorithms may mix differently at near-tied actions. Compare legal
  policy validity, independently graded values, deviation gains and value intervals,
  not just matching percentages. Exact iteration parity remains required where the
  backend and arithmetic order are intentionally unchanged.

### Conservative initial offline envelope

These are **planned guardrails**, not already supported capacities or speed promises.
M0 will measure actual hardware/runtime and lock a machine-specific benchmark manifest.
Physical-memory discovery was unavailable in the planning sandbox; do not assume a RAM size.

| Use | Initial envelope | Behavior at the boundary |
|---|---|---|
| Existing browser river work | Keep current 100,000-state teaching limit | No increase as a side effect of offline work |
| New offline development solve | One job; up to 2 GiB estimated total peak, 10 minutes wall time, 100,000 iterations | Refuse compilation or stop incomplete; preserve last completed checkpoint |
| Process headroom | Use the smaller of the project cap and a conservative measured available-memory budget | If memory is unknown, require explicit runner configuration for wide cases; tiny references still run |
| Regular CI | Tiny parity fixtures and one bounded accepted reproduction | Broad profiling belongs in explicit extended jobs, not every browser test |
| Initial saved web catalog | Small manifest, per-scenario lazy chunks; target no more than 5 MiB compressed for the first selected scenario and 100 MiB for the initial catalog | Measure decompressed/parser memory too; reduce slices or stop publication, never truncate the mathematical policy silently |

Count immutable arrays, action slots, range masks/rank caches, solver scratch, independent
grader scratch, snapshots, checkpoint serialization and temporary copies. Do not report
structural typed arrays as total RAM. Use conservative preflight bounds before allocation,
then sample process peak RSS during real runs and calibrate the estimate with headroom.
An in-process RSS observation is not an OS-enforced cap; keep jobs isolated and let the
controller terminate them if they exceed the envelope.

Benchmark range ladders are 8, 16, 32, 64, 128 and 256 unblocked physical combinations
per side, followed by representative nonuniform/asymmetric ranges with several hundred
combinations if earlier levels pass. These are probe sizes, not admission guarantees.
The first wider-range acceptance target is **64 combinations per player with at least
2,000 compatible private deals**, not merely a larger input whose blockers leave a tiny
game. Hundreds of combinations per side are the next scale target, not a current promise.
Count actual compatible deals and legal public work; early rejection is an expected result.
Resource or rule expansion beyond this envelope gets a documented decision, not a changed
constant hidden inside a performance patch. No paid cloud/GPU purchase is authorized here.

Measure compile, iteration, grade, export and end-to-end time to a fixed quality target.
Record CPU/runtime, warmup, repetitions, median/tail times, memory and fixture hash; avoid
concurrent heavy benchmarks. Profile no-raise and richer-menu cases separately.
Prospective goals: M1 materially lower peak storage than repeated trees; M2 at least a
3× kernel/grade speedup on a locked wider fixture and an improved end-to-end time to the
same quality. They are engineering targets to test, not claims. If missed, report the
result and inspect the bottleneck before adding another dimension.

## 8. Milestone implementation plan

Each milestone gets a small contract before code, a scoped implementation, tests and
an audit record. Update this table with the commit/evidence only after completion.

| Milestone | Deliverable | Exit gate | Status |
|---|---|---|---|
| M0 | Baselines, benchmark matrix, locked v1-equivalence and resource contract | Reproduced references; exact counts and numeric/resource gates recorded | Complete; compact turn audit |
| M1 | Compact resumable turn engine for unchanged v1 rules | Same transitions, information sets, ordinary-CFR updates and independent grade | Complete; compact turn audit |
| M2 | Range-vector terminal/traversal engine and scalable scorekeeper | Naive/readable/exhaustive parity; wider-range profile within envelope | Complete; vector turn audit |
| M3 | Configurable richer turn/river betting and accepted wider examples | Rule reductions, short-all-in audit, independent quality gate | Complete; configurable turn-v2 audit |
| M4 | Minimal saved-turn explorer and artifact pipeline | Genuine engine result navigable; conditional semantics and accessibility tested | Complete; saved turn explorer audit |
| M5 | Bounded joint flop/turn/river engine | No future-card cheating; exact runouts, reductions and accepted flop fixture | Not started |
| M6 | Curated postflop library and broader explorer | Every published scenario reproducible, graded, documented and load-budgeted | Not started |
| M7 | Optional native/parallel/symmetry acceleration | Profile justifies it; numerical parity and resource gains demonstrated | Deferred/conditional |

M4 is a thin usability checkpoint, not a detour into a separate curriculum. M5's engine
design can follow M3 without waiting for extensive UI polish. M7 may move earlier only
if profiling shows it is needed for an explicitly chosen M3/M5 target.

### M0 — establish the baseline and lock the experiment

- Read `AGENTS.md`, relevant local Next.js guides, source contracts and current Git state.
- Reproduce accepted turn/river fixtures; record fresh counts, grades and environment.
- Profile the turn reference by stage, including tree indexing/compilation and grading,
  not only CFR. Include uneven weights, shared-card blockers, ties and unequal stacks.
- Define the first equivalence fixture matrix and anticipated wider-range ladder. Fix
  request hashes, tolerances, quality targets and time/memory envelopes before solving.
- Specify canonical public node IDs, private-hand coordinates, chance masks and the
  mapping to existing information keys. Validate the mapping on paper and in count tests.
- Define exact preflight fields and negative-input behavior; estimate before allocating.
- Write `tasks/compact-turn-engine-spec.md` and the first benchmark manifest.

**Done when:** the next implementation has a falsifiable contract and baseline report.
No new UI or new betting rules are part of M0.

### M1 — compact, correct, resumable turn solving

- Implement only v1-equivalent no-raise turn rules in the new compilation path.
- Compile public action/chance arrays and exact private-pair indices; prove that the
  topology is not derived from hidden cards or one representative river deck.
- Add ordinary CFR with a deterministic resumable workspace; snapshot and resume cannot
  alter results. Keep float64 state and retain the old implementation unchanged.
- Differential-test full iteration state on small games, not just final displayed EV.
- Use readable independent grading for bounded acceptance; add a naive streamed grading
  reference as needed without removing exhaustive/reference checks.
- Add separately named CFR+ only after ordinary parity, with recorded update/average rules.
- Implement CLI preflight, progress, stop reasons and cancellation between safe checkpoints.
- Measure total working storage and runtime against the baseline.

**Done when:** an optimized path reproduces the same bounded game with no loss of hidden
information correctness; the accepted old artifact still reproduces untouched.

### M2 — widen ranges by changing computation, not merely caps

- Implement per-card compatibility sums and rank-group terminal kernels alongside the
  explicit-pair oracle. Test both players, ties, duplicate/overlapping combinations and
  concentrated/asymmetric weights with seeded generated cases.
- Add vector reach/value propagation and independently implemented vector best response.
- Remove repeated private-pair/public-state grading workspaces from the scalable path.
- Add bounds for hand/action slots and integer indices; reject numeric/count overflow.
- Compare small-game trajectories to M1; compare random complete policies and grades to
  naive/readable scorekeepers; run positive hidden-information cheating regressions.
- Profile the range ladder, then publish only the demonstrated offline admission envelope.
- Add complete iteration-boundary checkpoint/restore tests and typed-array serialization
  checks, including corrupted/wrong-game checkpoints and interrupted output writes.

**Done when:** at least one fixture with 64 combinations per player and at least 2,000
compatible deals is accepted within the locked resource and quality budgets, with the
same independent correctness evidence. Fix its exact ranges/board in M0. If the target
does not fit, report M2 as incomplete and profile it rather than silently shrinking it.
A faster terminal microbenchmark alone is not this milestone.

### M3 — richer turn/river rules and practical examples

- Lock turn v2 rules and bounded menus before solving; introduce raises separately from
  the range-vector implementation so failures have a smaller search space.
- Enumerate all tiny-game betting lines with an independent money replay. Test minimum
  raises, short all-ins, no raising into all-in, street resets and unmatched chip returns.
- Reduce single-size/no-raise requests to v1. Reduce completed-turn river continuations
  to compatible river-v3 games, accounting for carried money and action histories.
- Create a small corpus covering dry, paired, two-tone and draw-heavy boards, stronger
  versus wider ranges, and unequal stack depth. Range presets must have named provenance
  and explicit assumptions, not an unsupported “GTO preflop range” label.
- Seek a compatible external numerical reference for a specified game. Match cards,
  weights, money, menus, utility offsets and grading convention before comparing. If no
  compatible referee is available, record that limitation; never force false agreement.
- Freeze held-out rule/grade cases before tuning performance. No learned-generalization
  claim follows from passing this corpus.

**Done when:** a user can run an audited custom turn-and-river solve with meaningfully
broader ranges and a useful, explicitly limited bet/raise menu. The first accepted
examples meet the published quality gate, not just a fixed iteration count. Include an
acceptance fixture with at least 64 combinations per player, two opening sizes per
street and a legal raise branch on each street; lock its actual targets before solving.

### M4 — a minimal saved-turn explorer

- Add a separate route such as `/solver/postflop`, retaining `/solver/lab` and
  `/solver/river`. Read the installed Next.js guides again when implementing it.
- Load an instant saved example. Show selected input assumptions, solve quality and all
  unsupported dimensions. Start with saved/offline results, not a new wide browser solver.
- Let users inspect a hand/history, follow legal actions and reveal an available river.
- Derive action frequency, forced-action EV under the saved continuation policy, EV
  differences, immediate opposing responses, folds and posterior ranges consistently.
- Distinguish static check-down equity from showdown equity conditioned on subsequent
  play. Neither replaces action EV, which includes folds, prices and later betting.
- Use joint reaches for range-grid aggregation; do not average all hand cells equally.
- An unreachable decision has undefined conditional facts, not invented zero EVs.
  A low-reach decision gets a separate caution from whole-game exploitability.
- Keep source policies and heavy explanation work out of initial bundles and the UI
  thread. Load validated chunks; only add a browser worker for genuinely needed work.
- Follow baseline-ui and fixing-accessibility at implementation: native controls,
  associated errors, visible focus, non-color-only action encoding, accessible grid/list
  alternatives, no forced animation, and keyboard navigation that preserves focus.
- Use route-specific CSS. Test 320/390/1280 widths, 200% zoom and long values; inspect
  internal clipping as well as document overflow. Do not call screenshots a full a11y audit.

**Done when:** the engine upgrade is useful to inspect without representing the existing
tiny demonstration as a new scale breakthrough. Custom browser turn solving is optional
and needs its own measured work limit; the old river cap is not a two-street safety proof.

### M5 — bounded flop-to-river solving

- Begin with a new tiny readable flop reference and a single-size/no-raise three-street
  contract before expanding the scalable path. Do not copy terminal-stage shortcuts that
  assume no more cards can arrive.
- Enumerate both future cards jointly with all intervening decisions. Preserve full
  public history and each player's private hand throughout the three streets.
- Reduce fixed flop-action/turn-card continuations to the audited turn rules. Test
  all-in runouts, folds before future cards, draw completion and paired-board ties.
- Extend the independent scorekeeper and cheating regressions to both future cards.
- Gradually apply M2's range-vector kernels, then M3-style menus within a newly profiled
  budget. Large flop topology/action-slot growth may remain the dominant constraint.
- First acceptance is one fully specified starting matchup on a selected flop, followed
  by a small diverse board set. Wider ranges and richer trees are successive benchmarks,
  not simultaneous assumptions.
- After the tiny correctness acceptance, target a single-size/no-raise flop example with
  at least 64 combinations per side under the profiled envelope. Track this scale target
  separately from the proof; it may require the conditional M7 work or a scope decision.

**Done when:** at least one complete flop/turn/river finite game has a reproducible policy,
independent legal best-response grade and a stated resource/quality result. A collection
of independently solved turns averaged together does not qualify.

### M6 — grow the saved library and explorer

- Start with roughly 6–12 chosen scenarios only if M3/M5 budgets support them. Include
  different board textures and range/stack relationships; a target count is not a quality gate.
- Build a deterministic local job queue with one active solve by default, resumability,
  content-addressed cache keys and a manifest of successes, failures and incomplete runs.
- Validate complete source artifacts before generating browser-facing fact/policy slices.
  Preserve source hashes and show the grade attached to exactly the displayed strategy.
- Add position/board filters, range grids with exact-combo drilldown, action navigation,
  stable shareable scenario/history IDs, downloadable inputs, and quality/assumption panels.
- Expand accepted boards, then formations and menus based on measured cost and usefulness.
  Do not pretend a saved catalog answers arbitrary custom boards or unsupported actions.
- Measure compressed transfer, decompressed memory, parse time and cache invalidation on
  mobile as well as desktop. Keep source research artifacts out of the default web download.

**Done when:** the app exposes a credible, audited collection of three-street heads-up
solutions with instant browsing, without requiring a GPU or a neural training pipeline.
This is a capability target, not a claim to have matched Griffin's hidden implementation.
If only tiny flop proofs fit, publish them as reference examples; do not mark the
practical-range library goal complete. Include M5's wider flop scale evidence before
describing the catalog as a practical postflop range explorer.

### M7 — acceleration only when the profile justifies it

Priority order: allocation/cache fixes; algorithmic terminal/grade improvements; exact
symmetry where provable; deterministic parallel batches; then a native Rust/WASM backend.

- Suit symmetry is valid only when the weighted ranges, board and rules are invariant
  under the mapping; asymmetrically weighted suits must not be merged incorrectly.
- Parallel workers consume frozen strategy snapshots and return deltas. Aggregate in a
  specified deterministic order; do not update shared regrets as racing tasks finish.
- A native backend is an additive library/CLI with the same normalized request/artifact
  contracts and its own backend identity. Keep TypeScript as the executable oracle.
- Require license/dependency review before adding packages; no AGPL source transplant.
- Compare accuracy and end-to-end time including data conversion and grading, not only
  a fast kernel. Keep full quality gates even if generation becomes much faster.

If M5 cannot fit without sampling/bucketing/learned leaves, stop that expansion and
propose a new mathematical contract. Those techniques change the evidence required and
are not silently authorized by a desire to “go as far as possible.”

## 9. Pros, cons and mitigations

| Choice | Advantages | Disadvantages / failure risk | Mitigation and evidence |
|---|---|---|---|
| CPU-first, no neural model | No training corpus or model lifecycle; transparent rules and grade | New scenarios still cost real compute; no automatic generalization | Offline queue/cache; modest menus; publish measured solve times; unsupported cases remain explicit |
| Preserve readable references | Strong regression oracles and an inspectable portfolio story | Two paths to maintain | Additive modules and canonical adapters; differential CI; never delete the oracle for speed |
| Compact public tree | Much less duplicated structure | Pair × runout arithmetic can still dominate | Treat M1 as an equivalence step; measure full RSS/time; M2 changes the expensive calculation |
| Range vectors and rank sweeps | Avoid repeated all-pairs terminal work; improve grading too | Subtle blocker, chance and normalization bugs | Naive kernels, probability-mass checks, random-policy comparisons, all-terminal audits and cheating tests |
| Exact card enumeration | No Monte Carlo error in game values/grade | Flop chance expansion and policy storage remain large | Bounded ranges/menus, lazy public-branch work, measured refusal; symmetry only after a proof/test contract |
| Finite bet menus | Tractable game with explicit legal actions | The best omitted size may matter | Display menus; compare refinements as new games; never describe abstraction error as measured exploitability |
| CFR+ after ordinary parity | Practical convergence candidate already used in the project | Update/averaging mistakes; non-monotone quality | Version each convention; test update order; grade the saved average independently at checkpoints |
| Independent scorekeeper | Defensible quality instead of an internal training metric | Can be as expensive as solving; some shared primitives remain | Streaming/vector grader, separate budgets and traversal, slow money/evaluator oracles and external comparison where compatible |
| Fixed illustrative ranges | Makes scenarios reproducible and easy to inspect | Wrong real-world ranges can dominate the answer | Provenance and assumptions; range sensitivity cases; no “universal recommendation” label |
| Offline saved library | Instant UI and no production solve server | Finite coverage, stale caches, large files | Canonical hashes, versioned manifests, lazy slices, no nearest-scenario substitution |
| Native/parallel optimization later | Potential larger jobs without changing the game | Porting cost, nondeterminism, licensing and maintenance | Profile gate; additive backend; deterministic reductions; numerical parity and pinned dependencies |
| Engine-first sequencing | Increases actual capability before polish | Progress can be invisible to a casual visitor | Every milestone ships a reproducible report/example; M4 supplies a thin explorer before a large curriculum |
| Explicit quality/budget gates | Honest, repeatable acceptance | Some promising runs fail or cannot be published | Preserve incomplete results for research; report failures; do not weaken a gate after seeing the answer |

No single optimization makes unrestricted NLHE tractable. The combined benefit is a
controlled route to useful finite postflop games, with a defensible answer at every stage.

## 10. Verification and release procedure

### Mathematical tests

- Parsing/weights/blockers: board collisions, overlapping holes, impossible distributions,
  extreme weights, scale invariance, zero-mass rejection and normalization underflow.
- Public tree: no hidden-hand-dependent actions, full histories, exact chance counts and
  mass, legal short-stack actions, street reset and terminal money conservation.
- Kernel parity: naive versus optimized fold/showdown vectors for both players, weighted
  ties, all-identical board outcomes, asymmetric hands and randomized complete policies.
- Solver parity: freeze/update/average conventions, chunk-boundary invariance, repeated
  runs, checkpoint resume, complete finite strategies and malformed-policy rejection.
- Grading: exhaustive reduced best responses, readable/vector agreement, deliberate
  opponent-card and future-card cheating, no ability to select hidden-state-specific actions.
- Reduction: existing turn v1 and river v3 rules/utilities; tiny flop to turn; no assumption
  that solving conditional subgames independently reproduces the original whole-game policy.
- Metamorphic checks: player/range relabeling with correctly mapped action order and sign,
  suit relabeling, common range-weight rescaling, and input permutation canonicalization.
- Inspector facts: conditional action values versus explicit terminal walks, reached
  posterior weights, fold responses and off-path/rare-decision handling.
- Artifact/checkpoint mutation: altered rules/actions/probabilities/NaNs, wrong game,
  truncated chunks, unsupported schema/version, resource-limit bypass and stale grade.

### Integration and product checks

CLI validation/refusal, time limit, cancellation during compile/solve/grade/export,
partial-write recovery, real elapsed/iteration reporting and deterministic checkpoint
continuation. Worker adapters must reject stale request IDs, preserve completed results
on a later failure and never fall back to a large synchronous main-thread solve.

At the UI milestone, use production-build Playwright for keyboard/validation/cancellation,
saved scenario navigation, lazy-load failures and stale responses. Retain all current
Leduc/River/trainer regressions. Include responsive screenshots, internal clipping and
zoom checks, and manual screen-reader review. Broaden beyond Chromium when the runner
supports it; report untested browsers/assistive technologies rather than imply coverage.

### Existing commands to preserve and run as appropriate

```sh
npm test
npm run typecheck
npm run lint
npm run audit:math
npm run audit:kuhn
npm run audit:leduc
npm run audit:turn
npm run audit:river
npm run audit:river:v2
npm run audit:river:compact
npm run audit:river:scorekeeper
npm run audit:river:factorized
npm run audit:river:v3
npm run audit:river:exchange
npm run audit:multiway-river
npm run audit:multiway-raised-river
npm run audit:multiway-two-size-river
npm run audit:multiway-side-pot-river
npm run audit:multiway-four-player-river
npm run profile:river:factorized
npm run build
npm run test:e2e
```

Use focused tests while developing; run the relevant full release matrix before calling
a milestone complete. Heavy exhaustive/profile suites can live in explicit extended CI
jobs, while normal CI retains bounded math and artifact gates. Add new postflop commands
only when implemented. Record actual commands/results, runtime and environment in audits.

### Preserve local work and keep releases reproducible

At this plan's baseline, unrelated dirty work exists in `METHODOLOGY.md`, `README.md`,
`e2e/keyboard.spec.ts`, `src/app/globals.css`, `src/components/PokerSim.tsx`,
`test/copy.test.ts`, `src/lib/poker/session.ts` and `test/session.test.ts`. Reinspect Git
each session; this is not a permanent allowlist of files safe to overwrite.

- Prefer isolated new modules and route CSS over edits to these dirty files.
- Use `apply_patch`, never revert/reset unrelated work, and do not stage whole dirty
  files when only an owned hunk is intended. Review clean candidates when overlap is unavoidable.
- Use explicit staging lists and inspect the index before any authorized milestone commit.
- Validate the exact staged release without uncommitted features; also verify compatibility
  in the working tree. Different test totals must be explained, not silently dropped.
- Commit/push completed milestones only within the user's active authorization. A planning
  request does not start long solves, buy compute, install a native toolchain or deploy a service.

## 11. Stop conditions and honest fallback

Stop the affected expansion and diagnose if any reference changes unexpectedly, private
information leaks into a policy/grade, chance mass is wrong, a payout is unexplained,
or independent values disagree beyond the locked tolerance. Do not compensate with more
iterations, a broader tolerance or a weaker acceptance target.

For ordinary performance failure, preserve the working smaller milestone and profile it.
Reject the oversized request; report what fit. Ask for a scope decision if progress needs
materially different assumptions, a resource-budget expansion, third-party licensed code,
paid infrastructure or a new sampling/abstraction contract. Lack of an external referee
is a disclosed evidence limitation, not permission to claim external parity.

If the preferred full-range flop path proves too expensive locally, the honest fallback
is a smaller, well-audited saved library and a useful turn solver—not a “full GTO” label
on a different approximation. More compute remains an option, not a hidden requirement.

## 12. Execution record and next-session checklist

### Current record

- [x] Inspect baseline architecture, history, active roadmap and local Next.js guidance.
- [x] Save this CPU-first implementation plan and link it from the roadmap.
- [x] M0: baseline profile and locked compact-turn contract.
- [x] M1: compact v1-equivalent turn engine.
- [x] M2: wider-range vector engine and scalable independent grader.
- [x] M3: richer turn/river betting and accepted practical examples.
- [x] M4: minimal saved-turn explorer.
- [ ] M5: joint flop/turn/river reference and scalable implementation.
- [ ] M6: curated solution library and broader explorer.
- [ ] M7: conditional acceleration, only if justified.

**M0/M1 execution, 2026-09-22:** See [locked contract](compact-turn-engine-spec.md)
and [release audit](compact-turn-engine-audit.md) for request/rules/policy hashes, complete
reference parity, CLI cancellation, tests and profiling. No old solver source or artifact
changed. Full ordinary-CFR policy matches the old artifact exactly. Structural typed storage
on the 16-deal boundary fell from 977,650 to 88,685 bytes; solve workspaces from 926,248 to
201,888 bytes. Total RSS was roughly unchanged with the readable grader and shared-tree
iterations were slower than repeated compact. This is a correctness/storage foundation,
not an accepted wider-range solver. Full restartable disk checkpoints remain M2 work.

**M2 execution, 2026-09-23:** See [locked contract](vector-turn-engine-spec.md) and
[release audit](vector-turn-engine-audit.md). The unchanged 64-by-64 probe (3,773 compatible
deals) passes at the first scheduled checkpoint: 256 CFR+ iterations, delay 20,
exploitability 0.026707309503037013 chips, below the 0.25-chip gate. The full policy is
reproducible on Node 20/24. The first accepted run took 3.344 seconds including worker
compile/grade/export, with 295.2 MiB sampled peak worker RSS. There are 1,305 public states
and 35,584 information sets, representing 4,516,282 equivalent repeated states without
allocating that tree. Full checksummed iteration-boundary disk checkpoints can resume
bit-identically at the same iteration. A separate vector grader and explicit-pair kernels
agree; hidden-hand/future-card cheating tests remain. Existing engines/artifacts are unchanged.
This is wider **synthetic-range** turn solving, not full-range or arbitrary-bet-size NLHE.

**M3 execution, 2026-09-23:** See [locked contract](configurable-turn-v2-spec.md),
[pre-solve input hashes](configurable-turn-v2-input-hashes.json) and
[release audit](configurable-turn-v2-audit.md). Turn-v2 adds three opening targets,
three raise targets, optional all-in and one raise per street with immediate refunds
and street-specific amounts. All five locked examples pass at the first scheduled
checkpoint (256 CFR+, delay 20), including 64-by-64 ranges, two openings and legal raises
on both streets: 6,699 public states, 147,840 information sets, 23,177,540 equivalent
states, exploitability 0.033587175026543514 chips. First accepted run: 17.082 seconds,
607.6 MiB sampled worker RSS, 802.2 MiB sampled combined RSS. The shared numeric engine
is action-generic without changing arithmetic; the complete M2 artifact still reproduces.
The separate M3 budget is 2 GiB within this plan's envelope; M2 remains 1 GiB. No UI,
flop solver, training dependency or external numerical validation claim was added.

**M4 execution, 2026-09-23:** See [locked contract](saved-turn-explorer-spec.md) and
[release audit](saved-turn-explorer-audit.md). `/solver/postflop` navigates every public
history and compatible acting hand in two accepted M3 examples, including river cards,
raises, all-ins and refunds. Forced-action values, selected-showdown versus static equity,
responses and conditional ranges have independent repeated-state checks. Public previews
and range mixes use joint reaches; off-path and numerically tiny facts remain unavailable.
The examples still have three handcrafted combinations/player, not new range capacity.
Full source policies stay offline. The 98 derived chunks total 22,475,685 raw bytes;
the default turn slice is 98,046 bytes and largest lazy chunk 286,249 bytes. Catalog and
chunks reproduce on Node 20/24; gzip measurements stay outside canonical identity.
Clean release: 623 unit tests, 47 Chromium tests, type-check, lint and production build
passed. This adds 11 unit and 12 browser tests; old source engines/artifacts are unchanged.
Native controls, explicit focus handling and route-only CSS preserve the existing labs.
No browser turn solve, flop engine, GPU or external numerical parity claim was added.

**Next implementation session:** lock the tiny M5 flop reference contract before code.
Start with one opening size per street and no raises, exact enumeration of both future
cards, complete public history, tiny explicit weighted ranges and independent settlement
and legal best-response grading. Lock fixture hashes, quality gates and resource budgets
before acceptance solves. Prove reductions to the existing turn rules, all-in runouts,
folds before later cards, and cheating regressions for both hidden future cards. Solve
all three streets jointly; averaging independently solved turns does not qualify.
Keep the readable proof separate from M5's later wider-range scale target. Preserve all
accepted engines/artifacts, browser limits and unrelated trainer work. No automatic
sampling, card buckets, neural leaves, GPU, licensing change or paid compute is implied.

At the end of each milestone add:

```text
Milestone / status / date:
Request, rules and benchmark hashes:
Changed files and commit (if committed):
Correctness and independent-grade evidence:
Measured range/tree capacity, time and peak memory:
Quality target, actual grade and stop reason:
Tests/artifact reproductions and exact commands:
Known limitations, deviations and approvals:
Next bounded task:
```

The roadmap is the project entry point; this file controls the active CPU-first sequence.
Older “next: turn teaching lesson” statements remain historical release context. The
multiway plan retains its own stages and is not completed by this heads-up work.

## 13. Reference notes

- Existing project contracts/audits linked above are the executable compatibility targets.
- [CFR paper](https://papers.nips.cc/paper_files/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html)
  and [CFR+ paper](https://arxiv.org/abs/1407.5042) describe the algorithm family. Our exact
  update order, averaging, units and result validation still require local specifications.
- [Pio's hardware documentation](https://piosolver.com/docs/faq/hardware/) is evidence
  that useful postflop solving can be CPU-based, not a performance or hardware promise
  for our code. Do not copy old hardware recommendations into this project's budgets.
- [Griffin's public app](https://fold-poker.gtarpenning.workers.dev/) and its manifest
  illustrate offline result delivery only. Its backend and the meaning of a reported
  comparison percentage remain unverified without the source/game comparison details.
- For future UI work, reread the installed Next.js guides, especially server/client
  boundaries, CSS Modules and production Playwright testing. The local boundary and
  Playwright guides were read during planning; do not assume their APIs stay unchanged.
