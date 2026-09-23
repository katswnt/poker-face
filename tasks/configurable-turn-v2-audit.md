# Configurable turn/river v2 — M3 audit

2026-09-23. Baseline `ca0d8a8`. [Locked contract](configurable-turn-v2-spec.md),
[pre-solve input hashes](configurable-turn-v2-input-hashes.json),
[CPU-first parent plan](cpu-postflop-solver-plan.md).

## Scope and numerical claims

Offline, heads-up turn and river solved together with exact private-card compatibility
and river enumeration. New rules allow up to three declared opening targets, three raise
targets, optional actor-specific all-in, and one raise after the opening bet on each street.
Whole chips, no rake, no flop/preflop solve, no neural leaf values or GPU dependency.
Player 0 acts first on both streets. There is no new browser route or change to trainer,
Leduc, River Lab or its 100,000-state browser teaching limit.

Amounts are current-street contribution targets, not percentages or cumulative two-street
amounts. Unavailable normal targets are skipped, never silently capped. Short all-ins,
minimum raises and no raising into an all-in opponent are explicit. Street closure
immediately returns uncalled excess; the next street carries only matched payments.

All policies remain **approximate strategies for the declared finite game**, not exact
or universal GTO. Exact enumeration uses float64 arithmetic, not exact real-number arithmetic.
Exploitability is half the sum of the two independently calculated best-response gains,
in net chips per hand; percent-of-pot is not action-frequency accuracy.

## Locked acceptance corpus

All requests and quality/resource gates were fixed before their first acceptance solve.
Each has a 100-chip pot and handcrafted ranges. The wider case is a synthetic capacity
probe; the four smaller cases are teaching/test assumptions, not solved preflop ranges.
Required exploitability <=0.25 chip; preferred <=0.10 chip. CFR+, delay 20, scheduled grades
256/1,024/4,096/16,384/65,536/100,000. All five passed at the **first** scheduled grade, 256.

| Fixture | Deals | Public states | Information sets | Value, player 0 | Gain 0 / gain 1 | Exploitability |
|---|---:|---:|---:|---:|---:|---:|
| wide-64 | 3,773 | 6,699 | 147,840 | −3.442169475 | 0.038243089 / 0.028931261 | 0.033587175 |
| dry-value | 8 | 6,699 | 6,930 | +12.192367232 | 0.057198796 / 0.047093381 | 0.052146088 |
| paired-short | 9 | 8,868 | 8,871 | +8.603877095 | 0.164287458 / 0.030739166 | 0.097513312 |
| two-tone | 8 | 5,547 | 5,826 | +49.984715002 | 0.015284998 / 0.001993063 | 0.008639031 |
| connected | 9 | 10,647 | 10,530 | +15.067314566 | 0.046993238 / 0.004249685 | 0.025621461 |

The wide case has 166,012 deal–river pairs, 23,177,540 equivalent repeated states,
14,805,252 terminals, and 384,384 action slots. Both streets contain legal raise branches.
Its full exploitability is `0.033587175026543514`; explicit-pair grading gives
`0.03358717502654485`. These are within the locked 1e-10*S payoff/grade tolerance.
No fixture, tolerance or threshold was adjusted to make an observed solve pass.

All five complete policies are in `src/lib/solver/postflop/configurable-turn/artifacts/`.
Total JSON size is 28,420,225 bytes; the wide file is 23,337,429 bytes. They are offline
artifacts, not imported by the browser. Hashes bind the canonical request, rules identity,
complete policy and payload; wall-clock timing is deliberately excluded.

```text
Wide request: bd1345838e1cef200f8e876e566e5db5956e6efa0d4f44d7bbdb75fe9b30e934
Wide policy:  07fab42b7a695b38712c1977cd0947569cb0e46042a2593ede1a4e1b7635e953
Wide payload: 381113385e5e2d93b38cd140f93934702b58679c76a98193afb74985945b6a18
Dry payload:  1221202fbbe66be69e07f7284bf58b971bffb90851ea5a8d26ae5cc874090689
Pair payload: ab9efa138a13adc67f8286bcebeb20d66f9b3f8dcf53b857b0a148df8aad7444
Tone payload: 44724e28d15fe1c305327f4e6f1cfea562afd9fa21f3fe4edc0ed611bdb59527
Conn payload: 4be9800d7dae316f1a059f83790f7e82fb0c6d1c306914650988a8a879f3b60e
```

## Independent evidence and preservation

