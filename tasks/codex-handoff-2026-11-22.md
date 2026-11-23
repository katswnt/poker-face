# Codex handoff — 2026-11-22 CPU continuation

The authorized CPU-roadmap continuation has reached its measured stopping points.
It does **not** complete the entire research program: PF4, CO–BTN publication and the
external multiway training/turn experiment remain blocked by unchanged gates.
The deployed teaching app and its earlier W1–W4/P1–P5, E1, D1/D2 and H1 milestones stay
intact. This run adds reference data, validation contracts and reproducible failure evidence;
it does not change `/play`'s game or silently adopt a new engine.

## Shipped commits

| Commit | Change | Verification |
|---|---|---|
| `912616a` | Step 10 frozen preflop continuation-value validation contract | Exact 1,142/1,142 units, zero skips; tsc/lint, 20 audits/build; all eight CI 45065228344 jobs green |
| `2877408` | Step 11 tiny joint reference, 504 preflights and bounded calibration failure | Exact 1,159/1,159, zero skips; tsc/lint, 21 audits/build; all eight CI 45073738933 jobs green |
| `ed097e2` | Step 13 two complete formation packs, independent referees and withheld CO–BTN evidence | Exact 1,171/1,171, 22 audits/build; hosted gzip portability failure preserved, then fixed forward |
| `62030ce` | Current formation reproduction command uses the verified publisher | Exact 1,174/1,174, tsc/lint, 22 audits/build; pushed together with the portable correction |
| `4a87f9a` | Pinned portable compression and strict manifest migration | Exact 1,176/1,176, zero skips; tsc/lint, 22 audits/build and identical Node 20/24 audit bytes; all eight CI 45096583659 jobs green |
| `868d5bf` | Step 14 pinned MCCFR full-tree scorekeeper prerequisite and proven failure | Exact 1,180/1,180 units, zero skips (144,669.875333 ms); three Rust tests; fresh numerical replay; tsc/lint, 24 audits/build; all eight CI 45102016387 jobs green (one Firefox first-attempt timeout, passed retry) |

Every exact checkout used real copied `node_modules`, never a root symlink. README was
staged as a clean blob while preserving the unrelated trainer hunks. No protected file,
tsconfig exclusion or numerical gate was changed. The formation fixes preserved all
original native observations and 506 policy-data files; failed attempts remain charged.

## Measured results and limits

**Preflop steps 10–12.** The contract freezes 84 boards × two complete 169-class range
profiles × three pot types = **504 continuation roots**, with separate held-out boards and
accounting/error budgets. These are stress-test inputs, not playing advice. The nine-card
joint reference has 1,492 states and 263 information sets; 16,384 CFR iterations yield
per-player gains 0.0000903302313 / 0.0000944719589 chips and independent grade agreement
within 1e-10. Its illegal hidden-card witness remains separated from a legal response.

All 504 native allocation estimates fit; largest reservation **11.7793 GiB**. The first
full-range calibration root exceeds its frozen **600-second** budget: closed at
600,282.739834 ms; last checkpoint 120 iterations / 589,251 native ms and
**1.1334240653% of the starting pot**, versus **0.001%** required. Peak RSS
12,293,881,856 bytes, eight threads, 11,669 samples, zero sampler errors. Only 1/144
calibration roots attempted, zero accepted; the other 143 calibration and 360 noncalibration
roots remain unattempted. No fitted additive model or held-out observation was accepted.
This is a necessary coverage failure, **not a falsification of the untested model**.
PF4/library regeneration and range promotion stay blocked. V1 artifacts and diagnosis
are unchanged; diagnosis SHA-256 remains
`d95b71e978f0c98650fe4583182d8ed99a2406060d0065a51b94590e96cc508d`.
Read [contract](preflop-validation-v2-spec.md) and [research](preflop-v2-research.md).

**Step 13 formations.** The separate manual-range v1 collection publishes **SB–BB SRP
12/12 roots and BTN–BB 3BP 12/12 roots**. All 36 allocation estimates pass. Accepted roots
meet ≤0.3%-starting-pot native quality, saved-node invariants, file/pack limits and fresh
byte-identical reproduction. SB–BB generation: 49.283 minutes, 140–210 iterations/root,
peak 9,521,512,448 RSS bytes. 3BP: 2.702 minutes, 110–180 iterations, peak 897,335,296 bytes.
Total charged native generation/reproduction work, including failed attempts:
**115.460591 minutes**, below eight hours. The 29 accepted native caches occupy
1,058,962,799 bytes; five CO caches are retained but withheld.

Published packs: **508 files including manifests, 123,482,163 raw bytes and 31,507,321
portable-gzip bytes**. SB–BB: 24,070,489 gzip bytes; 3BP: 7,436,832. Each pack includes its
own board/range/position/chip/menu rules, hashes and reproduction record. SB is OOP and
BB IP in the blind-versus-blind game after other seats fold; this is not the two-seat
button/SB position rule. `/play` still uses its original 12-flop BTN–BB SRP library.

