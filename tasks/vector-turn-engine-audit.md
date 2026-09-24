# Wider-range vector turn engine — M2 audit

2026-09-23. Baseline `6ed0469`. Contract:
[vector turn specification](vector-turn-engine-spec.md); parent:
[CPU-first implementation plan](cpu-postflop-solver-plan.md).

## Delivered scope and limits

A separate offline CPU backend solves the same finite turn-v1 game jointly across turn
and river, now with up to 64 unblocked physical combinations per player. It has ordinary
CFR, alternating CFR+, a separate vector value/best-response grader, explicit-pair
terminal oracles, complete disk checkpoints and an isolated cancellable CLI process.
There are no neural models, GPU dependencies, Monte Carlo leaves, raises, additional
betting sizes, flop game, or new UI. The existing solver source/artifacts and browser
100,000-state teaching cap are unchanged.

The 64-combination cap is admission, not a guarantee that every such game reaches any
chosen quality target within ten minutes. Weight ratios below 1e-12 are explicitly
refused. Whole-chip inputs and all old turn-v1 payout/minimum input restrictions remain.
The artifact is a finite-iteration approximate strategy, not exact or universal GTO.
There is no external compatible turn-solver comparison.

## Locked acceptance result

No benchmark, tolerance or acceptance threshold was changed after seeing a solve.
The M0-fixed synthetic request is `POSTFLOP_M2_PROBE`: board `9c 7d 4h 2s`, 64 weighted
combinations each, pot 100, stacks 150/150, one 50-chip turn bet and one 100-chip river bet.
These synthetic ranges exercise computation; they are not recommended preflop strategies.

| Quantity | Accepted result |
|---|---:|
| Compatible private deals | 3,773 |
| Legal rivers per deal / deal–river pairs | 44 / 166,012 |
| Stored public states | 1,305 |
| Equivalent repeated states / terminals | 4,516,282 / 2,497,726 |
| Information sets | 35,584 |
| CFR+ iterations / averaging delay | 256 / 20 |
| Player 0 value | −6.754015282174491 chips |
| Best-response gains, players 0 / 1 | 0.034413023994080305 / 0.01900159501199372 chips |
| Exploitability, half Nash gap | 0.026707309503037013 chips |
| Explicit-pair grader exploitability | 0.02670730950303657 chips |
| Required maximum / preferred maximum | 0.25 / 0.10 chip |
| Stop reason | Quality met at first scheduled checkpoint, 256 |

The 0.0267073% of pot number measures incentive to deviate, not action-frequency error.
Exact card enumeration still uses floating-point arithmetic; grading differences here
are well within the pre-set 2e-8-chip tolerance, not proof of exact real-number arithmetic.

Full policy: `src/lib/solver/postflop/vector/artifacts/heads-up-turn-vector-v1.json`
(4,377,115 bytes including newline), not imported by a browser route.

```text
Request SHA-256: 279c58fd54b45fac11db44dcd2e840335496d6dbd69c400038e1bc37ce34f533
Policy SHA-256:  bbddc1565a366bb42d03839f4d25a7d223c73f54bd40766246f854fd34ace699
Payload SHA-256: 1a51682bf8073f723cf0222e5630b1e9f21ab0b03d2df9a89d73718dcda17684
```

`npm run audit:turn:vector` repeats the locked schedule, compares the complete serialized
artifact, and grades its policy again with explicit pairs. `generate:turn:vector` is the
intentional regeneration command. CI adds the non-mutating audit. Reproduction passed
on local Node 24.10.0 and Node 20.20.0; timing is excluded from the artifact hash.

## Correctness and independence evidence

- Public topology comes from a constant one-deal v1 rules harness, **not** the actual
  wide pair population. Only public histories, actions and transitions are reused.
  Its private ranks/deck/probabilities are never used for actual range values.
- Range compilation, root compatible counts and root normalization do not materialize
  a private-pair or pair/runout list. All 48 board-unblocked public rivers are present;
  every compatible private pair has exactly 44 legal outcomes at 1/44.
