# P1 production-source integration

Started 2026-09-30 after `70dfdc0` passed exact-commit isolation checks and all eight
jobs in CI [36795159624](https://github.com/katswnt/poker-face/actions/runs/36795159624).
The wider-range study is landed; P1 play is **not yet shipped**.

## Contract and sequence

Keep the roadmap's architecture and all quality gates. The frozen 64-root study demonstrated
that complete ranges fit the proposed reservation on this desktop in three browsers. It did
not test production play, certify phones, or establish full-game safety.

1. Add a versioned `play-v1` Worker request profile. Default W4 behavior stays unchanged.
   Admit only the measured lean turn/river menu, at most 640 hands/player and stack/pot 18,
   float32, first-street export, at most 1,000 iterations and 120 seconds. Require the
   unchanged 0.3%-pot target. Keep 128 MiB fixed overhead plus measured preflight memory;
   cap engine storage at 32 MiB, export working space at 16 MiB and bounded JSON at 2 MiB.
   Desktop reservation ceiling is 256 MiB; mobile/unknown is 192 MiB. Device memory may
   only lower these. A failed quality target is not a playing policy.
2. Recover all flop strategy columns from the 12 original full-precision slice exports in
   a separately versioned, hash-bound play supplement. Existing B4 files/ranges stay fixed.
   Every already-published per-mille strategy column must match. Never fill missing columns
   with an invented policy. Treat unavailable action EVs as unavailable, not zero.
3. Put library, browser and native sources behind asynchronous public-only preparation and
   the existing pure reducer. Maintain exact reaches of the policy actually sampled.
   Neither player's private hand enters solve inputs or cache keys. Cancel/timeout discards
   work and leaves the hand recoverable; no partial policy publication.
4. Re-run the 64 frozen roots on full/browser ranges (100% retained if identical), including
   independent grading against full ranges. Add an independently tested complete turn-export
   referee where necessary; first-street export alone cannot certify the whole turn game.
5. Run 1,000 complete seeded bot-vs-bot hands, conservation, byte-identical replay logs and
   real-source non-interference tests. Independently grade at least 20 production river
   roots at no more than 0.3% pot. Measure Chromium M1 Pro p50/p95 through the real source.
6. Only after every P1 gate passes: update the spec, isolate and verify the exact commit
   with copied dependencies, push, and observe all CI jobs green before P2.

No silent pruning, menu substitution, precision downgrade or missing-board fallback. If a
full-range request does not fit and no measured lawful ladder rung applies, refuse explicitly
and record it as a gate failure. The authorized phone fallback is live rivers plus a measured
turn-only cache if turns do not fit; physical checks come last, not an invented phone pass.

### Production latency budgets (frozen before this measurement)

Chromium on this M1 Pro: p95 public-request-to-prepared-policy **≤2 seconds on rivers and
≤10 seconds on turns**, including Worker startup, verified asset loading, solving, export
and policy validation. These budgets follow the wider-range study, not its failed simple
ratio prediction. The hard per-job ceiling remains 120 seconds with no partial policy;
the 1,000-iteration and 0.3%-pot requirements stay unchanged. They are not phone or Firefox
latency guarantees. Browser/version, fresh-process method and individual results must be
reported. Slow or refused cases may not be removed from the corpus.

## Preserved boundaries

Scripted preflop, hand-written ranges, 12 saved flops, approximate strategies for finite games;
local re-solving is not a global guarantee. PF4 stays gated. AGPL sources remain distributed
with the engine. P0's equal-share pot-origin net is not real preflop profit: the 550-chip pot
contains 50 dead chips from the folded small blind. Keep that accounting explicit.

Do not touch trainer/session work, its README hunks, or the paused configurable-flop draft.
Do not exclude the draft from typechecking. Verify a clean-scope commit instead.

## Ownership (expand explicitly as implementation proceeds)

- This record and P1-only status updates in the roadmap, play spec and closing handoff.
- `src/lib/solver/bridge/live/{admission,model,client,runtime}.ts`, new `play-profile.ts`.
- `test/hu-play-profile.test.ts` and associated Worker boundary tests.
- `test/hu-play-worker.test.ts`; `test/hu-play-library.test.ts`.
- `scripts/build-hu-play-library.ts`, `src/lib/hu-play/sources/library-data.ts`,
  `public/solver-data/hu-play-v1/`, `tasks/artifacts/hu-play-flop-sources.json.gz`.
  These are new supplements, not replacements for any `bridge-v1` data.
- `src/lib/hu-play/{hand,async-hand}.ts`, `test/hu-play-async.test.ts`: expose single
  reducer steps and add public-only preparation without changing the synchronous replay API.
- `src/lib/hu-play/types.ts`, `src/lib/hu-play/sources/{policy,library}.ts`,
  `test/hu-play-sources.test.ts`: complete library policy source and public preparation guards.
- `src/lib/hu-play/sources/resolved.ts`, `test/hu-play-resolve-source.test.ts`: complete-range
  result adapter, quality checks and reconstruction of the actual played reaches.
- `src/lib/hu-play/sources/browser.ts`, `test/hu-play-browser-source.test.ts`: W2-backed
  public solve lifecycle; no native server fallback or private-hand input.
- `src/lib/hu-play/sources/native.ts`, `test/hu-play-native-source.test.ts`: Node-only,
  one-thread native source with estimate-first refusal and independent river checks.
- `src/lib/hu-play/{scripted.ts,sources/play.ts}`, `test/hu-play-scripted.test.ts`: seeded
  full-hand driver, real-source composition and explicit external-dead-blind accounting.
- `scripts/audit-hu-play-p1-hands.ts`: freezes complete-hand seeds 0–999 (alternating AI seat)
  and the first 32 distinct production river roots for independent grading. Smaller runs
  are smoke checks, never a substitute for the 1,000-hand gate. Cache-backed replays must
  request identical public spot hashes and reproduce complete log hashes byte for byte.
- `src/lib/solver/bridge/turn-referee.ts`, `test/bridge-turn-full-referee.test.ts`: independent
  complete-turn grading, cross-checked with the existing turn-v2 referee and quadratic kernels.
- `scripts/hu-play-p1-corpus.ts`, `scripts/measure-hu-play-p1-corpus.ts`,
  `test/hu-play-p1-corpus.test.ts`: preserve all frozen games through production preparation,
  repeat the full/browser-range solve and grade complete turn exports independently.
- `scripts/hu-play-p1-profile-page.ts`, `scripts/profile-hu-play-p1-browser.ts`: actual
  BrowserResolveSource/client/Worker path without the feasibility-study parser shim.
- `scripts/audit-hu-play-p1.ts`, the four `tasks/artifacts/hu-play-p1-production-*.json`
  records, `test/hu-play-p1-record.test.ts`: hash-bound observations, gate recomputation and
  numerical/log-only reproduction comparison (never byte-identical clock/RSS claims).
- `test/hu-play-real-leak.test.ts`, `test/hu-play-fetch.test.ts`: real policy non-interference
  and bounded, hash-checked, abortable loading. `package.json` and `.github/workflows/ci.yml`
  add reproduction and actual native/WASM coverage rather than relying on skipped tests.
- README: only the P1 roadmap, verification, source-tree and play-test hunks.

## Gates

- [x] Failing assertions observed before behavior changes.
- [x] Strict profile and Worker cancellation/refusal/timeout/quality tests.
- [x] Complete, independently checked flop columns without changing B4.
- [x] Public-only asynchronous sources; real-source leak and reach checks.
- [x] Frozen full/browser-range quality comparison, independent full-range grading.
- [x] At least 20 independently graded production river roots at ≤0.3% pot.
- [x] 1,000 complete seeded hands; exact conservation and deterministic replay.
- [x] Measured production Chromium latency, with budgets and phone caveats.
- [ ] Exact-commit full verification, push, all CI green.

## Measurements and failures

Production measurements: M1 Pro, 32 GiB, Darwin 25.4, Node 24.10; source hashes are frozen
inside the hand report. The evidence hashes and recomputed numbers are in
`artifacts/hu-play-p1-production-summary.json`. Research-only three-browser peak observations
remain separately labelled in `heads-up-play-p1-wide-feasibility.md`.

| P1 gate | Measured result |
| --- | --- |
| Complete hands, seeds 0–999 | 1,000/1,000; 1,342 native solves; zero illegal states; exact conservation |
| Cached-result replay | 1,000/1,000 identical complete log hashes and public solve keys |
| First 32 distinct production rivers | Independent exploitability 0.122900–0.297327% pot |
| Frozen original corpus | 32 rivers, then 32 turns; both native runs retain 100% of both ranges |
| Full/browser-range difference | Exported numerical policies identical; every AI per-hand root EV difference 0 chips |
| Independent full-range grade | Median 0.244491558% pot; maximum 0.297718121% pot (unchanged median ≤1% gate) |
| Actual BrowserResolveSource / W2 Worker | 64/64 exact native numerical hashes, one Worker started and retired per job |
| Chromium river latency | p50 71.9 ms, p95 77.6 ms, max 96.5 ms; p95 budget 2,000 ms |
| Chromium turn latency | p50 2,309.4 ms, p95 4,368.1 ms, max 4,519.5 ms; p95 budget 10,000 ms |

Latency is one observation per frozen root in a fresh browser, including preparation and
asset loading. p50 is the middle-pair mean, p95 the nearest rank (31st of 32). The native
audit clocks are not isolated CPU benchmarks: short verification checks also ran on this
machine. No numerical or timing case was discarded. Production status memory excludes
finish/export growth, so that lower bound is **not** substituted for the earlier W2 full
high-water/RSS measurements. All 64 production requests used the stricter unknown-device
192 MiB reservation ceiling; that is not a physical-phone pass.

Flop supplement: 12 content-addressed files, 1,077,088 policy bytes; gzip source 1,604,458
bytes. All 96 flop decisions and every positive-reach column are covered. Existing B4
columns reproduce exactly; B4 files are unchanged. The captured original full-precision
slice evidence is checked in so regeneration does not require an untracked native cache.

### What the ladder measurement means

The first rung now fits the frozen full-range corpus; both required native solves therefore
use identical ranges. There is **no enabled pruning threshold**, removed-hand policy, bet-menu
reduction or measured fallback gain to invent. Provenance says `full`, zero pruned mass and
float32-renormalized policy (or `library`, per-mille on the flop). The source can inspect
available later B4 nodes but does not silently substitute one for a failed full solve. A job
that fails admission, cancellation, timeout or quality leaves a recoverable pending decision.
P2 must measure any new off-tree/fallback behavior before enabling it.

The full-turn referee reads a separate complete export, verifies public chips and all river
outcomes, and computes per-hand values/best responses with hidden cards integrated **before**
maximizing. Its first-street projection must exactly match the playing export. Called turn
all-ins have implicit river enumeration (44 unseen cards per private pair), not omitted
betting. The independent turn-v2 engine and quadratic terminal oracle agree within 1e-10
chips on the small regression. Full 1,128-combo blocker/rank checks also preserve tiny
compatible reach next to large blocked weights. Whole turn grades hold arriving ranges fixed;
they do not certify the composed strategy after the next street is re-solved.

Saved action EVs are explicitly labelled original-policy values; live first-street results do
not export action EVs. P5 must not invent those values or treat them as zero. The scripted
formation's 50 dead small-blind chips are accounted separately from both players' initial
10,000-chip stacks and P0's equal-share utility origin. No trainer/session module is imported.

### Reproduce

```sh
npm run audit:hu-play:library
npm run audit:hu-play:p1
node --import tsx scripts/audit-hu-play-p1-hands.ts --hands 1000 --out NEW_HAND_DIRECTORY
node --import tsx scripts/audit-hu-play-p1.ts --compare-hands NEW_HAND_DIRECTORY
node --import tsx scripts/measure-hu-play-p1-corpus.ts --out NEW_CORPUS_DIRECTORY
node --import tsx scripts/audit-hu-play-p1.ts --compare-corpus NEW_CORPUS_DIRECTORY
node --import tsx scripts/profile-hu-play-p1-browser.ts --native NEW_CORPUS_DIRECTORY --out NEW_BROWSER_DIRECTORY
```

Build the pinned native/WASM bridge first for native/Worker checks. Directory arguments must
not exist: observations are never overwritten. `--compare-*` checks all numerical outputs
and logs against the frozen record, excluding only timestamps, RSS and duration fields.
Physical iOS/Android checks are still the last-step checklist in the wider-range record.
Next after this milestone is isolated, committed and green in CI: P2 off-tree river bets.

The first four play-profile assertions failed against the original parser/admission, then
passed with the strict separate profile. Worker tests first exposed the omitted profile at
both boundaries, then (after wiring) independently exposed publication of a one-iteration,
target-missed result. That result is now refused before export. The 25 relevant profile,
runtime and lifecycle tests pass, including actual WASM full-range solving and cancellation.
The complete-turn test initially rejected native called-turn-all-in terminals. The bridge
format intentionally represents their remaining card implicitly; explicitly enumerating
that runout made both independent graders agree, without changing Rust, CFR or a tolerance.
Corpus and report tests also failed before their implementation and now check reproduction.

## Release verification

In progress. No P2 implementation has begun; exact-commit isolation, push and hosted CI
must complete first. The root worktree retains the paused draft's original nine tsc errors;
none are excluded or repaired. Only an isolated owned-file commit is the release gate.

The staged candidate was exported to `/private/tmp/poker-p1-candidate.DAPibN` with copied
(not symlinked) dependencies: **943/943 tests, zero skips**, Next route type generation plus
tsc, lint, flop-supplement reproduction and P1 gate recomputation all passed. Trainer/session
hashes are unchanged; reversing just the four README replacements reproduces its pre-edit
backup exactly. Next is the separate exact-commit verification, not a claim it already passed.
