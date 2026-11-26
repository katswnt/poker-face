# R0 v2 — separately versioned full-tree scorer repair

Prospective contract, 2026-11-25. Parent: [original R0](robopoker-r0-spec.md).
The user requested continuation of the remaining CPU roadmap after release `0f23c2e`.
This study preserves the rejected original pin, its sources and all observations.

## Frozen experiment

Vendor the exact published mccfr 1.2.0 sources (upstream commit
`72360adc7fbc6afa4119be3aefcc0e990d3789a7`, registry archive SHA-256
`1dfd2105c16c338e5a385a0cbbe9454f5673ce1bd2ac99c4c8df065dffadadb4`)
as local version `1.2.0-poker-face.1`. Preserve MIT attribution and a manifest of
every original source hash. Add an explicitly named full-tree scorer; leave the
original scorer available for historical comparison. No training algorithm,
sampling hyperparameter, regret/weight schedule or default feature changes.

The repaired scorer operates on upstream fully expanded trees. It validates
complete legal actions, terminal leaves and perfect recall; computes chance and
opponent counterfactual reach; optimizes one action per information set in reverse
own-decision-depth order; and evaluates the resulting complete response. This is
independent of the existing TS grader's recursive information-set algorithm.
Use f64 accumulation of the exact stored f32 probabilities/payoffs. Normalize
each exported probability row explicitly in f64. Save the raw f32 rows and grade
both raw and normalized rows, reporting their value/response differences. Only
the normalized, complete profile is a probability-strategy certificate. Training
storage and updates stay f32. This is a local fork, never a passing result for
unchanged upstream 1.2.0.

Tests precede implementation. The original sequential witness must first expose
the wrong best response (1 instead of 10). Additional exhaustive small fixtures
cover hidden-state shared information sets, nonuniform integer-ticket chance,
zero-probability opponent branches, sequential decisions and imperfect-recall
refusal. The adapter retains the original boundary: chance only at the root,
bounded finite zero-sum trees and exact integer-ticket measures. No expanded
input/game scope is inferred from the generic scorer.

After tests, freeze all executable source, dependency, input and contract hashes
before measuring. Run the original uniform sequential witness and locked river
twice each, plus the additional witnesses twice each. Every accepted prerequisite
must have full-tree score, each player value and best-response agreement ≤1e-6
chips, deterministic numerical replay, <60,000 ms and <1,000,000,000 RSS bytes.

Only after every prerequisite passes, train the unchanged river with
LinearRegret + LinearWeight, ExternalSampling then PluribusSampling, exactly
100,000 epochs, one worker/tree per epoch, tree seed 20261122. Repeat each mode
once, same seed/count. Original gates remain: maximum unilateral gain ≤0.45 chips,
full unsampled sum of best responses / 3 versus independent NashConv / 3 within
1e-6 chips, identical numerical repeats, <60 seconds and <1 GB peak RSS. Capture
process wall time and native elapsed (including validation, training and grading),
compile separately. A 60-second process deadline is enforced. No tuning, adaptive
seeds/counts or unrecorded retries. Stop dependent runs at the first failed gate;
unattempted modes remain unattempted. A negative outcome is published as such.

Attempt files are exclusive-create and contain raw stdout/stderr/status before
assessment; all failures count. One frozen observation sequence, at most 12
prerequisite processes and four trained processes (16 process-minutes maximum).
Release replay uses the same inputs/parameters and is labelled verification,
never a new candidate. Source changes after freeze require a separately versioned
study; preserve earlier files. No external messages, deployment or paid compute.

## Ownership and release

New `native/robopoker-referee-v2/`, `src/lib/solver/multiway/robopoker-v2/`,
`scripts/audit-robopoker-r0-v2.ts`, tests and `tasks/artifacts/robopoker-r0-v2/`;
package/CI wiring and truthful research documentation. Preserve original R0,
independent graders, all native/WASM/app code and the user's unrelated changes.
Before release: exact isolated staged-tree full units, Rust tests, tsc, lint,
old/new R0 and relevant formation audits, prepared production build. Explicit
file commit/push and all hosted jobs green precede any dependent milestone.
Tiny three-player turn/river remains conditional on every R0 v2 gate passing;
preflop PF4 remains independently blocked by its original calibration failure.
