# Compact turn engine — M0/M1 locked contract

Date: 2026-09-22. Baseline: `7d2ea37`. Parent: [CPU-first plan](cpu-postflop-solver-plan.md).
Locked before implementing or running the new engine. M1 does not complete M2.

## Scope

An additive `src/lib/solver/postflop/` backend implements exactly turn-v1's existing
finite game and admission limits: 8 combinations per range, 16 compatible deals,
25,000 repeated states, one opening amount per street, no raises, 100,000 iterations.
There is no browser change, larger-range admission, sampling, neural model or GPU work.
The existing turn, river, toy engines and accepted artifacts remain unchanged.

## Compiler and information boundary

- Reuse the existing validated request, normalized compatible deals and public betting
  transitions. Store a shared public tree with terminal/player/river-chance node kinds.
- Enumerate the 48 board-unblocked public river candidates, not the first private pair's
  44-card deck. Mask the four private cards separately for each compatible deal.
- Each live private pair still has exactly 44 river outcomes, each with probability
  `1/44`. Global public branches unavailable to all private pairs may remain structural
  placeholders, but must never create an information set or carry positive chance mass.
- Store terminal matched-chip amounts and fold winners once; cache exact showdown
  signs by private pair and river outside the iteration loop. Showdown and fold utilities
  reduce to sign times matched contributions under the existing equal-prior-pot convention.
- Information coordinates are public node plus the actor's own hand. Map them to the
  unchanged turn-v1 keys and action order. Never use the opposing hand or future river
  to choose a turn action. Retain legal zero-strategy-reach information sets.
- Compile exact repeated node counts and information-set multiplicities; independently
  compare to `buildGameTreeIndex`. Validate before allocating arrays. Typed-byte estimates
  are not total process memory and must be labeled separately.

The compiler is an internal trusted numeric representation, not an external file format.
Its typed arrays are read-only by contract. Public entry points accept validated requests,
not untrusted imported compiled arrays.

## CFR conventions

Ordinary CFR freezes both players' strategies, traverses deals and legal public edges
in reference order, collects both regret deltas, accumulates own-reach averages once per
information set, then applies all deltas. Regret chance reach is the root deal probability
times `1/44` only after the river; backward river expectation also uses `1/44` for the
future edge, without duplicating past chance. Player reach never includes chance.

Add alternating CFR+ only after ordinary parity. It uses players 0 then 1, rebuilding
strategy between updates, floors cumulative regrets at zero, then accumulates the updated
profile with weight `max(0, iteration - averagingDelay)`. Compare to the existing generic
compact CFR+ implementation, which supports chance nodes. Algorithm/version are explicit.

`advance(n)` advances the same workspace by complete iterations. Chunking, observing
snapshots or interleaving independent sessions must not change arithmetic. Snapshot
strategies/maps/arrays are detached. At zero average mass use the defined current-policy
fallback; saved ordinary-CFR checkpoint fallback matches the reference's pre-update policy.
Reject invalid algorithms, iteration counts, delays, checkpoint lists and non-finite data.
At most 16 policy checkpoints are retained; full restartable disk checkpoints belong to M2.

## Independent evidence and tolerances

- Small public tree, legal actions, per-deal chance support, payout and information-set
  counts match the readable game exactly. Walk every accepted fixture terminal.
- Compare ordinary CFR to the readable and generic repeated-compact implementations
  at iterations 1, 2, 10 and 100; compare CFR+ to repeated compact at the same checkpoints,
  with delays 0 and 20. Add generated asymmetric/short-stack and tie cases.
- Require finite values first. Probability/strategy differences at most `1e-9`; accumulated
  chip regret differences at most `1e-9 * max(1, iterations * S)`, where `S` is maximum
  absolute terminal utility. Value/best-response differences at most `1e-10 * max(1,S)`.
- Preserve update-order, perfect-recall and deliberately cheating best-response regressions.
- Use the unchanged readable best-response grader for M1. It remains expensive and is
  not described as the new scalable scorekeeper. Reject malformed saved policies there.
- Locked full acceptance: ordinary CFR on the original fixture at 16,384 iterations,
  independently graded exploitability <=0.10 chip. Compare the complete policy to the
  old artifact, and reproduce that old artifact byte-for-byte. No new equilibrium claim.
- CFR+ demonstration budget: 1,000 iterations, delay 20, same <=0.10-chip gate. If missed,
  record the failure; do not weaken the gate. Ordinary equivalence is the primary M1 gate.

## Benchmark matrix and gates

`postflop/fixtures.ts` defines the original weighted 3-deal fixture, a 16-deal boundary
fixture (board `9c 7d 4h 2s`, suited AQ versus suited JT, pot 100, stacks 150, bets 50/100),
and zero-/short-stack/tie fixtures. Hash requests and results in the audit command.

Baseline profiling measures preparation, index construction, readable solving including
its internal compilation, repeated-compact compilation/solving, independent grading,
serialization and process high-water RSS. Report five timed samples after a warmup at
256 iterations, plus the accepted full artifact reproduction. New profiling adds shared
compilation, session advance and detached snapshot costs. Do not subtract two timings
and call the difference an exact measurement of hidden implementation phases.

M1 structural-storage gate: shared compiler typed arrays <=50% of repeated compact
compiler arrays on the 16-deal fixture. Report solver working arrays separately and
compare total process RSS in isolated runs; do not infer total-memory savings from this
gate. Runtime changes are observations, not a speed acceptance promise for M1.

Offline CLI: one isolated worker, at most 10 minutes and 100,000 iterations; validates
requests/options before work. Progress stages carry elapsed time and completed iteration
counts, not invented accuracy percentages. Signal/timeout cancellation terminates the
worker; cancelled/incomplete work never emits an accepted result. M1 is deliberately
small; a conservative 512 MiB preflight estimate cap and process RSS sampling protect
this path, without claiming a precise OS memory hard limit. No automatic resume from a
partial iteration; no silent synchronous browser fallback.

M2's future scale fixture is fixed in the fixture module before its solve: 64 weighted
physical combinations per player on `9c 7d 4h 2s`, selected by a deterministic stride
through all legal combinations, with at least 2,000 compatible pairs. It is a synthetic
performance benchmark, not a preflop recommendation. M1 must refuse it under unchanged
v1 limits. Its future quality target is <=0.25% of the 100-chip starting pot under the
parent plan's resource envelope; defining it does not claim to solve it now.

## Release

Unit/CLI cancellation and error tests; artifact and existing solver regressions; types,
lint, build and existing browser suites. Record baseline, hash-bound acceptance and
benchmark observations in `compact-turn-engine-audit.md`. Revalidate a clean staged
release separately from the dirty working tree. Preserve unrelated files and use explicit
staging. Do not add UI work or range-vector scaling to make M1 appear broader than it is.
