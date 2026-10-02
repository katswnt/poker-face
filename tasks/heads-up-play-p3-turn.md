# P3 — nested turn solving and a reusable turn cache

Status: shipped as `bc4e5e5` after exact-commit isolation and all eight jobs in hosted
CI `36950939510` passed. P4 may start. Prospective contract written before P3
behavior changes or timing results. Depends on shipped P2 `1d581d8` (all eight jobs in
CI `36906885269` green). The binding gates remain in `cpu-ceiling-roadmap.md` and
`heads-up-play-resolving-spec.md`; nothing below substitutes for them.

## Scope and invariants

- Turn custom bets/raises re-solve at the human's public parent, with the lean turn and
  river menus plus exactly that actual action. First-street export ends at river chance;
  the internal solve still includes every compatible river. A new river-root solve uses
  the actual dealt card and the ranges from the policies actually played.
- A separate `turn-subgame-v1` contract preserves the actual forced turn prefix (at most
  eight continuing actions). Already-conditioned ranges are not conditioned again along
  that prefix. Do not broaden `river-subgame-v1` or ordinary explicit-tree validation.
- No private hand or future dealt card in solve requests, cache keys or preparation.
  All-in calls run out to showdown; they must not create a fictitious river decision.
- Keep every positive arriving hand. P1's 640-hand/SPR18 envelope, float32, 0.3%-pot
  target, 1,000 iterations, 120-second watchdog and measured memory admission stay in
  force. A strict separate profile admits only this tree family, not arbitrary menus.
- Cancellation/supersession never commits the human action or publishes a partial policy.
  Undefined zero-support posteriors require recorded translation using a supported old
  action, followed by solving the response at the **real** price. Never invent reach or
  silently change a bet size. If neither route passes its gate, report refusal.
- Small raw solve exploitability is not safety of the composed policy. No global safety,
  exact GTO, physical-phone performance, solved preflop or solved-range claim.

## Cache contract (before measuring coverage)

Warm all publicly legal turn cards for each of the 12 unchanged B4 flops after the
unraised common flop lines: check/check and every single-bet/call line in the lean flop
menu (including check/bet/call). Derive arriving ranges from the complete, hash-bound
flop policy supplement; do not use truncated/quantized slices as full policies. Include
every compatible requested root, and report any unsupported or failed root explicitly.

Cache identity includes the complete normalized public solve input, ranges, finite tree,
quality settings and engine/bridge build identity. File hashes bind complete float32
first-street policies in independently fetchable chunks. A changed board, price, range,
tree or engine cannot return a stale hit. Result validation and quality admission are
identical for cached and live results. Failed fetch/hash/validation is a recorded miss,
not authorization to use the corrupt result. No hidden-card-dependent lookup.

Report byte sizes and cold/warm lookup latency separately from solve latency. Evaluate
hit rate on the first 1,000 seeded production hands (seeds 0–999, both seats played by
the real source), without tuning the warm-up lines after observing misses. The cache is
not claimed to cover arbitrary custom bets or all future histories. Live misses remain
bounded solves; this is not a new game or a substitute for the required live-turn gate.

## Implementation / fail-first order

1. Strict TypeScript and Rust turn-subgame parsing; legal forced prefix, chance boundaries,
   all-in termination, actor/order/minimum-raise and exact hand retention tests.
2. Pure explicit turn-tree builder, checked against the native lean menu at multiple pot/
   stack depths; native/WASM parity and independent tiny complete-game grading.
3. Worker admission/profile and public-only nested source; actual range updates,
   zero-support fallback, cancellation and new river-root preparation through the reducer.
4. Optional hash-bound offline cache generation, validation/loader and production source lookup.
   Deterministic cache corruption, version mismatch, miss and no-private-data tests.
5. Frozen off-tree turn corpus: at least 200 distinct public parents from the existing
   seeded B4 game, with small, intermediate, large and all-in non-menu actions, covering
   both seats and root/check/bet/raise parents. Freeze input bytes before timing. Record
   every direct/fallback/refused case, grades, iterations and native/browser timing.
6. Repeat unchanged P1 1,000-hand conservation/replay/leak gates; independently grade
   sampled complete turn games where tractable and at least 20 production rivers. Record
   Chromium M1 Pro p50/p95 (turn p95 **≤10 s**, river p95 **≤2 s**). Retain failed attempts.
7. Versioned successor evidence for changed P1/P2 source closures, preserving historical
   artifacts and exact identities; never allow-list arbitrary source changes.
8. Full tests, typecheck, lint, Rust checks, relevant solver/artifact audits, browser checks
   and saved/prepared production builds. Explicit P3 file commit, exact-commit isolated
   verification with copied dependencies, push, all eight CI jobs green before P4.

## Gates / evidence

- [x] Contract and menu parity; complete tiny-game independent turn grades.
- [x] Production nested turn, translated response, cancellation and fresh river solve.
- [x] Frozen custom-turn measurements, unchanged quality and latency budgets (draft source;
  exact-commit reproduction and release proof still required).
- Optional: full common-line cache, corruption/version checks, hit-rate/latency/size report;
  not a release blocker if the unchanged frozen live-turn gates pass (Kat, 2026-10-01).
- [x] 1,000 deterministic conserved hands; public-only leak invariants (draft-source
  measurement complete; exact-commit/CI checks below still required).
