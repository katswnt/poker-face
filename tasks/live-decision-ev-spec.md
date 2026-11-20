# E1 — live decision values and model-relative action comparisons

Prospective contract, 2026-11-19, written before engine changes and failing tests.
Baseline code/release `b509656`; closing documentation `1a6ee2a`. R1 implementation CI
and deployment are verified; closing CI `44601114747` passed all eight jobs. E1
fail-first tests began after that release sequence finished. Follow the post-P5 plan, CPU roadmap working rules,
AGENTS and lessons. Historical solver artifacts, quality gates and protected work remain.

## Outcome and boundaries

At admitted live turn/river decisions in `/play`, show the acting hand's expected return
for every represented action, and compare the human's supported chosen action to the
highest-valued represented action. Values describe the continuation of ONE local solved
finite game. They do not predict play against the composed AI after later re-solving,
certify a Nash strategy, or turn the 23.4%-pot measured composed result into a guarantee.

No training, preflop promotion, live flop solving, new ranges, pruning, game/size changes,
session-score aggregation or side project. Saved-policy grades keep their current meaning.
Unsupported/translated decisions and hands with no valid model column remain unavailable.
The deployment safeguard, visible limitations and corresponding AGPL source remain required.

## Mathematical contract

Use CHIPS internally, 100 chips = 1 bb. An action's from-now value is

`E[payout at the terminal - (actor's terminal contributions - actor's contributions now)]`.

The expectation conditions on the actor's hand and the public history, with compatible
opponent hands weighted by their range and played action reach, and every compatible future
river card integrated. Both players then follow the local solve's continuation policy.
Earlier contributions are sunk. Folding therefore has value zero at a valid decision.
From an independently computed root-net utility, add startingPot/2 and the actor's current
committed chips. Never subtract the pot twice, use the opponent's contributions as the
actor's cost, or call pot-share percentages action values.

Example with only fold/call and no future betting: calling 20 into a current pot of 80
with 25% equity returns `0.25 * (80 + 20) - 20 = 5` chips; folding returns zero. This
example does not justify substituting all-in equity for a value when future betting remains.
After averaging both players' from-now values over compatible reaching deals under the
policy, their sum equals the current pot; future transfers cancel. Test that identity.

The table includes actions with zero frequency at a positive-reach parent. A zero action
probability is not proof that its value is zero or that it is unavailable. A board-blocked
hand, zero actor reach or zero blocker-compatible joint reach is unavailable (`null`) for
ALL actions. Nonfinite values at an otherwise valid positive-reach row are an export
error: refuse the result, never hide them as zero or null. A real zero value remains
a number, distinct from null.

A fail-first probe found that positive range weights near 1e-30 and 1e-20 can have
positive compatible mass near 1e-50, which underflows float32 normalization. Before
implementing the guard: preserve combinatorial reach support separately (initial positive
weights, nonzero action probabilities and card compatibility). If that support is positive
but the engine cannot normalize it, refuse the teaching export with an explicit error.
Do not prune the hand or label it unreachable; the default solver remains unchanged.
This is an export limitation, not a relaxed numerical tolerance or a new range model.

For a represented choice, `gap = max(action values) - selected value`. Maximize only AFTER
integrating the hidden opponent hand; never choose separately with knowledge of its cards.
Do not use the most frequent action or all-in equity as the best action. The comparison
keeps its exact model/spot identity and value convention. Display rounding is described
separately from numerical, solver-convergence and range/model errors. An aggregate
exploitability score does not bound each hand's value error. No "correct GTO" badge.

## Implementation contract

1. Add an opt-in, pre-allocation session capability for decision-value export. Native and
   WASM use the same shared Rust implementation and the same persistent DCFR session.
   Finalize once; do not solve again, reset regrets, modify checkpoints or add iterations.
   Enable only uncompressed turn/river sessions. Ordinary calls keep their exact old output.
2. Reuse upstream `expected_values_detail(actor)` with cached compatible normalized weights,
   as the existing audited slice exporter does. Preserve spot hand order and action order.
   Expose a versioned optional `decisionValues` block in the final result, with explicit
   from-now/chip/local-policy labels and `(nodeId, action-major nullable rows)` entries.
   Every exported player node has exactly one entry; no terminal/chance entries. Avoid
   duplicating actions/boards or exporting all later turn streets merely for teaching.
   A turn's first-street values still integrate its full solved river continuation.