- Fold kernels use per-card incidence sums; showdown kernels use strict rank sweeps.
  Separate quadratic kernels compare actual physical cards and rank pairs. Tests cover
  both players, all public rivers, ties, shared/identical hands, zero reach, unequal weights,
  blocked and unsupported hands, short/zero stacks, suit relabeling and common weight scaling.
- Near-cancellation queries use integer support counts plus an explicit positive-mass
  fallback when the result is at most 2% of the accumulated pool. Review identified that
  an epsilon-only check could retain a large *relative* error in a tiny legal root mass.
  The fix preceded the acceptance solve. A regression where the only legal pair has
  normalized weight 1e-24 now matches M1; no tolerance was widened or small hand discarded.
- At 1/2/10/100 iterations, five tiny fixtures compare both current and average policy
  and regrets with the unchanged M1 engine for ordinary CFR and CFR+ (delays 0/20).
  Explicit-pair session kernels separately agree on regrets and averaging sums.
- The independent grader has its own depth-first traversal and never imports CFR or
  session code. Work buffers are depth × hand, not pair × public state. It shares only
  immutable game/rank data and audited terminal primitives. Uniform, pure, seeded mixed,
  and accepted wide policies agree with explicit-pair grading; tiny policies also agree
  with the readable scorekeeper.
- An exhaustive reduced-game policy search agrees with the legal best response.
  Deliberately opponent-card- and future-river-peeking oracles gain illegally, proving
  that the tested legal grader does not use either advantage.
- Chunking, detached snapshots and JSON restore preserve the trajectory. Tests include
  the full wide checkpoint resuming to the accepted 256-iteration policy hash.
  Invalid identities, versions, dimensions, numeric values, iterations, regret signs,
  averaging bounds and checksums fail closed.

This is internal differential/oracle evidence, not an independently authored third-party
certification. The old readable engine and payout oracle remain essential references.

## Resource measurements and performance tradeoffs

Hardware: Apple M1 Pro, arm64 macOS, 32 GiB reported physical RAM, Node 24.10.0.
The first isolated accepted run took **3,343.6 ms** from runner entry through worker
close (preflight, startup, compile, CFR+, grade and export), with **309,493,760 bytes**
(295.2 MiB) sampled peak worker RSS. Node 20 reproduced in 4,306.6 ms with 200,032,256
bytes sampled peak worker RSS. These are observations, not cross-machine promises.
The audit's extra parent-side explicit-pair cross-check is outside those worker-run times.

The fixed prefix ladder uses the first 8/16/32/64 entries of each M0 range. Each row is
an isolated process, one warmup followed by five samples of **128 ordinary-CFR iterations**.
These timings are not CFR+ convergence times and those short profiles are not accepted
quality artifacts. Full samples are printed by `npm run profile:turn:vector`.

| Combos/player | Compatible deals | Compile ms | Iteration ms | Vector grade ms | Pair-oracle grade ms | Process max RSS MiB |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 39 | 12.74 | 1.085 | 3.21 | 29.95 | 210.3 |
| 16 | 207 | 21.10 | 2.030 | 6.89 | 104.99 | 292.1 |
| 32 | 909 | 35.25 | 3.794 | 11.76 | 389.31 | 400.0 |
| 64 | 3,773 | 65.56 | 7.469 | 25.34 | 1,496.65 | 582.3 |

At 64 combinations, median snapshot/export-policy serialization were 70.66/61.22 ms.
Showdown-vector kernels took 0.00274 ms versus the deliberately straightforward pair
oracle's 0.51453 ms per call. The ~59× grade/~188× kernel comparison exceeds the 3×
engineering target, but is **not** a speed claim against an optimized external solver.
The pair oracle deliberately uses simple physical-card checks; microbenchmarks do not
predict solve-to-quality speed. At the wide profile, 3,368/18,120,704 mass queries used
the cancellation fallback (~0.019%). Its worst-case cost is still quadratic.