- [x] P1/P2 regression/successor evidence, preserving every historical artifact.
- [x] Exact-commit isolated checks and push.
- [x] Every hosted CI job green before P4 starts: run `36950939510`, commit `bc4e5e5`.

Measured results, commands, owned paths and known limitations are appended as obtained;
unchecked items are not claimed complete.

## Checkout continuity

Related future option: [data reuse and reference publication](poker-data-reuse-and-publication.md).
That research note does not change P3's cache coverage, validation gates or release scope.

### Safeguard and priority amendment — 2026-10-01

The primary checkout is readable again. All 46 non-conflicting continuation files were
copied back byte-for-byte, verified by SHA-256, without staging or committing. The three
existing primary release-record edits were preserved instead of overwritten by the
continuation's alternate wording. All 16 protected trainer/session/flop-draft files match
their pre-copy hashes. The primary checkout is now the durable source checkpoint; the
independent continuation still runs the frozen measurements against its original binaries.

An ignored local safeguard directory, `build/p3-safeguard-2026-10-01/`, contains the
source/protected-file hash manifest and `frozen-turn-corpus.tar.gz`. Archive SHA-256:
`6805cbd253547fa4fc2ad1bf2a9a0ca7164c8b0248a1730b096562fe8cd41cb6`.
This is a local recovery checkpoint, not a published release or completed audit.

Kat explicitly made cache completion optional **if** the frozen 200-case corpus passes
live, including turn p95 ≤10 s and all unchanged quality/correctness gates. Prioritize
that corpus before more cache generation; P4/P5 must not wait for an optional optimization.
The cache process group 31620 was suspended on request with SIGSTOP and stays suspended.
Any elapsed time spanning that pause is invalid latency evidence. If resumed, first
verify the process identity and frozen source/build hashes. Existing partial records
must not be represented as complete coverage or measured browser performance.

The 200 distinct public parents were frozen before off-tree measurement, with input hash
`b0a7e5dd3ef4516316b8a1bf84759319521a47404965695a29526e1e02c3dae7`.
They come from the first 200 distinct turn roots in hand seeds 0–281, with both AI seats,
all four parent families, 40 minimum, 40 all-in, 40 near-all-in and 80 interior sizes.
All 200 baseline solves passed their quality gate. Two cases needed the prospectively
defined supported-parent selection fallback; that is **not** the solve fallback rate.
Current native audit attempt: `/private/tmp/poker-p3-playing.VbLrKm/capture`.
No production browser result or P3 release is claimed yet.

### Frozen-corpus reproduction and first complete native attempt

The first audit stopped **before solving** because JSON key reordering changed the old
turn subgame ID. New fail-first turn/river identity tests reproduce this issue. The fix
serializes public events and actions in their original schema order: all 200 complete
frozen spots, hashes, ranges, parents and amounts now reproduce exactly. Nothing was
reselected, and the original frozen input remains unchanged. A source-only v2 successor
records the new implementation identity and its parent input hash:
`bec208a7e32ba99f8b99ab4b115d277dac4438a94932d0d08635dc6a3a1b7e3c`.
`scripts/refreeze-hu-play-p3.ts` refuses any change to a frozen case, including order;
it copies the unchanged baseline results and runs no new native solve.

The first full native attempt (`/private/tmp/poker-p3-playing-v2.4NXXG8/capture`)
completed **192/200**, with eight failures, and is not passing release evidence:

- Seeds 126 and 141: translated all-in responses were rejected by the nonnegative
  raw-engine-score check. Fresh complete native exports are identical to their entire
  first-street policies; the independent complete-turn grader gives **0 chips** for both.
  Raw engine residuals are -0.000030517578 and -0.000015258789 chips, respectively.
  Both agree within B2's existing 0.0002-chip bound. A separate terminal-only turn gate
  now checks the complete exported policy independently before admitting a negative
  residual. It preserves the raw result, reports the independent grade in provenance,
  rejects any omitted chance continuation, and does not change the 0.3%-pot target or
  the existing ordinary-turn/nonnegative gate. The original full-export referee still
  refuses first-street exports; its separate terminal-only entry proves completeness.
- Seeds 152, 157, 162, 182, 187 and 197: the test opponent's check/call/fold-only tail
  had no supported action. The fixed, public-only continuation preference is now
  check, call, fold, bet, raise (existing policy order within each type), always requiring
  compatible model support. This changes the test tail, not the frozen initial bet,
  game, first AI response or production policy. No actual private hand or timing enters
  selection. Both the failing attempt and the revised method are retained.

Fail-first regression logs: `poker-p3-subgame-identity-{red,green}.log`,
`poker-p3-refreeze-{red,green}.log`, `poker-p3-quality-tail-{red,green}.log` in `/private/tmp/`.
The quality/tail suite passes 4/4; native/WASM, Worker, identity and river-quality
regressions pass 14/14 with zero skips. The complete failed native capture is also
safeguarded at `build/p3-safeguard-2026-10-01/failed-native-v2.tar.gz` (SHA-256
`3be407249ef21c7ab6cf0adf72fd58598f29084a0a4f074b903ee429b40a30f7`).
All 200 cases are rerunning, not just the failures, at
`/private/tmp/poker-p3-playing-v3.fFIIA1/capture`. No success is assumed.

Optional cache checkpoint: 674 completed records/chunks, **50,071,208 uncompressed
policy bytes**, from the prospective 2,352 common roots. This is partial generation,
not an observed play hit rate, compressed transfer size or deployed coverage. It remains
suspended and is not used by the live-corpus audit.

