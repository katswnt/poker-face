# W2: bounded single-threaded browser Worker

2026-09-29, on top of uncommitted [W1](postflop-solver-w1-st.md), base `8866180`.
This milestone implements the Worker/client and the part of W0 needed to admit small
turn/river jobs. It does **not** expose a public live page, certify phones, add MT, change
the preflop model or resume the paused configurable-flop draft.

## Implementation contract

1. Validate bounded Spot v1 JSON before entering WASM; hash canonical bytes in the Worker.
2. Load same-origin content-addressed ST assets. Check the build manifest hash, engine pin,
   glue/WASM hashes, license text and source build instructions. Hashes detect deployment
   mismatch, not a malicious same-origin server. The hash directory must be immutable and
   its **entire** generated distribution (source/vendor/licenses/Rust notices) must be served
   when W4 deploys it. A binary-only copy is not a valid deployment.
3. Create one Rust session, build game/card tables, return the versioned estimate. Admit
   before allocating **strategy storage**. Preflight itself is not allocation-free.
4. Allocate once, advance the same DCFR session in timed chunks (target 40 ms, 1–32
   iterations), yield a macrotask, report real completed iterations and the iteration at
   which exploitability was last measured. No fabricated percent/ETA. Root previews are
   non-final, have no action EV claims, and are sent at most once per second.
5. Finalize once. Check result identity, range order, strategy shape, final iteration/grade,
   precision/thread count, node/export limits inside the Worker. Yield before publication
   so queued cancellation can win. A failed/cancelled solve never publishes Result v1.
6. Each request has a job ID and a **new Worker**, even estimate-only. Main-thread cancel
   revokes publication immediately; cooperative cancel drops Rust state between calls.
   Kill an unresponsive Worker after a 250 ms grace period. Replacement/disposal terminates
   immediately; stale/duplicate messages cannot update the next job. A separate watchdog
   covers loading, preflight, solving, export and checking. A trap retires the instance;
   do not call back into WASM, even to free it. Timers are not hard real-time guarantees.

Relevant implementation: `native/solver-bridge/src/export_estimate.rs`,
`src/lib/solver/bridge/live/{model,admission,runtime,loader,worker,client,browser}.ts`.
No React dependency in the mathematical engine or Worker runtime. The browser factory is
lazy; Next route bundling/asset-deployment coverage remains part of W4, not inferred from
the esbuild loopback harness. Existing Leduc/river routes are unchanged.

## Admission and sizing

The first production policy deliberately supersedes the older multi-GiB sizing-study helper:

- Turn/river only; explicit weighted ranges with **at most 64 hands per player**.
- **Float32 only**. No silent int16 fallback outside the locked independent-referee tolerance.
- Input ≤256 KiB, depth ≤100, ≤10,000 JSON values before the recursive contract validator.
- ≤10,000 iterations; total request timeout ≤120 seconds.
- Menu trees: stack/pot ≤10; at most two opening sizes and one raise size per player/street;
  raise limit 0 or 1; pot sizes 25–200%, raises 2–4× or all-ins; no automatic added all-in.
  Explicit trees remain supported within the input/complexity/export limits. No input is
  silently resized. These guards also bound the upstream raw tree built **before** raise pruning.
- Export ≤100,000 upper-bound nodes and ≤32 MiB upper-bound JSON. Strategy solving still
  covers future streets when `first-street` export is explicitly requested.
- Budget `B = min(256 MiB, legacy profile budget, reported deviceMemory/4)`; absent device
  data never raises the 256 MiB ceiling. Invalid reported memory lowers it conservatively.
- Admit iff `E32 + X + 128 MiB + observed preflight linear memory ≤ B`, and E32 fits the
  spot's own storage cap. Intentional double-counting leaves room for tables/allocator slack.

The edited abstract betting tree is counted without strategy allocation. Each chance branch
is multiplied by **all unseen board cards**, without discounting blockers, impossible cards
or suit isomorphism. This bounds actual exported nodes N, strategy cells C and edges D.
For H = total private hands, I = input bytes, K = maximum iterations:

