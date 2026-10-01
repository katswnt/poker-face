# P2: off-tree river decisions

Started after P1 `ea47f6e` passed isolated verification and all eight hosted CI jobs in
run `36804916249`. P2 is not shipped. The binding gates remain roadmap step 6 and play
spec §2.4 / §2.7. No change to ranges, game, quality tolerance or phone claims.

## Implementation contract

1. Re-solve at the human's decision **before** their new legal bet/raise. Preserve every
   positive arriving hand; use the lean menu plus that exact integer chip amount at this
   node only. Never treat the old policy's undefined posterior as a range.
2. Represent prior river actions as a forced public prefix, with probability one and no
   additional reach multiplication: input ranges are already conditioned on that prefix.
   Ordinary bridge explicit trees require check / fold / call alternatives and cannot
   represent forced bets. Add a narrowly versioned `river-subgame-v1` tree mode rather than
   silently relaxing ordinary explicit-tree validation. It must preserve actual committed
   chips, whose payoff offset is constant per player. No chance or private information enters
   the prefix. Compare this embedding to exact independent small games, including facing a
   raise and all-in branches, before enabling it in play.
3. Add a bounded river-only Worker profile for this mode. Same full-range capacity, float32,
   target, iteration/watchdog and conservative memory reservation as P1; explicit public-node
   bounds before native construction. W4 and P1's existing profiles remain unchanged.
4. Public-only asynchronous off-tree preparation: solve, validate, then use the new human
   action probabilities for the posterior and the AI policy below the actual action.
   Cancellation/quality/admission failure must publish no partial strategy. A zero-support
   posterior requires a labelled fallback, never an invented likelihood.
5. Implement measured translation fallback with real-chip settlement and explicit reason,
   mapped action, probability and source identity. Do not silently prune or substitute a
   different game. Previous policy and any translated continuation must cover every live
   hand; unsupported continuation is an explicit refusal and a corpus gate failure.
   **Concrete river fallback:** choose pseudo-harmonic neighbours among previous-policy
   non-fold actions with positive compatible support. Check (opening bet) or call (raise)
   is zero incremental size; normalize raises by the pot after calling. Record any excluded
   zero-support references, the draw and the mapping. Multiply the human prior by that
   previous action's likelihood, then solve the smaller AI response at the **actual** chip
   state. This is labelled "translated range, re-solved response", not direct nested solving
   or raw mapped-policy play. It handles a translated check/call that would have ended the
   virtual river without pretending the real bet vanished. Same quality and resource gates;
   no supported non-fold model or a failed response solve is a refusal, not an invented range.
6. Freeze at least 200 seeded non-menu river cases (tiny, huge, all-in, both seats, check/bet/
   raise parents) before measuring. Record completion/fallback, latency, reservation and
   quality per case. Independently report AI value versus nearest-menu translation, local
   exploitability and every human hand's BR change at the parent. Positive safety margins
   are reported, not suppressed: unsafe local re-solving has no global guarantee.
7. Keep P1's historical records immutable. If its source hashes change, retain verifiable
   historical source evidence and add a versioned successor reproduction record, including
   fresh numerical/log comparisons; never bypass the freeze by deleting checks or allowing
   arbitrary hashes. Re-run original P1 gates and native/WASM parity after bridge changes.

## Gates (tests first)

- [x] Versioned forced-prefix contract, native/WASM parity and independent payoff/BR checks.
- [x] Lean explicit-menu parity; actual action added at exactly one parent.
- [x] Public-only preparation/posterior/replay; stale, cancelled and target-missed rejection.
- [x] Bounded Worker admission and measured translation fallback.
- [x] Frozen ≥200-case audit, all complete within budget or labelled fallback.
- [x] Per-case local grades, AI value difference and per-hand human safety margins.
- [ ] P1 successor regression evidence, complete isolated exact-commit gates, push, all CI green.

## Ownership

This record and P1 release-status annotations; new P2 tests/modules/audits and explicit
bridge/profile extensions as listed here before staging. Trainer/session files, their README
hunks, B4/P1 artifacts and the paused configurable-flop draft remain untouched.