### Live frozen-corpus gate passed — 2026-10-01 (still not a release)

The complete corrected native run at `/private/tmp/poker-p3-playing-v3.fFIIA1/capture`
passes **200/200**, exact deterministic replay and real-chip conservation. There are
**135 direct / 65 translated-range responses**, 327 accepted native solves in total,
and 62 independently graded actual river games (maximum **0.2972137231% pot**).
Native report hash: `6c99322f1c965a4ed42592f77701f41957f44ccab555ab517ec81cc133e5c31d`.
The translated responses still solve at the real price; the human range is modelled
using a supported old action. This fallback rate and its limitations must stay visible.

The unchanged production Worker, fresh Chromium browser per case, full ranges, no cache,
unknown-device 192 MiB profile, and no cross-origin isolation completed all 200 cases
with exact native numerical/log identity and Worker cleanup:

| Measurement | p50 | p95 | Maximum | Unchanged p95 gate |
| --- | ---: | ---: | ---: | ---: |
| Actual turn action → first AI response | 1,342.4 ms | **4,255.7 ms** | 7,357.4 ms | 10,000 ms |
| Actual river request → playing policy (62) | 48.95 ms | **63.80 ms** | 73.90 ms | 2,000 ms |

Raw browser records: `/private/tmp/poker-p3-browser-live.HHf8Lp/capture`.
Turn timing includes failed/zero-support attempts and translation fallback, plus the
audit's response snapshot, but not an already-prepared old baseline or later river
decisions. All native solving was idle during this timing run; brief regression-test
activity overlapped, so this is an observed desktop run, not a pristine-machine lower
bound or a phone guarantee. Progress memory is not claimed as peak memory; the separate
three-browser W2-observer run remains pending. The optional cache therefore **does not
block P4/P5**, per Kat's explicit condition. No physical-device gate was added.

Four fixed first-of-family cases (seeds 0, 50, 100, 150), selected before their complete
reference grades, also pass. Complete turn/river policies exactly match the actual
first-street exports; independent grades are respectively **0.291464570%, 0.210963054%,
0.271054378%, 0.292719619% pot**. Maximum engine/referee difference is
**0.000004716122 chips**, within the unchanged 0.0002-chip tolerance. Complete exports
contain 7,077 / 5,055 / 3,034 / 2,024 public nodes. Records:
`/private/tmp/poker-p3-complete-grades.YEsfqF/capture`.
These grade the specified finite games, **not** the safety of a composed strategy.

Fresh P1 1,000-hand and 64-root reproductions and P2 200-case reproduction are running
before new versioned successor evidence is captured. Historical P1/P2 artifacts remain
untouched. New successor readers retain the historical archives, bind their parent
hashes and require identical numerical/log identities plus current source closures and
fresh unchanged gates; they do not permit a source-hash allowlist.

The earlier optional cache process was no longer present at the read-only process check
before browser timing. Its 674 completed records remain intact; no batch was restarted.

The original Documents checkout became unreadable (`Operation not permitted`) after P2.
P3 continues in a fresh independent public clone at `/private/tmp/poker-continuation.QklD3O`,
verified clean at `1d581d8aeed8b5d0735ab3544ec1ab412e550ef8`, with physically copied
`node_modules` from the accessible exact-P2 verification copy. No access-control workaround
or edits to the original trainer/session/flop draft were attempted. Original checkout
reconciliation remains open until access returns; its dirty files must be preserved.

### Cross-browser and release-regression checkpoint — 2026-10-01

Fresh P1's 64-root native/complete-export reproduction is numerically identical to the
historical release. Fresh P2's 200 native cases pass with the same 12 translations; its
independent safety study still measures **23.3990626360% of subgame pot** maximum composed
exploitability. This is not an expected win rate or a bound for all hands.

The P3 W2-observer Chromium run also completed all 200 cases: turn p95 **4,465.5 ms**,
river p95 **65.8 ms**, largest observed WASM linear-memory high-water **31,129,600 bytes**.
These are through-export linear-memory observations, not total browser/JS peak memory or
a physical-phone certificate. Firefox/WebKit collection is still in progress. Early
Firefox turn times are roughly 11–58 seconds with exact numerical/log parity. This is
consistent with the earlier P1 feasibility study's Firefox turn p95 of 52,061 ms; it is
not a newly established regression or a diagnosed JIT problem. Chromium remains the
prospectively specified latency gate. `/play` must not promise its timing in all browsers.

Fresh P1 native replay, short unit/type/lint checks and then P2 browser regressions overlap
parts of this memory batch. Timings are desktop observations under that recorded load,
not isolated microbenchmarks. The P3 primary live timing above ran separately. The native
P1 1,000-hand reproduction is still running; the P3 real-controller 1,000-hand replay will
bind those exact freshly generated policies and complete logs, not synthesize a new deal set.
Raw memory capture: `/private/tmp/poker-p3-browser-memory.qfr2i5/capture`.

The fresh 1,000-hand native run completed all **1,342 solves** and 32 independent river
grades, with every numerical fingerprint, complete hand log and chip ledger identical to
the historical P1 release. Report hash:
`2b7f02bf0abeb958d4405ae73e4c530387ebf4903baa64666f82140902db73dd`.
The 64-root production-Worker regression passed with exact native parity: Chromium turn
p95 **4,876.5 ms**, river p95 **109.5 ms**. P1's new version-2 successor evidence preserves
its historical archive and binds 101 current source files; `audit:hu-play:p1` passes.