```
J = 4096 + 1024N + 32C + 128D + 256H + 8I + 128(floor(K/10) + 2)
X = 8J + 4096N + 64C + 1024H
```

J is a conservative bound for the compact **base Result v1** JSON (no native slice plan).
It includes root arrays/hand names, string escaping and convergence. X is an **engineering
reservation**, not a proven bound on arbitrary JavaScript engine object layout or device
memory pressure. It covers coexistence of Rust export DTO/JSON, Worker strings/parsed
objects and the structured-cloned receiver result. The old `2 × (12C + 200N)` study estimate
missed important copies/root fields and is not used in production.

## Tradeoffs and remaining gates

- Fresh Workers cost startup and repeat preflight on solve after estimate. They reclaim the
  whole WASM high-water allocation and simplify cancellation; no long-lived instance reuse.
- Conservative bounds refuse some games that could fit. Prefer refusal/explicit first-street
  export or offline scripts over reducing precision or changing the game without consent.
- A single synchronous step/build/export can exceed the chunk target. The page remains
  responsive and can hard-kill the Worker; it cannot promise sub-250-ms response on a stalled
  or backgrounded browser. No fallback to main-thread solving.
- Physical iOS/Safari/Android memory/thermal/background-tab behavior remains unmeasured.
  These engineering caps are not an OOM safety certificate; W4 must retain clear refusal,
  retry and saved-example paths. Do not raise caps based on these desktop tests.
- Float32 DCFR returns an approximate strategy for the specified finite game. Native/WASM
  agreement is not independent mathematical verification. Preserve the separate TypeScript
  referees and the locked **0.0002-chip** tolerance; no exact/universal GTO claim.
- Saved hand-written flop ranges remain labelled. PF4 stays gated on a preflop validation
  contract; this browser work supplies no evidence that the diagnosed payoff model is fixed.

## Reproduce

Use W1's pinned Rust 1.98.1 / wasm-bindgen 0.2.104 build instructions, then:

```sh
npm run build:bridge
npm run build:wasm
npm run test:bridge
npm run test:wasm
npm run test:wasm:live
npm run profile:wasm:live
npm run audit:wasm -- --measure
npm run audit:wasm:live -- chromium firefox webkit
```

`profile:wasm:live` is a deterministic 24-case synthetic sizing grid: river/turn × 4/16/64
hands × full/first-street × one-size/no-raise or two-size/one-raise menus. It measures actual
exports only for admitted jobs. Its reused Node instance makes linear-memory observations
**cumulative high-water**, not per-job peaks and not process/JS memory. Native Rust tests
also check count/JSON bounds on small full/first-street flops; live flops remain refused.

The browser audit bundles the actual production Worker entry and client, serves only a
loopback test page/assets, and runs without cross-origin isolation. It checks numerical
fingerprints against direct WASM, stage cancellation, blocked-Worker termination, heartbeats,
estimate-only/refusal, missing/corrupt assets and a successful fresh job afterward. The
deterministic unit suite covers races/traps/timeouts without timing-dependent assertions.

## Verification record

Local checks on macOS arm64 / Node 24.10.0 / pinned Rust 1.98.1:

- **859/859 Node/domain tests, no skips** in an isolated HEAD + W1/W2 copy; 19 new W2
  boundary/lifecycle tests. Its typecheck, ESLint and production build pass.
- **16/16 Rust tests**, native/WASM clippy with warnings denied and format checks pass.
- **21/21 existing Playwright tests** pass against that production build (math/solver
  drills, river lab, Leduc lab; existing keyboard/phone-width checks included).