Explicit milestone paths (README: only the P2 roadmap paragraph and source-tree label):

```text
.github/workflows/ci.yml
package.json
README.md
native/solver-bridge/src/lib.rs
native/solver-bridge/src/spot.rs
native/solver-bridge/tests/bridge.rs
scripts/audit-hu-play-p1.ts
scripts/audit-hu-play-p2-playing.ts
scripts/audit-hu-play-p2-safety.ts
scripts/audit-hu-play-p2.ts
scripts/capture-hu-play-p1-successor.ts
scripts/capture-hu-play-p2.ts
scripts/hu-play-p1-successor.ts
scripts/hu-play-p2-browser-gates.ts
scripts/hu-play-p2-corpus.ts
scripts/hu-play-p2-playing-case.ts
scripts/hu-play-p2-profile-page.ts
scripts/hu-play-p2-safety.ts
scripts/measure-hu-play-p2-native.ts
scripts/profile-hu-play-p2-browser.ts
src/lib/hu-play/play-hand.ts
src/lib/hu-play/river-menu.ts
src/lib/hu-play/river-translation.ts
src/lib/hu-play/river-tree.ts
src/lib/hu-play/types.ts
src/lib/hu-play/sources/browser.ts
src/lib/hu-play/sources/native.ts
src/lib/hu-play/sources/resolved.ts
src/lib/hu-play/sources/nested-river.ts
src/lib/hu-play/sources/river-play.ts
src/lib/solver/bridge/contract.ts
src/lib/solver/bridge/river-hand-values.ts
src/lib/solver/bridge/live/admission.ts
src/lib/solver/bridge/live/play-profile.ts
src/lib/solver/bridge/live/river-profile.ts
src/lib/solver/bridge/live/river-quality.ts
src/lib/solver/bridge/live/runtime.ts
tasks/cpu-ceiling-roadmap.md
tasks/heads-up-play-p1-integration.md
tasks/heads-up-play-p2-river.md
tasks/heads-up-play-resolving-spec.md
tasks/artifacts/hu-play-p1-p2-successor.json
tasks/artifacts/hu-play-p1-p2-successor.json.gz
tasks/artifacts/hu-play-p2-river-summary.json
tasks/artifacts/hu-play-p2-river.json
tasks/artifacts/hu-play-p2-river.json.gz
test/bridge-river-hand-values.test.ts
test/bridge-river-subgame.test.ts
test/hu-play-nested-source.test.ts
test/hu-play-p1-successor.test.ts
test/hu-play-p2-browser-gates.test.ts
test/hu-play-p2-corpus.test.ts
test/hu-play-p2-record.test.ts
test/hu-play-p2-safety.test.ts
test/hu-play-play-hand.test.ts
test/hu-play-river-play-source.test.ts
test/hu-play-river-profile.test.ts
test/hu-play-river-quality.test.ts
test/hu-play-river-runners.test.ts
test/hu-play-river-translation.test.ts
test/hu-play-river-tree.test.ts
test/hu-play-river-worker.test.ts
```

## Open measurements

The first native engine experiment is `/private/tmp/poker-p2-native-01` (not yet a release
artifact). All 200 inputs were written before the first off-tree estimate/solve; input hash
`4f2a1442b882460371645954ce69ae700324d7427a3271d013d505a156f6325c`, report hash
`f725f2fc1530936d2b13d28fad47021e6256f70b852212f45315bf84a61b34d1`.
The 32 baseline river numerical hashes reproduce P1 exactly after the bridge extension.
Selection: root `seed % 32`, parent family `floor(seed / 32) % 4`, size family `seed % 5`;
no off-tree outcome or timing influences selection. No preferred parent needed substitution.

| Engine-feasibility measurement (M1 Pro, one native thread) | Result |
| --- | --- |
| Distinct frozen games | 200/200 solved, 0 target misses/errors |
| Actual size categories | 40 minimum, 42 all-in, 40 near-all-in, 78 interior |
| AI seats / forced-prefix lengths | 104/96 seats; 64 roots, 104 one-action, 32 two-action prefixes |
| Independent local exploitability maximum | 0.29998075664942775% of the **street-root** pot (stricter than parent-pot scaling) |
| Maximum iterations | 190 (unchanged cap 1,000) |
| Native solve p50/p95/max | 14.115 / 26.757 / 35.078 ms |
| Maximum engine / export-working estimate | 259,368 / 10,034,560 bytes |
| Largest public tree / input | 27 nodes / 43,391 bytes |