P3's real full-hand/controller layer then replayed those 1,000 hands **twice each**, using
the same freshly generated public policies, verifying every requested game hash and
policy hash before use. Every complete log and ledger matches P1 exactly. This separately
checks composition, not a new solve latency or optional-cache hit rate. Capture:
`/private/tmp/poker-p3-full-hands.61rO2S/capture`, report hash
`eceb49083a162f27b045b5c4729ca79421f9722d6fd11b21feb178c316728335`.
The targeted P3 real-native/WASM/controller/cache suite passes **41/41, zero skips**;
nine identity/evidence-boundary tests and all 21 Rust tests pass, as do typecheck, lint,
native fmt and Clippy. The complete unit suite is running, with P2/P3 release evidence
still incomplete; no missing proof is waived. All 16 protected files remain unchanged.

Fresh P2's normal Chromium Worker run passes **200/200**: p50 **119.75 ms**, p95
**169.600 ms**, maximum **209.400 ms**. P1/P2 browser regressions overlapped parts of
the P3 memory batch and P3 controller/unit checks, not an idle-machine microbenchmark.

Fail-first `hu-play-p3-ci.test.ts` now passes: the CI workflow includes the P3 release audit,
real native forced-turn tests, real-WASM Worker/cancellation and full-hand composition.
Historical artifact bytes are still untouched. No P3 commit has been made.

P2's complete 600-case observer regression now passes with exact native parity and
Worker retirement in all three browsers. Chromium/Firefox/WebKit p95 is respectively
**170.8 / 470 / 165 ms**; observed WASM high-water is **2,162,688 bytes** in each.
The new `hu-play-p2-p3-successor` archive is a separate version-2 proof, retaining the
original frozen inputs, baseline policies, every playing policy, log and independent
safety result. Compressed SHA-256:
`1819c4b60223e4d56cc435789b776cff733b3b133d16fa4138006fd1ae26dade`.

The complete serial draft suite ran **1,022 tests: 1,020 passed, two failed, zero skipped**.
Both failures are proof gates, not waived: it reached the P2 evidence test before the
successor was captured, and P3's final three-browser proof does not exist yet. All other
tests passed. Log: `/private/tmp/poker-p3-full-preflight.log`. Re-run the full suite after
the final evidence is captured, then again against the exact isolated commit.

A second ignored recovery archive, `build/p3-safeguard-2026-10-01/passed-native-and-live.tar.gz`,
preserves the completed native/live/full-game/replay observations (including the fresh P1
policies), not merely summaries. SHA-256 after the archive completed:
`14c8cc07f11d2cfde1dd7beaa01e908d5728d43aab62789081dec0073855d00b`.
All 81 then-owned files were byte-identical in the primary and continuation checkouts;
nothing was staged. This is a local recovery archive, not a data publication.

### Fresh-build reproduction contract

`scripts/reproduce-hu-play-p3.ts` provides a separate reproduction of the immutable
evidence with a freshly built native or Node/WASM engine. It never rewrites the frozen
inputs or bypasses a stale-source check. It requires the same current engine source,
re-solves every frozen request through the real public controller, checks every numerical
cell and complete log against the preserved result, and independently grades fresh complete
exports of the same four reference cases. The new binary/WASM build identities are recorded
separately. Different clean checkout paths or the build's `baseCommit` can change binary/build
hashes; that does not permit any numerical/game/quality change. No new browser timing or
memory claim is made from this Node tool.

Fail-first `hu-play-p3-reproduction.test.ts` rejects missing tooling, an altered action
frequency, a missed target and the wrong game; the real-WASM test now passes. CI's WASM
job explicitly runs it. Full fresh-build corpus runs belong in exact-commit verification,
after the P3 evidence bundle has been captured:

```sh
npm run build:bridge
WASM_BINDGEN=/path/to/wasm-bindgen-0.2.104 npm run build:wasm
npm run audit:hu-play:p1
npm run audit:hu-play:p2
npm run audit:hu-play:p3
npm run reproduce:hu-play:p3 -- --backend native --out /new/native-capture
npm run reproduce:hu-play:p3 -- --backend wasm --out /new/wasm-capture
```

The output directory must not exist; all failed cases and raw returned policies are kept.
Quality remains 0.3% pot with the existing precision/referee tolerances; first-street
exports are not misrepresented as complete future strategies.

### Cheap optional-cache checkpoint (not a release dependency)

No generation was restarted. The preserved **674/2,352** prescribed common roots are
the complete first three flops (196 each) and the first 86 roots of `9h8h6c`, not a
success-selected or representative sample. Each chunk's size/hash, exact public input,
engine identity, complete first-street columns and current quality admission were checked.

- Total raw policy bytes: **50,071,208**; sum of individually gzip-level-9-compressed
  chunks: **20,079,534 bytes** (20.1 MB). Largest raw/gzip chunk: **104,423 / 42,686 bytes**.
  This is payload size, excluding a manifest and HTTP overhead—not measured network
  latency and not a requirement to download every chunk before playing.
- Exact public-spot membership matches **238 of 765 turn requests (31.1%)** in the fresh,
  frozen first 1,000 P1 hands. This is potential coverage of that partial root collection,
  **not** observed browser-cache hits, arbitrary-human/off-tree coverage or coverage of
  all 12 flops. No uncompleted root is counted as available.
