# B5: WASM live solving in the browser (spec draft, 2026-09-25)

Follows `tasks/postflop-solver-bridge-plan.md` ("After this plan: B5") and
`tasks/postflop-solver-bridge-spec.md` (contract v1, B2 tolerance).

**2026-09-29 update:** the [W1 ST implementation and audit](postflop-solver-w1-st.md)
supersede the draft's build assumptions below: stable Rust, a single-threaded build, shared
resumable session and UI-less parity Workers are implemented. No live page or MT deployment
has shipped. [W2's bounded ST runtime and audit](postflop-solver-w2-worker.md) now supersede
the draft admission/cancellation policy below: float32 only, 256 MiB total reservation,
64 hands/player, turn/river only, export-aware refusal, fresh Worker for every job.
Physical-device budgets remain unvalidated. The older large-game sizing table below is a
research proposal, **not production permission to allocate those amounts**.

**2026-09-30 update:** [W4](postflop-solver-w4-ui.md) implements the local `/solver/live`
page and explicit preparation of full hashed assets/source. Public release and physical
device validation are still open; no MT or live-flop scope was added.
The W4 release record includes saved-only/prepared production builds, real Chromium 200%
browser zoom, three-engine keyboard/responsive checks and full-load links from all solver labs.

## Goals

1. The same postflop-solver commit, behind the same **Spot v1 in, Result v1 out** contract,
   runs in a Web Worker. No browser-only format.
2. A **size-based admission rule**: an oversized spot is refused before strategy allocation, with the
   estimate and budget shown.
3. Threads when cross-origin isolated, a **single-thread (ST) build** otherwise, with the same
   answers from both.
4. Progress, cancellation and a root-strategy preview. No partial Result v1 is ever published.
5. Checked against the native bridge and the B2 referee (locked τ = 2e-4 chips) in CI.
6. AGPL met: the page links to the exact source it was built from.

## Non-goals

- Griffin-scale SRP flops in the browser. Our benchmark needs 32.8 GB float32 / 16.6 GB int16
  (B1), which is over even Chrome's Memory64 cap (16 GB). The B4 library covers those spots.
- Memory64 (`wasm64`): no Safari or iOS support (caniuse, 2026-09), the Rust target is tier 3,
  and it would not admit the benchmark anyway.
- The TypeScript referee running on every live solve, new UI design, and Result v1 changes.

## How upstream does it (b-inary/wasm-postflop v0.2.7, AGPL-3.0)

- Two builds of one source: `solver-mt` and `solver-st`, both `rustup run nightly wasm-pack
  build --target web` with `wasm-opt -O4`, LTO and `codegen-units = 1`. The MT
  `.cargo/config.toml` sets `+atomics,+bulk-memory,+mutable-globals,+simd128`,
  `--max-memory=4294967296` and `build-std = ["panic_abort","std"]`. ST sets only the 4 GiB
  max.
- postflop-solver runs with `default-features = false` (no bincode, like ours), `custom-alloc`
  (a stack allocator; upstream says the default allocator is slow in multithreaded WASM; it
  needs nightly `allocator_api`), and `rayon` in MT only.
- Threads come from a vendored copy of **wasm-bindgen-rayon**: `initThreadPool(n)` spawns n
  module workers that share the `WebAssembly.Memory`, and each engine call runs inside
  `THREAD_POOL.install`. A Comlink worker calls `solve_step(i)` once per iteration, then
  `exploitability()`, then `finalize()`.
- It chooses MT or ST by **UA sniffing** (Safari/iOS always get ST with 1 thread). Memory is
  limited to 3.9 GB of `memory_usage()` ("4GB Wasm limit − 0.1GB margin"). It is served with
  `COOP: same-origin` and `COEP: require-corp`.
- Its benchmark (a Pio "3betpotFAST" flop, Chrome 108, Ryzen 3700X) used 1.25 GB float32 /
  660 MB int16 and ran about 2× slower than native (16 threads, 0.3 % pot: 26 s vs 15.6 s).

## Architecture

```
page (/solver/live, COOP+COEP) ──postMessage──► live-solver.worker.ts (module worker)
   │  crossOriginIsolated?                        ├─ loads /wasm/<build-hash>/{mt|st}/solver_bridge_wasm.js
   │                                              ├─ MT: initThreadPool(min(hwConcurrency, 8)) → nested rayon workers
   │                                              └─ LiveSession (wasm-bindgen class, one per worker)
   └─ worker.terminate() = hard cancel / frees all linear memory
```

**Rust crate split (shared code, no fork).**
- `native/solver-bridge` gains features: `native` (default; `libc::getrusage`, global rayon
  pool), `threads` (every `rayon::` use), and `wasm`. `wasm` replaces `std::time::Instant`,
  which **panics on wasm32-unknown-unknown**, with `web-time`. W1 reports WASM linear memory
  separately as `core::arch::wasm32::memory_size(0) × 65536`, never as process RSS.
  Result v1's `peakRssBytes: 0` means unavailable on WASM. Linear memory excludes JS/browser overhead.
- The solve loop becomes a resumable `Session`: `new(spot_bytes)`, `estimate()`,
  `allocate(compress)`, `step(n)`, `root_strategy()` and `finish()` (finalize, export, Result
  v1 JSON). `root_strategy()` works because `game.strategy()` runs before finalize; EVs need
  `State::Solved`. Native `solve_spot_with_slices` loops over the same `Session`, and
  `audit:bridge` must still reproduce B2 bit for bit.
- New crate `native/solver-bridge-wasm`: a cdylib using wasm-bindgen, depending on
  `solver-bridge` with `default-features = false, features = ["wasm"]`; MT adds `threads` and
  the wasm-bindgen-rayon crate (`no-bundler`). It has its own Cargo.lock and pins a nightly
  (wasm-bindgen-rayon is tested on `nightly-2025-11-15`). A test asserts that the
  postflop-solver `rev` is the same in both Cargo.toml files and in `POSTFLOP_SOLVER_COMMIT`.
  Turn on `custom-alloc` only if W2 shows the default allocator is slow in MT.
- With `panic=abort`, an engine panic or `handle_alloc_error` **traps and kills the instance**.
  The worker reports `error`, the page terminates it, and the instance is never reused.

**Loading (Next 16 / Turbopack).** Our worker keeps the existing `new Worker(new URL(...,
import.meta.url))` pattern. The wasm-pack `--target web` output is not bundled. It is copied to
`public/wasm/<content-hash>/` and loaded with `import(/* turbopackIgnore: true */ url)`, so
Turbopack never rewrites wasm-bindgen-rayon's nested `workerHelpers.js` worker. It is served
with `Cache-Control: immutable`.

**Cross-origin isolation.** Use `next.config.ts` `headers()`. The Next 16.3.3 docs show the
same `source`/`headers` API; these rules run before the filesystem (including `/public`) and in
`next dev`, so no `vercel.json` is needed.
- Values: `COOP: same-origin` and `COEP: require-corp`. Not `credentialless`, which Safari
  lacks. All subresources are same-origin (`next/font/google` self-hosts).
- Scope: `/solver/live`, `/_next/static/:path*` and `/wasm/:path*`, because worker scripts need
  a compatible COEP on their own responses (W1 verifies in Chrome, Firefox and Safari).
- **Soft navigation does not isolate**: `crossOriginIsolated` is fixed at document load, so
  entry links must be plain `<a>`. If the page is not isolated, the worker falls back to ST and
  never reloads.
- Costs: COOP severs `window.opener`. Future cross-origin embeds need CORP/CORS. The **Vercel
  Toolbar iframe fails under COEP** (vercel/vercel#16040).
- Choose MT by **feature detection** (`crossOriginIsolated && typeof SharedArrayBuffer ===
  "function"` and the MT module instantiates), not UA sniffing. Safari has SharedArrayBuffer
  since 15.2 but defaults to ST until W3 proves MT there.

**Worker protocol** (mirrors `src/lib/solver/river/lab/runtime.ts`: injected `now`/`yield`, id-
tagged commands, `cancelled` event). Commands: `estimate`, `solve`, `cancel`. Events:
`estimate` (bytes, compressed bytes, export estimate, budget, verdict), `progress` (stage,
iteration, exploitability, target, linear-memory bytes), `preview` (root strategy, sent at
most once per second), `result` (Result v1 object parsed/checked inside the Worker before
publication), `cancelled`, `error`. W2 adds source provenance and measured-at iteration.

**Cancellation (W2 ST).** JS drives `session.step(k)` in chunks targeting 40 ms (k adapted to the
measured time per iteration) and `await`s a macrotask between them, so `cancel` gets through.
The page terminates the worker on unmount, on a new spot, or when a cancel goes unacknowledged
for 250 ms. One synchronous call may exceed the target; cancellation on the main thread
immediately revokes publication. **Every estimate/solve gets a fresh Worker**, including
small jobs. The overall watchdog includes asset loading, preflight, grading and export.

**Spot hash** is computed by `crypto.subtle` SHA-256 in JS and by the WASM, and must equal
`result.spotHash`. In the browser, `memory.peakRssBytes: 0` means unavailable. Status reports
WASM linear memory separately (not JS heap/RSS). `engine.threads` is 1 for ST. Result v1
is unchanged. Never describe linear memory as process RSS.

## Original large-game sizing proposal (not the W2 production policy)

Use [W2 admission](postflop-solver-w2-worker.md) for production. The pure legacy
`wasm-admission.ts` rule/table remains an offline sizing study; compressed fallback and
multi-GiB budgets below are not enabled by the Worker.

Let `E` = `memory_usage()` for the chosen precision (float32 first; int16 only if float32 does
not fit, flagged "outside τ" because B2 measured int16 root-EV error up to 8.7e-4 chips). Let
`X` = export bytes. The Rust export structs and the serialized JSON coexist in linear memory,
so `X ≈ 2 × JSON bytes`. JSON is estimated from a dry walk that counts strategy cells and
nodes: `≈ 12 B × cells + 200 B × nodes` *(measure)*. Let `F` = fixed overhead: module, tree,
hand tables, allocator slack, MT thread stacks and TLS *(measure; start at 128 MiB)*.

**Admit iff `E + X + F ≤ B`**, where `B` is the smallest applicable budget:

| Environment | Budget B | Basis |
| --- | --- | --- |
| wasm32 hard ceiling | 3.5 GiB | 4 GiB max linear memory (`--max-memory=4294967296`), minus 0.5 GiB of headroom (upstream uses 3.9 GB for `E` alone and ignores `X`/`F`) |
| Desktop Chromium / Firefox | 3.5 GiB | V8 allows 4 GiB of wasm memory |
| Desktop Safari | 2 GiB *(measure)* | not measured; WebKit counts shared-memory maximums against a process-wide reservation |
| `navigator.deviceMemory` present | ≤ deviceMemory × 1 GiB / 4 | Chromium only; the value is capped at 8, so it only ever lowers B |
| Mobile (iOS, iPadOS, Android; `pointer: coarse`) | 512 MiB | reports: >~300 MB is unreliable on older iOS Safari; about 1.5 GB (iPhone 12 Pro) to 3 GB (iPhone 15 Pro) before the tab reloads; a 2 GB `maximum` failed at construction on iOS 16.2 |

On iOS the declared `maximum` must itself be small: an MT variant with a 1 GiB max, or ST
(unshared, so it declares no max). W2 decides.

**Which spot classes fit.** Every value below comes from the B1 estimates or upstream. W0
would fill in the *(measure)* cells with `solver-bridge estimate`, which builds game/card
tables but not strategy storage:

| Class | Example | E float32 / int16 | Desktop 3.5 GiB | Mobile 512 MiB |
| --- | --- | --- | --- | --- |
| River, full ranges, ≤ 3 sizes + raise | referee river 14×14; full-range river *(measure)* | ≪ 100 MB *(measure)* | yes | yes |
| Turn, 167×250 hands, 1–2 sizes (upstream `basic`) | `smoke-upstream-basic` | 12.1 MB / 6.4 MB (measured B1) | yes | yes |
| Turn, full ranges, 3 sizes + raise per street | *(measure)* | expected 10²–10³ MB | likely | only with int16 or narrow ranges |
| Flop, 3-bet pot, narrow ranges, Pio "FAST" menu | upstream benchmark | 1.25 GB / 660 MB | yes (float32) | no |
| Flop, SRP 100bb, Griffin lean tree (B3 locked benchmark) | `benchmark-lean-srp-btn-bb-100bb-ks7h2d` | 6.00 GB / 3.05 GB (B3) | int16 only, if X ≲ 580 MB | no |
| Flop, SRP 100bb, 3 sizes/street + raise (our locked benchmark) | `benchmark-srp-btn-bb-100bb-ks7h2d` | 32.8 GB / 16.6 GB | **no** (9× over) | no |
| Same, all-in-only raises | B1 trim table | 21.2 GB / 10.7 GB | **no** | no |

Conclusion: rivers and turns are the in-browser target. Flops only fit as narrow-range or
small-menu spots of around 1 GB. The Griffin-scale SRP flop is out of reach on every browser
(wasm32 or Memory64), so live flop play must reuse the saved B4 library and live-solve only
from the turn onward.

**Export limits for live use.** The default is `exportScope: "first-street"` or a slice plan.
A full export of a turn spot with realistic ranges can be hundreds of MB of JSON. `X` is part
of the admission rule so an export can never be the thing that overflows.

## Verification

- **Hypothesis: float32 ST WASM is bit-identical to native.** Rust does no fast-math or FMA
  contraction by default. postflop-solver's wasm-only `simd128` code (`utility.rs`) is exact
  max-reductions. DCFR uses `sqrt` and `powi(3)`. B2 found 1 and 10 threads bit-identical.
  The lowering of `powi` and NEON vs simd128 codegen could still differ, so W3 measures it.
- Gates on each wasm result (3 referee spots, the suit-isomorphism probe, `smoke-upstream-basic`):
  (a) the same `spotHash` and an identical exported tree (structure, actions, chips,
  `impossibleCards`); (b) the full B2 referee: `refereeWalk`, our graders, `refereeGates` with
  the **locked τ = 2e-4 chips, not re-tuned**; (c) a report of the max |Δ| strategy / EV /
  exploitability against the native result. Bit-identity is recorded if found, and |Δ| ≤ τ is
  required either way.
- Measurement run in the style of B2 (`audit:bridge -- --measure --engine wasm`): the same 4
  games at 10 to 1000 iterations, in ST Node, MT Chromium and ST Chromium. If any wasm
  discrepancy exceeds τ/10, stop and investigate. Do not widen τ.
- **CI** (job `bridge-wasm`): a pinned nightly with `rust-src` and `wasm32-unknown-unknown`,
  plus a `wasm-bindgen-cli` pinned to the crate's version. Steps: build ST and MT, check a
  `.wasm` size budget, run clippy for the wasm target, then run the gates in Node on the ST
  module (`initSync`) against native results. Playwright Chromium runs `next build && next
  start`, asserts `crossOriginIsolated`, and solves the river referee MT and ST. WebKit covers
  the ST fallback; real Safari and iOS are manual (W3).

## Licensing (AGPL-3.0-or-later)

Serving the `.wasm` conveys object code (§6) of a modified program users interact with over a
network (§13). Corresponding Source must be offered for the exact build:
- the page shows "Source (AGPL-3.0)" linked to `github.com/katswnt/poker-face/tree/
  <VERCEL_GIT_COMMIT_SHA>`, plus the postflop-solver commit and the build steps (pinned
  toolchain, both Cargo.lock files, `npm run build:wasm`);
- a generated `public/wasm/<hash>/LICENSES.txt` holds AGPL plus the MIT/Apache notices
  (wasm-bindgen, wasm-bindgen-rayon Apache-2.0, rayon, serde, sha2, web-time);
- the wasm is built only from this repo, never from an upstream prebuilt.

## Milestones

### W0: contract and limits (no browser)
- [x] Versioned `estimateExport`: public nodes, strategy cells, edges, JSON upper bound and
      engineering working-memory reservation. Rust tests cover river/turn/flop, blockers,
      unequal ranges, full/first-street exports. W2 measures 24 bounded turn/river cases.
- [ ] Broader large-game/flop/device grid and physical-device budgets. Intentionally not
      required to admit larger games in this ST milestone; those games remain refused.
- [x] `src/lib/solver/bridge/wasm-admission.ts`: a pure `admitLiveSpot(estimate, env) → {ok,
      precision, budget, reason}` with unit tests over the table (including the benchmark
      refusal and the mobile budget). Done 2026-09-25: also `parseBridgeEstimate` (the
      `estimate` line), `wasmBudget` (min of wasm32 ceiling, profile, deviceMemory/4; unknown
      profile = mobile's 512 MiB), `chooseThreading` (pure MT/ST choice from passed-in flags),
      `needsFreshWorker`, and the spot-class table as `WASM_SPOT_CLASSES`.
      `test/bridge-wasm-admission.test.ts` (12 tests): at-cap admits / +1 byte refuses,
      float32 → int16 → refuse, B1 benchmark and its trim refused everywhere, upstream basic
      admitted everywhere, mobile/unknown stricter than desktop, table rows match the rule.
      Finding: the **B3 lean benchmark** (5.996 GB float32 / 3.046 GB int16, exact bytes from
      `artifacts/benchmark-b3.json`) is admitted on desktop Chromium/Firefox **as int16 only**
      with X = 0 (3.18 GB of 3.76 GB); a > ~580 MB export refuses it, and so does
      `allowCompressed: false` (open question 2). Row added to the class table below.
- [x] Document the browser meanings of the Result v1 fields (above) in the bridge spec. No
      schema change.

### W1: build (ST implemented; MT/deployment deferred)
- [x] Feature-gate `solver-bridge` (`native`, `threads`, `wasm`) and refactor to `Session`.
      Native numerical/tree/slice output matches the pre-W1 binary; timing/RSS excluded.
- [x] `native/solver-bridge-wasm`, stable Rust 1.98.1, wasm-bindgen 0.2.104; hashed ST
      assets under its ignored `target/web/<hash>/`, with exact source, vendored dependencies,
      licenses and manifest. `npm run build:wasm`; engine-revision and stale-build checks.
- [ ] MT build and public deployment. Nightly/isolation are not required for ST.
- [ ] When MT is pursued: `next.config.ts` headers (COOP/COEP/immutable caching). Verify isolation and worker COEP
      in Chrome, Firefox and Safari, and that soft navigation falls back to ST.

### W2: worker and UI-less harness
- [x] `src/lib/solver/bridge/live/`: single-use ST Worker, injected runtime, small typed
      protocol, admission, chunked `step`, cancel, previews, trap retirement and client
      generation/watchdog protection. No automatic compressed or MT fallback.
- [x] Loopback-only UI-less harness runs the production runtime/client in Chromium,
      Firefox and WebKit; numerical parity, responsiveness, cancellation and refusal.
- [x] Next route and explicit local asset/source preparation (W4).
- [ ] Public deployment and physical Safari/iOS/Android budgets (W3).
      Engineering reservations are conservative estimates, not measured JS heap upper bounds.

### W3: verification
- [x] Node ST gates and 20-case measurement grid: zero observed native/WASM numerical
      differences; independent referee tolerance unchanged. See the W1 audit.
- [x] `bridge-wasm` CI definition and local Chromium/Firefox/WebKit ST Worker parity.
- [x] Hosted ST CI observed green: W1 run `36753561883` (`ebcd248`) and W2 run
      `36757906224` (`bf44ef2`), 2026-09-30; all jobs, not only the WASM job.
- [x] M1 Pro Chromium/Firefox/WebKit grid: 72 fresh-process/Worker observations, 63 admitted
      results with matching fingerprints and nine expected refusals. Wall time, post-export
      WASM high-water and sampled browser RSS (including WebKit XPC services) are recorded
      in [W3](postflop-solver-w3-verification.md). Caps and 0.0002-chip tolerance unchanged.
- [ ] **Open (device):** actual Safari.app, physical iOS Safari and Android Chrome; no
      devices provided. Thermal/background/OOM behavior at the edge remains unmeasured.
      Playwright WebKit is not a substitute for those tests.

MT parity is deferred optional scope, not a completed ST gate or an implied claim.

### W4: minimal UI hook
- [x] `/solver/live` (a full-load `<a>` link from the lab): guided setup or pasted spot,
      see the admission verdict, solve, cancel, view the root strategy preview and the final
      exploitability. It shows the AGPL source link and build hash, and retains a saved
      independently checked example when WASM assets are absent. Root values are not
      represented as action EVs. See W4 for the deployment checklist and tests.

## Risks

- **Nightly drift** (threads need nightly plus `build-std`): pin a date and keep ST
  stable-capable.
- **Coverage on a new target**: W1 ST now builds and passes the listed parity/referee cases.
  Larger trees, MT and real mobile devices still need separate evidence.
- **Trap = lost session** (panic or OOM): admission makes it rare, and restarting the worker
  makes it safe.
- **Browser memory**: tabs die below the stated limits, especially on iOS. Keep budgets
  measured and conservative.
- **COEP** breaks future embeds and the Vercel Toolbar. **Speed**: about 2× native upstream,
  worse on phones, and MT on Safari is unproven.

## Open questions (for Kat)

1. Scope COOP/COEP to `/solver/live` only (plain-`<a>` entry) or apply it site-wide (simpler,
   loses the Vercel Toolbar on previews)?
2. Should live solving allow int16 compression (bigger spots, outside τ) or stay float32-only?
3. Mobile: offer live solving at all, or show only the saved library below a budget?
4. Should the in-browser TypeScript referee grade small live results (river) before display?
5. Should live play with re-solving start at the turn (from a B4 flop slice), as the memory
   ceiling implies?

Sources: github.com/b-inary/wasm-postflop (package.json, rust/*/.cargo/config.toml,
src/worker.ts, RunSolver.vue, README); RReverser/wasm-bindgen-rayon README; postflop-solver
`9d1509fe` src (utility.rs, solver.rs, interpreter.rs); `node_modules/next/dist/docs` headers +
turbopack; caniuse wf-wasm-memory64; v8.dev/blog/4gb-wasm-memory; godot#70621; Apple forums
761666; vercel/vercel#16040; MDN COEP.

## Decisions (2026-09-25)

- Verification and referee contexts use float32 only (`allowCompressed: false`): int16 values
  drift past the locked 2e-4 tolerance (B2 measured up to 8.7e-4 chips; B3 river subgames 2.8e-3).
- Live play may use int16, but admits only turn and river re-solves. Flops always come from the
  saved B4 library, even when a lean flop would technically fit a desktop tab as int16.
