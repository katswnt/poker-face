# Compact turn engine — M0/M1 release audit

Date: 2026-09-22. Baseline: `7d2ea37`. [Locked contract](compact-turn-engine-spec.md).
Parent: [CPU-first implementation plan](cpu-postflop-solver-plan.md).

## Outcome

Implemented an additive shared-public-tree turn backend, ordinary CFR, separately named
alternating CFR+, resumable sessions, detached snapshots and an isolated offline runner.
Both streets are still solved together. Exact river enumeration is not Monte Carlo, and
finite-iteration output is labeled an approximate strategy for this particular game.
No existing solver source, saved artifact, browser route or dependency changed.

This is a smaller structural representation, **not** larger-range admission or a general
postflop solver. Turn v1's limits remain: 8 combinations per range, 16 compatible deals,
25,000 equivalent repeated states, one opening amount per street, no raises, 100,000
iterations. Future M2 range-vector solving and scalable independent grading are not done.

## Acceptance and reproducibility

`npm run audit:turn:compact` compares the complete ordinary-CFR policy with the existing
artifact, compares CFR+ with the generic repeated-tree compact solver, and independently
grades both through the unchanged readable information-set scorekeeper. Both pass the
locked <=0.10-chip exploitability gate. CI runs this in addition to old turn reproduction.

| Original 3-deal fixture | Ordinary CFR | Alternating CFR+ |
|---|---:|---:|
| Iterations / averaging delay | 16,384 / 0 | 1,000 / 20 |
| Player-zero value, chips | 50.01255964562273 | 50 |
| Player-zero best-response gain | 0.008481881975271222 | 0 |
| Player-one best-response gain | 0.020804422711719894 | 0 |
| Exploitability, half Nash gap | 0.014643152343495558 | 0 |
| Complete policy matches its comparison | Exactly | Exactly |

The zero CFR+ grade is the floating-point result on this very small fixture, not a
general accuracy guarantee, symbolic equilibrium proof, or external-solver validation.
Ordinary CFR also matches every saved convergence checkpoint's grade exactly. The old
artifact still reproduces byte-for-byte with its original generator; it is not relabeled
as a new backend's artifact. No tolerance or quality target was weakened after the runs.

Both compile to 1,305 public states, equivalent to 3,592 full states, 1,088 information
sets and 132 legal private-deal/river pairs. The public union has 48 cards; each fixed
private pair masks its four cards, leaving exactly 44 at probability 1/44.

Hash manifest (SHA-256, canonical JSON; timing excluded):

- Original request: `75834f839bb1b28159b46a1eb894fe9a002e29ab0461357a6259d6452bfe29e3`
- Original rules: `b7aca81487749ed21b51478400da52352d3fc433b1b1925971938b134cb413c1`
- Existing artifact payload: `bd98eacacfb5de375cc8c485dfde8c44e890e41a151afa0d15caebcb7019995e`
- Ordinary full policy: `5dde7fbefe8cd7b7ab568b735991d818c0d76867d3f2ad7ca332180cb8f55e2f`
- CFR+ full policy: `6606a8e729846e8e0fbb14739bc741d1e023e66e56ddbfedb1aff269293626ba`
- Boundary request: `f3cbf31edf50e9f2b03298352760d826ce5bb72f338bd6567c165bf3b94d5603`
- Future M2 request: `279c58fd54b45fac11db44dcd2e840335496d6dbd69c400038e1bc37ce34f533`

The synthetic M2 fixture is fixed at 64 physical combinations per player and 3,773
compatible deals. It is correctly refused under current limits. It was not solved or
presented as a recommended playing range.

## Differential tests and information safety

The 35 new unit/integration tests cover:

- Every physical state, legal action, terminal payout and information-set multiplicity
  in the five fixed fixtures, including unequal/short/zero stacks and ties. These match
  the readable game. The old independent slow payout oracle remains in the release suite.
- River cards blocked by one deal but legal for another; no first-private-pair deck shortcut.
  Own hand/public history keys hide opposing hands and the future river. The existing
  positive cheating/exhaustive-best-response and update-order tests still pass.
