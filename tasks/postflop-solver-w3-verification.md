# W3: hosted verification and desktop browser measurements

2026-09-30. Step 3 of [the CPU-ceiling roadmap](cpu-ceiling-roadmap.md), following W1 and
W2 in order. Single-thread float32 only; no new admission permission or solver algorithm.

## Hosted prerequisites and exact-commit checks

- W1 `ebcd248e0532c2ed3219698e12884331acc66cac`: [all CI jobs green](https://github.com/katswnt/poker-face/actions/runs/36753561883).
  Isolated exact commit: 840/840 unit tests (no skips), 15/15 Rust tests, typecheck, lint,
  build, native referee, 20-case WASM parity grid, three browsers and 21/21 UI regressions.
- W2 `bf44ef2e14808c4ca8158d0fdd7f0a87d57b71d6`: [all CI jobs green](https://github.com/katswnt/poker-face/actions/runs/36757906224)
  **before W3 began**. Isolated exact commit: 859/859 unit tests (no skips), 16/16 Rust tests,
  typecheck, lint, build, native/WASM clippy, native referee, 20-case parity grid, 24-case
  sizing grid, both three-browser harnesses and 21/21 UI regressions with retries disabled.
  Saved library, preflop and river-v3 artifacts reproduce; PF4 remains gated.
- W2's exact-commit artifact: 748,486-byte WASM, SHA-256
  `e071d82c0d9c6242753813819ee99f83871a76c20f124f7d2c906ad64c084dff`; source hash
  `c5ec5c8a4f3c1f16994b52d382f0406961ebdffd11f8ca24dec282f97585933d`; build hash
  `fd885873a4438c880eb941d310c3c1f534e1e12226d72126c469be8fd8c5e4c4`.
  The W1/W2 20-case grid had zero observed native/WASM numerical deltas; maximum independent
  value discrepancy was 0.000012143074496151485 chips. **Tolerance stays 0.0002 chips.**

## Measurement contract

The unchanged W2 sizing grid is now a shared pure helper: river/turn × 4/16/64 hands per
player × full/first-street export × small/wide menu. W2's Node command retains its original
10 iterations. W3 requests 100 iterations and records actual iterations and final grade;
these are runtime observations, **not a convergence-quality certificate** for those games.

Each of the 24 inputs receives one cold browser process and one fresh Worker in each of
Playwright Chromium, Firefox and WebKit. The measurement-only Worker imports the actual W2
runtime and loader; it merely attaches a linear-memory observation to each event. It does
not alter the production protocol, chunk schedule, admission, precision or mathematical
engine. Reading at events after export avoids confusing the last solve-status observation
with export's higher memory use. Full numerical-result fingerprints must agree with direct
WASM for every admitted job. The three wide-menu full-turn exports must still be refused.

- **Wall time:** page request to its terminal event, including Worker startup, loading,
  preflight, solving, export, checking and result delivery. Excludes browser launch and the
  subsequent fingerprint calculation. One observation per case, not a latency distribution.
- **WASM high-water:** linear-memory bytes read at events through result publication. This
  memory grows monotonically within the fresh instance; it excludes JS/browser memory.
- **Sampled browser RSS:** sum of the dedicated browser root/current descendants and new
  same-bundle companion processes from `ps`, targeting a sample every 20 ms after the prior
  sample finishes. Pre-existing non-descendant PIDs are excluded. This includes macOS
  WebKit's XPC services, whose parent is launchd rather than the browser. Baseline is taken
  before requesting the Worker. The report includes sample count, largest poll-start gap
  and the observation window (which also includes page-side fingerprinting). This is not
  precise peak memory, PSS or isolated JS heap: shared pages can be counted more than once,
  brief spikes/reparented processes can be missed, and the sampler/harness adds overhead.
  Avoid concurrently launching another instance of the same Playwright bundle; the
  new-companion attribution assumes this isolated measurement run owns those launches.
- **Reservation is not browser RSS:** the 256 MiB production admission reservation covers
  an engineering estimate of solver work and copies. A browser's baseline alone can exceed
  that figure. Neither the reservation nor this desktop run certifies phone OOM safety.

Hardware read from the machine: Apple M1 Pro, 34,359,738,368 bytes RAM (32 GiB), macOS
26.4.1 (25E253), Node 24.10.0. Physical iOS/Android devices were not provided.

## Measured results

The [checked-in raw record](../src/lib/solver/bridge/artifacts/wasm-w3-m1-pro.json) contains
all 72 observations and the method, engine/source/build hashes and browser versions.
Input-grid SHA-256: `cce1dd88aa221634e55a42bd0a75e0093ceef26a7166227901eb5341e1b71a38`.
Each browser admitted **21/24** cases and refused the same three wide-menu full-turn exports.
All 63 admitted numerical fingerprints match direct WASM; every job owns one terminated
Worker. No precision fallback, input resizing or admission-cap change was used.

Values below summarize **admitted cases only**, one 100-iteration request per input. The
time range is across different inputs, not repeated-trial variance or p50/p95 latency.

| Browser | Request-to-result wall time | Maximum WASM high-water (bytes) | Maximum sampled browser RSS (bytes) |
|---|---:|---:|---:|
| Chromium 151.0.7922.34 | 52.4–1,305.5 ms | 7,929,856 | 330,186,752 |
| Firefox 153.0 | 88–16,145 ms | 7,929,856 | 1,089,961,984 |
| WebKit 26.5 | 37–1,236 ms | 7,929,856 | 423,100,416 |

The slowest case in all three was `w2-turn-64-first-street-wide`. Browser baselines were
275,333,120–276,004,864 bytes (Chromium), 975,208,448–982,450,176 (Firefox), and
335,396,864–336,265,216 (WebKit). All WebKit measurements include three XPC companions.
The largest observed poll-start gaps were about 131.1, 199.5 and 74.1 ms respectively,
despite the 20 ms target; this is why the report says **sampled** peaks. Do not infer device
safety, comparative browser memory efficiency, or future convergence time from these numbers.

## Tests first and reproducibility

Four new tests were written first; their initial run failed because the measurement helpers
did not exist. After implementation they passed:
24 unchanged bounded inputs; rooted RSS summation with unordered descendants and malformed
input rejection; post-export memory rather than stale solve status; and refusal/error
separation. The iteration-bound assertion was tightened to require early validation and
failed before correcting a limit-field typo. Tests contain independent arithmetic for RSS
and the displayed measurement summary.

A first browser run exposed a measurement-coverage error, not a solver error: WebKit's
root/descendant RSS stayed nearly flat while its XPC renderers were reparented to launchd.
A process probe confirmed three same-bundle networking/GPU/WebContent companions. A fifth
test failed before adding explicit new-companion accounting and exclusion of old processes
and similar bundle names. The published grid is rerun with that correction; the earlier
under-counted WebKit RSS is not presented as a full-browser observation.
A sixth record test failed before the generated artifact was installed, then passed. It
recomputes input hashes, coverage/admission counts and cross-browser fingerprints, checks
the separate memory fields, and requires WebKit XPC coverage in this M1 record.

```sh
npm run build:bridge
npm run build:wasm
node --import tsx --test test/bridge-live-profile.test.ts
npm run profile:wasm:live
npm run profile:wasm:browsers -- --output /private/tmp/wasm-browser-observations.json
npm run audit:wasm -- --measure
npm run audit:wasm:live -- chromium firefox webkit
```

`ps`, loopback serving and browser processes require normal local process permissions.
Run performance measurements without simultaneous builds/audits. Inputs and source are
hash-bound; timings and sampled memory are expected to vary, not reproduce byte for byte.

## Open coverage and unchanged limits

- **Open (device):** physical iOS Safari, Android Chrome, actual Safari.app, mobile thermal
  throttling, backgrounding and memory-pressure/OOM behavior. Playwright WebKit is not a
  physical Safari/iPhone test. No devices were available for this autonomous run.
- **Deferred (scope):** MT and cross-origin isolation. W1–W4 ship a useful ST path; they do
  not certify a hypothetical MT build. No int16 certification or live flop admission.
- The 64-hands/player, 256 MiB reservation, 120-second and 10,000-iteration ceilings remain
  unchanged. Do not raise them from desktop evidence. W4 must keep refusal/retry and the
  saved example usable. Hand-written ranges remain approximations; PF4 is still gated.

## Owned files / release gates

`scripts/bridge-live-grid.ts`, `scripts/bridge-live-measurement.ts`,
`scripts/bridge-live-profile-page.ts`, `scripts/bridge-live-profile.worker.ts`,
`scripts/profile-bridge-live-browser.ts`, the small extraction in `scripts/profile-bridge-live.ts`,
`test/bridge-live-profile.test.ts`, W3-only `package.json` and CI hunks,
`src/lib/solver/bridge/artifacts/wasm-w3-m1-pro.json`, this record and W3 spec/roadmap
updates. No trainer/session or paused flop files.

Before push: commit explicit paths only, export that exact commit with copied node_modules,
run the full suite/typecheck/lint/relevant audits, then observe all hosted CI green before
W4. Any fresh generated-build identity is recorded separately from historical observations.

The pre-commit W3-only worktree passes **865/865 unit tests with no skips**, typecheck, lint
and production build. The shared 10-iteration Node grid matches all 24 prior W2 counts,
admission verdicts, engine/export reservations and linear-memory observations exactly
(JSON byte lengths with variable timing digits are excluded). No production app or Rust
source changed. The exact-commit checks and hosted run remain mandatory before W4 starts.
The native referee, 20-case native/WASM parity grid and three-browser W2 lifecycle audit
also pass. Numerical differences remain zero; the independent tolerance is unchanged.