- Production Worker/client in **Chromium, Firefox and WebKit**: three river/turn/suit
  fixtures at 100 iterations match direct WASM fingerprints exactly, with page heartbeats;
  cancellation during loading/building/solving/exporting/checking, hard-kill of a blocked
  Worker, estimate-only/refused jobs, missing/corrupt assets and fresh-job recovery pass.
  The hard-cancel harness completed in roughly 0.32–0.33 seconds including its intentional
  initial delay and post-cancel observation. This is an observation, not a latency guarantee.
- **20-case native/WASM iteration grid** passes with zero observed numerical differences;
  independent TypeScript grades stay inside the unchanged 0.0002-chip tolerance. The frozen
  pre-W1 native fingerprints (including slices) still match. The native CI job now explicitly
  runs that regression rather than relying on a domain job that can skip absent binaries.
- `audit:bridge:library`, `audit:preflop` and `audit:river:v3` pass. The v3 artifact still
  reproduces value +16.081056725 and exploitability 0.009074631 chips; no saved strategy changed.
- W2's 24-case sizing grid admits **21**, refuses the three wide-menu full-turn exports.
  All admitted compact JSON/counts fit their estimates. Max observed cumulative WASM linear
  memory was **10,289,152 bytes**; this excludes browser/JS memory and is not a device budget.

Selected sizing observations (64 hands per player; byte counts, not rounded MB):

| Game/export | Engine storage | Bounded nodes | JSON bound | Actual compact JSON | Verdict |
|---|---:|---:|---:|---:|---|
| River, small menu, full | 84,124 | 9 | 98,960 | about 11,705 | Admit |
| Turn, small menu, full | 814,540 | 1,305 | 3,952,024 | about 796,180 | Admit |
| Turn, wide menu, full | 6,602,548 | 11,691 | 36,599,192 | Not allocated/exported | Refuse |
| Same wide turn, first-street | 6,602,548 | 27 | 159,256 | about 27,775 | Admit |

Actual JSON byte lengths include variable timing digit lengths. Re-run the script for current
observations; do not treat those byte counts as numerical-reproduction hashes. The wide
full-turn engine needs only about 6.3 MiB, but its conservative total reservation is about
507.6 MiB: checking engine storage alone would have missed the export refusal.

Generated ST artifact (ignored, not deployed): **748,486 bytes**, WASM SHA-256
`d3c96880b60f748c1bbed728e8f339f3548a2ddc8e0cbdfef5bd8fb7140735e5`;
source hash `8e80080fa222b0aa6fd8e2828425a637e15bfb799893dbcf6b4e8cea2e3f5880`;
build hash `b04b2fe6a92ed3530f48aa48d8af41905a65df49c6581701eeec667bacc50a2c`.
Two successive same-layout builds reproduced that build hash; no cross-machine binary
identity claim is made.
The W1 audit's earlier hashes are historical, not this artifact. Hosted CI has not run for
this uncommitted work, and no physical-device/assistive-technology claim is made.

The unrelated seven trainer files retain their previous SHA-256 hashes; the user's original
README hunks are unchanged. Whole-worktree typecheck still reports exactly the nine known
paused-flop errors (missing `policy.ts`, incorrect `FlopV2`/`FlopV2Game` references).
No files staged, committed or pushed in this milestone.

## Ownership / next handoff

W2 adds `native/solver-bridge/src/export_estimate.rs`, all seven `live/*.ts` files above,
`test/bridge-live.test.ts`, `scripts/{audit-bridge-live-browser,bridge-live-harness-page,profile-bridge-live}.ts`,
and this document. It also changes `native/solver-bridge/src/lib.rs`, its `tests/bridge.rs`,
`package.json`, `package-lock.json` (direct pinned esbuild dev dependency for the audit),
`.github/workflows/ci.yml`, the legacy admission helper/test (honest allocation wording),
the WASM spec, roadmap and **only README's browser-roadmap hunk**. W1 files remain owned by
the previous milestone. No generated `target/` assets belong in a commit.

