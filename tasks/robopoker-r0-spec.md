# R0 — pinned MCCFR prerequisite and river experiment

Prospective contract, 2026-11-22. Parent: [R0](robopoker-evaluation.md), CPU step 14.
No fixture, numerical gate or upstream algorithm changes are authorized by this record.

## Inputs and gate order

Use crates.io `mccfr = "=1.2.0"`, default features unchanged, a committed Cargo.lock,
and the published source's VCS commit `72360adc7fbc6afa4119be3aefcc0e990d3789a7`.
This differs from the earlier read-only review's commit. Preserve its MIT notice.
The published defaults include `server`; the old “no server dependency by default”
description is not applicable to this release. No database/network service is started.

1. Export the complete, existing `multiwayRiverV1Game` from its audited TS rules into
   a versioned finite-tree interchange. Preserve exact information-set strings, ordered
   legal actions, all terminal utilities and the original weighted compatible deals.
   Rust uses this tree as `CfrGame`/`CfrInfo`/`CfrEncoder`; it does not implement a second
   poker rules engine. Freeze/hash the canonical input and the actual exported bytes.
2. First validate the unchanged upstream **full-tree** scorekeeper against our grader
   on the uniform profile of this fixture. Its scorer treats chance children uniformly;
   represent each deal by exactly its integer product-of-range-weights number of tickets.
   Tickets share the same decision information sets and utilities. Assert the probability
   identity for every original deal, and include every ticket when grading (no sampling).
3. Also test a three-player zero-sum sequential counterexample: player 0 chooses take
   (payoffs `[1,-0.5,-0.5]`) or continue, then chooses lose `[-10,5,5]` or win `[10,-5,-5]`.
   Both information sets use the uniform profile. An exhaustive pure-policy enumeration
   must confirm the legal best response of 10. This checks that the scorer optimizes a
   player's later decisions when choosing an earlier action. It is diagnostic, not a
   replacement fixture or a relaxed acceptance gate.
4. Only if these prerequisites pass the original `1e-6` chip agreement bound, train the
   locked river fixture with LinearRegret + LinearWeight, first ExternalSampling then
   PluribusSampling, 100,000 epochs each, one worker/tree per epoch, tree seed 20261122.
   Repeat each run with the same seed/count. No adaptive iteration/seed search. Export
   every information set/action and grade the actual exported probability profile.
   Any necessary f32 normalization must be explicit and both profiles compared.
5. Each trained run must meet the parent's maximum per-player unilateral gain ≤0.45
   chips, full unsampled upstream ΣBR/3 versus independent NashConv/3 error ≤1e-6 chips,
   deterministic repeat, <60 seconds and <1,000,000,000 peak RSS bytes. Compilation is
   measured separately. Prerequisite execution is measured too. Stop dependent training
   or turn/river work at the first mathematical prerequisite failure; preserve evidence
   and distinguish unattempted training from poor convergence. Do not patch the upstream
   checker and call that a passing test of the pinned release.

## Implementation and tests

The CLI accepts only a bounded versioned finite tree and returns its full node count,
complete policy, upstream per-player profile values/best responses and upstream score.
No hidden cards in information-set IDs. It calls upstream scoring directly; no local
replacement of its score. Rust validates topology, chance tickets, utilities and
information-set consistency before indexing. TS independently verifies strategy identity,
chance weights, tree fingerprint and the scorer result. Hash all evidence and source files.
Fail-first tests cover missing adapter, malformed inputs, missing/extra information sets,
the weighted measure and the sequential-response witness. Preserve a failed mathematical
gate as a reproducible observation, with passing regression tests that assert its diagnosis.

Ownership: new `native/robopoker-referee/` (no target), new
`src/lib/solver/multiway/robopoker/`, `test/robopoker-r0.test.ts`,
`scripts/audit-robopoker-r0.ts`, package/CI audit wiring; this record, truthful README
hunks, roadmap/completion status and the closing handoff. Existing solver engines,
artifacts, native/WASM bridge, app and protected WIP remain unchanged.

## Release gates