3. Extend the small typed Worker request with an opt-in capability flag. The engine enables
   it before estimate/admission; extra value cells, JSON bytes and working memory are
   reserved then. Reject missing capabilities, inconsistent estimates, bad dimensions,
   partial coverage, mismatched identities, extra nodes or nonfinite cells before publishing.
   Retain cancellation, stale-message rejection, hard termination, time/memory limits and
   disposable instances. No main-thread solve or equity/frequency fallback.
4. Enable the capability for `/play`; general saved/W4 results and legacy solve callers may
   remain unchanged. Wire values into resolved and nested sources with an explicit
   `local-solved-policy` basis. Do not infer "saved" from the mere presence of EV rows.
   No new value influences range updates, action sampling, RNG, policy choice or settlement.
5. Bind a grade to the model shown BEFORE the human acts. Off-menu/zero-support preparation
   may replace a policy: preserve the original grade snapshot, or explicitly refuse a grade
   if the snapshot cannot be preserved. Never silently grade the earlier choice with a later
   augmented/translated model. Subsequent genuine decisions in that new local solve can have
   their own valid values. Keep the AI's actual-hand data hidden until hand completion.
6. Extend the existing decision table and grade explanation using native accessible markup,
   existing theme/scoped styles and plain language. Explain "expected chips returned from
   here minus chips still to pay" and "best listed return minus your choice". Label the
   particular local model and exclude later re-solving from the claim. Keep saved-policy
   wording/rounding intact. No new animation, dependency or protected global CSS edit.

If code inspection makes a different data shape materially safer, revise this contract
BEFORE implementing it, preserving the mathematical/coverage/admission gates above.

## Pros, costs and mitigations

| Benefit or cost | Implementation / mitigation |
|---|---|
| Learners can see the cost of a choice rather than guessing from its frequency | Show action values and the model-relative difference with explicit units |
| Shared native/WASM engine already computes the values | Extend export; independently verify semantics rather than trusting an API name |
| Sunk chips/forced prefixes can give plausible but wrong numbers | Independent complete-game recomputation, both seats, algebraic examples and mutation tests |
| Low or zero reach can create invalid conditioning | Null masks from compatible reach, zero-frequency parent tests, no invented values |
| Local policy differs from the later composed opponent | Persistent scope label, immutable grading identity, unchanged exploitability warning |
| Export adds CPU, serialization and memory | Pre-allocation reservation, measured full frozen corpus, unchanged admission/time gates |
| Source changes invalidate historical proof hashes | New complete source-bound successor evidence; old source/artifact bytes preserved |
| Near ties/rounding invite overconfident feedback | Report numeric model gap without an optimality badge or session total; explain error scope |

## Fail-first mathematical and boundary tests

- Tests initially reject the missing export capability; each behavioral change gets an
  assertion that fails before implementation. Preserve four pre-W1 numerical fingerprints.
- Use locked river v3, configurable-turn dry-value and suit-isomorphism referee fixtures,
  plus small explicit forced-prefix/all-in cases for BOTH actors. Validate trees/chip rules
  using the existing independent referee/reducer, not engine-reported EVs.
- Independently enumerate compatible private pairs and legal river cards for complete small
  games. Compute payouts with the independent hand evaluator; integrate fixed continuation
  strategies. Check every eligible action/hand/node and every unavailable row. Ensure the
  checker rejects altered chip origins, card blocking, action ordering and values.
- Check folds = 0; losing calls can be negative; zero-frequency actions retain meaningful
  EV; parent reach zero gives null; values need not lie between zero and starting pot.
  Cover forced historical bets, raises, returned uncalled chips, all-ins and ties.
- Locked B2 tolerance stays **2e-4 chips at referee scale**. Record maximum measured action
  value discrepancies, including native/WASM. Stop and investigate any failure; do not
  widen that tolerance. Large-pot production value comparisons require separately reported
  measurements and honest limitations, not an unearned per-hand numerical guarantee.
