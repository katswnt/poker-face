# P1 wider-range feasibility — rivers first

Started 2026-09-30 from `9e53d18`, after all eight CI jobs were observed green.
Kat selected this continuation explicitly: cheapest-first native estimates, single-thread
native solves, native/WASM timing ratios, then real three-browser memory measurements.
Physical-device checks come last and must be listed, not used to block these measurements.
This supersedes the earlier requirement to obtain devices before investigating wider limits.
It does not lower any mathematical gate or change the requested game.

## Frozen sequence and measurement contract

1. Reconstruct the **same 64 P1 roots**, hash-checking the original report and all published
   inputs. Process the 32 rivers first, then the 32 turns; preserve original corpus indexes.
   Do not select easier roots, prune ranges, substitute boards, alter menus or use compression.
2. Run `solver-bridge estimate` on each original full-range spot. This constructs game/card
   tables but does **not** allocate strategy storage or solve. Report engine float32 storage,
   export node/cell/JSON reservations and stack/pot ratio. These are estimates, not peak RSS.
3. Native solves: one thread, float32, unchanged 0.3%-pot target, first-street export. Allow
   at most 10,000 iterations, 30 minutes and 4 GiB engine storage per research job; these are
   offline measurement budgets, **not new production limits**. Process sequentially to avoid
   contention. Keep original and measurement spot hashes (solve budgets change the latter).
   Record construction/allocation/solve/export/total times, iterations, convergence, actual
   result size, OS peak RSS and sampled RSS. Preserve failures and missed targets as failures.
4. Independently grade every complete river policy with our factorized scorekeeper, keeping
   all positive hands and exact blockers. This supplies more than the required 20 river
   observations, but is not the production play/replay gate. Engine self-grades on turns
   are explicitly not an independent full-turn certificate.
5. Select timing-ratio cases by **native estimated storage**, before browser timing:
   smallest, median and largest per street (ties: original corpus index). Reuse the same
   single-thread WASM engine and matched native iteration budgets. Report solve-only and end-to-end
   ratios separately; extrapolated times are estimates, never measured p95 or a phone claim.
   Before browser timing, native river solves were only 1–5 ms (integer-ms engine clock).
   Therefore river ratio jobs use a longer matched **1,000-iteration** budget and a 1e-9%-pot
   stopping target, separate from the unchanged 0.3%-pot quality runs. Turn ratio jobs use
   **100 iterations**: the quality runs already take 438–3,548 ms at 70–130 iterations, so
   running 1,000 browser turn iterations is unnecessary for clock resolution. This cheaper
   turn budget was fixed before any browser timing; preliminary 1,000-iteration native turn
   runs are not the paired dataset. Record actual counts
   if convergence stops earlier. These timing jobs do not replace quality measurements.
   Report sensitivity to ±1 ms clock quantization; it is not a statistical confidence interval.
6. Measure full-range jobs through a measurement-only extension of the W2 harness in fresh
   Chromium, Firefox and WebKit processes/Workers, with actual finish/export/check/clone.
   Observe monotonic WASM high-water through export, and sample the browser process tree
   including WebKit XPC companions. Report baseline, peak, increment, sample gaps and stages;
   sampled RSS can miss brief peaks and double-count shared pages. Do not equate it to the
   engine reservation or call desktop WebKit an iPhone test.
7. Calibrate a versioned reservation from observations, then propose separate desktop/mobile
   bounds, including hand count, stack/pot, raw-tree construction, export and time. Compare
   hold-out/high-size cases; retain explicit refusal/cancellation and no silent precision,
   menu, range or board changes. Do not blindly rescale the old 128 MiB overhead from one case.
8. Re-run the **unchanged** P1 quality, ≥20 river referee, 1,000-hand determinism/conservation,
   leak and latency gates with the actual proposed production sources. Full-versus-pruned
   comparisons use identical ranges when nothing is pruned (100% retention); otherwise keep
   ≥99% mass and independently grade against full ranges. No pass from an estimate alone.

## Decided fallback and remaining boundaries

If turn solving does not fit the proposed phone budget: live rivers everywhere, live turns
on desktop, **turn-only precomputed continuations for mobile**; size that cache from actual
coverage/cost. A complete all-street cache is not the main path, and a smaller teaching game
is not an authorized substitute. Missing positive-reach library columns still need explicit
handling; action-size translation does not invent a missing-board policy.