- These chunks retain their original build identity. A different clean build is a miss
  until separately validated/repackaged; no cross-build compatibility was assumed.

Frozen cache inputs hash:
`7999ae883b21fa4845551e7fc9e2c6680fe7199c81c92e5da1d95ea21d814f7f`.
Local observation: `build/p3-safeguard-2026-10-01/partial-cache-observation.json`.
Cache publishing, actual loader hit rate and cold/warm download timings remain optional
and uncompleted. P4/P5 do not wait for them.

### Broader regression checks

The fixed serial bridge/WASM/library/P1-wide/gadget/preflop/river-v3/factorization/live-example
audit list passes, with no artifact changes. Additional evaluator, Kuhn/Leduc, earlier
river, turn/vector/configurable-turn and saved turn-explorer reproductions pass. The first
flop-reference attempt failed because the sandbox denied `ps` memory sampling (`spawn EPERM`),
**not** due to a timeout or mathematical mismatch. The unchanged permission-approved
reproduction passed in 42.260 s, with 1,104,953,344-byte sampled combined RSS under its
unchanged 2 GiB cap and byte-identical artifact. These checks overlap the P3 memory batch;
that batch is not an isolated timing microbenchmark. No threshold was raised.

The remaining saved-flop source/library/explorer and exact equity-matrix audits pass.
W1 native/WASM browser parity and W2 real-Worker cancellation/lifecycle audits pass in
Chromium, Firefox and WebKit; `next typegen`/`tsc`, full lint, native/WASM fmt and Clippy
also pass. Both candidate Next production builds pass (saved-only and prepared assets).
The saved-only Playwright suite passes **82**, with four intentional live-asset skips;
the prepared three-browser suite passes **34**, with two intentional non-Chromium zoom
skips. **No retries** were enabled. Representative 320px setup and 1280px result screenshots
were visually inspected. Logs/output: `/private/tmp/poker-p3-{build-saved,build-prepared,
e2e-saved-first,e2e-live-first}.log` and the corresponding e2e output directories.

The candidate builds and UI tests overlap the later Firefox memory cases. They do not
replace exact-commit isolation, fresh-build P3 numerical reproduction, or hosted CI.
The primary checkout's older assets are not deployment-ready; P5 still requires a clean
release rebuild and deployed source/archive identity verification.

### Concurrent planning commit preserved

The pre-release branch check found new main commit `bd169a7db66efe03ae9127b7f8d1e9fe817a7b20`
(CI `36942839002`, completed/success): only `tasks/todo.md` and the new
`tasks/trainer-solver-integration-plan.md`. The primary checkout already contained it.
The continuation was fast-forwarded with no P3 or protected-file edits; all 16 protected
hashes remain unchanged. Neither planning file is part of P3's staged-file list. The
recorded engine build still accurately names its original `1d581d8` base; all measured
engine/runtime source bytes are unchanged. P3 will land on the newer main, not overwrite it.

The future trainer plan does not change the current P3 → P4 → P5 execution order or
authorize modifying the dirty trainer. Before that later integration, distinguish the
opponent's information-limited action policy from the learner's blocker-conditioned belief,
and do not call the approximate local solver a "perfect opponent". Those are future review
notes, not changes to the unrelated plan or additional P3 requirements.

The completed Firefox 200-case observer run has exact native parity, no failures and
clean Worker retirement: turn p50 **15,335.5 ms**, p95 **51,838 ms**, maximum **98,205 ms**;
river p50 **87 ms**, p95 **161 ms**, maximum **247 ms**. Its largest observed WASM
high-water is **31,129,600 bytes**, the same as Chromium. The prospectively specified
10-second turn/2-second river **latency gate is Chromium-only**, as in P1; Firefox passes
the parity/lifecycle/memory checks, not a 10-second speed promise. The release summary
labels that gate scope explicitly. No timeout or quality limit was enlarged. WebKit is
still running; the combined evidence has not yet been published or marked passed.

### Completed three-browser capture and release evidence

All **600/600** observed cases passed native numerical/log parity and clean Worker
retirement, with no cache and no cross-origin isolation. The maximum observed WASM
linear-memory high-water through export was **31,129,600 bytes (29.7 MiB)** in each
browser; that is not total process/JavaScript memory or physical-phone certification.

| Browser | Turn p50 / p95 / maximum (ms) | River p50 / p95 / maximum (ms) |
|---|---|---|
| Chromium | 1,349.7 / 4,465.5 / 7,521.5 | 47.95 / 65.8 / 70.1 |
| Firefox | 15,335.5 / 51,838 / 98,205 | 87 / 161 / 247 |
| WebKit | 1,344 / 4,396 / 7,564 | 36.5 / 49 / 55 |

These observer timings retain the concurrent-load qualifications above. The separate
production Chromium run's **4,255.7 ms turn p95** meets the unchanged 10-second gate.
Firefox passes correctness/memory/lifecycle, not that Chromium-specific latency gate.
No gate, watchdog, quality target or range was reduced to obtain this result.

The final capture command audited all 200 real-controller cases, 327 accepted solves,
62 independently graded reached rivers, four complete turn references, all 800 browser
observations (200 primary + 600 observer), and the 1,000 full-hand replays before writing
the release files:

```sh
node --import tsx scripts/capture-hu-play-p3.ts \
  /private/tmp/poker-p3-corpus-source-v2.pfWurH/capture \
  /private/tmp/poker-p3-playing-v3.fFIIA1/capture \
  /private/tmp/poker-p3-browser-live.HHf8Lp/capture \
  /private/tmp/poker-p3-browser-memory.qfr2i5/capture \
  /private/tmp/poker-p3-complete-grades.YEsfqF/capture \
  /private/tmp/poker-p3-full-hands.61rO2S/capture
npm run audit:hu-play:p3
```

Published-in-commit evidence is a **34,921,234-byte** compressed bundle with SHA-256
`dd9b5648c3bebd6958f9b69bc6d8d676952376eeade1041c24c8b1870253c51b`;
its uncompressed content is 127,796,397 bytes. Evidence hash:
`ccd478fea488cb1e20dab6b1c4937317d73222c7da814f085836d04d377f9bc3`.
The manifest and summary are human-readable; the audit verifies hashes before replay
and recomputes every summary. Historical P1/P2 bundles are preserved alongside their
new source-bound successor proofs.

The ignored local recovery archive `completed-browser-memory.tar.gz` has SHA-256
`93e6534abbb07945669364c50577b12aab2ff79780f6a461a3f8625003c9d8c6`.
It preserves all raw P2/P3 browser memory observations, not just these summary numbers.
Physical devices, optional cache publishing/lookup timing, and global policy safety remain
open. P4 may start only after exact-commit verification and all hosted P3 CI jobs pass.

After final evidence capture, the complete candidate suite passes **1,023/1,023**, zero
skips, in 514.286 s (`poker-p3-full-ready-approved.log`). Typecheck, lint and the final P3
audit also pass. The first sandboxed attempt ran all 1,023 tests with seven failures caused
by denied process-memory sampling (`spawn EPERM`), preserved in
`poker-p3-full-ready.log`; the unchanged permission-approved run passes every test.
No test, timeout or quality threshold was changed. The index contains exactly the 89
explicitly inventoried paths, with only one README hunk applied via `git apply --cached`.
All protected preimages remain unchanged after removing that owned README paragraph.
The forthcoming exact-commit rebuild/reproduction and hosted CI are separate release gates.

## Implementation evidence — 2026-10-01 (earlier draft, not a release)

Implemented the separate TypeScript/Rust `turn-subgame-v1` contract, forced-prefix
bookkeeping, exact lean-plus-actual tree builder and `play-turn-v1` Worker admission.
The profile has a pre-construction bound of 176 abstract nodes (120-node lean continuation,
at most 48 additional nodes for the actual action, plus eight forced-prefix nodes).
That is a structural bound, **not** a memory or latency certificate; the existing estimate,
export, quality and watchdog checks still apply. No W4 or P1 budget was enlarged.

Fail-first logs and current passing checks are retained under `/private/tmp/poker-p3-`:

- `turn-tests-red.log`, `rust-red.log` → strict contract tests and **21 Rust tests** pass.
  `turn-parity.log`: **5/5** tests, native/WASM menu parity at six pot/stack settings,
  four tiny complete nested-turn games independently graded by both turn kernels. First-street
  export preserves the full solve's policies/values; no truncated export is graded as complete.
- `profile-red.log`, `source-worker-red.log`, `controller-red.log` → strict profile,
  real-WASM Worker/source checks, direct/fallback range updates, malformed-result refusal,
  cancellation/supersession and fresh actual-river solving pass their targeted suites.
- `full-source-red.log` → `full-source-green.log`: **3/3** full-hand composition tests.
  The saved flop remains on-tree only until P4. Turn and river controllers prepare an
  action before the reducer commits it; direct and translated-response play conserve chips,
  replay identically, and cancellation leaves the exact prior state/reaches untouched.
- `cache-red.log` → `cache-green.log`: **4/4** cache tests. Keys bind the complete public
  spot, quality options and engine/source/build identity. Complete float32 turn policies
  are validated, never per-mille compressed. Stale builds, corrupt/truncated/oversized
  files, bad results and missed targets produce recorded misses, not playing policies.
  A cancelled read is not a cache miss and cannot start a fallback solve. Cache chunks
  are bounded at 2 MiB, the manifest at 1 MiB and the warm byte cache at four entries.
- `cached-source-red.log` → `cached-source-green2.log`: **2/2** adapter tests. Hits avoid
  live solving; misses invoke the supplied live solver. Hand-decision provenance names
  hit/miss and the exact key/chunk without including non-deterministic lookup timings.
  The first adapter test mistakenly compared two different measured wall clocks; its
  corrected comparison preserves **all numerical fields**, omitting timing/RSS only on
  the fresh-live branch. Cache-hit bytes are still compared in full.
- `warmup-red.log` → `warmup-green.log`: every **2,352** prospective common root is
  constructible: 12 unchanged flops × the four lines `x x`, `b182 c`, `b363 c`,
  `x b363 c` × 49 publicly possible turn cards. Zero unsupported roots; every positive
  arriving hand retained. This is input enumeration, **not** 2,352 completed solves or
  an observed hit rate. No seeds/private deals or measured misses selected this coverage.
- `composition-cache-final.log`: **9/9**, including the strengthened non-interference
  comparison between two legal positive-weight private deals on the same public line.