- For production-scale observations, freeze the five largest-pot P5 river games within
  the independent oracle's 3-million-work cap (spot-hash tie break). Every checked mask
  must match, and each maximum discrepancy must stay below **0.05 chips**, half the
  existing 0.1-chip display step. This additional display-resolution gate is separate
  from, and does not widen, the 0.0002-chip referee gate. It gives no universal per-hand
  bound. Record the preliminary observations and remeasure the frozen selection at release.
- Default vs enabled solving must preserve all strategies, root values, equity, iterations,
  checkpoints and quality exactly; strip ONLY the new teaching block for that comparison.
  Test that the projection cannot hide any changed old field. Native/WASM new-value parity
  is checked independently from the old-result comparison.
- Worker tests cover reservation before allocation, oversized-export refusal, absent/invalid
  capability, malformed/null rows, changed spot identity, stale events and cancellation
  during export/check. No partial or stale values may appear with a current decision.
- UI/model tests cover best-EV vs most-frequent action, ties, negative values, pending choice,
  exact history binding, both human seats, missing model hand, off-menu model replacement,
  translated decisions, saved-policy regression and hidden AI data.

## Source evidence and performance gates

Preserve all frozen P1–P5 inputs and historical bytes. New engine/runtime/source hashes
require measured successors with archived original source and complete current closure.
No hash allowlist, deleted source check, reduced corpus, invented report or old timing
relabeled as new. Fresh native and WASM policies must match the old mathematical results
and full logs/ledgers on the unchanged cases; the new teaching values get their own checks.

Re-run full-range admission and the frozen 200-case P3 browser corpus with value export
enabled. Retain the **Chromium turn p95 <=10 s** gate, existing river gates, exact replay,
range retention and independent quality targets. Measure solve/export/total time, actual
JSON bytes and peak linear memory in Chromium/Firefox/WebKit, plus available JS/process
memory without conflating those measures. No browser budget increase to accommodate this
feature. Firefox/WebKit retain their existing observer/time-limit contract; no new claim
that Firefox turns finish within 10 s. Phones remain unvalidated/nonblocking.

Retain the full 1,000-hand deterministic/conservation/leak gates and P5's frozen 200-hand
controller corpus. Teaching additions must not change a public solve request, selected
action, RNG state, hand log, range or ledger. Explicitly compare additional teaching views
separately from the unchanged poker behavior. Preserve all failed measurements.

## Execution and release checklist

- [x] Freeze this tracked contract before engine changes; record failing tests.
- [x] Shared opt-in export, strict validation and pre-allocation reservation implemented.
- [x] Independent action-value and native/WASM tests pass without changing old fingerprints.
- [x] Model-bound teaching/grade integration, no behavioral or hidden-card leakage changes.
- [x] Fresh source-bound successors and full frozen correctness/quality/performance gates pass.
- [x] Browser keyboard, 320/390/1280px, real 200% zoom, refusal/cancel/retry and live-grade
      checks pass; inspect screenshots. Saved-policy behavior remains intact.
- [x] Explicit owned files only; README staged from a clean blob. Exact commit in isolated
      checkout with copied dependencies: full unit suite, tsc, lint, relevant audits, Rust
      checks, asset reproduction and saved/prepared production builds pass.
- [x] Push and observe all eight CI jobs green. Rebuild/prepare source-complete assets from
      the clean release commit, use the guarded pinned Vercel procedure, verify deployed
      bytes/source links and real-hand teaching checks.
- [x] Update this record with measured values, commits, owned paths and limits; finish a
      dated handoff listing untouched work and the next drills contracts.

Do not promote a failed numerical or performance gate into a claim of completion. Record
the failure and its raw evidence; continue only independent work if a required gate cannot
be met. Physical-device absence is not such a blocker under the user's existing direction.

## Initial ownership (review explicit list before staging)

Shared native session/export/reservation and thin WASM/native bindings; typed optional
bridge teaching result and validation; W2 capability/admission/runtime; resolved/nested
policy value adapters; teaching-only grade/controller/UI files as needed; independent
oracle, unit/browser/audit tools and source-bound successor evidence; prospective spec,
task record, handoff and only corresponding README hunks. No trainer/session, globals,
paused configurable-flop, old frozen artifact or PF4 changes.