This is **not** the production P2 gate: no Worker, fallback, complete-hand replay or safety
comparison was measured by this experiment. Native preflight uses zero for unavailable WASM
high-water memory, not a browser certificate. Physical-device checks stay last and open.
The independent per-hand grader matches the existing factorized grader, quadratic kernels,
native per-hand values within the locked tolerance and an analytic hidden-card-cheating test.
Four root/check/bet/raise embeddings have exact native/WASM numerical parity. Ordinary
fixture hashes remain unchanged; all 18 Rust tests pass. Root tsc still has only the nine
protected draft errors; no exclusions or draft changes were made.

Post-solve support inspection found **12/200** expanded-parent policies assign the actual
human action zero probability for every hand (seeds 2, 29, 64, 78, 83, 98, 118, 124, 126,
151, 176, 192). These are mathematically undefined posteriors and **not** direct playing-policy
successes. The concrete fallback above must be measured before P2 can pass. All 200 old
parents have at least one positive-weight non-fold reference; compatible support is checked
again by the fallback, without either private hand. No evidence files were overwritten.

At this stage P1's source-freeze audit correctly refused the edited adapters/profiles. Its
gates were not disabled: the complete successor reproduction described below now supplies
the required historical-source and numerical evidence.

### First production attempt and repairs (2026-10-01)

`/private/tmp/poker-p2-playing-01` retained all 200 cases: **197 completed, 3 failed**
(118, 124, 126). The input corpus is unchanged. Assertion-first regression tests reproduced
all three failures. A forced all-in raise was incorrectly exported as a bet because the
exporter inferred "facing a bet" from a fold alternative; forced prefixes deliberately have
no such alternative. It now uses the actual committed chips. This changes no engine action
or strategy. A separate small Rust test failed before this fix.

The other two raw float32 grades were -0.0000152587890625 and -0.00006103515625 chips.
They are preserved, not clamped or advertised as mathematical exploitability. P2 now grades
**every** exported strategy independently before publishing it (also in the production
Worker), and requires both the raw score and the independent score ≤ the unchanged target,
with absolute cross-grader difference ≤ the locked 0.0002 chips. The independent score is the
playing provenance's displayed grade; raw engine score and comparison tolerance accompany it.
This is an extra strategy check, not a higher tolerance or a guarantee for all larger games.
P1's existing result contract is unchanged. A malformed returned result cannot trigger a
translation that hides the error; only unavailable solves and defined zero-support failures
may use the documented fallback. The three regression cases now complete. Full-corpus and
browser reruns remain necessary before claiming this repair meets the release gates.

### Prospective safety comparison contract

Freeze this definition before generating the safety table. Grade the **composed policy that
would be played**, not the expanded solver's discarded AI policies on other human actions:
keep the previous AI policy on every old branch, and insert the actual response only below
the added action. Use the expanded solve's human policy for both profile-value comparisons;
human best responses ignore that policy and maximize separately per hand after summing over
hidden AI hands. Preserve every positive parent-range hand, even when the chosen response
model gives it zero posterior probability. All values use the same original street-root chip
origin and the parent's blocker-compatible deal measure.

For the required nearest-menu comparator, choose the nearest positive-compatible-support
non-fold old action by incremental size / pot-after-call (ties choose smaller). This comparator
uses the **old response policy, not another response solve**. Translate its sized AI actions
to the closest legal lean response size by the same pot-relative convention; fold stays fold,
check/call becomes call against the real wager, and a virtual terminal check-back/call uses
explicit "call-through". If no sized response is legal, map a virtual sized action to call.
Record this endpoint convention and the mapped action; it is a defined translation baseline,
not a claim that a terminal blueprint supplied an AI policy. These lean river cases contain
only one AI decision below the actual sized human action; assert that invariant.