Physical iOS Safari / Android Chrome checks, memory pressure, backgrounding and thermal
behavior will be listed for Kat after desktop qualification. Until measured, any mobile
limits are provisional engineering choices, not certified phone safety or latency.
Scripted preflop, hand-written ranges, 12 saved flops, approximate finite-game strategies,
and no global guarantee from local re-solving remain mandatory. PF4 stays gated. Preserve
the AGPL source distribution and all unrelated trainer/session and paused-flop work.

## Tests, ownership and release

Write failing tests before each behavior change. First checks: frozen corpus/hash identity,
river-first coverage, unchanged game/payoff inputs, one-thread float32 solve provenance,
independent chip/percent arithmetic, deterministic ratio-case selection and estimate-only
execution. Timing observations are hash-bound records, not byte-identical performance promises.

Initial owned scope: this doc; the user-directed amendment in `cpu-ceiling-roadmap.md`;
`scripts/hu-play-wide-corpus.ts`, `scripts/measure-hu-play-wide-native.ts`;
`test/hu-play-wide-feasibility.test.ts`; new generated feasibility records. Expand this list
explicitly when adding the browser harness, admission calibration and associated tests.
The first full-range estimate exposed a prerequisite JSON parsing defect; ownership also
includes `native/solver-bridge/Cargo.toml`, its `tests/bridge.rs` and
`test/bridge-float-input.test.ts` for the strict decimal-input regression described below.
Browser measurement ownership adds `scripts/hu-play-wide-{measurement,research-shim,profile-page}.ts`,
`scripts/profile-hu-play-wide-browser.ts` and `test/hu-play-wide-browser.test.ts`.
Record/audit ownership adds `scripts/hu-play-wide-analysis.ts`, `scripts/audit-hu-play-wide.ts`,
`test/hu-play-wide-record.test.ts`, `tasks/artifacts/hu-play-p1-wide-*.json`, and the explicit
audit/test entries in `package.json` and `.github/workflows/ci.yml`.
The unshipped production proposal is evaluated only by `scripts/hu-play-wide-proposal.ts`
and `test/hu-play-wide-proposal.test.ts`; no deployed source imports it.
README ownership is limited to correcting the shipped `/solver/live` status/table and the
new wider-range research paragraph; trainer documentation remains separate and unstaged.
The continuation notes in `heads-up-play-resolving-spec.md` and
`codex-handoff-2026-09-30.md` are also owned by this study.
No production limits change in the estimate/native-measurement stage. Final commits still
require exact-commit isolated full tests, tsc, lint, relevant audits/build, push and green CI.

- [x] A: 64 native estimates, no solving.
- [x] B: 64 single-thread native solves and river referee; representative WASM ratios.
- [x] C: three-browser full-range peak-memory/time observations.
- [x] D1: measured desktop/mobile proposal, checked against every frozen quality case.
- [ ] D2: implement the bounded production sources and rerun all unchanged P1 gates.
- [x] Physical-device checklist ready for Kat (not a prerequisite for A–D research).

## Measurements

### First estimate: exact-weight JSON defect (before strategy allocation)

The first river root failed: JavaScript's exact float32 value serialized as
`0.029999999329447746`, but the Rust JSON fast parser read `0.029999999329447743` (one
float64 ULP away). The bridge correctly refused that parsed number as not float32-exact.
The same failure reproduces in a tiny existing river fixture; it is not a range-size limit.
Rust and native/WASM integration regressions failed before the correction. One sandbox-only
attempt failed in the RSS sampler with EPERM; the authorized rerun reproduced the actual
decimal-input failure. Neither that permission error nor the rejected estimate is a solve.