At the common tiny 16-deal boundary, readable/shared/vector results have matching grades
within floating tolerance. Shared/vector ordinary iteration medians were 0.715/0.592 ms;
readable 128-iteration solve including compilation took 454.27 ms. Readable/shared
grading was about 96 ms versus 1.81 ms vector. Vector policy bytes need not match scalar
accumulation order, even when grades agree; original M1 ordinary artifact parity remains
exact. A fresh `profile:turn:compact` run also repeated the readable/repeated/shared
comparison at **256** ordinary iterations. On the 16-deal boundary the repeated backend
took 42.41 ms compilation, 91.38 ms solve-plus-snapshot, and 90.03 ms readable grading;
shared took 6.82 ms compilation, 186.84 ms advance and 4.01 ms snapshot. Repeated compact
can still iterate faster on these tiny inputs; M2 is not a universal per-iteration speedup.
Those 256-iteration times are not a same-budget head-to-head with the 128-iteration table.

Wide structural typed arrays are 1,214,877 bytes; session numeric arrays 4,954,256 bytes;
grader numeric working storage 578,632 bytes. These are **not total memory**: information
keys, maps, policy snapshots, strings, JSON, runtime and garbage collection dominate RSS.
The repeated-sample profile's 582.3 MiB includes previous discarded samples awaiting GC;
it is not the single accepted worker's 295.2 MiB.

The runner estimates 505,305,088 peak bytes for the wide request and uses the smaller of
1 GiB and one eighth of reported physical RAM. It bounds V8 old space, samples worker RSS
at real progress boundaries, and terminates on observed overruns or ten-minute timeout.
Reported physical memory is not free RAM. Samples can miss transient peaks, and parent
IPC/checkpoint copies use additional RAM; there is **no OS-enforced total-memory guarantee**.
128/256-combination inputs are explicitly refused, not silently solved with trimmed ranges.

## Worker, checkpoint and CLI behavior

`solve:turn:vector` accepts the built-in wide/demo fixture, a bounded `TurnRequest` JSON,
or a full checkpoint. Reports are real compilation/solving/grading/checkpoint/export
events; the last grade retains its original iteration. No solve is restarted for animation.
The runner kills the child on cancellation, timeout, memory overrun or callback failure;
it only returns a result after a successful worker exit and flushed output.

Default quality checks occur at 256/1,024/4,096/16,384/65,536/100,000, plus a requested final
budget and a restored iteration. Exit 0: quality target met. Exit 2: budget exhausted
with unmet quality, explicitly labeled JSON. Exit 1: failure/cancellation, no policy JSON.
Targets are chip units; the default is 0.25% of starting pot. Reaching the budget is never
reported as reaching the target. Resume regrades can stop at a different iteration;
same-iteration continuation is bit-identical, not necessarily the whole invocation report.
Convergence history contains only grades from the current invocation.

Checkpoints include completed iterations, version/canonical game identity, complete regrets,
average sums, algorithm/delay/kernel/budget and a SHA-256 envelope. They are corruption
checks, not authentication or proof of training. Checkpoint output must start at a fresh
path; first publication cannot overwrite a raced existing file. Later writes use a synced
temporary file and atomic replacement of the writer-owned target, with inode checks.
Malformed writes and external replacement tests preserve the previous/user content.
No claim of power-loss directory durability or adversarial concurrent filesystem locking.
Resume input is never overwritten; a new output path is required. Cancellation can lose
unsaved completed work since the last checkpoint, but cannot export a partial iteration.

## Release verification

| Check | Working tree (includes unrelated trainer work) | Clean staged export |
|---|---|---|
| Full `npm test` | 572 passed | 561 passed |
| Type-check, lint, production build | Passed | Passed |
| Chromium, retries disabled | 38 passed | 35 passed on unchanged rerun; first run 34 passed / 1 existing randomized-test failure |
| New vector artifact reproduction | Node 24 and Node 20 passed | Node 24 passed |
| Compact turn complete-policy audit | Passed | Passed |