Report per case: each raw solve's independently checked local exploitability; composed AI
profile EV and its difference from nearest translation; both profiles' local exploitability;
every human hand's BR difference versus the old parent blueprint and versus the complete
translated comparator in the expanded action space. Report maxima and positive counts, with
null only for hands with no compatible opponent. Also report conditional actual-branch values
so a zero-probability actual action in the expanded human policy cannot hide the comparison.
Old-branch blueprint comparison changes the human action space; the translated comparison
does not. Neither is a whole-game safety guarantee. Derived profiles have no invented native
solve status/hash/EVs; the independent grader accepts a separate tree-and-hands contract.

## Production measurements (2026-10-01; release verification still open)

The repaired source/reducer path completed **200/200**, with 188 direct nested responses and
12 explicitly labelled translated-range/actual-price response solves. All 212 solves passed
independent grading; maximum 0.29998075664942775% of the original street-root pot. Maximum
raw/independent grade difference was 0.00019627591063908756 chips, below the unchanged
0.0002-chip bound. Both native runs replayed every case identically. The production Chromium
Worker run matched all native strategy and completed-log hashes exactly, with all 212 Workers
terminated and no cross-origin isolation. No private hand enters preparation; changing the
human's cards in direct and fallback cases preserves all public solve keys and AI decisions.

| Actual browser measurement, fresh browser per case | p50 | p95 | Maximum |
| --- | --- | --- | --- |
| Chromium, unmodified production Worker (200) | 111.4 ms | 153.2 ms | 193.4 ms |
| Chromium, W2 memory observer (200) | 110.25 ms | 155.7 ms | 251.4 ms |
| Firefox, W2 memory observer (200) | 205 ms | 416 ms | 702 ms |
| WebKit, W2 memory observer (200) | 110.5 ms | 152 ms | 195 ms |

Every row includes off-tree preparation, real reducer continuation and independent grading;
browser launch, cached baseline preparation and final hash computation are excluded. All
600 memory-observer cases retain exact native parity and Worker cleanup. Peak observed WASM
linear memory through final export was **2,162,688 bytes** in each browser; this does not
measure total JS heap, process RSS or physical-phone safety. The 192 MiB unknown-device
reservation and 2-second Chromium p95 gate are unchanged. Part of the observer run overlapped
native P1 regression work; these are measured observations, not idle-device promises.

### Safety result: local quality does not protect the composed policy

All **66,641** positive parent-range human-hand entries are retained in the table (only an
entry with no compatible opponent may have a null value). Relative to the old parent blueprint,
9,220 hand entries in 169 cases gain more than 0.0002 chips; the maximum is 6,953.7613 chips.
That comparison adds a human action. Relative to the **complete nearest-translation comparator
in the same expanded action space**, 5,203 hand entries in 134 cases gain more than 0.0002
chips; maximum 2,963.3789 chips. These positive safety margins are material, not rounding noise.

With the same expanded human strategy held fixed, the actual AI's profile-value difference
versus nearest translation ranges from -1.3057 to +183.6919 chips (mean +11.3605). Forcing the
actual action while retaining the **parent prior**, not inventing a zero-support posterior,
gives differences from -5,911.4492 to +2,584.2980 chips. The composed profile's maximum local
exploitability is **23.3991% of the street-root pot**, despite every individual solve passing
0.3%. There are 53 explicitly recorded terminal-call-through comparator cases. Do not display
the solve's small grade as a certificate for this composed policy or full-hand play. This
milestone measures the roadmap's unsafe re-solving design; it does not implement the gadget
in the Rust/browser engine or improve the P4 safety guarantee.

### Reproduction and retained evidence

- `npm run audit:hu-play:p2` verifies the compressed, hashed full-policy archive, regenerates
  all 200 frozen inputs, replays the actual public adapters/reducer, independently recomputes
  all solve and per-hand safety grades, and rechecks the native/browser/memory observations.
  It needs no binary or network. The approximately 26 MB archive preserves every positive
  hand and full strategy rather than a success-only summary.