Independent saved-river referees agree with native P0 value within 0.000002452 chips
(SB–BB) and 0.000058076 chips (3BP). Their local grades are **0.0640723% and 0.7200662%
of the respective river pots**. The latter exceeds 0.3%; the frozen referee gate is
value agreement, not a promise that every conditional node satisfies the root threshold.
The native full-policy grade does not certify the rounded, partial exported strategy.

**CO–BTN is withheld.** The sixth attempted root, `co-btn-srp-v1-td7d3c`, fails 14 saved
opponent-EV checks on Ad-containing hands at `x b429 c 4c b995 c 3s`: errors
**29.3–258.25 chips**. The native checkpoint itself meets its root quality target
(160 iterations, 1.920198202 chips = 0.295415108% pot). Five earlier accepted roots are
withheld and six remaining roots unattempted. The rejected full raw export was **not
retained**; errors/checkpoints were. Do not claim a diagnosed native mathematical bug.
Next investigation must capture the full-precision node/children before quantization,
with the same frozen input, and separate reach conditioning, export and rounding effects.

Two publication defects were fixed separately: cache re-encoding changed JSON key order;
short-decimal f32 reporting was compared directly as f64. Fresh native hashes actually
match original data; current validation uses exact f32 reporting conversion. A third
CI-only host-zlib size mismatch led to pinned `pako` 2.1.0, a fixed gzip profile and
preserved original manifests. No size/quality tolerance was relaxed. Current Mac Node
24.10.0 and official Node 20.20.2 print identical complete audit JSON, SHA-256
`6da9282f25223852c00534c3ed328c06a46b1ed197acbc4a675177eca4aff8a5`.
See [formation record](formation-libraries-v1-spec.md) and its v2–v5 correction records.

**Step 14 R0 is blocked before training.** The actual pinned crates.io `mccfr` 1.2.0
source is commit `72360adc7fbc6afa4119be3aefcc0e990d3789a7`, distinct from the old
read-only review. Its default features include `server`; no service is started here.
The MIT notice is preserved and Cargo.lock pins the dependency graph.

Our unchanged river fixture has 172 weighted compatible deals, 4,301 original states
and 72 information sets. An exact 2,349-ticket chance representation gives 58,726 upstream
full-tree states, preserving all information-set/action identities. On the uniform profile,
upstream ΣBR/3 is **17.7059383392334 chips**; our independent NashConv/3 is
**18.106108982545766**. Difference **0.40017064331236796**, versus the unchanged 1e-6 gate.
Profile values agree within 3.20e-7; player-0 BR differs by 1.200511411 chips.

The diagnosis is independently decisive: a five-state zero-sum game lets player 0 take
1 or continue and then choose −10/+10. Upstream chooses take because it evaluates the
later decision under the average policy; our exhaustive four-policy enumeration and
information-set dynamic response both choose continue then +10. Upstream BR **1**,
correct BR **10**. This is not float32 noise or hidden-card cheating. The old upstream
routine does not optimize later hero decisions while selecting earlier ones.

Two fresh native repeats are numerically identical. Original river prerequisite runs:
**79.020541 / 52.710167 ms**, peak **11,599,872 / 11,583,488 bytes**. Witness:
0.04975 / 0.031292 ms, 1,622,016 bytes. These are scorekeeper times, **not training
benchmarks**. Linux CI freshly reproduces all numerical outputs exactly: river
31.768753 / 36.004918 ms, peak process RSS 21,856,256 / 22,949,888 bytes; witness
0.062839 / 0.056546 ms. Three Rust tests pass; initial CI release compilation takes
45.11 seconds, plus 1.03 seconds for the CLI build. Compilation is outside the grading
runtime gate. Training/convergence, pruning, larger games and turn/river re-solving were
not attempted. This does not invalidate our existing audited multiway artifacts or prove
the external trainer cannot converge. No upstream issue/message was sent.
Evidence hash: `efd765146bc9b7e86f3799598d7c42abfb961fbe5582b6f84292cc1734a715e8`.
Read [R0 spec and diagnosis](robopoker-r0-spec.md).

### Browser retry retained in the release record

R0 CI's WASM/browser job is green with 34 live checks, 48 drill checks, and 54
play/review checks passing immediately plus **one Firefox test passing on retry**;
four existing non-Chromium zoom skips remain. The retry is
`e2e/play-review.spec.ts:102`: its hand-setup helper did not see “Hand complete” within
the unchanged five-second assertion timeout. It failed before the review assertions.
No app or test source changed in R0. Five focused Firefox repetitions on the exact
commit then passed with **zero retries**, 29.6 seconds total (about 3.1 seconds/test).
This does not establish a root cause or prove the intermittent issue fixed. Preserve
`step14-ci-wasm.log` and the prepared-repeat log; do not silently raise the timeout.
The first local attempt refused to build because live assets were not prepared; no
browser test ran in that attempt. After the normal source/hash-checked preparation,
the full prepared production build and all five browser repetitions pass.