### Prospective evidence migration

Keep every historical P1–P5 bundle immutable. Use new, separately named E1 successor
bundles, each bound to its immediate historical parent and checked against the complete
current source closure. Re-measure the original capability-off P1–P4 gates, preserving
their exact mathematical and hand-log identities; these measurements must not be described
as capability-on performance. Separately capture the enabled frozen P3 corpus through
real Workers in all three browsers, native/WASM payload parity, enabled 1,000-hand replay,
and P5's enabled 200-hand controller corpus. P5 teaching snapshots may gain values, but
its exact public requests, actions, full logs and ledger must remain identical.

New P3/P4 input envelopes may update source/build/binary identities only. Compare the
entire remaining envelope, all cases, roots and baseline numerical hashes to the frozen
parent; never regenerate a conveniently different cohort. Archive the parent source bytes
as well as retaining the old report bundles. A successor does not authorize a stale source
check: each fresh report still passes the existing current-source checks and every original
quality, replay, latency and memory gate. All legacy mathematical projections remain intact.


## Candidate checkpoint — 2026-11-19 (uncommitted, not released)

R1 closing commit `1a6ee2a` passed all eight jobs in CI `44601114747`; the public
production assets still match `b509656` (verified again at 20:12:20 UTC). E1 work is
isolated in `/private/tmp/poker-live-ev-87kic_rz`, with copied dependencies. Protected
trainer/session/flop bytes and README hunks remain unchanged. No E1 commit or deployment.

Written tests failed before the export, independent oracle, validator, Worker handling,
policy basis, model-bound grading, adapters, immutable snapshot and page integration.
The native-runner test's first run was interrupted by sandbox denial of process sampling;
its original implementation was subsequently replayed with sampling permitted and failed
on the intended missing-value assertion. Both failures are retained, without calling the
sandbox error mathematical evidence.

Implemented in the candidate: optional shared native/WASM export and reservation;
strict final-data checks; disposable Worker admission/cancellation; explicit saved/local
value bases; exact-node adapters; immutable original human model/grade; and the `/play`
teaching table and comparison. No changes to iteration generation, poker actions or RNG.

Measured checks so far (not the final release gates):

- Independent complete pair/runout enumeration: river reference 176 deals / 22 player
  nodes / 707 numerical cells / 161 null cells, maximum discrepancy **0.0000339554 chips**;
  dry-turn reference 8 deals / 2,410 player nodes / 4,905 numerical cells / 13,893 null
  cells, **0.0000332481 chips**; suit-isomorphism probe 24 deals / 1,642 player nodes /
  9,427 numerical cells / 14,345 null cells, **0.0000304145 chips**. Fixed **0.0002-chip**
  referee gate unchanged. Native/WASM teaching payloads and all old math match exactly.
- Explicit checks cover 25%-equity calls (5 chips), sunk raises (15), negative
  zero-frequency calls (-20), tied showdowns (30), both actors, implicit all-in rivers,
  bad masks/values/chip origins, wrong model IDs and hidden-card maximization.
- The underflow probe initially exported null for positive compatible mass near 1e-50.
  Boolean reach support now detects this and refuses the optional teaching export.
  Default solving and four pre-W1 numerical fingerprints remain unchanged.
- **36/36** boundary/math/default-fingerprint tests, **23/23** Rust tests, **13/13**
  initial model/saved/controller checks and **11/11** adapter/snapshot/controller checks
  passed in their recorded runs. Typecheck and lint pass. The full suite is now running;
  historical source-bound audits still require successor evidence before release.
- Preliminary native compatibility probe: **327/327** previously accepted attempts in
  the frozen 200-case P3 corpus (62 river, 265 turn), every old mathematical field exact.
  All preliminary desktop/mobile reservations fit with preflight WASM memory set to zero;
  this is only a necessary lower bound, NOT measured browser admission or phone safety.
  Native wall p95 was 16.03 ms river / 3,100.84 ms turn in this exploratory run (other
  development tests ran concurrently). Maximum result bytes were 212,263 / 241,058;
  maximum export reservations were 12,369,024 / 14,405,568 bytes. These are not browser
  latency or heap measurements, and do not replace the final unchanged gates.