- `real-zero-support.log`: **4/4** controller tests, including a real one-hand-per-seat
  QQ-versus-set-of-sevens turn solve whose added all-in has zero modelled support. The
  fallback retains a supported old likelihood and solves the actual 1,800-chip response;
  it neither invents a posterior nor changes the real bet. This extra regression was
  added after the complete draft suite below.

The first complete draft suite (`npm test`, `full-suite-draft.log`) ran **1,002 tests**:
**999 passed, three failed, zero skipped**. All three are intact historical source gates:
the two P1 evidence tests reject the changed current source closure, and P2 rejects its
changed closure pending new reproduction evidence. These failures are **not waived**.
P3 cannot be committed/released until versioned successor records preserve the old evidence
and repeat its unchanged numerical/log/quality/browser gates against the final new sources.

`npx tsc --noEmit` and full `npm run lint` pass. The saved-only production build passes
(`build-draft-approved.log`); the first sandboxed attempt failed solely fetching the
existing Google font (`build-draft.log`), then the unchanged build passed with approved
network access. This is draft verification, not exact-commit release verification.
`audit:river:v3`,
`audit:river:factorized`, `audit:preflop` and `audit:hu-play:library` pass without modifying
their artifacts. River v3 still reproduces +16.081056725 chips for player zero and
0.009074631-chip exploitability. The preflop audit reproduces the **unvalidated** model;
it is not evidence that PF4 may advance.

Remaining measurements: freeze the 200-case custom-turn corpus and the common-root inputs
to disk; generate/grade the full cache; measure browser/cache latency and memory; run the
first 1,000 production hands without adapting the warm-up set; produce P1/P2 successor
proofs, then complete exact-commit isolation and CI. Deployment must use the exact verified
engine/cache identity (or record a miss); cross-build binary equivalence is not assumed.
No cache data pack has been published and no P3 commit/push has occurred.

### Exact-commit release verification — `bc4e5e5`

The exact commit `bc4e5e50fad833bfbe4d5e6417c4b5712c17a77a` was checked in
`/private/tmp/poker-p3-exact.a8eVYm`, an independent clean clone with **physically copied**
`node_modules`, no protected draft and no type-check exclusions. Native and WASM engines
were rebuilt from that checkout with the pinned toolchains. The tree was still clean
after every check below. Only then was the commit pushed to `origin/main`.

- **1,023/1,023 unit tests, zero skips**, 546.108 s; `next typegen`/tsc and full lint pass.
- **21 Rust tests**, native/WASM fmt and Clippy pass.
- P1/P2/P3 evidence, full flop play/library, bridge/library/referee, gadget, preflop-model,
  river-v3/factorized/exchange, turn-vector/v2/explorer, flop-reference/source/library/explorer,
  exact equity-matrix and saved live-example audits pass without artifact changes.
- Fresh native/WASM referee parity has zero numerical deltas, retaining the independent
  0.0002-chip tolerance. Real Worker parity/cancellation/cleanup passes in Chromium,
  Firefox and WebKit.
- Both saved-only and prepared-asset Next production builds pass. Saved-only Playwright:
  **82 passed, four intentional live-asset skips**, 52.9 s. Prepared three-browser
  Playwright: **34 passed, two intentional non-Chromium zoom-API skips**, 28.2 s.
  **No retries**. Narrow and desktop screenshots were visually inspected; overflow and
  keyboard checks passed. These runs overlapped correctness work, not new timing studies.
- Fresh **native and Node/WASM each re-solve all 200 cases / 327 accepted requests** with
  every numerical cell and full reducer log identical. Each also reproduces all four
  complete turn references and independently re-grades them. No frozen input or artifact
  was rewritten to match a new binary identity.

Fresh native report: `/private/tmp/poker-p3-exact-native-reproduction/report.json`,
SHA-256 payload `be0e25ffa7f9046b7725437478c88c8160b544dcec1650e45bd3835929be12af`.
Fresh WASM report: `/private/tmp/poker-p3-exact-wasm-reproduction/report.json`,
SHA-256 payload `47c5fff16e9e80b078c164354f99dcf0aafbb266aeb9741b71a8245a5123bc29`.
All local release logs use `/private/tmp/poker-p3-exact-*.log`.
The ignored safeguard archive `build/p3-safeguard-2026-10-01/fresh-exact-reproduction.tar.gz`
preserves both complete fresh captures; SHA-256
`93489a482619aab4a5bfaec612915c018105ce0afc60ab7f501c55132a9ed6cf`.

Clean build identities:

- Engine source: `a2852d8ab1701a796d7f32b71be37092082cd622a264dd5c60854684c0a068d2`
  (unchanged from the measured corpus).
- Build: `4c0295c516eec5a9a5fa54b4e4f58dd3a4c93855c5038547c6fcc3f95dcf5adf`.
- WASM: **796,056 bytes**, SHA-256
  `8dfd16b4632a5c4ceef64396b1e156a06e6fc1bf2f7e7686e98734af891700f9`.
- Native binary: `9bad89c0ab7415b6e664acf6f447db7affa763ae48d912d404b6f64617dc32b5`.
- Prepared corresponding-source archive:
  `e033a7974d179d0194ce8a89588e719ae06705636f0697a356a4faaf9aae19b8`.

These are local release-test assets, **not a Vercel deployment**. P5's clean release
rebuild and deployed engine/source checks remain required. All 16 protected preimages
still match the safeguard manifest after removing only P3's README paragraph. No trainer,
session or configurable-flop draft was staged. The separate data-reuse note stays untracked.