- New public rules/compiler have no representative private deal. A collapsed skeleton
  counts with 48 public river copies and 44 copies per compatible private pair before
  allocating node/hand workspaces. Every turn decision hides the future river.
- An audit-only cash-ledger replay independently generates legal choices and every
  payment/refund from action histories. It calls no production transitions, menu helper,
  compiled terminal scale or fast evaluator. Every public state is checked on the four
  small corpus games and three frozen held-out cases, including overlapping weighted
  hands, 17/5 and 37/61 stacks, zero stacks, three sizes and double-paired boards.
- All endpoints in those seven small games also match the slow five-of-seven evaluator.
  Root and river probability sums are checked; each private pair has exactly 44 rivers.
  The bounded readable adapter (8 hands/player, 16 deals, 100,000 states) uses production
  rules and fast showdowns, so it is a traversal/CFR reference, **not** the independent
  chip/evaluator oracle. Its index exactly equals the vector information-set index.
- Uniform, pure and seeded mixed policies have matching values and legal best responses
  under readable, vector and explicit-pair grading. Accepted small policies also match
  the readable grader; all accepted policies match the separate pair kernel.
- Ordinary CFR on a weighted, blocker-overlapping two-size/raise game matches the
  independent readable solver's current/average policies and regrets at 1/2/10/100.
  Ordinary CFR and CFR+ both match explicit-pair kernels at those iterations, including
  cumulative regrets and average sums. Tolerances remain as pre-specified.
- Five old turn fixtures reduce endpoint-by-endpoint using an explicit **state-dependent
  legacy cap adapter**. V1 deferred uncalled-chip returns; net money and utility agree
  with immediate v2 refunds. A no-clipping one-size/no-raise case also matches v1's
  ordinary CFR and independent grades through 100 iterations with mapped keys/actions.
- Nine river-v3 continuation reductions compare fixed-policy values and best responses
  after three different turn histories and three rivers. Opponent/own ranges are
  conditioned on each hand's earlier action probabilities and card removal; independently
  conditioned joint-deal mass agrees. They compare continuations of the joint strategy,
  not independently solved river equilibria. These reductions use compatible, no-extra-all-in
  menus and positive remaining stacks. Unequal actor-specific all-in menus cannot simply
  be unioned into v3 without adding actions; their accounting is covered by the ledger
  oracle instead. Zero-stack runouts use direct showdown checks.
- The M2 numeric session/grader were made action-generic through `VectorCoreGame`, with
  no update arithmetic or traversal-order change. Backend version remains 1; canonical
  game identities explicitly distinguish turn-v1 from turn-v2 rules. All existing
  hidden-hand/future-card cheating and exhaustive best-response regressions remain.
  The complete M2 artifact reproduced unchanged immediately after extraction:
  policy `bbddc1565a366bb42d03839f4d25a7d223c73f54bd40766246f854fd34ace699`,
  payload `1a51682bf8073f723cf0222e5630b1e9f21ab0b03d2df9a89d73718dcda17684`.

This is internal differential/oracle evidence, not third-party certification. A 256-iteration
pass on these fixtures does not promise that arbitrary admitted games converge that fast.

## Resource contract and measurements

Maximum 64 unblocked combinations/player, relative weights >=1e-12 of that player's
maximum, 16,384 characters/range, 1,000,000-chip amounts, 100,000 iterations. Reject above
20,000 public states, 250,000 information-set upper bound, 750,000 action-slot upper bound,
32 MiB estimated checkpoint JSON or the memory budget. Invalid/unknown input fields fail
closed, including sparse arrays passed directly to the library (not representable as
holes in JSON). No silent range pruning, action clipping or limit expansion.

M3's separate budget is min(2 GiB, reported physical RAM/8), within the parent plan's
approved envelope. M2 keeps its 1 GiB cap. Wide estimated peak: 1,263,259,648 bytes;
estimated checkpoint ceiling: 21,115,392 bytes. The admission rule therefore needs about
9.42 GiB reported physical RAM for the wide case; a smaller machine must use a smaller
declared request, not disable the check. Reported physical memory is not free RAM.

First accepted run: Apple M1 Pro, arm64 macOS, Node 24.10.0, 32 GiB physical RAM.