Enable serde_json's `float_roundtrip` feature in the shared bridge dependency so the native
and WASM builds preserve the input f64 value before the unchanged strict f32 check.
The [parser source](https://docs.rs/serde_json/1.0.151/src/serde_json/de.rs.html) shows the
feature-selected accurate conversion. Raw `0.03` remains invalid: the fix does not round
incoming weights, rewrite a spot, loosen a tolerance or modify a CFR algorithm. Rebuild both
engines and require the existing numeric fingerprints/audits plus the new weighted parity
regression before accepting measurements from this build.

The new regression passes in native and WASM; the shared Rust suite is 17/17. Native audit,
the WASM referee audit and its 20-case native/WASM grid pass with zero numerical differences
and the unchanged 0.0002-chip independent tolerance. No saved numerical artifact changed.

### A: all 64 native estimates

The [estimate record](artifacts/hu-play-p1-wide-native-estimates.json) has payload hash
`005992de36d8542818cefb2093e0539633415066efc31437c995f66878cfa9ff`.
All 32 rivers preceded all 32 turns. No strategy storage was allocated and no CFR iterations ran.

| Measurement | River (32) | Turn (32) |
| --- | ---: | ---: |
| Float32 engine storage estimate, bytes | 194,792–236,416 | 5,330,088–21,495,672 |
| Export working reservation, bytes | 5,055,424–8,945,088 | 4,559,808–9,214,208 |
| Compact JSON upper bound, bytes | 516,136–912,904 | 468,456–946,112 |
| Positive hands, OOP | 208–544 | 267–601 |
| Positive hands, IP | 240–395 | 243–497 |
| Maximum stack/pot | 17.727272727272727 | 17.727272727272727 |

Storage-selected ratio cases are corpus indexes 32, 57, 42 (river) and 18, 25, 29 (turn).
Execution remains river-first, in original corpus-index order within each street.
These estimates suggest the old hand/SPR parser gates are more restrictive than storage
for this corpus; they are not measurements of browser memory or a production admission pass.

### B: native quality runs and representative browser ratios

All jobs use one thread, float32, the original full ranges/menu/payoffs and 0.3%-pot target.
First-street export does not truncate the turn game: future river betting is still solved.

| Measurement | River (32) | Turn (32) |
| --- | ---: | ---: |
| Engine target reached | 32/32 | 32/32 |
| Completed iterations | 30–80 | 70–130 |
| End-to-end native wall time | 13.010–22.657 ms | 452.569–3,567.458 ms |
| Engine solve clock | 1–5 ms | 438–3,548 ms |
| OS peak RSS, bytes | 3,194,880–3,637,248 | 8,585,216–25,264,128 |
| Independent river local exploitability, % pot | 0.132945418–0.289017561 | Not independently graded |
| Turn engine-reported local exploitability, % pot | — | 0.195611603–0.297717875 |

Every river was independently graded with complete positive ranges and exact blockers.
The largest engine/referee exploitability difference is 0.000011933878 chips. This is local
quality with fixed arriving ranges, not a whole-game guarantee or completion of P1 play.
The ultrafast native jobs sometimes finish between RSS samples; absent sampled RSS is
`null`, never zero. Native OS peak RSS remains available separately.

Raw quality runs are `/private/tmp/poker-p1-wide-native-rivers-v2` and
`/private/tmp/poker-p1-wide-native-turns`, with report hashes
`0fa306af5a2208f25f2eb29ae71291f9170848fa125852fe3d29d7aeb3080ce6` and
`9d8eac63e771c273d28945cae849cc3719cb5a6c1e0e57b49cdd3972c30b3777`.
The native reports are now checked in beside the estimate record, with their original hashes.
Full policy outputs can be regenerated with the numerical reproduction command below.

An initial river batch had 27 **measurement-summary** failures, not CFR failures: serde's
shortest f32 JSON decimal is not the exact f64 value used in its percent calculation. The
summary now reconstructs `Math.fround(chips)` and requires exact percent equality. A failing
regression captured the error before the correction; the entire 32-river batch was rerun.
The initial directory `/private/tmp/poker-p1-wide-native-rivers` is retained as failure evidence.
No engine arithmetic or quality tolerance changed. The ratio-v2 dataset uses the predeclared
river-1000 / turn-100 iteration budgets; earlier turn-1000 timings are not paired with it.

All 18 paired browser timing jobs (six inputs × three browsers) match the full native
numerical fingerprint exactly. The three storage-selected rivers use 1,000 iterations;
the three turns use 100. These are separate timing jobs, **not** 0.3%-target quality solves.

| Street / browser | Engine solve-time ratio to native | End-to-end browser time | WASM high-water, bytes |
| --- | ---: | ---: | ---: |
| River / Chromium | 2.687–6.657× | 277.6–337.6 ms | 1,507,328–1,900,544 |
| River / Firefox | 19.253–34.000× | 1,290–1,984 ms | 1,507,328–1,900,544 |
| River / WebKit | 2.525–5.686× | 249–304 ms | 1,507,328–1,900,544 |
| Turn / Chromium | 1.257–1.487× | 978.1–3,500.7 ms | 6,619,136–22,937,600 |
| Turn / Firefox | 15.899–18.318× | 11,566–43,676 ms | 6,619,136–22,937,600 |
| Turn / WebKit | 1.288–1.468× | 983–3,661 ms | 6,619,136–22,937,600 |

Ratios include browser session yields/finalization, not just CPU instructions. Per-row
±1-ms clock-quantization sensitivity is retained. End-to-end ratios include cold Worker
and module loading while native timing includes process launch. Neither is a universal
WASM multiplier. `file` confirms both installed Firefox and Chromium executables are arm64,
not an Intel Firefox/Rosetta comparison. Physical devices remain unmeasured.

The largest sampled browser-memory increments in these paired jobs are 61,833,216 bytes
in Chromium, 124,698,624 in Firefox, and 78,282,752 in WebKit. Those are process-tree RSS
increments, not WASM bytes. This is why the tiny linear-memory observation alone cannot
justify removing the existing 128 MiB overhead allowance.

### Browser measurement method

The private loopback bundle substitutes only the parser/watchdog limit imports of the
existing W2 client/runtime. Each fresh page and Worker accepts **one exact prevalidated
corpus request**. Production imports and limits are untouched; original W2 export reservation,
admission and linear-memory watchdog remain active. Research timeout is 30 minutes.
The deployed app cannot opt into this harness. The server serves the complete hashed engine
distribution, including source/licenses, not a binary-only copy.

All numerical fields of each exported Result v1 (including every exported strategy/EV cell
and convergence value) are hashed against the matching native job; only clocks/memory are
removed. This does not claim to hash unexported future-street policies. Error/refusal records keep
their observed high-water and stage telemetry. An assertion-first test covers that behavior.
Browser-process sampling includes newly launched WebKit XPC companions and reports baseline,
peak, increment and maximum gap. Fresh browser launches are outside job timing; fingerprinting
is outside terminal latency but inside the RSS observation window. No device claim follows.
Collection included a few short assertion-first harness regression probes in the controller;
no full builds, native solve audits or full test suites ran alongside the browser batch.
These are single-run end-to-end observations with harness/controller overhead, not isolated
CPU microbenchmarks. The production-source latency gate must be measured separately.

### C: complete river quality observations

All 96 quality-target river jobs (32 roots × three browsers) pass and match native exactly.
Each uses 30–80 iterations; this is not the longer ratio workload. Nearest-rank p50/p95,
one fresh process/Worker per case, including startup through checked result publication:

| Browser | p50 | p95 | Maximum | Maximum WASM high-water | Maximum sampled browser RSS increment |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 59.8 ms | 66.8 ms | 88.3 ms | 1,900,544 B | 41,385,984 B |
| Firefox | 161 ms | 188 ms | 196 ms | 1,900,544 B | 95,567,872 B |
| WebKit | 51 ms | 65 ms | 135 ms | 1,900,544 B | 56,983,552 B |

Maximum **total** sampled browser-process RSS was 319,848,448 / 1,077,100,544 / 400,736,256
bytes respectively. This includes large desktop-browser baselines, not just solving. It
must not be mislabeled as WASM usage or compared directly to an engine reservation.
River report hash: `d44ca20c46314bdc3a0e6234a80ccee74e51aae51e2e42bd4d020fe50e16b87a`.

### C: complete turn quality observations

All 96 turn jobs also pass, match native exactly and reach the same 0.3%-pot target in
70–130 iterations. Complete first-street export/check/clone is included in job latency.

| Browser | p50 | p95 | Maximum | Maximum WASM high-water | Maximum sampled browser RSS increment |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 2,219.5 ms | 4,525.3 ms | 4,567.1 ms | 22,937,600 B | 62,750,720 B |
| Firefox | 26,786 ms | 52,061 ms | 53,939 ms | 22,937,600 B | 128,335,872 B |
| WebKit | 2,187 ms | 4,580 ms | 4,599 ms | 22,937,600 B | 84,230,144 B |

Maximum total browser RSS was 348,160,000 / 1,107,853,312 / 428,130,304 bytes respectively.
The largest observed sampling-request gap was 205.85 ms despite a requested 20-ms interval;
sampled peaks can miss shorter spikes. Linear memory, which grows monotonically in each
fresh Worker, includes the post-export high-water and is distinct from process RSS.

The [recomputed study summary](artifacts/hu-play-p1-wide-summary.json) binds all seven input
reports; payload hash `6970a2e7ab470bccb640aa18bcd67491b655f03eadbbac4d58232639d9f3163a`.
It preserves 192 per-case timing extrapolations from the six paired ratio cases, then compares
them with actual quality-run latency. Only **107/192** observations fall inside the simple
ratio-plus-overhead envelope. The envelope is therefore **not** a certified latency predictor;
use the measured per-browser quality distributions, not a claimed universal WASM multiplier.

### D: measured candidate (not implemented in production)

The proposed option is a **separate versioned play profile**, leaving the general-purpose
W4 parser unchanged. Candidate boundaries: 640 hands/player (the 12 starting library ranges
have at most 632), stack/pot ≤18 (covers 9750/550), float32, first-street export and the exact
existing lean turn/river menu. Do not relax the raw-construction guard for arbitrary menus.
Proposed additional engine/export ceilings are 32 MiB float32 storage, 16 MiB export working
reservation and 2 MiB bounded JSON. These are engineering headroom choices, not measured
absolute physical-device capacities. They require boundary tests and the real-source P1 audit.

Candidate solver reservations: retain the existing formula and its 128 MiB fixed overhead,
with 256 MiB on desktop and a stricter 192 MiB on mobile/unknown; reported device memory can
only lower either. These numbers were checked against **all** observations, including the
58 cases not selected for paired ratio runs. All 192 observed quality jobs fit both proposed
profiles and the proposed reservation exceeds every observed WASM high-water and sampled
browser RSS increment. The largest reservation for the original 1,000-iteration input is
166,514,968 bytes: desktop headroom is at least 101,920,488 bytes, mobile/unknown at least
34,811,624 bytes. This calibrates the proposal against desktop observations; it does not
prove a bound on JS memory or certify physical phones. The fixed overhead was **not** reduced.

Keep the existing 120-second absolute watchdog, deterministic target/iteration stopping and
discard-on-timeout behavior. Keep P0's 1,000-iteration deterministic play cap (all 64 native
quality jobs reached the target in at most 130); do not publish a target-missed strategy.
Set useful per-browser latency expectations from the quality
batch, not the ratio jobs or a promised percentage animation. The frozen corpus alone cannot
certify the 1,000 new seeded production hands or full board/line coverage; those gates stay open.