Hosted run [36950939510](https://github.com/katswnt/poker-face/actions/runs/36950939510)
completed successfully on the exact commit: **all eight jobs observed green before P4
began**. This includes the full verification job, native bridge, WASM/browser job and five
multiway audit jobs. No hosted retry or gate change was needed. CI's action-runtime/image
deprecation notices are maintenance notes, not failed gates.

### Explicit files currently owned by P3

This inventory is extended explicitly before staging later measurement/release files.
The data-reuse note is Kat's separate requested note, not an authorization to publish data.
Only the P3 roadmap paragraph in README is owned here; unrelated trainer hunks stay unstaged.

```text
native/solver-bridge/src/lib.rs
native/solver-bridge/src/spot.rs
native/solver-bridge/tests/bridge.rs
scripts/hu-play-turn-warmup.ts
src/lib/hu-play/sources/browser.ts
src/lib/hu-play/sources/native.ts
src/lib/hu-play/sources/resolved.ts
src/lib/hu-play/sources/nested-turn.ts
src/lib/hu-play/sources/turn-play.ts
src/lib/hu-play/sources/postflop-play.ts
src/lib/hu-play/sources/heads-up.ts
src/lib/hu-play/sources/turn-cache.ts
src/lib/hu-play/sources/cached-root.ts
src/lib/hu-play/turn-menu.ts
src/lib/hu-play/turn-tree.ts
src/lib/hu-play/turn-translation.ts
src/lib/hu-play/types.ts
src/lib/solver/bridge/contract.ts
src/lib/solver/bridge/live/admission.ts
src/lib/solver/bridge/live/play-profile.ts
src/lib/solver/bridge/live/runtime.ts
src/lib/solver/bridge/live/turn-profile.ts
tasks/heads-up-play-p3-turn.md
tasks/heads-up-play-p2-river.md
tasks/heads-up-play-resolving-spec.md
tasks/cpu-ceiling-roadmap.md
test/bridge-turn-subgame.test.ts
test/helpers/hu-play-turn.ts
test/hu-play-turn-tree.test.ts
test/hu-play-turn-profile.test.ts
test/hu-play-turn-worker.test.ts
test/hu-play-nested-turn-source.test.ts
test/hu-play-turn-translation.test.ts
test/hu-play-turn-play-source.test.ts
test/hu-play-heads-up-source.test.ts
test/hu-play-turn-cache.test.ts
test/hu-play-turn-warmup.test.ts
test/hu-play-cached-root-source.test.ts
```

Additional owned implementation and proof files (explicitly reviewed before staging):

```text
.github/workflows/ci.yml
package.json
scripts/audit-hu-play-p2-playing.ts
scripts/audit-hu-play-p2.ts
scripts/audit-hu-play-p3-hands.ts
scripts/audit-hu-play-p3-playing.ts
scripts/audit-hu-play-p3-turn-grades.ts
scripts/audit-hu-play-p3.ts
scripts/capture-hu-play-p1-successor.ts
scripts/capture-hu-play-p2.ts
scripts/capture-hu-play-p3.ts
scripts/capture-hu-play-turn-cache.ts
scripts/freeze-hu-play-p3.ts
scripts/hu-play-p1-successor.ts
scripts/hu-play-p3-browser-gates.ts
scripts/hu-play-p3-corpus.ts
scripts/hu-play-p3-playing-case.ts
scripts/hu-play-p3-profile-page.ts
scripts/hu-play-p3-selfplay.ts
scripts/profile-hu-play-p3-browser.ts
scripts/refreeze-hu-play-p3.ts
scripts/reproduce-hu-play-p3.ts
src/lib/hu-play/public-state.ts
src/lib/hu-play/river-tree.ts
src/lib/hu-play/subgame-identity.ts
src/lib/solver/bridge/live/turn-quality.ts
src/lib/solver/bridge/turn-referee.ts
tasks/artifacts/hu-play-p1-p3-successor.json
tasks/artifacts/hu-play-p1-p3-successor.json.gz
tasks/artifacts/hu-play-p2-p3-successor.json
tasks/artifacts/hu-play-p2-p3-successor.json.gz
tasks/artifacts/hu-play-p2-p3-successor-summary.json
test/hu-play-p1-successor-version.test.ts
test/hu-play-p2-successor-version.test.ts
test/hu-play-p3-browser-gates.test.ts
test/hu-play-p3-ci.test.ts
test/hu-play-p3-complete-grade.test.ts
test/hu-play-p3-corpus.test.ts
test/hu-play-p3-playing-case.test.ts
test/hu-play-p3-record.test.ts
test/hu-play-p3-refreeze.test.ts
test/hu-play-p3-reproduction.test.ts
test/hu-play-p3-selfplay.test.ts
test/hu-play-public-state-json.test.ts
test/hu-play-subgame-identity.test.ts
test/hu-play-turn-cache-capture.test.ts
test/hu-play-turn-quality.test.ts
tasks/artifacts/hu-play-p3-turn.json
tasks/artifacts/hu-play-p3-turn.json.gz
tasks/artifacts/hu-play-p3-turn-summary.json
README.md
```

The final P3 evidence bundle/summary and only the README milestone hunk are included above.
The separate requested data-reuse note remains saved but outside this milestone's
commit list. No trainer/session/flop-draft file is included in either list.