- Current and average policies, cumulative regrets and checkpoints against repeated compact
  at 1/2/10/100 iterations; ordinary averages also against readable CFR. CFR+ delays 0 and
  20 test zero-average-mass fallback as well as actual averaging. Independent values and
  gains agree under the locked tolerance. Twelve generated short/asymmetric whole-chip
  games add differential coverage; reordered/rescaled ranges preserve policy.
- Bit-identical one-shot/chunked sessions despite intervening snapshots, snapshot mutation
  and interleaved independent sessions. A deliberate nonfinite internal mutation poisons
  the workspace instead of allowing partially updated output. Invalid options/checkpoints,
  memory admission, wider input and malformed/hidden-card-conditioned policies are refused.
- Real isolated-process execution, full JSON/payload-hash reproduction, independent
  regrading of exported policy, monotone completed counts/time, all four cancellation
  stages, timeout, invalid input, consumer failure and SIGINT without stdout policy.

The compiler reuses validated range preparation and public betting transitions. The new
numeric iteration loops differ from the reference loops; the independent grader does not
read their regrets. This is internal differential/oracle evidence, not third-party turn
solver parity. Compiled arrays are trusted internal, read-only by contract, not an import
format. Full restartable disk checkpoints are explicitly deferred to M2.

## Performance: smaller arrays, not yet a scalable solve

Environment: Node 24.10.0, macOS arm64, Apple M1 Pro, reported physical memory 32 GiB.
`profile:turn:baseline` measured the old paths before the new engine ran. Original/boundary
256-iteration median readable solves including compile were 218.24/779.85 ms; repeated
compact solve/snapshot 21.89/92.57 ms; independent grading 20.19/90.28 ms. Its whole-process
sequential high-water RSS was 260,928/317,072 KiB, not isolated per-fixture memory.

`npm run profile:turn:compact` then runs each fixture/backend in a separate process with
one 16-iteration warmup and five 256-iteration samples. All three resulting full policies
have identical hashes. The following measurements are observations, not speed gates:

| Boundary: 16 deals, 19,153 repeated states, 2,224 information sets | Readable | Repeated compact | Shared public |
|---|---:|---:|---:|
| Structural typed bytes | n/a (objects) | 977,650 | 88,685 |
| Solver working typed bytes | n/a (objects) | 926,248 | 201,888 |
| Median compile, ms | included below | 43.37 | 7.04, includes preparation |
| Median 256-iteration solve, ms | 860.74, includes compile | 91.08, includes snapshot | 183.32, advance only |
| Median detached snapshot, ms | included | included | 4.17 |
| Median independent grade, ms | 95.19 | 93.36 | 101.79 |
| Median serialization, ms | 5.43 | 6.47 | 2.96 |
| Isolated process high-water RSS, KiB | 302,976 | 296,048 | 295,808 |

The locked structural gate was <=50% of repeated compact bytes; actual ratio is **9.07%**.
That is about 91% less structural typed storage, not 91% less total RAM. JS metadata,
snapshots, evaluator allocations, runtime/GC and repeated-tree grading still cost memory.
The shared path is about twice as slow as repeated compact in this small iteration test;
it avoids copied tree storage but still loops over private pairs. Total RSS is roughly
unchanged between compact paths. M2 changes that arithmetic and grading representation.

On the original three-deal fixture, shared compile/advance/snapshot medians were
3.99/39.67/1.83 ms; structural/workspace bytes 60,209/120,096; RSS 174,672 KiB, versus
169,872 KiB repeated compact and 256,752 KiB readable. Small-process differences are not
general memory guarantees. At 256 iterations these profiles are not accepted full solves:
exploitabilities are 0.933010412 chips (original) and 0.664016748 chips (boundary).

## Offline workflow and resource limits

```sh
npm run solve:turn:compact -- --fixture demo --iterations 1000 --algorithm cfr-plus --delay 20
npm run solve:turn:compact -- --fixture boundary --iterations 256 --algorithm vanilla
npm run solve:turn:compact -- --request turn-request.json --timeout-ms 30000
npm run audit:turn:compact
npm run profile:turn:baseline
npm run profile:turn:compact
```

Custom JSON uses the existing `TurnRequest` shape: `id`, four-card `board`, two `rangeText`
strings, `committedPerPlayer` (half the starting pot), two `stackBehind` values, and two
`betSizes` (turn then river). All chip quantities obey v1 whole-chip validation. Request
files must be regular files of at most 64 KiB. No output path is opened or overwritten.