### Physical-device checklist (last, not blocking this research)

- iPhone/iPad Safari and Android Chrome: record device model, OS/browser, memory hint if
  exposed, exact build/source hash and the **same input hashes**, not reduced test ranges.
- Run smallest/median/largest rivers, then the largest turns and seed-0's high-SPR root;
  record iterations, final quality, elapsed time, crashes/reloads and device-reported memory
  if available. Compare numerical fingerprints; label unavailable RSS as unavailable.
- Repeat sequential fresh Workers, cancel during building/solving/export, immediately retry,
  background/foreground, and test under ordinary competing-tab memory pressure. Check that
  a killed job publishes no strategy and that the hand/session is recoverable.
- Check real Safari.app separately from Playwright WebKit. Check VoiceOver/TalkBack,
  keyboard/switch controls, narrow layouts and zoom when the play UI exists.
- Report heat and sustained-run slowdown. If phone turns fail the chosen budget, measure and
  activate the authorized turn-only mobile cache; retain live rivers where admission permits.

This checklist is ready for Kat; no physical-device result is claimed or awaited here.

## Reproduction and next integration gates

```sh
npm run build:bridge
npm run build:wasm
npm run audit:hu-play:wide
node --import tsx scripts/audit-hu-play-wide.ts --check --native
```