- Frozen input: `/private/tmp/poker-p2-native-01`.
- Repaired native reports: `/private/tmp/poker-p2-playing-02` and `-03` (same numerical/log
  identities; the latter binds the final type annotations).
- Production browser: `/private/tmp/poker-p2-browser-01`; memory: `/private/tmp/poker-p2-memory-01`.
- Safety: `/private/tmp/poker-p2-safety-04` binds the unchanged prospective section above and
  the latest native report. Attempt `-01` exposed probability-normalization before merging
  translated actions; a seed-1 test failed first, then passed after matching the real policy's
  normalized columns. No grader tolerance was increased.
- The original 197/200 attempt, pilot and earlier reports remain in their scratch directories.

The native crate currently passes 19 tests. Root type-checking still reports only the nine
pre-existing protected flop-draft errors; no exclusions were added. P1's fresh 64-root complete
numerical comparison is identical, and fresh production Chromium p95 is 86.6 ms river /
4,436.5 ms turn. Its fresh 1,000-hand run completed with 1,342 solves and 32 independent river
grades, reproducing every original numerical identity and hand-log hash. The versioned P1
successor bundle preserves the original 18 source files and binds 98 current dependency
files, including Rust toolchain pins. Corrupted archives, missing source files, changed pins
and substituted hand logs are rejected; original P1 artifacts remain byte-for-byte unchanged.

## Release verification

Candidate `/private/tmp/poker-p2-candidate.5IebfY` contains only the owned paths above and
copied (not symlinked) dependencies. The first full pass has **973/973 tests, zero skips**,
typecheck, lint, native/WASM parity and both P1/P2 artifact audits passing. The final
source-inventory refinement also passes its archive/replay tests. Saved-only production
build and full e2e pass (82 passed; four intentionally asset-required skips). Three-browser
Worker lifecycle checks pass, including hard termination during build/solve/export and a
fresh solve after cancellation. The prepared production build and three-browser UI suite pass:
34 passes, two intentional non-Chromium zoom-API skips, zero retries. This includes keyboard,
320/390/1280px reflow, real Chromium 200% zoom, refusal, cancel/retry and asset failure.
Exact-commit release checks follow; no push or hosted CI success is claimed until they complete.

The checked-in P2 bundle is 26,058,273 compressed bytes, SHA-256
`41a3572438b6a06be5fac57cd3cf13b58b84cec5bb732000033662553df5ff74`.
P1 successor evidence hash:
`0a174e18499c4d52cc3fde9c9b076cfe9ceaaa98d1efc17fcbfa4307092a5305`.
Native/WASM numerical reproduction is exact; binary bytes across separate build paths are
not claimed identical. Physical-phone checks stay open and do not block this release.

Verification commands (run in isolation; no protected files imported):

```sh
npm run build:bridge
WASM_BINDGEN=/private/tmp/poker-w1-tools/bin/wasm-bindgen npm run build:wasm
npm test
npm run typecheck
npm run lint
npm run test:bridge
cargo +1.98.1 fmt --check --manifest-path native/solver-bridge/Cargo.toml
cargo +1.98.1 clippy --release --locked --manifest-path native/solver-bridge/Cargo.toml --all-targets -- -D warnings
cargo +1.98.1 clippy --release --locked --manifest-path native/solver-bridge-wasm/Cargo.toml --target wasm32-unknown-unknown -- -D warnings
npm run audit:bridge
npm run audit:wasm
npm run audit:hu-play:p1
npm run audit:hu-play:p2
npm run audit:bridge:library
npm run audit:hu-play:library
npm run audit:hu-play:wide
npm run audit:hu-play:gadget
npm run audit:preflop
npm run audit:river:v3
npm run audit:river:factorized
npm run audit:wasm:example
npm run audit:wasm:live -- chromium firefox webkit
npm run build
POKER_FACE_LIVE_SAVED_ONLY=1 npm run test:e2e -- --retries=0
npm run prepare:wasm:live
POKER_FACE_LIVE_REQUIRED=1 npm run build
POKER_FACE_LIVE_REQUIRED=1 npx playwright test --config playwright.live.config.ts --retries=0
```