The parent validates request/options and admission before starting one child worker
process. The worker runs the same resumable session in chunks of 32 complete iterations,
then independently grades and serializes. JSON progress goes to stderr; completed hashed
results go to stdout only after a successful worker close. Iterations are not an accuracy
percentage. Exploitability is measured after completion; there is no invented live grade.
Consumer exceptions, SIGINT/SIGTERM, timeout or sampled-RSS violations terminate this
isolated worker and return an error, never a partial accepted policy. Cancellation during
a numeric iteration discards that worker; the in-memory API itself advances whole iterations.

Limits: at most ten minutes and 100,000 iterations; a conservative 512 MiB preflight
estimate; 384 MiB V8 old-space guard; stage/chunk RSS samples refused above 512 MiB.
Profiling prompted raising the estimate's fixed runtime/GC reserve from 32 to 160 MiB;
the 512 MiB ceiling and original game caps were not increased. This tightens admission
headroom; it does not change any game, policy, grade or timing acceptance gate.
These are not a precise OS-enforced total-memory ceiling. Sampling can miss transient
peaks during synchronous phases; output/parent memory and runtime overhead are additional.
Current tiny game caps are retained to bound that risk. No browser synchronous fallback,
UI change, disk restart, paid compute or external implementation is involved.

## Release verification

Working tree: 518 unit tests and 38 Chromium tests passed (no retries), including existing
keyboard and phone/desktop visual checks; production build, type-checking and lint passed.
A clean export of only the staged release passed 507 unit tests, 35 Chromium tests with
no retries, type-checking, lint, production build, compact-turn acceptance and byte-for-byte
old turn reproduction. The differing totals are the preserved uncommitted trainer tests,
not skipped release tests. Lint runs overlapping Playwright saw warnings in transient trace
JavaScript; reruns after Playwright completed were clean in both trees.

The clean export's 35 new focused tests and full compact acceptance also passed under
locally installed Node 20.20.0, with the same policy hashes as Node 24. CI uses Node 20;
this is local runtime-family coverage, not a claim to have executed GitHub's Linux runner.
The README's solver-only hunks are staged separately from its original trainer edits;
every original added/removed line remains unstaged. Other unrelated local files retain
their original SHA-256 hashes. Only implementation comments, admission headroom and this
audit record changed after the full clean tests; all 35 focused tests, compact acceptance,
types and lint passed again in both the working tree and refreshed release export.

Additional completed release checks:

- `audit:math`: all 2,598,960 five-card hands match canonical category totals.
- `audit:kuhn`, `audit:leduc`, `audit:turn`, `audit:river`, `audit:river:v2`,
  `audit:river:v3`, `audit:river:exchange`: saved artifacts/manifests reproduce.
- `audit:river:compact`, `audit:river:scorekeeper`, `audit:river:factorized`: passed;
  zero measured policy/regret/value differences in their parity reports.
- `audit:multiway-river`, `audit:multiway-raised-river`, `audit:multiway-two-size-river`,
  `audit:multiway-side-pot-river`, `audit:multiway-four-player-river`: all five saved
  artifacts reproduce. The longer runs were allowed to finish; no artifact was rewritten.
- `profile:river:factorized`: existing boundary still handles 10,240 compatible deals,
  87 public states and 890,881 equivalent states. Observed 26.81 ms/CFR+ iteration and
  55.63 ms/grade; observations only, not performance acceptance thresholds.
- `profile:turn:baseline` and `profile:turn:compact`: completed as reported above.

Commands use `npm run <name>`; full suites were `npm test`, `npm run typecheck`,
`npm run lint`, `npm run build`, and `CI=1 npm run test:e2e -- --retries=0 --reporter=list`
with the existing local Chromium installation. No browser functionality changed, so
these are regression checks, not new turn-UI accessibility or screen-reader claims.

## Next bounded milestone

Lock M2's blocker-sum/rank-group kernels, vector reach/value propagation and independent
scorekeeper contract. Check them against explicit private-pair walks before increasing
limits. Then attempt the fixed 64-by-64/3,773-deal fixture under the parent plan's resource
and <=0.25%-of-pot quality gate. Keep tiny-reference/cheating tests and current browser caps.
Raises, additional sizes, flop solving and a saved-result explorer remain later milestones.