The first audit checks recorded input/report hashes and regenerates summary arithmetic
byte for byte. `--native` additionally re-estimates all 64 inputs, re-solves the 64 quality
and six timing cases, checks numerical fingerprints and independently re-grades all rivers.
It intentionally does **not** demand byte-identical clocks or RSS. Exact numerical re-solving
is a local same-platform reproduction; no unmeasured cross-architecture bit-identity claim.
CI checks the records plus the small weighted native/WASM regression and existing referees.

For fresh performance observations, use new output paths (scripts refuse to overwrite):

```sh
node --import tsx scripts/measure-hu-play-wide-native.ts --estimate --out /absolute/new-study/estimates.json
node --import tsx scripts/measure-hu-play-wide-native.ts --solve --estimates /absolute/new-study/estimates.json --street river --out /absolute/new-study/native-rivers
node --import tsx scripts/measure-hu-play-wide-native.ts --solve --estimates /absolute/new-study/estimates.json --street turn --out /absolute/new-study/native-turns
node --import tsx scripts/measure-hu-play-wide-native.ts --ratio --estimates /absolute/new-study/estimates.json --out /absolute/new-study/native-ratios
node --import tsx scripts/profile-hu-play-wide-browser.ts --mode ratio --native /absolute/new-study/native-ratios --out /absolute/new-study/browser-ratios
node --import tsx scripts/profile-hu-play-wide-browser.ts --mode quality --native /absolute/new-study/native-rivers,/absolute/new-study/native-turns --street river --out /absolute/new-study/browser-rivers
node --import tsx scripts/profile-hu-play-wide-browser.ts --mode quality --native /absolute/new-study/native-rivers,/absolute/new-study/native-turns --street turn --out /absolute/new-study/browser-turns
```

