# P1: admission and saved-policy coverage gate

Started 2026-09-30, after W4 `a87b34a` passed isolated exact-commit verification and all
eight jobs in CI run `36768099422`. No P1 production ladder or `/play` is shipped yet.
The CPU-ceiling roadmap's working rules and architecture override the older play draft's
native-server deployment and ad-hoc hand-threshold/size-removal suggestions.

## Frozen measurement plan (before the seeded audit)

First test a necessary condition for the required ladder: whether *any* subset of at most
64 hands can preserve at least 99% of each player's positive reach. The maximum retained
mass is the sum of the 64 largest weights divided by their total; no other 64-hand subset
can retain more. This is the roadmap's per-player reach mass, not blocker-adjusted joint
deal mass and not an exploitability estimate. Scaling a range does not change the bound.
Reject invalid/empty/underflowing weights; never silently remove a real hand to make it fit.

An exploratory, read-only scan of the saved **quantized** library root reaches found zero
fits among 384 turn roots and 288 river roots. At those roots the median of the smaller
player's top-64 retained fraction was 24.4129% on the turn and 40.1257% on the river.
These are diagnostics, not the required seeded-play corpus or a quality measurement.

Freeze the play-prefix audit as follows, before examining its outcomes:

- Seeds 0–4095; flop chosen uniformly using a separately domain-separated seeded draw
  over the manifest's 12 saved flops; AI seat alternates by seed. Private deals/runouts use
  the existing compatible weighted `dealFromSeed`; turn/river cards are not selected from
  the saved slices. Starting pot 550, stacks 9750, minimum opening bet 100 chips.
- Use the real P0 hand reducer. Both seats sample the saved per-hand strategy whenever the
  exact node exists. Human draws use a separate seed domain. Every reach update multiplies
  the **played per-mille strategy**, rather than substituting a saved rounded reach vector.
- Stop a prefix, recording why, when a node or positive-reach hand's strategy is unavailable.
  No guessed action, board substitution, hidden-card-dependent solve or synthetic fallback.
  Such prefixes are coverage failures, not completed hands or zero-exploitability results.
- Record every reached turn/river street root. Freeze the first 32 distinct seeded roots
  on each street, in seed order (64 total), plus whole-cohort coverage. Do not select roots
  by retention, EV, exploitability or whether admission succeeds. River roots necessarily
  come from prefixes whose sampled turn was covered: explicitly report that selection limit.
- Hash manifest/chunk inputs and each reconstructed full-range spot. Store deterministic
  public metadata and bounds, not private cards. Reproduction must be byte-identical.
- If the necessary 99%/64-hand condition fails on a root without a matching saved node,
  check whether action translation can actually supply a policy on its board. Translation
  changes action size, **not cards**. Report unavailable coverage as unavailable.

Only after feasible pruning candidates exist should the native full/pruned solves and
independent full-range grading run. Their ≤1%-pot median gate, the ≥20 river/0.3%-pot gate,
1000 complete deterministic hands and browser latency gates remain required. If admission
is already impossible, record EV/exploitability as **unmeasured**, not zero or inferred from
retained mass, and stop dependent product work. No browser cap, mass floor, game menu or
numerical tolerance changes are authorized by this audit. PF4 remains gated.

## Measured result: P1 blocked before solving

The frozen audit completed all 4,096 seeded prefixes and selected its 64 roots without
changing the sampling rule. Report: [hu-play-p1-admission.json](artifacts/hu-play-p1-admission.json).
This is a failed **necessary admission/coverage gate**, not a failed CFR convergence result.
It cannot supply a feasible browser-pruned strategy for the required quality comparison.

| Measurement | Turn | River |
| --- | ---: | ---: |
| Reached street roots | 3,131 | 354 |
| Both ranges can retain 99% within 64 hands | **0** | **0** |
| Full-range input passes the current browser parser | 0 | 0 |
| Exact saved root exists | 474 | 0 |
| No saved policy for this board | 2,627 | 354 |
| Median of the smaller player's top-64 reach fraction | 13.0042% | 28.0162% |
| Largest such fraction across the cohort | 62.2716% | 58.6411% |
| Median hands needed for 99%, OOP / IP | 541 / 384 | 368.5 / 263 |

The 1,066 completed saved-policy-only hands are **not** the 1,000-hand production-AI gate:
the other 3,030 prefixes stopped without a policy, including nine with a missing
positive-reach strategy column in a quantized saved node. Nothing substitutes a zero
probability for an unknown positive-reach column. No production source or `/play` is shipped.
P0's completed-hand settlement check uses its existing equal-share starting-pot origin;
this audit does not certify a real preflop/session profit ledger for the 50-chip dead blind.