Do not stage the entire README: it still contains the user's unrelated trainer documentation.
Leave the dirty trainer/session files and paused configurable-flop draft untouched. The
draft still prevents a whole-tree typecheck; verify HEAD plus explicit milestone files in
an isolated tree, never conceal the failure with a tsconfig exclusion.

Next: W4 bounded learner UI/asset deployment, with keyboard/mobile/error/cancel/source-link
checks and physical-device validation; then P1–P2 policy-backed play. MT is optional later
work. Do not promote preflop ranges or silently expand the browser limits.

Browser references: [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate)
and [structured-cloned messages](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage).

## Release verification — 2026-09-30

Prerequisite W1 landed as `ebcd248e0532c2ed3219698e12884331acc66cac`. Its exact isolated
commit passed 840/840 unit tests (no skips), 15/15 Rust tests, typecheck, lint, build, native
referee and the 20-case WASM parity grid, all three browser harnesses and 21/21 targeted UI
regressions. **All hosted jobs passed** in [CI run 36753561883](https://github.com/katswnt/poker-face/actions/runs/36753561883)
before this W2 release work began.

W2 was reconstructed on that commit in a detached worktree with copied `node_modules`.
Only the owned Worker/export-estimator files and W2 hunks of shared config/docs are included;
the W4 UI/assets, trainer/session work and paused flop draft are absent from this release.
No application source is excluded to hide the draft's type errors.

The implementation and its unit tests predate this roadmap execution. This release review
added an explicit **fail-then-pass** browser assertion for each blocked synchronous stage:
the old generic busy-Worker harness failed with “blocked Worker must enter building”; the
updated harness enters building, solving or exporting and blocks its event loop. The actual
production client hard-terminates each test double, publishes one cancellation and no result,
and keeps the page heartbeat running. These are controlled failure-injection tests, not a
claim that a real solve was deliberately made to hang. Real-Worker cooperative stage-cancel,
stale messages, timeouts, traps and fresh-job recovery retain their separate coverage.

Rechecked before commit: **859/859 unit tests, no skips; 16/16 Rust tests; 21/21 existing
solver/drill Playwright tests with retries disabled; native/WASM format and clippy;
typecheck, lint and production build**. Native referee, saved-library, preflop and river-v3
audits passed; the existing v3 artifact remains unchanged. The production Worker and W1
parity harnesses pass in Chromium, Firefox and WebKit. Stage-specific hard-cancel total
harness times were **295–299 ms**, including the deliberate 40 ms post-cancel observation;
these are observations, not timer guarantees.

The 20-case native/WASM grid again reports zero numerical deltas and passes the unchanged
0.0002-chip independent referee gate. The 24-case sizing run again admits 21 and refuses
three wide-menu full-turn exports; all admitted exports fit their bounds. Its maximum
cumulative linear-memory observation is 10,289,152 bytes, not browser process/JS peak memory.

Sandbox-only attempts could not spawn the existing RSS sampler or bind the loopback server,
and one build could not fetch the existing Google Font. Reruns with the required local
process/network permissions passed; no gate or code was changed to bypass those restrictions.

The pre-commit isolated artifact is 748,486 bytes, WASM SHA-256
`fefc8ba3c48386686aa86809846b1ec3a59f2423946982b3dede7f2c6ed6b8d8`, source hash
`c5ec5c8a4f3c1f16994b52d382f0406961ebdffd11f8ca24dec282f97585933d`, build hash
`5fc2b782285d52626bef02dad443136aab94afad9271c5fc9955aab31ffc53d8`. Earlier hashes above
are historical. Rebuilding the exact release commit can change the manifest's base commit
and build hash; cross-layout byte identity is not claimed.

The exact commit must receive a fresh isolated full-suite/type/lint/audit/build run before
push, then all hosted CI must be observed green before W3 starts. Record that run ID and
the exact-commit artifact in W3 and the closing handoff. Next is W3 desktop fixture-grid
timing/memory measurement, with physical-device work explicitly open and caps unchanged;
then the already-started W4 learner UI.