- [x] Pinned dependency/API/licence and lockfile recorded.
- [x] Complete fixture identity, weighted measure and topology checks pass.
- [ ] Full-tree scorer prerequisites pass — **failed**, with the evidence below; training blocked.
- [ ] Both trained variants meet every original R0 gate; no Nash claim for 3+ players.
- [ ] Tiny turn/river follow-on contract/work, **only if R0 passes**.
- [x] Exact isolated commit: full units, tsc, lint, relevant audits/build; push, all CI green.
- [x] Measured outcome and open gates in [closing handoff](codex-handoff-2026-11-22.md).

## Measured outcome: prerequisite fails; dependent work blocked

Observed 2026-11-22 PST (`2026-11-23T02:30:53.928Z`), M1 Pro, Darwin arm64,
Rust 1.98.1. No upstream patch, fixture change, tolerance change or sampled-score
substitution. Both inputs were run twice in separate processes; numerical outputs match
exactly. Training was **not attempted** after this failure. The untrained uniform
profile's large gains are not a convergence result.

| Measurement | Locked river | Sequential witness |
|---|---:|---:|
| Original states | 4,301 | 5 |
| Information sets | 72 | 2 |
| Compatible deals / integer-weight tickets | 172 / 2,349 | No chance |
| Fully expanded upstream states | 58,726 | 5 |
| Upstream ΣBR/3 (chips) | 17.7059383392334 | 0.1666666716337204 |
| Independent NashConv/3 (chips) | 18.106108982545766 | 3.1666666666666665 |
| Absolute disagreement (chips) | **0.40017064331236796** | **2.999999995032946** |
| Maximum profile-value disagreement (chips) | 0.00000031910941977741913 | 0 |
| Native elapsed, two runs (ms) | 79.020541 / 52.710167 | 0.04975 / 0.031292 |
| Peak RSS, two runs (bytes) | 11,599,872 / 11,583,488 | 1,622,016 / 1,622,016 |

Native elapsed includes input parsing, tree validation/build, upstream grading and policy
export preparation; compilation and Node's independent grading are excluded. The initial
dependency build was not separately timed; release verification records compilation
separately. These times measure a scorekeeper prerequisite, **not MCCFR training speed**.
The 362,595-byte river interchange repeats only chance edges; every duplicate reaches
the original information-set ID, never a ticket-specific/private-deal observation.
Every ticket frequency equals the original weighted compatible-deal probability exactly.

### Which checker is wrong, and why