| Fixture | End-to-end job ms | Sampled worker peak bytes | Sampled parent peak bytes | Sampled combined peak bytes |
|---|---:|---:|---:|---:|
| wide-64 | 17,082.0 | 637,075,456 | 204,046,336 | 841,121,792 |
| dry-value | 1,322.4 | 170,016,768 | 562,544,640 | 732,561,408 |
| paired-short | 1,623.3 | 191,250,432 | 519,389,184 | 710,639,616 |
| two-tone | 1,087.8 | 144,834,560 | 525,074,432 | 611,647,488 |
| connected | 1,906.9 | 196,526,080 | 471,285,760 | 667,811,840 |

Times include parent preflight, process startup, compile, CFR+, independent vector grade
and export/worker close. The extra parent-side pair-oracle check is outside these job
times. Parent memory in later rows includes the previous audit artifact/game awaiting GC;
separate peaks are not necessarily simultaneous. Combined samples use the parent's current
RSS plus the latest reported worker RSS. They may double-count shared pages and miss
transient peaks. This is conservative sampled monitoring, **not OS-enforced total memory**.
The runner rejects observed overruns and has a ten-minute total timeout; V8 old-space
also has a limit, but neither establishes available RAM or catches every transient peak.

The separate phase profile uses one warmup and five samples of **64 CFR+ iterations**,
delay 20, with each fixture in its own process. These short profiles are not accepted
policies: their exploitabilities were 0.3253 (wide) and 0.8748 (dry) chips. They measure
phase costs, not time-to-quality. Full samples print from `npm run profile:turn:v2`.

| Fixture | Compile ms | Iteration ms | Snapshot ms | Vector grade ms | Pair-oracle grade ms | Policy JSON ms | Checkpoint JSON ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| wide-64 | 261.97 | 52.51 | 323.11 | 148.48 | 8,613.72 | 344.40 | 150.63 |
| dry-value | 21.51 | 3.73 | 15.50 | 7.92 | 29.49 | 9.93 | 6.71 |

Wide typed storage was 5,458,527 bytes compiled, 26,024,080 session working and
3,085,384 grading working; checkpoint JSON at 64 iterations was 9,683,686 bytes, within
the estimated ceiling. The wide five-sample process reached 1,134.8 MiB max RSS; the dry
process reached 287.2 MiB. Those peaks include discarded prior samples awaiting GC and
are not single-worker solve-to-quality peaks. The roughly 58x grade difference is against
our deliberately simple explicit-pair **oracle**, not an optimized external solver.

## CLI, checkpoints and operational guarantees

```sh
npm run audit:turn:v2
npm run profile:turn:v2
npm run --silent solve:turn:v2 -- --fixture dry-value
npm run --silent solve:turn:v2 -- --fixture wide-64 --checkpoint fresh.json
npm run --silent solve:turn:v2 -- --resume fresh.json --checkpoint another-fresh.json
```

`--request file.json` accepts only versioned turn-v2 requests. Default target is **0.25
chip**, unlike the M2 CLI's default 0.25% of pot. `--target-chips`, `--iterations`,
`--algorithm`, `--delay` and a shorter `--timeout-ms` are explicit settings. Stdout is a
complete JSON report; stderr contains actual phase/iteration/last-grade events. Exit 0
means quality target met; 2 means iteration budget ended with an explicitly unaccepted
policy; 1 means error/cancellation/timeout, with no policy JSON. No fake progress or restarts.

One isolated CPU worker advances full iterations in chunks. Cancellation during compile,
solve, grade, checkpoint or export returns no result. Already-written complete checkpoints
survive cancellation. Restores validate checksum, version, identity, options, arrays and
numerical bounds, then independently regrade the restored policy. A v1 checkpoint cannot
be used as v2. The full wider checkpoint resumes to the accepted policy hash exactly.

Checkpoint I/O shares M2's unchanged bounded codec and fresh-path atomic writer. Output
must be a new file, not the resume input. Same-iteration continuation is bit-identical;
an extra resume-time quality check can end an invocation earlier. Grade history belongs
to the current invocation. Checksums detect corruption, not authenticity or honest training.
Atomic replacement is restricted to the writer-owned target; no claim of adversarial
filesystem locking or power-loss directory durability. Unsaved completed work can be lost.

## External referee investigation — not a numerical validation claim