The differing test totals are the preserved, **unstaged** trainer/session work, not
skipped solver checks. All 54 new M2 tests are in the release. The CLI tests additionally
cover custom-input canonicalization through a real saved-file resume, settings preservation,
failure exit codes and retaining the input checkpoint.

The initial clean browser failure was `keyboard.spec.ts:44`'s existing language test.
The trace showed the Poker terms preference correctly persisted, but the randomly dealt
first decision was pocket sixes and its explanation contained none of `TERM_DEFINITIONS`.
The test unconditionally expected `.explained-term-button` after one step. No UI/runtime
source or that test changed in this milestone; an unchanged full rerun passed 35/35.
This is a known reproducibility gap, **not fixed by this release or hidden by retries**.
A future trainer-testing change should pin a hand with a known glossary term, rather
than depend on a random first decision. The user's dirty keyboard file remains untouched.

Existing responsive checks covered 320/390/1280-pixel layouts and enlarged text. Generated
320-pixel comparison and 1280-pixel river result screenshots were also visually inspected;
no new UI was introduced. This is Chromium coverage, not a screen-reader/cross-browser audit.

The following legacy checks all passed in the working tree, with unchanged reference
source/artifacts and matching accepted hashes (the clean export separately ran full unit
grading/regressions and compact/vector reproduction):

```sh
npm run audit:math
npm run audit:kuhn
npm run audit:leduc
npm run audit:turn
npm run audit:turn:compact
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
npm run profile:turn:compact
npm run profile:river:factorized
```

The five-card audit enumerated all 2,598,960 hands. V3 remains 176 deals, 63 public states,
1,000 iterations and exploitability 0.009074631 chips. Its exploratory factorized boundary
still has 10,240 deals, 87 public states and 890,881 equivalent states; freshly measured
26.95 ms per CFR+ iteration and 63.44 ms per grade. No reference acceptance was relaxed.

Release staging uses explicit paths. The solver-only README was built from `HEAD` and
verified against the original unrelated added/removed lines before staging. Hashes of
the other seven unrelated dirty/untracked files stayed identical. A separate index export,
with copied local dependencies, was built/tested without those unrelated features.
No third-party solver implementation, dependency or licensing change was introduced.

## Next bounded milestone

M3: new versioned richer turn/river betting rules with multiple declared opening sizes
and bounded raises; minimum raises, short all-ins, stack caps, no raising into an all-in
player, street resets and returned unmatched chips. Lock fixtures/resource gates first,
reduce single-size/no-raise games to v1 and completed-turn continuations to river v3,
then accept useful examples under independently measured quality. Do not treat this M2
capacity result as permission to raise caps, add a flop engine or imply full-range GTO.

## Known behavior: cross-engine CFR+ policies differ at near-indifferent spots (2026-09-24)

An external audit found that under CFR+ the compact and vector engines can report average
policies up to 0.5 apart at near-indifferent information sets. Cause: floating-point
cancellation leaves a cumulative regret like 7.3e-18 in one engine where the other has
exactly 0, so regret matching returns a pure action in one and uniform in the other.
Exploitability, values and best responses agree; vanilla CFR policies agree to 1e-10.

A shared zero floor on positive regret (`1e-14 · S · (t+1)`, S = committed + shortest stack)
was prototyped and **not adopted**:

- It removes the pure-vs-uniform flip only in the first iterations. CFR+ amplifies last-bit
  differences about 10× per 10 iterations (≈1e-3 by iteration 85), so no threshold makes
  two engines' policies bit-comparable at production iteration counts.
- Re-solving under it moved `turn-v2-paired-short` at 256 iterations from 0.0975 to 0.144
  chips. Floors from 1e-22 to 1e-12 scatter that number between 0.091 and 0.144, while every
  setting lands at 0.038–0.040 by 512 iterations: the 256-iteration value is a noisy point on
  the path, not a quality level.

Cross-engine checks therefore compare values, best responses and exploitability, never
CFR+ policy bits. The prototype patch is not in the repository.