Pinned [`strategy/nash.rs`](https://github.com/krukah/robopoker/blob/72360adc7fbc6afa4119be3aefcc0e990d3789a7/crates/mccfr/src/strategy/nash.rs)
builds every best-response choice separately. `optimal_cfactual_payoff` calls
`external_payoff` below that action, which evaluates the hero's **average** continuation
policy. It then executes all those separately selected choices in `response_payoff`.
Earlier choices therefore need not be optimal when the hero's later choices also change.

The diagnostic game makes this exact, without card weights or hidden information:
take gives player 0 **1**; continue leads to lose (**−10**) or win (**+10**). Uniform
continuation has value 0, so upstream chooses take and reports BR value 1. A legal policy
chooses continue then win, for **10**. Our information-set recursion and independent
enumeration of all four pure policies both return 10. Other players have no decisions
and split the opposite payoff. Thus this is a proven upstream best-response defect on
the witness, not a float32 discrepancy or a disagreement about Nash terminology.
On the original river, player-0 BR is 30.42145538330078 upstream versus
31.6219667943806 independently; players 1/2 agree within 4.93e-7 chips. Profile values
agree within 3.20e-7, supporting the input/accounting adapter while the BR gate fails.

Do not generalize this to all upstream games, current releases or training quality.
No upstream issue/message has been sent. A future separately authorized study could
correct and independently validate their full-tree dynamic best response, then freeze
a new dependency/version contract and rerun R0. This run does not replace the pinned
checker or count its own checker twice. Three-player turn/river work remains blocked.

### Evidence, reproducibility and tests

Evidence: `src/lib/solver/multiway/robopoker/observations.json`, payload SHA-256
`efd765146bc9b7e86f3799598d7c42abfb961fbe5582b6f84292cc1734a715e8`.
River scenario hash: `472c36794c2ed0d267df57ebe88e361d8e12b03c2d874a58c8e1a86a1b96112b`;
compiled input: `85f2256aaea691098018b61af6cc81a502cb399b41408631f39c13f2f5acbdd3`.
Witness compiled input: `17d0aa57cd3f0993ae05351ada582dd33f963131a8dcf62240a1aab5904a27eb`.
The record binds all adapter/scorer source files and the lockfile; source edits require
new evidence, not relabelling the old observation. Runtime/RSS are remeasured on replay;
all numerical outputs, complete profiles and tree counts must match exactly.

The registry crate SHA-256 is
`1dfd2105c16c338e5a385a0cbbe9454f5673ce1bd2ac99c4c8df065dffadadb4`;
`.cargo_vcs_info.json` identifies the commit above. The exact upstream MIT licence was
retrieved from that commit through GitHub's contents API and preserved in
`native/robopoker-referee/THIRD_PARTY_NOTICES`. Cargo.lock pins transitive dependencies;
no Postgres, telemetry service, GPU or browser engine is launched by this adapter.

Fail-first: TS tests first failed with a missing adapter and then a missing audit module;
Rust tests first failed with undefined input/validation implementations. Now four TS
tests and three Rust tests pass: exact chance identity/complete strategy, malformed
topology/action/player/payoff/ticket refusal, exhaustive sequential reference, rejection
of false certificate/identity/truncated tree/nonfinite output, source-bound saved failure.
The original independent graders and existing artifacts are unchanged. The existing
multiway CI job also builds the pinned CLI and freshly repeats both failures on Linux.

```sh
npm run audit:robopoker:r0                  # read-only evidence/referee checks, no Rust
cargo test --release --locked --manifest-path native/robopoker-referee/Cargo.toml
npm run reproduce:robopoker:r0              # compile + two native repeats per input
```

Exit zero means the **recorded rejection is reproduced**, not that R0 passes. The audit
prints `blocked-upstream-best-response-prerequisite`. `--observe` refuses to overwrite
existing evidence. The actual evidence command is frozen in its own source hash.

### Release verification

Commit `868d5bf6d20a9894fa42d6f2c6f3ad621e5d7260`, pushed to origin/main after exact
verification in `/private/tmp/poker-r0-exact-4tdgtvjb` with real copied dependencies:
**1,180/1,180 units**, zero skips, 144,669.875333 ms; three Rust tests, fresh native
numerical replay, tsc, lint, 24 audits, a separate Node 20 formation audit, unchanged
preflop diagnosis and production build all pass. The timed warm Cargo build takes
0.14 seconds, 66,519,040 peak RSS bytes; this is not a clean dependency-build benchmark.
Fresh exact-checkout river grades take 69.488375 / 54.7795 ms with peak RSS
11,550,720 / 11,583,488 bytes and identical numerical results.

All eight jobs in [CI 45102016387](https://github.com/katswnt/poker-face/actions/runs/45102016387)
are green. Main CI: 1,180 tests, 1,087 passes and 93 existing binary-environment skips,
zero failures; 721,058.985745 ms. Separate binary jobs run their native/WASM checks.
Main browser smoke: 104 pass, 17 existing saved-only skips. R0's Linux job passes all
three Rust tests and exactly reproduces both full-tree numerical failures. River timing
31.768753 / 36.004918 ms, peak process RSS 21,856,256 / 22,949,888 bytes. The initial
Linux release compilation takes 45.11 seconds, plus 1.03 seconds for the CLI build;
compile time is excluded from the prerequisite execution budget.

WASM/browser CI: 34 live and 48 drill checks pass; play/review has 54 immediate passes
and **one Firefox test passing on retry**, with four existing zoom skips across suites.
The retry is the hand-setup `Hand complete` five-second wait in
`e2e/play-review.spec.ts:102`, before its review assertions. Five unchanged focused Firefox
repetitions on this exact commit then pass with zero retries (29.6 seconds total).
The initial local attempt refused to build without prepared live assets; no browser test
ran. Normal source/hash-verified preparation, the prepared production build and all five
repetitions then passed. No timeout/assertion/source changes. The CI cause remains
unconfirmed; do not describe the intermittent timeout as fixed or omit the first attempt.

No production app or WASM source change or deployment. Public production still matches
the retained exact `de7f0d6` build/source archive at `2026-11-23T02:45:55.868Z`.
