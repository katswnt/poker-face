# Poker Face

Poker Face combines a plain-language hold'em trainer with audited solver labs. The trainer
teaches poker fundamentals; the labs solve small, explicitly defined games and independently
measure how much each player could gain by changing strategy.

Live app: [pokerface.katswint.com](https://pokerface.katswint.com).
For a solver-first tour, open `/solver/flop` for six saved three-street games,
`/solver/postflop` for turn-to-river examples with raises, or
`/solver/river` for small custom river solves. `/drills` has timed poker-math practice.
Open these locally or on a deployment containing those routes.

## Current state

As of 2026-09-25, the configurable heads-up river solver v3, its dedicated browser lab,
a portable benchmark/strategy-grading CLI, guided one-change comparisons, and a bounded
**offline turn-and-river solver with configurable betting, a wider-range CPU backend, and disk checkpoints**, a **saved turn-and-river explorer**, a **bounded joint flop/turn/river CPU solver with a six-scenario saved library**, an **offline bridge to the external postflop-solver engine, checked by our own graders, with a saved 12-flop 100bb library**, and **timed poker-math drills** are implemented. The solvers are separate from
the heuristic four-player trainer.

| Experience | What is implemented | Important boundary |
|---|---|---|
| `/` — hold'em trainer | Observe or practice four-player hands, with worker-backed equity and price explanations | Heuristic strategy; exact heads-up river equity, sampled equity elsewhere; not an equilibrium solver |
| `/drills` — math drills | Timed one-question drills with exact answers, worked explanations and a browser-stored review queue | Heads-up, single-bet arithmetic; no implied odds, rake, ICM or solver-backed decisions |
| `/solver` — push/fold explorer | Instant precomputed heads-up shove-or-fold charts from an exact equity matrix, with card removal | Shove-or-fold abstraction only (chip EV, no antes); one frequency per hand class |
| `/solver/lab` — Leduc lab | Four lessons about mixing, value bets, bluffs, and bluff-catching | A six-card teaching game, not ordinary hold'em |
| `/solver/river` — River Solver Lab | Saved example, bounded custom solves, decision inspection, and one-change comparisons | Two players, known final board, explicit ranges and finite bet menu |
| `/solver/postflop` — turn & river explorer | Two instant saved examples, legal action navigation, river previews, hand values and conditional ranges | Three handcrafted combinations/player in these UI examples; no custom browser turn solve |
| `/solver/flop` — three-street explorer | Six saved games, both public-card transitions, exact-hand values, range groups, source-bound links and downloadable inputs | Five small teaching ranges plus one synthetic 64-by-64 example; one opening size/street, no raises or custom browser flop solve |
| Offline turn-and-river solver | Joint two-street solve, configurable betting, exact river enumeration, independent grading, restartable checkpoints | Up to 64 combinations/player, three opening sizes, three raise targets, optional all-in and one raise per street; custom solves remain offline |
| Offline flop/turn/river solver | All three streets solved together, exact ordered runouts, independent grading, binary restart checkpoints; sequential cached library generation | One capped opening size per street, no raises; up to 64 physical combinations/player |
| Offline postflop-solver bridge | Pinned external Rust engine behind a hashed JSON contract; small games re-graded node for node by our engines; a 100bb benchmark and a saved 12-flop button-vs-big-blind library | Heads-up, equal stacks, no rake, finite bet menus; hand-written ranges; large solves only spot-checked by our graders; no page uses it yet |

**Math drills (`/drills`).** Timed one-question drills for pot odds, minimum defence
frequency, polar bluff share, outs → equity, counting outs on a real flop, combo counting with
card removal, and call-or-fold. Answers are exact (formula or enumeration; unit tests check
each generator a second way, including the app's hand evaluator and full deck enumeration).
Explanations show the formula with your numbers and the at-table shortcut, and rules of thumb
are labelled approximate. Missed questions return through a Leitner review queue stored in
your browser. See the [drills spec](tasks/drills-spec.md).

The repository also contains a Kuhn reference solver and offline three- and four-player
river proofs, including separate raise, bet-size, and three-player side-pot experiments.
Those proofs are not a general multiway solver or the strategy behind the trainer.
See the [multiway plan and completed stages](tasks/multiway-nlhe-solver-plan.md).

**Exact game evaluation does not mean an exact equilibrium strategy.** The river engine
enumerates compatible hands and showdowns without Monte Carlo sampling. Saved-strategy
values and legal best responses are evaluated across the complete finite game, subject
to floating-point arithmetic. CFR+ produces an **approximate strategy for that specific
game**, not universal or exact GTO. Its remaining error is measured, not inferred from
training iterations or regret totals.

## What the River Solver Lab can do

- Accept a five-card board, two weighted ranges, pot, remaining stacks, opening bet sizes,
  raise-to amounts, and a raise limit. “Position” means who acts first and who acts second.
- Enforce whole-chip sizing, minimum raises, short all-ins, no raising into an all-in
  opponent, and returned uncalled chips. V3 permits up to five opening sizes, five raise
  targets, and two raises after the opening bet.
- Count compatible private deals and public states before solving. The work estimate is
  an approximate operation count, not a promised completion time.
- Run a resumable CFR+ session in a Web Worker, with completed iterations, elapsed time,
  independently measured exploitability, and cancellation. It does not restart training
  to animate a progress bar.
- Inspect a player's hand and decision history: action frequencies, action values and
  differences, opponent responses, fold probability, conditional showdown equity, and
  blocker-aware changes in the opponent's possible hands. Unreachable decisions are
  marked off path instead of receiving invented values.
- Pin a decision and change only the opponent range, opening bet menu, or opponent stack.
  Compare the same player, exact hand, and history, with frequency and chip-value changes,
  independent grades, and warnings for rare, off-path, or removed decisions. Both players
  adapt; this is not opponent locking. Changing the main form does not change the pin.
- Use native keyboard controls, visible focus, associated field errors, and layouts
  checked at phone and desktop widths and 200% text size.

**Limits:** river only; two players; no rake; equal prior contributions to an even starting
pot, though remaining stacks may differ. Only declared bet sizes are available. The
browser permits at most **100,000 equivalent repeated states and 2,000 iterations**.
A comparison requires both games together to fit the 100,000-state limit, reuses the
pinned result, and solves only the changed game with the same iteration count.
The script/library defaults allow up to 15,000 compatible deals and 1,000,000 equivalent
states, with at most 128 combinations per player's range. Bulk teaching data retains the
100,000-state cap. These are safety limits, not claims that every device finishes quickly.

“Equivalent repeated states” counts the full game as if the public betting tree were
copied for every private deal. The factorized engine stores that public tree once.
Cancellation yields between worker tasks; an individual preparation, grading, or teaching
operation must finish first. See the [lab specification](tasks/river-solver-lab-spec.md)
and [release audit, including known limits](tasks/river-solver-lab-audit.md).
The [comparison contract](tasks/river-comparison-spec.md) and
[comparison audit](tasks/river-comparison-audit.md) explain exact decision matching and
whole-game value bounds. Those bounds are not error bars for individual action values.

### Reproducible v3 example

The [locked fixture](src/lib/solver/river/configurable-v3/fixture.ts) uses board
`Ks 8s 4s 2c 9d`, ranges `AA AQs 76s` versus `JJ ATs 65s`, a 100-chip pot,
200 chips behind each player, opening bets of 50/100/200, raise-to targets of 100/150/200,
and at most two raises.

| Measurement | Checked-in result |
|---|---:|
| Compatible private deals | 176 |
| Public states / equivalent repeated states | 63 / 11,089 |
| Information sets / terminal states | 308 / 7,216 |
| CFR+ iterations / averaging delay | 1,000 / 20 |
| First player's value, from the hand's start | +16.081056725 chips |
| Best-response gains, first / second player | 0.014993444 / 0.003155818 chips |
| Exploitability | 0.009074631 chips per hand |

A best-response gain is how much one player could improve against the other player's
fixed saved strategy. For **two-player zero-sum games only**, this project's
`exploitability = (gain0 + gain1) / 2`. The multiway proofs instead report every player's
gain and the largest gain; they do not reuse that two-player convention.

Run `npm run audit:river:v3` to regenerate and compare the complete versioned, hashed
artifact without overwriting it. It also checks the independent money/showdown oracle
over all 7,216 terminal states. The [v3 audit](tasks/configurable-river-v3-audit.md)
records the hashes and evidence. This is one accepted fixture, not a quality guarantee
for arbitrary custom inputs.

The locked v3 demo now has an external match: postflop-solver, given the exact same tree
(checked node for node), reaches 0.0090 chips of exploitability, and our own grader agrees
with its self-report within 3e-7 chips (see the
[postflop-solver bridge](#external-engine-checked-by-our-own-graders-the-postflop-solver-bridge)).
The earlier pinned reference still cannot express v3's sizing rules. Other evidence includes
exact reduction to the externally checked v2 game, readable-solver comparisons, independent
grading, and hidden-card-cheating regressions. See the
[reference compatibility finding](tasks/configurable-river-v3-audit.md#independent-open-source-referee-attempted-not-forced).

### Saved turn & river explorer (M4)

Open `/solver/postflop` to follow an accepted joint turn/river strategy without solving
anything in the browser. Two small examples contrast an ace-high board with a paired board
and unequal stacks. Each includes every legal public history, every compatible acting
hand, and all available river cards—not just a curated winning line.

- Inspect action frequencies, forced-action chip values, value gaps, opponent responses,
  immediate folds, and how a response changes the opponent's possible hands.
- Keep **equity if betting stopped** separate from **equity among later showdowns**.
  Neither substitutes for action EV, which includes folds and later payments.
- Follow legal bets, raises, short all-ins, refunds, and the next card. River previews
  condition on public history with both hands unknown; inspecting one hand does not
  secretly fix a private deal for later navigation.
- Range summaries use joint reach weights, not equal-hand averages. Unreached or
  numerically unsupported decisions withhold conditional values; rare ones carry a
  separate caution. Global exploitability does not bound each local action-value error.
- Use native keyboard controls, visible focus, cancellation/retry for data loads, and
  phone layouts. This is saved-result loading, not solver progress.

The examples are graded at **0.052146088 chips** of exploitability (256 CFR+ iterations) and
**0.038681369 chips** (512 iterations; this spot was re-solved after bets above the
opponent's stack were collapsed into one action, which changed its tree). Both have three handcrafted combinations/player;
they are teaching assumptions, not recommended preflop ranges or a new capacity claim.
The wider 64-hand turn policy remains offline. This turn explorer itself introduces no
GPU, new strategy training, or custom wide browser solver; the separate flop engine below
is offline as well.

The full source policies stay out of the initial page and client bundle. The checked
manifest is 17,406 bytes; the default turn slice is 98,046 bytes. All 98 chunks have
reproducible sizes and SHA-256 hashes. Fetched chunks are checked in the browser; the
embedded first view is checked during artifact reproduction. The largest chunk is
286,249 bytes uncompressed. Together
they total 22,475,685 raw bytes, or 2,957,666 gzip bytes on Node 24 (compression varies by
runtime). The browser retains one active lazy
chunk plus the initial hydration slice, not the whole catalog. Size limits are not a
device-memory guarantee.

```sh
npm run audit:turn:explorer     # reproduce all derived chunks, without overwriting
npm run generate:turn:explorer # intentionally regenerate checked browser data
```

See the [explanation/data contract](tasks/saved-turn-explorer-spec.md) and
[release audit](tasks/saved-turn-explorer-audit.md) for conditional definitions,
independent evidence, accessibility checks and remaining limitations.

### Offline turn-and-river solving

The offline [turn contract](tasks/heads-up-turn-v1-spec.md) now starts with four board
cards and solves both remaining betting rounds together. It carries earlier actions and
blocker-compatible range weights forward; it does not solve each river independently and
average the answers. The future river card stays hidden during every turn decision.
All branches end in a fold or an enumerated showdown—there are no guessed leaf values.

The saved example uses `Ks 8s 4d 2c`, weighted ranges `AsQs:0.5 KdKh` versus `QsJs 9h9d:2`,
a 100-chip pot, 150-chip stacks, and turn/river bets of 50/100. Its 3 compatible private
deals have 132 deal–river pairs, 3,592 full states, and 1,088 information sets. After
16,384 **ordinary CFR** iterations (not CFR+), the first player's value is +50.012559646
chips, best-response gains are 0.008481882 / 0.020804423 chips, and exploitability is
**0.014643152 chips per hand**. This passes the pre-set 0.10-chip gate for this fixture.

```sh
npm run audit:turn  # reproduce the complete hashed result without overwriting it
npm run solve:turn  # deliberately regenerate the fixture artifact
```

The [release audit](tasks/heads-up-turn-v1-audit.md) records independent payout checks,
river-v3 reduction, exhaustive reduced-game best responses, and a regression showing
why peeking at the future card produces an illegal advantage. No external solver match is
claimed for this v1 fixture; one turn-v2 game is matched against postflop-solver (see below).
The reference caps ranges at 8 combinations each, 16 compatible
deals, 25,000 states, and 100,000 iterations. It is not wired into the River Lab or trainer.
This heads-up milestone does **not** complete the separate multiway turn stage.

The new [compact turn backend](tasks/compact-turn-engine-audit.md) reproduces the complete
saved ordinary-CFR policy exactly while storing the public tree once. It adds resumable
ordinary CFR and CFR+, genuine progress, cancellation, and hashed offline output. The
same tiny-range limits still apply; this is groundwork for wider solving, not wider solving yet.
On the 16-deal benchmark its structural typed arrays are about 91% smaller, but it is slower
than the older repeated-tree compact engine. Total process memory is roughly unchanged:
independent grading still builds a repeated tree. See the audit for measured costs and limits.

```sh
npm run audit:turn:compact
npm run solve:turn:compact -- --fixture demo --iterations 1000 --algorithm cfr-plus --delay 20
npm run profile:turn:compact
```

The solve command writes a complete JSON result to stdout and real progress to stderr.
Use `--request file.json` for a bounded custom `TurnRequest`, `--timeout-ms` to shorten the
ten-minute maximum, or Ctrl+C to cancel. Cancelled work does not export a partial policy.
That compact reference has no disk restart support; the separate wider backend below does.
A turn interface is not implemented.

#### Wider ranges, still the same declared betting rules

The [range-vector backend](tasks/vector-turn-engine-audit.md) now supports up to **64
physical hand combinations per player**. It calculates values for a range together,
instead of repeating the public tree for every private-hand pair. A separate grader
checks the strategy without reading the solver's regret updates. Neither uses Monte Carlo.

The fixed synthetic benchmark has 3,773 compatible deals, 166,012 deal–river pairs,
1,305 public states, and 35,584 information sets—equivalent to 4,516,282 repeated states.
At 256 CFR+ iterations, delay 20, its exploitability is **0.026707310 chips per hand**
in a 100-chip pot (0.0267% of pot), below the pre-set 0.25-chip gate. That percentage is
an incentive-to-deviate measure, **not** an action-frequency accuracy percentage.
The first player's value is −6.754015282 chips; best-response gains are
0.034413024 / 0.019001595 chips. An explicit-pair calculation agrees.

The accepted solve took about 3.3 seconds on the recorded M1 Pro/Node 24 run, including
compile, grading and export, with about 295 MiB sampled peak worker RSS. These are local
measurements, not performance promises. The full hashed policy is checked in offline;
Node 20 and 24 reproduce it. Ranges are synthetic test inputs, not recommended play.

```sh
npm run audit:turn:vector       # reproduce and independently check the saved result
npm run profile:turn:vector     # five-sample range ladder and phase timings
npm run --silent solve:turn:vector -- --fixture wide --checkpoint fresh-checkpoint.json
npm run --silent solve:turn:vector -- --resume fresh-checkpoint.json --checkpoint another-fresh-file.json
```

Use `--request file.json` for the same `TurnRequest` shape. Each player declares prior
contributions (`committedPerPlayer`); the starting pot is twice that number.
The two `betSizes` entries mean one turn size and one river size, **not two choices per street**.
`stackBehind` supplies the two remaining stacks. Player 0 acts first on both streets.
Relative hand weights below 1e-12 of that player's maximum are refused, never silently dropped.

The vector CLI defaults to CFR+, delay 20, a 100,000-iteration budget and a quality target
of 0.25% of pot. `--target-chips` sets a chip target; `--iterations`, `--algorithm`,
`--delay`, and `--timeout-ms` set explicit budgets/settings. It reports real iteration
counts and the last independent grade with its iteration, not a predicted completion bar.
JSON goes to stdout; progress to stderr. Exit 0 means target met; exit 2 means the budget
ended before that target; exit 1 means invalid input, cancellation, timeout, or another error.

Optional full checkpoints retain completed iterations, regrets, and average sums.
Ctrl+C stops the worker; an already-saved checkpoint remains usable. Output checkpoint
paths must be new; never point output at the resume input. Restores preserve solver
settings and are independently regraded. At the same completed iteration they continue
bit-identically, though an extra resume-time grade can stop earlier if it already meets
the target. Convergence history records grades from the current invocation.

This is an **approximate strategy for one finite heads-up game**, not exact or universal
GTO. The M2 backend keeps one capped opening size per street and no raises/rake/flop.
It uses a conservative 1 GiB estimated/sampled-worker budget (or less on smaller machines),
not an OS hard total-memory guarantee; the parent process and checkpoint I/O also use RAM.
The old solver limits, saved artifacts, and 100,000-state browser teaching cap are unchanged.

#### Configurable betting across both streets (M3)

The new [turn-v2 contract](tasks/configurable-turn-v2-spec.md) adds **up to three opening
sizes, three raise targets, an optional all-in action, and one raise per street**, while
keeping the older engines and their results unchanged. Turn and river have separate menus.
An amount means the player's total contribution on the **current street**. A 50-chip
river target does not include chips paid on the turn. Normal targets beyond the player's own
stack are unavailable, not clipped; the explicit all-in option adds that player's actual
maximum. A target above what the opponent can match is offered once, as exactly that amount,
so payoff-identical overbets do not appear as separate choices.
Minimum raises, short all-ins, no raising into an all-in player, and returned unmatched
chips are checked independently. Player 0 acts first on both streets.

The wider locked example uses the same 64-by-64 synthetic ranges, a 100-chip pot,
100-chip stacks, turn openings of 25/50 and a raise to 100, and river openings of 10/25
and a raise to 50. It has **6,699 public states and 147,840 information sets**, representing
23,177,540 repeated states without allocating that repeated tree. At 256 CFR+ iterations
with delay 20, exploitability is **0.033587175 chips per hand**. Four smaller teaching/test
examples also pass the pre-set 0.25-chip gate; all five are below the preferred 0.10 chip.
These are approximate strategies for specified finite games, not unrestricted no-limit GTO.

The first wider solve took about 17.1 seconds including preflight, worker startup,
compilation, solving, grading and export on the recorded M1 Pro/Node 24 run. Sampled peak
worker RSS was about 608 MiB and sampled parent-plus-worker RSS about 802 MiB. Timing
and sampled memory are local observations, not device guarantees. See the
[M3 audit](tasks/configurable-turn-v2-audit.md) for full grades, hashes and evidence.
The full policies are offline artifacts, not imported by the app.

```sh
npm run audit:turn:v2           # reproduce and independently grade all five policies
npm run --silent solve:turn:v2 -- --fixture dry-value
npm run --silent solve:turn:v2 -- --fixture wide-64 --checkpoint fresh-turn-v2.json
npm run --silent solve:turn:v2 -- --resume fresh-turn-v2.json --checkpoint another-fresh-file.json
```

For custom inputs, use `--request file.json` with the versioned
[request shape](src/lib/solver/postflop/configurable-turn/rules.ts) and
[examples](src/lib/solver/postflop/configurable-turn/fixtures.ts).
The default quality target is **0.25 chip**, not 0.25% for arbitrary pot sizes;
`--target-chips` changes it. The iteration, algorithm, delay, timeout, checkpoint,
exit-code and cancellation conventions match the M2 CLI above. V1 and v2 checkpoints
cannot be interchanged.

Admission refuses more than 20,000 public nodes, 250,000 information-set upper bounds,
750,000 action slots, a 32 MiB estimated checkpoint, or the memory budget. That budget
is the smaller of **2 GiB and one eighth of reported physical RAM**; M2 keeps its old
1 GiB cap. The wide request estimates 1,263,259,648 bytes and therefore needs at least
about 9.42 GiB of reported physical RAM under this conservative rule. The runner samples
parent and worker memory, but cannot guarantee OS-enforced limits or currently free RAM.
Jobs have a ten-minute maximum. A game fitting these caps is not a promise of convergence.
One small turn-v2 game ("dry value", 3 hands per player) matches postflop-solver on the
identical tree: our grade of its strategy and its self-report agree within 6e-7 chips.
The wide 64-hand example has no external match.

### Joint flop, turn and river solving (M5)

The new CPU engine starts with three board cards and solves all three betting rounds
together. A fixed compatible private deal has **45 × 44 = 1,980 ordered runouts**.
Both future cards stay hidden until dealt. This is not an average of separately solved
turns, a neural model, or a Monte Carlo equity estimate.

The tiny readable reference and the wider numeric backend have separate independent
grading and reduction tests. The accepted synthetic **64-combination-per-player** example
has 3,755 compatible deals, 191,844 public states and 5,017,600 information sets—equivalent
to 606,823,021 repeated states. At 256 CFR+ iterations, delay 20:

- First-player value: **+3.214052854 chips**.
- Best-response gains: **0.040942376 / 0.007236279 chips**.
- Exploitability: **0.024089328 chips**, or **0.0241% of the 100-chip pot**.

That percent measures an incentive to deviate, not “99.98% accuracy.” The range is
synthetic capacity-test data, not preflop advice. The first Node 24/M1 Pro acceptance
took about four minutes with roughly 999 MiB sampled combined process memory. Runtime
depends strongly on the machine and Node version; these are observations, not promises.

The finite rules allow **one capped opening size per street and no raises**. Player 0
acts first on every street. There is no rake. Short calls return uncalled excess; all-in
hands reveal remaining cards without more betting. This is an approximate strategy for
that game, not unrestricted no-limit hold'em or exact GTO. The earlier turn-v2 engine
supports richer betting menus; those menus have not yet been added to flop solving.

```sh
npm run audit:flop:reference  # reproduce the tiny reference and its independent audit
npm run audit:flop:source     # validate and independently regrade the complete saved wide policy
npm run audit:flop:vector     # full wider solve reproduction (several minutes)
npm run solve:flop -- --request game.json --preflight
npm run solve:flop -- --request game.json --output fresh-result --checkpoint fresh-checkpoint.gz
```

Use the [request shape](src/lib/solver/postflop/flop/rules.ts) and
[locked examples](src/lib/solver/postflop/flop/fixtures.ts). `--iterations` sets the work
budget; `--target` is a chip-unit quality target (default: 0.25% of starting pot).
`--resume saved-checkpoint.gz` restores the same game and run settings; checkpoint output
must be a new path. Ctrl+C terminates the worker and retains its last complete checkpoint.
Exit 0 means the requested grade passed; 2 means the iteration budget ended before that
target; 1 means invalid input, cancellation, timeout or another failure.

The wider runner admits at most 64 combinations/player, 250,000 public nodes and
12,000,000 action slots, within the smaller of 2 GiB or one quarter of reported physical
RAM, and a ten-minute deadline. These are sampled/controller limits, not OS-enforced
memory guarantees. Full float64 policies and checkpoints stay offline. The saved library
below exposes selected results; the custom browser river limit stays unchanged.
See the [M5 audit](tasks/heads-up-flop-v1-audit.md), [binary format](tasks/flop-binary-v1-spec.md)
and [library contract](tasks/saved-flop-library-spec.md).

### Six saved three-street games (M6)

Open `/solver/flop` to follow the same jointly solved strategy from flop through river.
Choose a dry, two-tone, paired, connected or monotone board, or the synthetic 64-hand
capacity example. The smaller ranges are handcrafted teaching assumptions; none is a
solved preflop formation. “First” and “second” mean action order on every street.

- Inspect exact physical hands, action frequencies, forced-action values, value gaps,
  opponent responses, folds, and response-conditioned ranges. Range groups use joint
  reach weights; an exact-combination table preserves suits and blockers.
- Reveal either next public card, compare public-card previews, step back, or share a
  source-version-bound link to a specific history and hand. Private hands remain unknown
  during public navigation. Impossible, off-path and tiny-reach facts are not invented.
- Inspect all assumptions, both original ranges, downloadable inputs, iterations,
  independent best-response gains, exploitability and source/policy hashes.

All six frozen games passed at 256 CFR+ iterations (delay 20), below the predeclared
0.25-chip gate and preferred 0.10-chip target for their 100-chip starting pots:

| Saved game | Exploitability, chips |
|---|---:|
| Two-tone king-high | 0.002712989 |
| Dry ace-high | 0.020847684 |
| Paired, unequal stacks | 0.025315640 |
| Connected | 0.009255944 |
| Monotone | 0.016788315 |
| Synthetic 64-by-64 | 0.024089328 |

The browser loads checked, hash-bound slices—not the full 87 MB wide policy. Flop and
turn explanations are derived offline. A selected river is evaluated exactly in a
cancellable worker, limited to 100,000 equivalent repeated states; it does not rerun CFR,
sample cards, or fall back to a large main-thread calculation. The whole saved catalog
is about 61.3 MiB gzip; the largest slice is 287,911 raw bytes. Only active board slices
and necessary ancestry are retained, not every board visited.

```sh
npm run audit:flop:library       # validate and independently regrade all six sources
npm run audit:flop:explorer      # rebuild and compare every browser slice without writing
npm run reproduce:flop:library  # rerun all six solves sequentially; several minutes
npm run generate:flop:library -- --resume # reuse validated sources or resume complete checkpoints
npm run generate:flop:explorer   # validate all candidates before publishing derived files
```

Regular CI independently regrades all six sources and reproduces every browser slice.
The optional [extended workflow](.github/workflows/flop-reproduction.yml) reruns all six
full solves sequentially. The slower Node 20 wide solve runs close to its ten-minute
per-job limit; performance on a different machine is not guaranteed.

Quality is measured for each declared finite game, not for omitted sizes, raises, other
boards, real-world ranges or rake. Whole-game exploitability is not an error bar on a
particular decision. These are approximate strategies, not exact or universal GTO.
See the [frozen inputs](src/lib/solver/postflop/flop-library/fixtures.ts),
[library contract](tasks/saved-flop-library-spec.md) and
[release evidence and limitations](tasks/saved-flop-library-audit.md).

### External engine, checked by our own graders: the postflop-solver bridge

The repository can now solve heads-up flop, turn and river games with
[postflop-solver](https://github.com/b-inary/postflop-solver), an open-source Rust solver by
Wataru Inariba (b-inary). It runs on an ordinary CPU and handles wide ranges and several bet
sizes, far beyond the 64-hand TypeScript engines above. It is used as a dependency, not copied
into this repository, and it is **not trusted on its own**: every result small enough for our
engines is graded again by our own code, and large results are spot-checked.

**How it is isolated.** All postflop-solver code lives behind one Rust crate,
[`native/solver-bridge`](native/solver-bridge), pinned to upstream commit
`9d1509fe5077d019825f833eed04b16d342dfda1` with a committed `Cargo.lock` (upstream makes
breaking changes without version bumps, and its author suspended development in October 2023).
TypeScript talks to it only through a versioned JSON [spot contract](src/lib/solver/bridge/contract.ts):
a spot goes in (board, per-combination range weights, pot, stack, bet menus or an exact
action tree, quality target, iteration and memory caps), and a result comes out (the concrete
tree, per-hand strategies, values and the engine's self-reported exploitability). Each spot is
identified by a SHA-256 hash of its canonical JSON, and the result must echo that hash. A Node
[runner](scripts/bridge-runner.ts) adds a timeout, a sampled memory budget, cancellation, and
never publishes a partial result. Because the engine sits behind the contract, it can be
replaced later without touching the app.

**How it is checked (`npm run audit:bridge`).** Three locked games that our engines already
solved — the v3 river demo, the turn-v2 "dry value" game and the tiny flop reference — plus a
suit-symmetry probe game are solved by postflop-solver and then:

1. **Same game, node for node.** The exported tree is walked in lockstep with our engine's own
   rules. Actor, street, board, chips committed, every legal action with its chip amount,
   every terminal and every dealt card must match, or the audit fails and names the path.
2. **Our grade, not theirs.** Its strategy is converted into our information-set format and
   graded by each engine's own best-response grader. Postflop-solver's reported
   exploitability is compared against our number but never used as our number.
3. **Gates.** Its self-reported exploitability and value must match ours within a fixed
   tolerance, its strategy's value must fall inside the saved artifact's certified range, and
   our grade must pass each game's existing 0.25-chip quality gate.

| Game (postflop-solver iterations) | Its exploitability | Our grade of its strategy | Its first-player value | Ours |
|---|---:|---:|---:|---:|
| River v3 demo (600) | 0.009005547 | 0.009005300 | 16.0896236 | 16.0896219 |
| Turn v2 dry value (520) | 0.00971508 | 0.00971560 | 12.1883645 | 12.1883584 |
| Tiny flop reference (100) | 0.009672165 | 0.009672742 | 48.0142840 | 48.0142830 |
| Suit-symmetry probe (620) | 0.009411812 | 0.009411622 | 27.1259588 | 27.1259592 |

All values are chips per hand in 100-chip pots. The largest disagreements are **5.8e-7 chips**
of exploitability and **6.1e-6 chips** of value. The tolerance, **2e-4 chips**, was set before
it was applied, from 80 measurement solves (`npm run audit:bridge -- --measure`): 10× the
largest float32 discrepancy seen, rounded up. One and ten threads gave bit-identical results.
The probe exists because none of the three locked games has a suit symmetry: postflop-solver
stores one subtree for suit-swapped cards, and the probe shows the export maps those strategies
back to the real cards. Skipping that mapping raises our grade from 0.0094 to 0.115 chips and
fails the gates. CI's `bridge` job builds the crate with the pinned toolchain, runs `cargo fmt`,
`clippy`, the crate's tests, the Node runner, referee and slice-export tests, and this audit on
x86-64 Linux.

**A large benchmark (B3).** The locked 100bb game is a button-versus-big-blind single-raised
pot on K♠7♥2♦ (550-chip pot, 9,750 chips behind), using the lean betting tree of the public
[Fold](https://fold-poker.gtarpenning.workers.dev/) app: the big blind may bet 33% or 66% of
the pot on the flop, 66% on the turn and 50% or 100% on the river; the button bets 66% on every
street; one raise per street. On the recorded M1 Pro (10 threads), postflop-solver reached
1.55 chips of exploitability, **0.283% of the pot**, after 170 iterations in 224 seconds with
6.0 GB peak memory in float32, meeting its predeclared 0.3%-of-pot bar. With its 16-bit
compression it reached 0.290% after 160 iterations in 3.06 GB. That percentage measures an
incentive to deviate, not accuracy. Six river subgames of the float32 solve, chosen before
solving, were exported with both players' reach and graded by our factorized river
scorekeeper: postflop-solver's subgame values match ours within **7e-6 chips**. Five of the six
have local exploitability at or below 0.1% of their pot; the sixth (3.1%) is a line reached
with probability 4.7e-7, which adds about 1.3e-5 chips to the whole-game figure. Our code does
not grade the flop and turn decisions of a game this size. Before the benchmark was re-locked
to this leaner tree, a 20-minute trial of a richer menu (33/75/125% plus all-in for both
players) stopped at 44 chips (7.9% of pot) and published nothing, as designed.

A separate measurement, not a gate: letting the button bet 33%, 66% or 125% instead of only
66% was worth **9.75 chips (1.8% of the pot)** to the button on this flop, resolved to about
±1.6 chips, for 3.8× the memory and about 5× the time. That is one flop and one formation, not
a general claim about bet sizes.

**A saved spot library (B4).** [`public/solver-data/bridge-v1/`](public/solver-data/bridge-v1)
holds 12 flops for the same formation, ranges and tree, chosen for texture (dry, ace-high,
broadway, paired, monotone, connected and two-tone boards). Each was solved in float32 and
passed the 0.3%-of-pot gate (0.270%–0.299%); none was rejected. The full tree for every hand is
far too large to ship, so each flop keeps every flop decision plus sampled turn and river
decisions on unraised lines (8 turn cards and 2 turn-and-river boards): 336 decision nodes per
flop, each with both players' per-hand reach, values and equity. The 229 data files total
68.6 MB raw, **17.3 MB gzip**, each bound to a byte count and SHA-256 in the manifest.
`npm run audit:bridge:library` (about 6 seconds, no Rust needed; in CI's main job) checks every
file, rebuilds each spot hash from code, checks reach and value consistency on every saved
node, and re-grades one saved full-precision river subgame with our factorized grader
(postflop-solver's value agrees within 3.3e-5 chips). Every file labels the ranges as
hand-written approximations, not solved, and the manifest labels the results as an
approximate equilibrium of this finite game, not exact or universal GTO.

**Limits, stated plainly.**

- **Heads-up postflop only.** No preflop, no multiway, no rake. Postflop-solver has one
  effective stack, so both players must have equal stacks. Only the declared bet sizes exist.
- **Our grading is complete only for small games.** The four referee games have 2–14 hands per
  player; agreement there is evidence the chip, action, chance-card and value conventions match.
  At the benchmark's scale our engines grade only six river subgames. Our turn engines cannot
  express this tree's player-specific river sizes, so no turn subgame is graded.
- **Numeric noise.** Postflop-solver stores strategies in 32-bit floats; our graders use 64-bit.
  Its optional 16-bit compression moved reported values by up to 8.7e-4 chips in the referee
  measurement runs and by up to 2.8e-3 chips in the benchmark's river subgames, so the 2e-4
  tolerance does **not** cover compressed results, and the library uses float32. The tolerance
  was measured at the referee games' scale (pots about 100, stacks at most 200) and does not
  transfer to bigger games without a new measurement.
- **Ranges are assumptions.** The benchmark and library use hand-written approximate 100bb
  button-open and big-blind-call ranges, not solved preflop ranges.
- **No page uses it yet.** The live site does not run the bridge, and no page reads the saved
  library yet. Other formations are not built.

See the [bridge plan](tasks/postflop-solver-bridge-plan.md) and
[contract, unit mapping, referee, benchmark and library results](tasks/postflop-solver-bridge-spec.md).

### Share a game and grade a strategy

The CLI now exports four versioned benchmark games and independently grades imported
policies. Start with the small weighted-range example; output files must be new:

```sh
npm run solver:river -- list
npm run solver:river -- export weighted-blockers --out river-game.json
npm run solver:river -- solve weighted-blockers --out river-policy.json
npm run solver:river -- grade weighted-blockers --strategy river-policy.json
npm run audit:river:exchange
```

Replace the policy-producing step with another implementation once its output can be
adapted. Exported games include compatible deals, legal decisions, action edges, and
terminal payouts. Imports require a complete information-set policy bound to the game's
fingerprint; incomplete, hidden-card-keyed, or invalid distributions are rejected.
The grader uses trusted local rules, not imported payouts or claimed quality scores.

See the [exchange guide](tasks/river-strategy-exchange-guide.md) for the schema, commands,
observation boundary, and precision requirements, and the
[reference manifest](src/lib/solver/river/exchange/artifacts/benchmarks-v2.json) for measured
results. The CLI supports the four catalog games, not arbitrary imported game definitions.
These are public correctness fixtures, not a representative or held-out strength test.

## What this could contribute to a GPU or training project

This repository currently has **no GPU backend, neural-network training, or learned
value model**. A collaborator's implementation must be inspected before claiming anything
here is missing there. Hardware alone does not tell us which of these pieces they have.

| Existing contribution | Possible use in a collaboration |
|---|---|
| Explicit game rules, exact compatible deals, and independent money/showdown checks | Agree on the game being trained and catch card, betting, or payoff mismatches |
| Independent, hidden-information-safe best-response grader and policy-import CLI | Evaluate an imported complete policy on the same benchmark game, regardless of how it was trained |
| Readable CPU reference, faster factorized CFR/CFR+, and reproducible artifacts | Check an accelerated implementation's values and quality before measuring speed |
| Structured action values, opponent responses, and posterior ranges | Supply small reference cases for learning experiments or explain a validated policy to a person |
| Worker-backed, keyboard-accessible teaching UI | A possible presentation layer after an adapter is built; not an existing plug-and-play integration |

**Useful starting point now:** share this repo and reproduce the v3 example. We do not
need a larger solver to start comparing rules and outputs. For a GPU CFR implementation,
compare quality at matched work and elapsed time. For a learned policy, adapt its legal
action probabilities and grade the complete policy on held-out bounded games. A value-only
model needs separate prediction tests; value predictions alone are not a strategy and
cannot receive an exploitability score.

The first shared experiment should use exactly the same board, weighted ranges, action
order, legal actions, stacks, payoff convention, and game fingerprint. Compare values
and best-response gains, not mandatory equality of action frequencies: multiple good
strategies can differ. A network or adapter must never condition decisions on an
opponent's private cards. A good small-game result does not establish full-game strength.

### Entry points for another engineer or agent

1. [V3 game contract](tasks/configurable-river-v3-spec.md) and
   [release evidence](tasks/configurable-river-v3-audit.md): rules, quality gates, and limits.
2. [Request and solve API](src/lib/solver/river/configurable-v3/solve.ts):
   `ConfigurableRiverV3Request`, `prepareConfigurableRiverV3`, `solveConfigurableRiverV3`.
3. [Factorized CFR engine](src/lib/solver/river/factorized/cfr.ts):
   synchronous solving and `createFactorizedRiverCfrSession` for chunked execution.
4. [Independent scorekeeper](src/lib/solver/river/factorized/scorekeeper.ts):
   `compileFactorizedRiverScorekeeper` and `gradeFactorizedRiverStrategy`.
5. [Portable game/policy format](src/lib/solver/river/exchange/types.ts) and
   [strict import and grading API](src/lib/solver/river/exchange/exchange-node.ts):
   `prepareRiverExchange`, `exportRiverPolicy`, `importRiverPolicy`, `gradeRiverPolicy`.
   [Benchmark catalog](src/lib/solver/river/exchange/catalog.ts) and
   [CLI](scripts/river-exchange.ts) provide the four supported reference games.
6. [Worker protocol](src/lib/solver/river/lab/model.ts),
   [worker runtime](src/lib/solver/river/lab/runtime.ts), and
   [teaching facts](src/lib/solver/river/lab/teaching.ts): math stays independent of React.
7. [Turn game](src/lib/solver/turn/game.ts), [solve API](src/lib/solver/turn/solve.ts), and
   [independent rules oracle](src/lib/solver/turn/oracle.ts): `createTurnGame`, `solveTurn`,
   and `auditTurnRules`; offline, bounded, no browser/UI dependencies.
8. [Wider CPU turn engine](src/lib/solver/postflop/vector/game.ts),
   [restartable session](src/lib/solver/postflop/vector/session.ts), and
   [independent vector grader](src/lib/solver/postflop/vector/scorekeeper.ts):
   `compileVectorTurn`, `createVectorTurnSession`, `restoreVectorTurnSession`,
   and `gradeVectorTurn`. See the [locked M2 contract](tasks/vector-turn-engine-spec.md)
   for probability, blocker, averaging and checkpoint conventions.
9. [Configurable turn-v2 rules](src/lib/solver/postflop/configurable-turn/rules.ts),
   [public compiler](src/lib/solver/postflop/configurable-turn/game.ts), and
   [independent chip replay](src/lib/solver/postflop/configurable-turn/oracle.ts):
   `compileTurnV2` uses the same numeric session/grader with new versioned rules.
   [Offline CLI](scripts/solve-turn-v2.ts) and [M3 audit](tasks/configurable-turn-v2-audit.md)
   cover accepted examples, limits and reproducibility.
10. [Bridge spot contract](src/lib/solver/bridge/contract.ts),
    [runner](scripts/bridge-runner.ts), [referee](src/lib/solver/bridge/referee.ts), and
    [subgame referee](src/lib/solver/bridge/subgame-referee.ts): `validateBridgeSpot`, the
    lockstep tree walk, and the gates that grade postflop-solver's output with our own engines.
    The Rust side is [`native/solver-bridge`](native/solver-bridge); the saved library's
    hash-checked [loader](src/lib/solver/bridge/library/load.ts) is browser-safe.
11. [Drill generators](src/lib/drills/generators.ts) and [grading](src/lib/drills/grade.ts):
    each question is a pure function of `(type, seed, level)` with an exact answer.

The CLI exchange is implemented; a browser importer and collaborator-specific adapters
are not. The import format constrains the submitted policy's observations but cannot
certify its author's training process or absence of data leakage. The repository is licensed
under AGPL-3.0-or-later (see [License](#license)); third-party code is combined only under
compatible licenses and is credited where it is used.

## Roadmap: what is left

The bounded river engine, labs, exchange, guided comparisons, and offline heads-up turn
reference are implemented. The active path does not depend on a collaboration.

1. **Grow the CPU solver first.** Baseline profiling, compact solving, wider-range vector
   calculations, scalable independent grading, disk restart checkpoints, and configurable
   turn/river betting with raises and five accepted examples, and the saved-result turn
   explorer are complete. M5 adds a joint flop/turn/river reference and accepted wider
   CPU solve. M6 adds six audited saved games and the three-street explorer. The next
   capacity expansion would need a new benchmark contract for richer flop betting or
   more representative ranges; neither is silently included. Porting our own
   engines to native code or a GPU (M7) is conditional and not needed for the accepted target.
   Separately, the postflop-solver bridge adds an external native engine for wide-range
   heads-up solves, checked by our engines on small games and river subgames. Heads-up play
   against a re-solving AI has only its P0 data contract (`src/lib/hu-play/`: public state,
   spot building that never sees hidden cards, deterministic replay); there is no UI yet. The standalone turn lesson
   is deferred. The [saved implementation plan](tasks/cpu-postflop-solver-plan.md) records
   the architecture, pros/cons, mitigations, resource budgets, and acceptance gates.
2. **Verification and reliability.** Postflop-solver now matches one small river, turn and
   flop game each on identical trees (B2), and six river subgames of its large benchmark
   solve re-grade to within 7e-6 chips of its values (B3). Next: grade turn subgames of large
   solves, which needs a turn engine that accepts per-player bet menus. Extend reproduction CI to older river/multiway
   artifacts; Kuhn, Leduc, turn, compact/vector/configurable turn, the saved explorer, v3, and exchange already have checks. Expand browser and
   assistive-technology coverage beyond Chromium and make random trainer setups deterministic.
3. **More useful river teaching.** Comparisons cover opponent ranges, opening bet sizes,
   and stacks. Price, position, and board/blocker changes need explicit matching rules.
   An opponent-mistake lesson would compute a best response to a stated model, not rename it GTO.
4. **Separate multiway research.** Sampled multiway ranges retain their own Stage 4 gate; a three-player
   turn experiment is still separate. GPU/WASM/native acceleration needs profiling and
   exact-small-game parity. General multiway flop play and learned leaf values are not implemented.
5. **Optional integration.** The benchmark exchange is available now. Build an adapter only
   after inspecting another implementation's rules and license; add held-out games before
   claiming a learned model generalizes.

There is no present full-range, all-streets, arbitrary-bet-size NLHE solver, and the
four-player trainer does not inherit the heads-up solver's guarantees.
The [detailed solver roadmap](tasks/solver-lab-roadmap.md) preserves completed milestones;
the [multiway research plan](tasks/multiway-nlhe-solver-plan.md) defines its separate gates.

---

## Trainer equity accuracy

The trainer now enumerates heads-up rivers instead of sampling them, and uses a fixed
10,000 random deals elsewhere. Both heavier hand calculations and local teaching readouts
run in Web Workers. New requests cancel obsolete workers; errors are shown rather than
falling back to a blocking calculation. Sampled uncertainty is labeled separately as one
standard error and an approximate 95% sampling margin. Close decisions stay close, not
proven mistakes.

At 50% equity, the approximate 95% margin for independent win/loss samples falls from
±3.1 percentage points at 1,000 samples to ±0.98 at 10,000. Actual split-pot uncertainty
uses measured variance. More samples do not fix the assumed opponent ranges or account
for future betting. Exact equity is also conditional on those assumptions, not exact GTO.

See the [accuracy contract](tasks/trainer-equity-accuracy-spec.md) and
[benchmark and release evidence](tasks/trainer-equity-accuracy-audit.md).
Run `npm run bench:trainer` to reproduce the fixed-seed precision/timing benchmark.

## What the four-player trainer does

Deals a 4-player NLHE hand and steps through every decision — preflop through river — with
a full explanation at each stage.

**Observe mode** — watch the hand play out. Every player's decision shows:
- What they said (dialogue)
- Why they did it (reasoning)
- Inner thoughts (position, reads, hand strength)
- The numbers (estimated pot share, call price, average result, and bet sizing)

**Train mode** — you're assigned a **random seat** ("hero"). Before seeing the model's
decision, you pick your own action, then compare. Feedback separates choices that match
the trainer, different legal choices, and postflop call/fold errors whose cost follows
directly from the displayed call-price math. Preflop differences are never presented as
proven losses because that part of the trainer uses hand-group rules rather than measured profit. The app
also surfaces behavioral patterns across a session
("folding too often," "missing thin value"). Villain hole cards are hidden until showdown;
afterward a recap panel reveals every opponent's full reasoning.

---

## Is this "GTO"?

**The four-player trainer is not GTO.** The separate solver labs search for approximate
equilibrium strategies in their declared finite games and report independently measured
quality. Neither is a claim to have solved unrestricted hold'em.

The trainer plays **heuristic, equity-driven poker**. Its limits are:

| Equilibrium solving involves… | The trainer uses… |
|---|---|
| Range-vs-range equilibria | Hero equity vs a *static* opponent range |
| Mixed strategies / indifference | Hard equity thresholds (bet ≥65%, thin value ≥52%) |
| Solver-derived bet-to-bluff ratios | A fixed semi-bluff frequency (30%), gated on real equity |
| Blocker-dependent strategy and range updates | Physical card removal in equity sampling, but no solved blocker-dependent strategy |
| Future betting and responding ranges | A local decision rule, not a solved continuation game |

The trainer is a heuristic teaching baseline for pot odds, equity, position, and sizing.
Matching it is not proof of optimal play, and differing from it is not automatically a
mistake. Its results should not be confused with the separate river solver's action values.

Earlier versions labeled the model's move "GTO play" and the tight table style "GTO." Those
were overclaims and have been renamed ("Trainer's choice" and "Tight"). The internal style key is
still `"gto"` for historical reasons; it's never shown to the user.

**A smaller game can be measured more directly.** The standalone
[`/solver`](https://pokerface.katswint.com/solver) explorer searches for stable play in a
heads-up shove-or-fold model. It reports the remaining strategy gap and uses precomputed
charts so the slider is instant. Its 169×169 equity matrix is exact: every board is
enumerated for every card-disjoint combo pair. Ranges are weighted with card removal. At
10bb it shoves 58.3% and calls 37.4%, against 58.4% and 37.3% in HoldemResources.net's
published heads-up Nash tables. It is deliberately separate from the 4-handed trainer. The
result is exact only for the shove-or-fold abstraction, and mixed edge hands are labeled as
such. See [METHODOLOGY.md](METHODOLOGY.md).

The repository also contains a **non-UI Kuhn poker reference lab**. It walks the complete
small game tree without random sampling, learns with ordinary CFR, and is graded by a
separate information-set-aware best-response evaluator. On Kuhn, that scalable evaluator
is checked against all 64 pure strategies for each player. The committed strategy is within
`0.001` chip of the known game value and below `0.001` chip exploitability;
`npm run audit:kuhn` regenerates and verifies it. This is a mathematical foundation for a
river solver and its teaching UI, not a new claim about the four-player trainer.

The same audited core now solves **Leduc poker**, which adds a public card, a second betting
round, and one legal raise per round. It uses Brown's 1-chip then 2-chip bet sizes, not the
2-then-4 sizes of Southey et al., so its game value (≈ −0.0525) differs from the often-quoted
−0.0856 (an independent solve with 2-then-4 sizes does reproduce −0.0856). Its complete 9,451-state tree matches the independently
implemented pinned reference. The committed 102,400-iteration strategy measures `0.00186`
chip exploitability and is gated against the converged game value `−0.05246` (certified by a
20,000-iteration CFR+ strategy with `5.1e-6` exploitability), which it matches within `0.00034`
chip. Brown's 1,600-iteration reference value is kept only as an informational comparison.
Its lessons are available at `/solver/lab`; it does not replace the trainer's four-player model.

---

## How trainer decisions are made

**Preflop** — a 6-tier hand-strength chart (`src/lib/poker/ranges.ts`) crossed with
position- and pressure-based thresholds. A hand is raised if its tier ≤ the position's
raise threshold, called if ≤ the call threshold (and the price is right), else folded.
Thresholds tighten as raises stack up (open → 3-bet → 4-bet) and widen with looser table
styles. Every percentage shown in the app is counted directly from all 1,326 starting-card
combinations, so the explanation cannot drift away from the shipped hand groups. These are
model rules, not solver outputs or promises that a play will make money.

**Postflop** — the trainer counts every allowed opposing hand on a heads-up river
(at most 990), with no random sampling error. Other estimates use a fixed
**10,000-deal Monte Carlo sample** (`src/lib/poker/equity.ts`) in a Web Worker.
This improves showdown-share precision, not the opponent model or strategy optimality.
Each sampled deal:
1. Samples the whole set of opponent hands from the app's **range-filtered pool**, rather
   than assuming every player holds two random cards. This is a modeling choice, not a
   claim to know a real opponent's range. Incompatible sets are rejected as a whole, so no opponent seat
   gets a sampling advantage from being chosen first.
2. Completes the board from the remaining deck.
3. Scores all hands head-to-head, crediting ties by exact pot share (`1 ÷ tied winners`).
4. Records whether hero received all, some, or none of the chips hero could reach.

The unrounded estimate is compared directly with the real price of calling. The engine
caps short all-ins and excludes unmatched chips the caller cannot win. When a call reaches
multiple pot layers, one simulated table deal scores each layer against only the opponents
eligible for it; the expected chip returns are added before the call cost is subtracted.
Table personality
changes the sampled opponent range, never the break-even equation. Value-bet sizing scales with equity and
shrinks as the pot goes multiway, but the trainer does not model a separate range of hands
that will call those bets. The semi-bluff fires at a fixed frequency only when the hand can
still improve (a draw / overcards), never on pure air. Because the trainer does not model
which hands call, it shows a pure-bluff fold-rate reference rather than claiming an exact
semi-bluff result. The pure hand replay runs in a background worker at deal time and
after a learner changes a choice. New requests terminate old workers; stale results
cannot replace a newer hand. Worker failures are visible, with no blocking fallback.

**The numbers shown** — each postflop decision labels whether all allowed hands were
enumerated or deals were sampled. Sampled results report one standard error and a
separate approximate 95% sampling margin (1.96 standard errors), measured from actual
win, loss, split-pot, or layered-return values. These are not guaranteed bounds and do
not cover incorrect opponent ranges or future betting. Zero measured sample variation
is not proof of zero sampling error. The feed also
shows the current call price and bet sizing. The price comparison assumes the remaining cards
are dealt and the players still in the hand reach showdown; it does not simulate later bets
or folds, so it is a current-price check rather than a complete profit forecast. For a semi-bluff, it labels
`bet ÷ (pot + bet)` as the fold rate a hand with no chance when called would need. A real
semi-bluff needs fewer folds because it can still win, but an exact number would require a
separate model of the opponent's calling hands.

---

## Architecture & why

```
src/
  app/                     Next.js App Router shell + SEO/OG metadata
    solver/                 push/fold explorer
      lab/                  Leduc lessons
      river/                River Lab UI, Web Worker, and scoped CSS
    drills/                 timed poker-math drills page
  components/PokerSim.tsx   UI + rendering (one component, by design*)
  lib/poker/                pure, UI-free, unit-tested domain core
    cards.ts                deck, rank/suit constants, formatting helpers
    eval.ts                 readable reference hand evaluator
    score7.ts               fast seven-card evaluator used in simulations
    ranges.ts               preflop tiers & position thresholds
    equity.ts               exact river enumeration, fixed-budget sampling, deterministic seeds
    trainer-hand.ts         pure four-player hand replay
    trainer-worker-*.ts     typed background protocol, runtime, and stale-result guards
    pots.ts                 side-pot & split-pot distribution
    engine.ts               one betting round, shared by preflop & postflop
    decide.ts               the full decision engine (board/holding analysis + choice)
    types.ts                shared domain types
  lib/solver/               solver code independent of React
    toy/                    Kuhn/Leduc rules, readable CFR, independent grading, artifacts
    turn/                   unchanged tiny joint turn/river reference and accepted artifact
    postflop/               compact v1-equivalent turn engine and CPU-first fixtures
      vector/               wider range calculations, independent grader, restart checkpoints
    river/                  bounded heads-up river rules, ranges, and teaching facts
      configurable-v3/      current rules, preparation/solve API, fixture, hashed artifact
      factorized/           shared public tree, resumable CPU CFR/CFR+, independent grader
      lab/                  validated inputs, typed worker protocol, teaching view models
    multiway/               separate bounded three-/four-player river proofs
    bridge/                 postflop-solver spot contract, hashing, referee gates, library loader
  lib/drills/               drill generators, exact grading, review scheduler (no React)
  lib/hu-play/              heads-up play P0: data contract and replay only, no UI yet
native/solver-bridge/       optional Rust CLI wrapping pinned postflop-solver
public/solver-data/bridge-v1/  saved 12-flop bridge library (hash-bound JSON)
test/                       node:test suites that import the REAL lib/ (not copies)
e2e/                        Playwright keyboard and training-flow smoke tests
bench/                      equity throughput, memoization, and 1,000/10,000 accuracy benchmarks
.github/workflows/ci.yml    lint + types + tests + audits + build + browser tests; Rust bridge job
```

**The determinism seam** (`equity.ts`) is a key correctness safeguard. The whole hand is
replayed in a worker after each hero action. If the Monte Carlo used
`Math.random`, each recompute would return different equities → the number of simulated
stages would shift → the hero's recorded choices would misalign with the streets they were
made on. So each equity is seeded **purely from the spot itself** (hole, board, opponents,
style, plus the deal's base seed): it's a referentially-transparent function of its inputs,
identical across re-runs regardless of what the hero did earlier — and therefore safe to
**memoize within a worker**. A new worker starts with a cold cache, so earlier streets
are recalculated rather than described as free. A test asserts
same-inputs → identical equity. (The earlier version used one sequential RNG for the whole
hand, so a spot's equity depended on how many draws preceded it — reproducible only if the
exact same sequence of spots recurred. The per-spot seed is strictly more robust.)

**Pure core extracted to `lib/poker/`** so the valuable logic (evaluator, equity, ranges,
pots, betting) is testable in isolation and can't drift from the UI. Two examples of drift
this killed: `evalHand`/`handScore` were separate encodings of the same ranking that had
silently disagreed (now one `rankCards` core, guarded by a property test); and the betting
loop existed **twice** — inline for preflop and a near-duplicate for postflop — now a single
`engine.runBettingRound` with the decision function injected, so the tests drive it with
scripted actions (short blinds, minimum raises, cumulative short-all-in reopening, dry side
pots, all-in caps, and hero-index accounting). The engine exposes structured legal actions
to the UI and records requested decisions separately from applied actions, so the interface
cannot offer or announce a move the engine did not execute.

\* **Why is the component still one file?** After extracting `decide.ts`, `PokerSim.tsx` is
now UI and rendering: the pure per-deal loop lives in `trainer-hand.ts` and runs in a
worker through `useTrainerTask`. The entire decision
engine — board/holding/threat analysis and the full per-spot choice — lives in
`lib/poker/decide.ts` and is unit-tested directly. What remains in the component is
genuinely view-layer and changes together with the markup; splitting the presentational
sub-components into their own files is cosmetic, not a testability win.

---

## Correctness & testing

`npm test` runs `node --import tsx --test test/*.test.ts` against the **shipped** `lib/`
modules (an earlier suite re-implemented copies that drifted from production — that's now
fixed). Coverage:

- **eval** — every hand category, the wheel, kicker tiebreaks, and the property test that
  `evalHand` and `handScore` never disagree.
- **ranges** — exact tier boundaries (AA/KK/QQ/JJ = tier 1, TT = tier 2, …) asserted
  against the real function.
- **equity** — purity, memoization consistency, multiway split shares, layered-pot returns, equal-weight whole-table
  sampling, measured sampling error, monotonicity, and — the load-bearing one —
  **the random-deal estimate agrees with full enumeration** on pinned river and turn cases
  within the measured sampling error. This catches important sampling bias without claiming
  that two examples prove every possible case.
- **pots** — single winner, even chop, button-relative odd-chip splitting, exact per-layer
  awards, a short all-in main-pot/side-pot split, uncalled-excess return, and a property that
  every layer goes to the strongest eligible hand.
- **engine** — a betting round driven by scripted decisions: checks move no chips, full and
  cumulative short raises reopen action correctly, dry side pots cannot be bet, illegal
  undersized raises normalize to calls, short blinds never negative a stack, over-bets cap all-in,
  and current-pot quotes exclude uncalled excess.
- **decide** — the full decision engine: stronger starting groups raise and weaker groups fold preflop, value bets
  and folds-to-price postflop, layer-aware call-price classification, and street-aware board analysis.
- **invariants** (`fast-check` fuzzing) — **chip conservation** (Σ payouts = Σ contributions,
  no chips created/destroyed) across 1,000 random pots, side-pot eligibility, betting-round
  conservation, evaluator-ordering consistency, and call-profitability equivalence.
- **solver** — push/fold model sanity checks; Kuhn's known value and exhaustive best responses;
  pinned Leduc and river reference comparisons; v3-to-v2 reduction; independent terminal
  money/showdown checks; blocker-compatible ranges; deliberate hidden-card-cheating
  regressions; readable/compact/factorized parity; chunked/synchronous strategy identity;
  worker cancellation and stale-request handling; hashed artifacts and off-path teaching.
  Multiway proofs use independent per-player deviation gains. `score7` also agrees with
  `handScore` over 100,000 tested hands.
- **bridge** — spot validation and canonical hashing, browser memory admission, slice plans,
  library chunk validation, hash-checked loading and reach/value invariants. Tests that drive
  the real Rust binary (runner, referee, slice export) run when it is built and in CI's `bridge` job.
- **drills** — every generator's answer is checked a second way (break-even identities, full
  run-out and deck enumeration, the app's hand evaluator), plus grading, sessions and the review
  scheduler.
- **heads-up play contract** — public-state derivation, reach, deterministic replay, and
  checks that hole cards never reach a spot, cache key, request or pre-showdown log.
- **browser smoke tests** — native Space activation for Deal and training-choice buttons,
  run against a production build in Chromium.

CI ([workflow](.github/workflows/ci.yml)) runs lint, type-checking, domain tests, every `audit:*` script (hand
evaluator, exact equity matrix, Kuhn/Leduc, every turn, flop and river engine, the saved bridge library, and the five multiway river
reproductions, the slow ones in a parallel job), a production build, and Chromium browser tests on pushes to
main and pull requests. A separate `bridge` job builds the Rust crate with the pinned toolchain, runs
`cargo fmt`, `clippy` and the crate's tests, then the bridge runner, referee and slice-export tests and
`audit:bridge`. The one exception is `audit:flop:vector`: its bit-identical wide-flop re-solve needs
about 14 minutes on a CI runner, past the flop job's 10-minute limit, so it runs locally; CI still re-grades
that saved policy independently. River Lab checks cover real-worker solves, cancellation, keyboard
operation, validation, decision inspection, one-change comparisons, and responsive layouts.
[Release records](tasks/river-solver-lab-audit.md) distinguish working-tree test runs from
committed artifacts; test totals are not a substitute for running the current checkout.
See [METHODOLOGY.md](METHODOLOGY.md) for the simulation design, validation, and error bounds.

**Money handling now has direct safeguards.** Showdown distribution used to award the entire pot to the
single best hand — no side pots, and ties weren't actually split despite the UI announcing
"Split pot." Because every committed chip is deducted from a player's stack, each player's
contribution is now tracked explicitly by the betting engine; `distributePots` uses that
ledger to build proper side pots and split ties evenly (odd chip to the first winner clockwise
from the button). Every pot layer exposes exact per-seat awards for the showdown UI. This
matters because stacks carry across hands.

---

## Conscious decisions & honest limits

**Trainer decisions made on purpose:**

| Decision | Why |
|---|---|
| No poker libraries in the trainer or TypeScript solvers — evaluator, equity, ranges, CFR and graders from scratch | The point is to demonstrate the math. The one external engine, postflop-solver, is an optional native dependency whose output our own graders re-check |
| Exact heads-up rivers; fixed 10,000 samples elsewhere | Count cheap cases completely and improve sampling precision without blocking the UI; neither fixes a wrong range assumption |
| Range-filtered opponents in the sim | Equity-vs-random is a real modeling trap; filtering to plausible ranges is more honest |
| Per-spot-seeded equity with per-worker memoization | Replayed choices see the same estimate for the same inputs; new workers intentionally start cold |
| Pure logic in `lib/`, UI + prose in one component | Isolate and test what benefits from it; don't over-split coupled UI/prose |
| No CSS framework | Preserve the terminal aesthetic; River Lab styles are isolated in a CSS module |
| Keep the trainer separate from solver labs | A bounded heads-up or toy-game result must not become an unsupported four-player recommendation |

**Known limitations (honest scope):**

- **The 4-handed trainer is heuristic, not a solver.** It does not solve range-vs-range
  equilibrium play, blocker-dependent action frequencies, or future betting decisions.
  The separate multiway proofs do not change that.
- **Fixed 4-handed, 5/10 blinds, 20bb starting stacks.** No table-size/stake variation — the tier ranges
  are calibrated for 4-handed and would need re-tuning per table size, which is its own
  correctness project; kept scoped deliberately rather than shipped wrong.
- **Multiway equity is still a model.** Complete opponent-hand sets are sampled without seat
  order bias, ties use the exact share, and value-bet sizing changes with player count. The
  remaining limits are static opponent ranges, no separate calling range for bets and raises,
  and no model of how often equity is realized.

---

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Scoped CSS modules and existing trainer styling, JetBrains Mono, terminal aesthetic
- `node:test` + `tsx` for the domain suite; `fast-check` for property/fuzz tests
- Optional Rust 1.98.1 crate wrapping postflop-solver (AGPL-3.0-or-later)
- GitHub Actions CI (lint + types + tests + audits + build + browser tests, plus a Rust bridge job)
- Deployed on Vercel

## Local development

Use Node.js 20.9+ (CI uses Node 20; the recorded local River Lab audit used Node 24).
Install the lockfile's dependencies, then open `http://localhost:3000/solver/river`:

```bash
npm ci
npm run dev
npm test         # domain + property test suite
npm run typecheck
npm run lint
npx playwright install chromium
npm run test:e2e # local configuration builds and starts the production app
npm run bench    # equity throughput + memoization benchmark
npm run build    # production build
```

### Reproduce and audit solver results

These checks regenerate or independently evaluate saved results and fail on mismatches;
they do not overwrite accepted artifacts.

```bash
npm run audit:kuhn
npm run audit:leduc
npm run audit:equity-matrix   # push/fold matrix hash + independent exact cell recompute (~10s)
npm run audit:river
npm run audit:river:v2
npm run audit:river:v3
npm run audit:river:exchange
npm run audit:river:compact
npm run audit:river:scorekeeper
npm run audit:river:factorized
npm run profile:river:factorized  # measured cost, not a correctness or speed guarantee
```

Offline multiway artifact checks are more expensive:

```bash
npm run audit:multiway-river
npm run audit:multiway-raised-river
npm run audit:multiway-two-size-river
npm run audit:multiway-side-pot-river
npm run audit:multiway-four-player-river
```

The corresponding `solve:*` commands and `generate:river:benchmarks` write artifacts;
use them only when intentionally regenerating results and review the diff. Custom library solves use
`solveConfigurableRiverV3(request, options)`; the artifact script itself regenerates the
locked example rather than accepting arbitrary input files.

### Optional: build and audit the postflop-solver bridge

The bridge needs a Rust toolchain. [`rust-toolchain.toml`](native/solver-bridge/rust-toolchain.toml)
pins Rust 1.98.1, so `rustup` installs that version automatically on the first build.
The rest of the app, `npm test`, `audit:bridge:library` and the TypeScript solvers do not need
Rust: tests that drive the real binary are skipped when it has not been built.

```bash
npm run build:bridge   # cargo build --release --locked (pinned postflop-solver commit)
npm run test:bridge    # the crate's own engine-semantics tests
npm run audit:bridge   # solve the locked referee games and re-grade them with our engines
npm run audit:bridge -- --measure   # re-measure the float32 tolerance (80 solves, ~2 minutes)
npm run solve:bridge -- --fixture referee-river-v3-demo --out result.json
npm run audit:bridge:library        # check the saved 12-flop library (no Rust needed, ~6 s)
npm run bench:bridge                # B3 benchmark; local only (~15 min, 6 GB); never overwrites
npm run reproduce:bridge:library    # re-solve every library flop; files must match byte for byte
```

`audit:bridge` took about 7 seconds after the build on the recorded M1 Pro run.
`reproduce:bridge:library` is local only: it takes tens of minutes and up to 6 GB per solve,
and CI's x86-64 runners may round float32 sums in a different order.

## Accessibility

Interactive controls preserve native keyboard behavior; history rows are keyboard-operable
(`role="button"`, Enter/Space); cards carry text alternatives (`aria-label`); a polite live
region announces each step; focus is visible; and step auto-advance respects
`prefers-reduced-motion`. Plain language is the saved default; Poker terms mode adds
keyboard-, touch-, and hover-accessible term explanations.

## Trainer navigation

- `→` — next step when focus is outside an interactive control
- `←` — previous step
- `Enter` / `Space` — activate the focused native control
- Click any history entry — jump to the full log at that step

## Acknowledgements

- [postflop-solver](https://github.com/b-inary/postflop-solver) by Wataru Inariba (b-inary),
  licensed AGPL-3.0-or-later, is the engine behind the optional native bridge in
  [`native/solver-bridge`](native/solver-bridge) and the saved bridge library. It is used
  unmodified as a Cargo dependency pinned to commit `9d1509fe5077d019825f833eed04b16d342dfda1`;
  none of its source is copied into this repository. Its results are accepted here only after
  our own checks.

## License

Copyright (C) 2026 Kat Swint.

This program is free software: you can redistribute it and/or modify it under the terms of
the GNU Affero General Public License as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version. It is distributed in the
hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
The optional bridge crate depends on postflop-solver, which is also AGPL-3.0-or-later.