Create the new parent directory first. Run sequentially, without concurrent build/test
workloads. The commands require local process inspection and loopback browser permissions.
Freeze ratio indexes from estimates before browser timing. Retain failures, not only successes.

After the study release is verified and CI is green, P1 still needs:

1. A production, versioned, strictly bounded play profile with refusal/cancel/timeout tests;
   rerun the original corpus through **that actual profile**, not the private allowlist shim.
2. Complete flop policy columns. The saved teaching slices omit tiny positive reaches after
   quantization. The 12 original full-precision slice-result caches are present locally;
   investigate a separately hash-bound full-column play supplement without changing the
   frozen B4 files/ranges. Never invent a strategy for an omitted positive-reach hand.
3. Library, browser and native sources behind the real reducer, with asynchronous preparation
   at public decisions and no private cards in a solve/cache key. Reach follows the policy
   actually played, not a substituted saved rounded reach. Preserve the native test path.
4. All unchanged P1 gates: native full/browser-range comparison on the frozen corpus (100%
   retention when identical), ≥20 independently graded production river re-solves at ≤0.3%
   pot, 1,000 complete seeded hands with exact conservation and byte-identical replay hashes,
   real-source leak checks and Chromium p50/p95. A root-only study does not meet those gates.
5. Honest accounting: P0's equal-share starting-pot net is not a real preflop/session ledger.
   The scripted 550-chip pot includes 50 chips from a folded small blind. Keep that external
   contribution explicit; do not use or alter the protected trainer/session work.

Release verification and all production P1 gates remain open. No `/play`, production policy
source or raised live limit is claimed by this study.

## Pre-commit verification — 2026-09-30

The clean-scope candidate based on `9e53d18`, with **copied** `node_modules`, passes
**919/919 unit tests (no skips), 17/17 Rust tests, typecheck and ESLint**. Native/WASM
format and warnings-denied clippy pass with explicit Rust 1.98.1. One initially unqualified
WASM clippy invocation selected a toolchain without the target; the pinned rerun passes.
No target, source exclusion or warning policy was changed to conceal that invocation error.

Both the saved-only and source-complete prepared Next production builds pass. The existing
three-browser live UI suite passes **34 tests, zero retries**, with only its two explicit
non-Chromium skips of the Chromium-only real-browser-zoom API check. All engines run their
remaining keyboard, narrow-width, text-resize, refusal, cancel and asset-recovery checks.

Native referee, WASM referee and the 20-case native/WASM iteration grid pass, with zero
observed numerical deltas and the unchanged 0.0002-chip independent gate. The old P1 report,
saved bridge library, preflop artifact and river-v3 artifact reproduce unchanged. The wide
record summary reproduces byte for byte; all 64 estimates, 70 native numerical results and
32 independent river grades also reproduce locally. The new native-weight JSON regression
is now explicitly run in hosted WASM CI, rather than silently skipped when no engine exists.

Candidate WASM: 777,863 bytes; source hash
`742fca1b698b7f377ba2d3cca93192273cdc13664ee03e5c8420b7b7fc5cc1ec`;
build hash `47489d05a2abc8469b5e49e5e5491ab654a29fb78d40f8b2eac37b3729362b31`.
The study's earlier build hash is historical; exact-release builds can differ with layout
and manifest base commit. Exact source and licenses travel with every generated distribution.

The seven protected trainer/session file hashes still match the preceding handoff, and
reversing **only** the four owned README edits reproduces its pre-study dirty bytes exactly.
The paused draft still causes exactly nine root-worktree type errors; the clean candidate
has no exclusions and passes. Nothing from that draft or trainer/session work belongs in
the study commit. The exact commit must still be tested in another fresh copied-dependency
checkout before push, and every CI job must be observed green before integration continues.