Concrete witness: seed 0, `srp-btn-bb-jcjd4s`, path `x x 7h`, pot 550, stack 9750.
Its ranges have 574 / 421 positive hands. Top-64 retention is 12.5564% / 27.1345%; retaining
99% needs 554 / 364 hands. No saved policy covers that turn. The first river witness is
seed 4, `srp-btn-bb-ahth5c`, path `x x Ad b363 c 5d`: 99% needs 182 / 235 hands,
and that river board is also unsaved. Choosing another bet size cannot create a policy
for either missing board. These are not hidden-card-dependent admission decisions.

Report SHA-256: `5708279f22c75c316a8d97dd4dfb1d857976127da11b3527f50e4c390cc807f9`.
Public-prefix cohort hash: `f6bbd7290448757ddcf74e98b0d2f59c2a1467d634bb03c9354fb630001ac61e`.
The report binds 121 input files by exact size/hash. The 64 corpus entries bind full,
reconstructible Spot v1 inputs by hash, but contain no private deal or hidden runout.

### What remains unmeasured / unshipped

- Native full-versus-browser-pruned EV differences and independent full-range local
  exploitability are **null/unmeasured**. We did not solve a heavily cut top-64 substitute
  and label it the required 99%-mass game. The ≤1%-pot median quality gate is unchanged.
- The ≥20 river/≤0.3%-pot referee gate, 1,000 complete production-policy hands, real-source
  leak gate and Chromium street-latency budgets are not met. Library-only prefix tests do
  not replace them. P1 is not completed; P2, P3 integration and P5 are blocked by this gap.
- The independent TS gadget/small-game research portion of P4 need not depend on browser
  range admission. It cannot unlock `/play` or confer safety on the Rust path.

### Options requiring a new measured plan, not silent implementation

1. Measure wider ranges on physical devices, then propose new browser limits supported by
   memory/latency evidence. Range count is only the first constraint: e.g. the seed-0
   stack/pot ratio is 17.727, above the menu parser's current 10. Export size and actual
   memory/quality gates still apply. Do not simply raise the count to the observed median.
2. A precomputed continuation cache must address **river as well as turn coverage**, missing
   betting lines and omitted policy columns. P3's common-turn warm-up alone is not enough.
   Measure the coverage and transfer/storage cost before selecting a cache design.
3. A smaller range-restricted teaching game would change the stipulated formation/dealing
   model. That is a product decision, not a permissible fallback for the specified P1 game.

## Tests and release record

Assertion-first: the reach-bound and real-reducer probe tests failed when their modules
were absent, then passed after implementation. The record reproduction check failed while
the frozen artifact was absent. Tests independently recompute reach as the product of the
played per-mille strategy columns, card removal and float32 normalization; check the
largest-k bound against enumerated subsets; reject invalid/underflowing weights; verify
determinism, public-only root records, missing-board refusal and input/artifact hashes.

Commands (a successful reproduction is **not** an admission pass):

```sh
node --import tsx --test test/hu-play-admission.test.ts test/hu-play-library-probe.test.ts test/hu-play-admission-record.test.ts
node --import tsx scripts/audit-hu-play-admission.ts --check
```

Owned paths: this document; `tasks/artifacts/hu-play-p1-admission.json`;
`src/lib/hu-play/admission.ts`; `scripts/hu-play-library-probe.ts`;
`scripts/audit-hu-play-admission.ts`; the three test files above; the P1 status notes in
`tasks/heads-up-play-resolving-spec.md`, `tasks/cpu-ceiling-roadmap.md` and
`tasks/solver-lab-roadmap.md`; the audit script/CI entry; README's browser/play paragraph
only. No engine, Worker limit, production policy, trainer/session or configurable-flop edit.
Exact-commit verification must precede pushing this diagnostic record; hosted CI must then
be observed green before starting another independent milestone.

The clean-scope candidate (`a87b34a` plus the explicit paths above, copied `node_modules`)
passes **884/884 unit tests with no skips**, typecheck and lint. The admission report
reproduces byte for byte both in the main tree and in isolation. Native bridge, bridge
library, river-v3 artifact and diagnosed-preflop artifact audits pass unchanged. A TypeScript
inference error in the new probe was corrected with an explicit `BridgeLibrarySpot` type;
no source exclusions, `any` escape or changed numerical output. The commit must repeat these
checks in a new isolated copy before push. No application route, Worker or mathematical
solver was changed; this is a research/diagnostic release, not completion of P1.