The earlier pinned MIT reference's branch-dependent pot-fraction raises are already
documented as mismatching fixed absolute menus in the
[v3 audit](configurable-river-v3-audit.md#independent-open-source-referee-attempted-not-forced).
That finding does not prove every other solver is incompatible.

On 2026-09-23, primary documentation for `b-inary/postflop-solver` was inspected.
Its [tree configuration](https://b-inary.github.io/postflop_solver/postflop_solver/struct.TreeConfig.html)
supports turn starts, effective stacks and configurable automatic-all-in/merging thresholds;
its [action-tree API](https://b-inary.github.io/postflop_solver/postflop_solver/struct.ActionTree.html)
allows individual lines to be added/removed. A carefully matched external test may be
possible, but no action-tree equivalence or numerical match was established here.

The installed tools report Cargo 1.56.0 and rustc 1.56.1. The candidate's current
[manifest](https://github.com/b-inary/postflop-solver/blob/main/Cargo.toml) uses namespaced
optional-dependency and weak-dependency features introduced in
[Cargo 1.60](https://blog.rust-lang.org/2022/04/07/Rust-1.60.0/), so the installed toolchain
cannot directly use that manifest. No toolchain upgrade was performed. Its
[AGPL-3.0-or-later licensing](https://github.com/b-inary/postflop-solver#license) also needs
explicit consideration before any future integration. No third-party source was copied,
linked, installed as a dependency, or distributed in this milestone. An external numerical
referee remains a limitation and a separately scoped follow-up, not a release claim.

## Release verification

Verified locally on 2026-09-23. A separate export of the staged release was built and
tested without the unrelated local trainer changes. The final source includes sparse-array
validation hardening; all five accepted artifact hashes stayed unchanged afterward.

| Check | Working tree | Clean staged release |
|---|---:|---:|
| Unit tests | 623 passed | 612 passed |
| Production Chromium tests, zero retries | 38 passed | 35 passed |
| Type-check, ESLint, production build | Passed | Passed |

The difference is 11 unit tests and three browser tests belonging to preserved unrelated
trainer work. M3 adds 51 unit tests. Browser coverage includes keyboard behavior, real
workers, cancellation, stale events, validation and responsive layouts at 320/390/1280px.
Clean comparison-result screenshots at 320px and 1280px were also visually inspected.
No UI source, test expectation or timeout was changed for this milestone.

One additional clean-browser run failed the existing comparison validation test's
five-second assertion while two full unit suites and a Node 20 artifact audit were running
concurrently. The failure snapshot still said “Counting both games in the background…”;
the expected validation alert had not arrived. This is evidence of a timing-sensitive
failure under that load, not proof of its root cause. Once those jobs finished, the entire
unchanged suite passed in 29.3 seconds with zero retries. The failed run is not counted as
a pass. Separate pre-test launch failures (missing production build, then a sandbox-denied
local listener) ran no tests; a build and the permitted local-server launch resolved them.

Both Node 24.10.0 and Node 20.20.0 reproduced all five v2 policy files byte-for-byte and
matched explicit-pair grades. The clean release also reproduced the M2 vector artifact.
All 17 older audit commands passed, including the exhaustive 2,598,960 five-card evaluator
audit, Kuhn/Leduc, turn/compact turn, every river backend, strategy exchange, and the five
multiway proofs. River v3 still reports value `16.081056725`, gains
`0.014993444`/`0.003155818`, and exploitability `0.009074631` chips.

All four resource profiles passed: configurable turn, vector turn, compact turn, and
factorized river. They were run separately from heavy verification jobs. The factorized
river boundary still admits 10,240 deals/87 public states/890,881 equivalent states and
refuses oversized requests; no legacy admission cap was raised.

Representative repeat commands (run the browser suite separately from CPU-heavy audits):

```sh
npm run typecheck
npm run lint
npm test
npm run audit:turn:v2
npm run audit:turn:vector
npm run audit:math
npm run audit:river:v3
npm run profile:turn:v2
npm run profile:turn:vector
npm run profile:turn:compact
npm run profile:river:factorized
npm run build
CI=1 npm run test:e2e -- --retries=0 --reporter=list
```

The commit is restricted to 34 explicit milestone paths. All 374 indexed files were
compared with the clean export by Git blob hash. The seven other unrelated files retain
their starting SHA-256 hashes; the original unrelated README additions/deletions remain
unstaged, separate from its staged solver update. CI now includes v2 corpus reproduction;
local success is not a claim that a future hosted CI run has passed.

## Next bounded milestone

M4: a thin saved-turn explorer with compact derived data, clear turn-to-river consequences,
keyboard/mobile access and honest conditional explanations. Do not load this 23 MB wide
policy into the initial browser bundle. Lock its teaching/explanation and data-budget
contract first. Full-range solving, a joint flop engine, custom wide browser solving,
opponent locking, additional raises and neural/GPU acceleration remain separate work.