- The real Chromium page test failed first on the missing local-model heading, then
  passed after integration: cancellation/retry, no duplicate bet, real Worker values,
  keyboard-entered check and displayed gap independently calculated from the table.
  Test body 4.0 s; build plus test 15.7 s, zero retries. Full browser/visual checks remain.

Raw candidate logs are copied to ignored `build/post-p5-2026-11-19/E1-progress/` on
primary. The diagnostic probe's spots, raw results and report remain in the isolated
candidate's `build/e1-probe/`. The probe deliberately is NOT source-bound release proof.

Still required: preserve and extend historical P1–P5 proof chains with archived source,
fresh disabled/enabled native/WASM policies and full logs; full frozen browser timing and
memory gates; full 1,000-hand/P5 controller gates; all app/keyboard/visual/refusal suites;
exact-commit isolation; all eight CI jobs; guarded clean rebuild/deploy/public source-byte
verification; final task checkboxes, README hunks and handoff. No quality gate is waived.


### Frozen capture checkpoint — 2026-11-19

Before release measurements, froze 184 source files, the prospective contract, engine
source/build identity and native binary in `build/e1-release-inputs-01/source-freeze.json`.
No captured source has changed. Current isolated candidate remains uncommitted.

Both capability-off and capability-on P3 native runs completed all 200 frozen cases,
327 accepted attempts each. Compared every old mathematical field (removing only the
validated new teaching block), inputs, log, provenance and independent river grades
against the immutable original: exact equality. The enabled export contains 1,069,302
numerical cells and 191,582 explicit null cells. These are coverage counts, not
independent value recomputation for every production hand. The three tiny referee games
and frozen five production rivers provide the separate independent comparisons.

The three-browser `/play` suite passed 28 tests with two explicit non-Chromium real-zoom
API skips, zero retries. Expanded live-value checks passed all three browsers, including
320/390/1280px and 200% text scaling. Inspected Chromium mobile/text-zoom, Firefox mobile,
WebKit desktop, and Chromium real-200%-zoom screenshots: readable tables/controls, visible
focus and no horizontal overflow. This does not validate physical phones.

P1's two 1,000-hand captures and the remaining native and browser release gates are still
running/pending. No browser latency or memory claim is inferred from concurrent native
wall times. The initial full unit run's six stale-source failures remain open until the
new evidence is measured and independently checked; they are not waived.


### Native release captures and broader UI checks

Both P1 runs completed 1,000 hands, 1,342 solve requests and 32 independent river grades.
The 1,148 distinct enabled policies preserve every legacy mathematical hash and full hand
log against both the fresh disabled run and the immutable pre-E1 record. P5's enabled
200-hand controller run completed 301 requests / 295 distinct policies; its requests,
actions, complete logs, replay results, ledger and old mathematical fields match exactly.

The 200-case P2 river and P4 flop captures also completed, with 159 live requests in P4.
All four fixed complete-turn samples for P3 and all four for P4 pass the original quality
and engine/referee agreement gates. The 64-root P1 corpus completed with no range pruning;
its independent median exploitability is recorded in the raw report. Native wall times
were collected concurrently and are not browser-performance evidence.

Prepared app suite: **96/96** passed. Separate live-solver three-browser suite:
**34 pass / 2 explicit non-Chromium real-zoom API skips**, zero retries. The full source
freeze remains unchanged. Raw candidate reports are under `build/e1-release-01/`; logs
and primary ignored checkpoints preserve the exact commands and comparison outcomes.
Browser performance/memory, final successor checks, full unit/exact-commit verification,
CI and deployment remain open.


### Browser release sequence in progress

The full 1,000-hand P3 and P4 adapter replays passed. The 64-root capability-off P1
Chromium run passes: turn p95 **4,586.100 ms**, river p95 **85.701 ms**, exact native
parity for every root. Its independent native median exploitability is **0.244491558%**
of the starting pot, maximum **0.297718121%**, with no pruned reach mass.
The capability-off 200-case P2 Chromium timing run passes at **156.600 ms p95**.
These observations do not stand in for enabled-export performance.