## Useful commands

```sh
npm run audit:preflop:v2:contract
npm run audit:preflop:v2:research
npm run audit:preflop
npm run diagnose:preflop
npm run audit:bridge:formations
npm run reproduce:bridge:formations
npm run audit:robopoker:r0
npm run reproduce:robopoker:r0
```

Formation reproduction with existing evidence is explicitly a **replay/audit**, not a
new solve. Follow the task's fresh-experiment recipe for a fresh native rerun. R0's audit
exit zero means its **rejection is reproduced**, not that the engine passed. Never edit
source-hashed historical generators/publishers or observation files to erase a failure.

## Production and remaining device checks

No app code/native bridge/WASM change or deployment was needed in this continuation.
Last verified production: **`de7f0d6174fb3510d8595ed987bff88ca8232b86`**, at
<https://pokerface.katswint.com/play>, deployment `dpl_HHoAePwiogWCLqgcSbCELVGEfFcB`.
Fresh public identity check at `2026-11-23T02:45:55.868Z` passes: all six engine/source
files match byte for byte; `/play` and `/solver/live` have working corresponding-source
links; `/play` retains the visible **23.4%-of-subgame-pot composed-policy warning**.

- Build: `a34c636fd90da5bcef285d97ce3af961b4550e7e78f77960357056982d2fdb4a`.
- Engine/source: `f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981`.
- AGPL source archive: `268ec4566f9caecf08cd1411f98d71666050ecf784fed91c4a05bff957a8238f`,
  4,808,719 bytes.

Production remains scripted preflop, hand-written ranges, 12 saved flops and exploitable
local re-solving. No exact/universal GTO claim. Physical iOS Safari and Android Chrome
memory, latency, background-tab recovery and cancellation remain **unmeasured**, nonblocking
per Kat's instruction. Existing device checklist is still applicable; desktop emulation
does not substitute for it. Optional full turn cache is unpublished and not required by
the passed live-turn gates. The newer formation packs are repository/offline data, not
new `/play` formations.

## Untouched local work and safeguards

Protected primary tree remains:

```text
 M METHODOLOGY.md
 M README.md                       # original trainer hunks only
 M e2e/keyboard.spec.ts
 M src/app/globals.css
 M src/components/PokerSim.tsx
 M test/copy.test.ts
?? src/lib/poker/session.ts
?? src/lib/solver/postflop/configurable-flop/
?? tasks/configurable-flop-v2-plan.md
?? tasks/poker-data-reuse-and-publication.md
?? test/session.test.ts
```

All 16 non-README protected files retain their starting hashes; trainer README +/- hunks
are identical. The paused flop draft still does not type-check in the mixed working tree;
it was never excluded or overwritten. Use an isolated exact commit for verification.

`build/cpu-finish-2026-11-22/` (ignored) retains protected copies/hashes, explicit file
lists, original/clean/merged README copies, exact-check logs, native error/attempt records,
all 177 formation cache/measurement files and CI results. Native accepted caches total
1,058,962,799 bytes. Preserve `step13-full-work/` and the rejected-attempt records.
The exact R0 checkout is `/private/tmp/poker-r0-exact-4tdgtvjb`; retain
`/private/tmp/poker-h1-fixed-90bavjbh` as the exact deployed build. Disk space is low;
retire only redundant generated checkouts after confirming all source, evidence and
required cached outputs are preserved. Never delete unrelated work to make room.

## Next research, without weakening gates

1. Capture and diagnose CO–BTN's full-precision continuation export before rounding.
2. Fix and independently validate the external scorer in a separately versioned study;
   rerun R0's original quality/determinism/resource gates before training claims or a
   three-player turn/river contract. Do not substitute our score for the required external one.
3. Develop a cheaper trustworthy continuation-observation method for the frozen preflop
   contract. Keep original target/error/held-out tests; do not tune defence rates or promote
   the unvalidated model. This run's failed coverage is evidence, not permission to relax it.

R0 release closure: all eight jobs in [CI 45102016387](https://github.com/katswnt/poker-face/actions/runs/45102016387)
are green. Main CI has 1,180 tests: 1,087 pass and 93 existing binary-environment skips,
zero failures, 721,058.985745 ms; exact local verification has zero skips. The separate
native/WASM jobs cover their binary-dependent checks. Main browser smoke is 104 pass,
17 existing saved-only skips. The browser retry is preserved above.

This final documentation-only commit records those verified results. It follows the same
exact-checkout/full-unit/typecheck/lint/relevant-audit/build and push/CI procedure; its own
post-commit result is reported in the closing response, avoiding a self-referential commit
hash. No additional engine acceptance or research completion is implied.