All browser cohorts run serially after native audits/replays and app suites finish.
Ordinary desktop/macOS background services remain active; this is not a dedicated
isolated benchmark host. No unrelated process was stopped. Keep that context with
the local measurements; unchanged timing/memory gates still apply.

Added an explicit `audit:hu-play:e1` step to the existing CI verification job, alongside
P1–P5. This adds no job or changed quality threshold. The workflow file is outside
the 184-file measured pipeline; all captured sources and the prospective contract remain
unchanged. Candidate checklist ticks above record completed checks; the separate full
exact-commit, CI and deployed-release gates remain unticked.

## Final frozen browser measurements — candidate, 2026-11-19

The serial queue completed at 2026-11-20 01:22:31 UTC (November 19 locally). Every
capability-off P1–P4 browser gate and the additional enabled P3 gate passed. No case was
dropped or retried to replace a failure. All 184 frozen source files remained unchanged.
These are laptop observations with ordinary OS/desktop services active, not dedicated-host
or phone guarantees. Host context is retained with the raw measurements.

Enabled, uninstrumented Chromium: all 200 cases; turn-response p50 **1,320.65 ms**,
p95 **4,240.8 ms**, maximum **7,316.6 ms**; reached-river p95 **63.9 ms**. The unchanged
turn gate is 10,000 ms and river gate 2,000 ms. The small difference from the disabled
run (turn p95 4,303.8 ms) is not claimed as a speed improvement.

All **600** enabled measured cases pass exact native parity, replay, admission and Worker
lifecycle checks, with **327 actual exports per browser**:

| Browser | Turn response p95 | Reached-river p95 | Peak WASM linear bytes | Largest result bytes | Maximum observed `finish()` time |
|---|---:|---:|---:|---:|---:|
| Chromium | 4,312.7 ms | 66.6 ms | 31,260,672 | 241,051 | 68.800001 ms |
| Firefox | 50,507 ms | 162 ms | 31,260,672 | 241,071 | 812 ms |
| WebKit | 4,382 ms | 52 ms | 31,260,672 | 241,052 | 71 ms |

The peak is **29.8125 MiB**, versus 29.6875 MiB in the disabled P3 cohort. `finish()`
includes finalization/export; it is not the isolated marginal cost of the new values.
Actual serialized bytes come from the original returned UTF-8 string. The existing
Firefox/WebKit observer and 120-second timeout contract is unchanged; Firefox does not
meet Chromium's 10-second response gate. Maximum measured Firefox turn response was
88,280 ms. No browser budget was raised.

Worker JS heap readings were unavailable in every browser. Chromium supplied separate,
coarse page-heap observations (largest used value 14,300,000 bytes); Firefox/WebKit did not.
These are not total browser/process memory and are not added to the WASM number. Physical
phones remain unvalidated and nonblocking under the existing user direction.

Disabled P4 also passed all 200 timing cases and all 600 measured cases: uninstrumented
Chromium turn/river p95 **2,552.5 / 63.9 ms**; measured turn p95 **2,541.3 / 30,445 /
2,605 ms** in Chromium/Firefox/WebKit, with peak linear memory **22,937,600 bytes**.
These are explicitly disabled-export regression measurements, not enabled E1 timings.

Raw phase reports are in `build/e1-release-01/`; command logs are
`/private/tmp/e1-browser-release-queue-01.log` and its per-phase logs. New source-bound
successors are being validated and packaged separately; historical artifact bytes remain.
Exact-commit verification, hosted CI and deployment remain outstanding at this checkpoint.

## Captured source-bound evidence — 2026-11-19

All six captures validated before writing. The old bundles remain byte-for-byte intact;
the new bundles contain the archived parent sources and the current measured closure.
No source-identity allowlist, reduced corpus or relaxed tolerance was introduced.

| New bundle stem in `tasks/artifacts/` | Compressed bytes | Uncompressed bytes |
|---|---:|---:|
| `hu-play-p1-e1-successor` | 1,032,117 | 3,395,744 |
| `hu-play-p2-e1-successor` | 28,839,723 | 104,155,722 |
| `hu-play-p3-e1-successor` | 35,171,125 | 128,855,531 |
| `hu-play-p4-e1-successor` | 14,284,431 | 50,073,890 |
| `hu-play-p5-e1-successor` | 17,481,189 | 52,012,989 |
| `hu-play-e1-values` | 83,299,975 | 259,149,992 |

Each `.json` descriptor records the compressed hash, uncompressed hash and evidence
identity; summaries are independently recomputed by the audit commands. All remain within
the prospective 512 MiB uncompressed / 100 MiB compressed caps.

The E1 bundle binds 1,000 unchanged native hands (1,342 requests / 1,148 distinct policies),
all 200 enabled P3 cases (327 accepted solves), all 200 enabled P5 controller hands, all
three browser cohorts, the three independent tiny references and the frozen five largest
eligible production rivers. Tiny-reference maximum discrepancies remain 0.0000339554147,
0.0000332480847 and 0.0000304145231 chips under the unchanged 0.0002-chip gate. Production
river maxima are 0.0018037637010, 0.0023905496955, 0.0017198111282, 0.0020000000000 and
0.0015452649650 chips under the separate prospective 0.05-chip sample gate. This is not
a per-hand error bound for unmeasured games. Native/WASM teaching and old math match exactly
on the locked references and every frozen browser attempt.

Capture log: `/private/tmp/e1-after-browser-validation-01.log`; all six phases exited zero.
The complete unit suite and remaining release checks follow; no E1 commit or deployment
has occurred at this checkpoint.

## Candidate verification and permission block — 2026-11-19

The full post-capture suite ran 1,101 tests: **1,100 passed, one failed, zero skipped**
in 145.814 s. The only failure was a P5 mutation test expecting a hash-error message:
its one-chip ledger mutation was correctly rejected earlier by E1's full-identity guard.
The test now expects that precise guard for successor version 2, retaining the old hash
expectation for version 1. The corrected file passes **3/3**, zero skips, in 31.695 s.
No validator, solver, tolerance, numerical assertion or corpus was weakened. This test
file is outside the frozen measurement closure; all 184 measured source hashes still match.

Typecheck, lint, native/WASM formatting and Clippy, **23/23 Rust tests**, and every
P1–P5/E1 saved-evidence audit subsequently passed. Complete logs are backed up under
`build/post-p5-2026-11-19/E1-candidate-verified/` in primary, including the original
full-suite failure. A fresh full-green suite is still required; focused success is not
being relabelled as a green full run.

Automatic approval review timed out before launching the combined full rerun and its
retry, then also timed out on the narrower direct `npm test` request. It reported no
safety finding. A scoped sandbox probe confirmed that read-only `ps`, used by native
memory sampling, is denied. All checks that fit inside the sandbox have been completed.
An explicit user approval request for the test command is pending. No E1 commit, push
or deployment has occurred; exact-commit checks, all eight CI jobs and public release
verification remain mandatory. No unrelated files have been changed or staged.

## Approved full-suite rerun — 2026-11-20

Kat explicitly approved the native-memory-sampling test command. The unchanged candidate
passed **1,101/1,101 tests**, zero failures, cancellations or skips, in **144.988 s**.
Log: `/private/tmp/e1-full-suite-approved-05.log`. All 184 measured source hashes and the
76-file owned manifest still match. The previous permission-review block is resolved.
Candidate verification is complete; exact-commit verification, hosted CI and deployment
remain required before calling E1 released.


## Exact-commit release verification — 2026-11-20

Implementation commit `bfecbced77d8a70a1eee80315974d911a00541f5` contains only the
76 reviewed E1 paths. The complete explicit list is reproducible with
`git diff-tree --no-commit-id --name-only -r bfecbce`; the landing manifest and hashes
are also retained in ignored `build/post-p5-2026-11-19/E1-landing-2026-11-20/`.
README was staged from a clean blob. All 15 protected non-README hashes and all
49 added/removed trainer README lines remained unchanged.

A clean detached checkout, `/private/tmp/poker-e1-exact-67o58von`, used **copied**
node_modules. Native and WASM were rebuilt there with Rust 1.98.1 and wasm-bindgen
0.2.104; engine source SHA-256 remains
`f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981`.

- Full unit suite **1,101/1,101**, zero failures/skips, **156.370 s**. Typecheck and lint pass.
- Both Rust format/Clippy checks and all **23 Rust tests** pass.
- All 14 audits pass: bridge, WASM, saved example, river v3, heads-up library, P1–P5,
  E1 values, preflop reproduction, wide-range evidence and gadget study. Preflop remains
  research-only; reproduction is not validation or permission to promote PF4.
- All three-browser WASM and Worker harness checks pass. Historical solver identities
  remain unchanged, including river v3 value **16.081056725 chips** and exploitability
  **0.009074631 chips**.
- Saved-only preview build passes; its app suite has **87 passes / 9 explicit
  asset-required skips**. Missing production assets refuse before Next starts.
- Prepared production build passes with an intentionally unusable HTTP(S) proxy,
  confirming that its local font does not require a Google Fonts fetch.
- Prepared full app **96/96**. Three-browser play **28 passes / 2 explicit non-Chromium
  zoom-API skips**; live solver **34 passes / 2 same skips**. Zero retries throughout.
  Live-value tables at 320px and 1280px, WebKit 320px and real Chromium 200% browser
  zoom screenshots were inspected; the controls, value table, focus and source links fit.
- Pinned Vercel 62.1.0 packaging passes; all six packaged engine/source assets match
  the prepared files byte for byte. The release checkout remains clean.

Commands are retained in `build/post-p5-2026-11-19/E1-exact-bfecbce/verify.sh` with every
per-check log and screenshot under `logs/`. That script runs the full suite, typecheck,
lint, Rust checks, the 14 audits, both three-browser harnesses, saved/prepared builds,
and all three Playwright configurations, each with zero retries. The exact source
freeze and original measurement evidence remain intact; no corpus was recaptured or
tolerance changed to obtain these results.

The commit was pushed to main after these checks. Hosted
[CI 44813301904](https://github.com/katswnt/poker-face/actions/runs/44813301904)
passed all eight jobs; the completed production verification is recorded below.


## Production deployment — 2026-11-20

All eight jobs in [CI 44813301904](https://github.com/katswnt/poker-face/actions/runs/44813301904)
passed on `bfecbced77d8a70a1eee80315974d911a00541f5` before deployment.
The main push created no replacement production entry in the observed Vercel list.
Vercel CLI 62.1.0 then deployed the verified clean package to the existing project.

- Deployment: `dpl_8D4ohZcho7zqDt6yrhupq1sWxibM`; Ready, production.
- Immutable URL: <https://poker-face-ccf41zv03-kat-swints-projects.vercel.app>.
- Public page: <https://pokerface.katswint.com/play>.
- Build SHA-256: `9c60cd7b4f6d56e271f344caf8441836b88ed43f3054d0aa85076ed29b28dc7d`.
- Engine source SHA-256: `f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981`.
- WASM: **811,207 bytes**, SHA-256 `32efb5beef3f6668c0512799b5786f332694f27194256d80520b0bf476f5f5ec`.
- Corresponding AGPL source: **4,808,775 bytes**, SHA-256
  `35e959307a9dc5cbcad605975953cd3fddf91c7289b9a072753137a855e595ca`.

Public verification passed at **2026-11-20T21:14:09.749Z**: every one of the six fetched
assets matches the prepared distribution byte for byte. Both engine-serving pages link
the corresponding source archive and show the correct build identity; `/play` retains
the measured 23.4% warning. Different clean build paths/commit metadata can change
binary/archive bytes; this establishes source correspondence and numerical parity,
not a universal bit-identical-build claim.

Deployed three-browser play: **28 passes / 2 explicit non-Chromium zoom-API skips**,
zero failures/flakes/retries, **120.433 s**. This covers real
hands, off-menu actions, live EVs and original-model grades, missing-engine recovery,
Worker cancellation/retry, keyboard controls, source links, responsive layouts and real
Chromium 200% zoom. Deployed narrow live-value and zoom screenshots were inspected.
Physical phone performance remains unvalidated; the existing Firefox limitations remain.

Local release evidence is retained under ignored
`build/post-p5-2026-11-19/E1-exact-bfecbce/`; current machine-readable state is
`E1-release-current.json`. The closing documentation commit changes no app/engine code
and must pass isolated full tests, typecheck, lint and the 14 audits before push, followed
by all eight CI jobs. It is not a separate production deployment.
