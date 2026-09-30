# W1: single-threaded WebAssembly bridge

Implemented and locally verified 2026-09-29 from `8866180`. Scope clarification of
[`postflop-solver-wasm-spec.md`](postflop-solver-wasm-spec.md): this milestone delivers the
**single-threaded foundation**, not the entire older W1–W4 browser proposal.

## Contract and implementation

- Keep the upstream engine pinned. Native CLI and WASM use one resumable Rust `Session`.
- Build once, estimate before allocating strategy storage, allocate once, advance the SAME
  DCFR state in chunks, finalize/export once. Preserve zero-based iterations and the existing
  every-10-iterations/last-iteration grading schedule regardless of chunk size.
- Spot v1 and Result v1 remain unchanged. Progress states when exploitability was actually
  measured. Root previews are explicitly non-final and contain no premature EVs.
- Pin stable Rust 1.98.1 and wasm-bindgen 0.2.104. Use `web-time` for monotonic elapsed time,
  disable Rayon/libc, keep the standard allocator. No nightly requirement for this ST build.
- Report WASM linear memory separately. Result v1 `peakRssBytes: 0` means unavailable, not
  free memory. Engine storage estimates do not cover JS/export/allocator overhead.
- Dropping a session cancels between synchronous calls. Only terminating a Worker interrupts
  an in-flight call or reclaims its whole linear memory; never reuse an instance after a trap.

## Verification gates

1. Preserve a pre-refactor native binary; compare numerical results, tree, checkpoint schedule
   and exported slices after refactoring. Timing/RSS/architecture-dependent storage excluded.
2. Rust lifecycle, timeout, refused allocation, early finish, chunking and preview tests.
3. Produce pinned, hashed `--target web` assets with source and license provenance.
4. Load those SAME assets in Node and a real browser Worker. Compare native vs ST on the
   three referee games plus suit-isomorphism probe. Keep the frozen **0.0002-chip** independent
   referee gates; report action-frequency and EV differences separately. Bit identity is an
   observation to test, not an assumption or advertised guarantee.
5. Native tests/audit, WASM parity, lint, typecheck, production build and focused browser checks.
   Run clean-scope checks excluding the explicitly paused, untracked flop-v2 draft.

## Boundaries / remaining work

No public live-solve UI, Worker job protocol, automatic device admission, multithreading,
COOP/COEP headers, compressed-precision certification or GPU training in this milestone.
These bindings are for controlled tests until W0's export-memory estimate and W2's Worker
admission/cancellation controls are complete. Even a preflight allocates game/card tables.
Live flops remain the saved library; live custom solving will be turn/river only.

Stable ST avoids cross-origin-isolation and nested-worker deployment changes, but is slower
than threaded native. Mitigate with conservative later admission limits, honest timing, chunks
and saved examples. Shared code reduces drift; independent TypeScript referees detect errors
that native/WASM agreement alone cannot catch. The approximation remains a strategy for the
specified finite game, never universal or exact GTO. PF4 remains gated; unrelated trainer and
paused flop work are preserved.

## Tooling references

- [Rust wasm32 target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)
- [wasm-bindgen deployment targets](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)
- [web-time](https://docs.rs/web-time/1.1.0/web_time/)

## Results

This is a completed **W1 ST foundation**, not a completed browser rollout.

### Build and reproduction

```sh
rustup target add wasm32-unknown-unknown --toolchain 1.98.1
cargo +1.98.1 install wasm-bindgen-cli --version 0.2.104 --locked
npm run build:bridge
npm run build:wasm
npm run test:wasm
npm run audit:wasm
npm run audit:wasm -- --measure
npx playwright install chromium firefox webkit
npm run audit:wasm:browser -- chromium firefox webkit
```

`WASM_BINDGEN=/absolute/path/to/wasm-bindgen` can select a locally installed CLI. Build output
is **ignored**, under `native/solver-bridge-wasm/target/web/<build-hash>/`; nothing is copied
to `public/` or deployed. The build contains a manifest, exact bridge source, vendored Cargo
dependencies, full dependency licenses and Rust standard-library notices. The loader checks
the manifest, engine pin, binary/glue hashes and stale bridge-source inputs.

Local final artifact (macOS arm64, Node 24.10.0, Rust 1.98.1):

- WASM: **743,961 bytes**, below the explicit 4 MiB transfer-size regression gate.
- WASM SHA-256: `61caa55fc86ac5f962e9f8fd5a1457e2455d752babcc3678bc70bde2a6d4129d`.
- Source hash: `2b2ded546e4814ddbb54cf0966b62d242f66471253753d4d3f56c0b10e1bb12f`.
- Build hash: `b03f9d7a1c500719be18c358e0f0da3b8fed747445dad082cc0ff60a76f58c2c`.
- Two same-layout builds produced the same build hash. The supplied source bundle also
  compiled **offline in a fresh directory** using its vendored dependencies. Its binary
  bytes differ with the changed source/build layout; cross-directory/cross-machine binary
  reproducibility is **not** claimed. All four referee cases from that offline rebuild
  reproduced the original build's complete tested numerical output with zero deltas.

### Mathematical and browser checks

The preserved pre-W1 native executable and the refactored one produced identical numerical
Result v1 outputs on all four referee cases, including a flop slice plan. New regression
fingerprints retain the tree, strategies, EVs, grades, convergence iteration schedule and
slices; only timing/memory observations are excluded.

| Case | Iterations | Public export nodes | Self-reported exploitability (chips) |
|---|---:|---:|---:|
| River v3 demo | 600 | 63 | 0.009005547 |
| Turn v2 dry value | 520 | 6,507 | 0.009715080 |
| Tiny flop reference | 100 | 189,900 | 0.009672165 |
| Suit-isomorphism probe | 620 | 4,203 | 0.009411812 |

For these cases, native versus Node ST had **zero observed differences** in every exported
action frequency, per-hand root EV/equity/weight, checkpoint grade and final exploitability.
Structural comparisons also require identical actions, amounts, boards and blocked-hand nulls.
The independent TypeScript tree walk/graders passed the existing **0.0002-chip** gate; the
tiny flop was also cross-graded by the generic exact best response. Native/WASM agreement
alone is not treated as mathematical proof.

The 20-case grid (four games × 10/30/100/300/1,000 iterations) likewise observed zero
native/ST deltas and passed the independent grading checks. Maximum observed independent
value discrepancy was about **0.00001215 chips**, below the frozen gate. These results do
not certify arbitrary games, int16 compression, every architecture or future compiler versions.

The larger `smoke-upstream-basic` turn demo also matched native in Node ST: 100 iterations,
0.91104555-chip self-reported exploitability. This is **parity smoke only**, not an independent
certificate for that larger game.

All four small cases ran in actual module Workers in Playwright Chromium, Firefox and WebKit
on macOS, **without cross-origin isolation**. Their complete numerical-result fingerprints
matched Node ST. Monotonic real iteration counts, checkpoint ages and non-final previews
were checked. Each test destroys its Worker. No physical phone or real Safari application
test is claimed; Playwright WebKit is not a substitute for that device coverage.

Observed linear-memory high-water sizes after full export were 1.25 MiB (river), 6.875 MiB
(turn), 187.25 MiB (tiny flop) and 5.0625 MiB (suit probe), identical across these three
browser engines. These are **not process RSS or safe device budgets**. The flop export is
a test fixture, not admission to a live-flop feature.

### Regression verification

- 15/15 Rust tests, including chunk sizes 1/3/7/10/100/u32-max, previews, allocation refusal,
  stale-grade labeling, timeout poisoning and already-converged zero-iteration games.
- 840/840 Node/domain tests in the isolated milestone tree, including the 4 WASM boundary
  tests and the frozen pre-W1 native-result regression. No tests skipped there.
- Rust format and clippy (native and WASM), ESLint, isolated typecheck and production build.
- 21 existing Playwright regressions: math/solver drills, river lab and Leduc lab.
- `audit:bridge`, `audit:bridge:library`, `audit:preflop`, and `audit:river:v3` passed. The
  river v3 artifact reproduced its existing hash/value/exploitability; no saved strategy changed.
- A `bridge-wasm` CI job is configured for the pinned build, Node gates/grid and three browser
  engines. **Hosted CI has not been run by this uncommitted local work.**

### Worktree / next handoff

No files staged, committed or pushed in this W1 turn. The pre-existing trainer/session
changes and paused configurable-flop draft were preserved. The seven non-README trainer
files retain their prior SHA-256 hashes. README's existing changes are preserved; W1 only
edits the separate browser-roadmap paragraph. **Do not stage the entire README.**

Whole-worktree typecheck still fails on the pre-existing, untracked configurable-flop draft
(missing `policy.ts`, wrong `FlopV2`/`FlopV2Game` references). Do not “fix” this by excluding
the draft in project configuration. W1 checks used HEAD plus explicit W1 files in an isolated
copy. The added `native/**/target/**` TS/ESLint exclusion is solely for generated WASM/vendor
build output, not application source. README-only documentation changes must also be carried
as a separate hunk into any isolated commit check.

Owned W1 files: `.github/workflows/ci.yml`, `eslint.config.mjs`, `tsconfig.json`, `package.json`;
the bridge's `Cargo.toml`, `Cargo.lock`, `src/lib.rs`, `tests/bridge.rs`; the five source/config
files under `native/solver-bridge-wasm/` (never `target/`); `scripts/build-bridge-wasm.mjs`,
`scripts/bridge-wasm-runner.ts`, `scripts/audit-bridge-wasm.ts`, `scripts/audit-bridge-wasm-browser.ts`,
`scripts/bridge-wasm-harness.worker.mjs`, `scripts/bridge-wasm-harness-page.mjs`;
`test/bridge-wasm.test.ts`, `test/bridge-session-regression.test.ts`; this audit,
`tasks/postflop-solver-wasm-spec.md`, `tasks/solver-lab-roadmap.md`; and only the noted README hunk.

**Next:** finish W0's bounded export-size estimate and then W2's production Worker. Validate
Spot v1 before entering WASM; admit turn/river only with measured engine+export+JS overhead;
send job-tagged honest progress and previews; reject stale messages; provide cooperative
cancel plus hard Worker termination, including during build/export; destroy trapped instances.
Then measure actual devices and add the W4 learner UI. Keep float32 certification separate
from compressed results. MT/isolation is optional later work, not a prerequisite for a useful
conservative ST product. PF4 stays gated.

## Release split verification — 2026-09-30

The W1-only release was reconstructed on `d8701e1` in a detached scratch worktree, with
copied (not symlinked) `node_modules`. Its Rust source matches the original W1 implementation;
trailing blank lines in the new crate's metadata were removed after the staged whitespace
check caught them (source hashes consequently change). The W2 export estimator and all
W2/W4 application changes are absent. This release split changes no
solver behavior; W1's already-written lifecycle/regression tests predate the roadmap run.
New behavior fixes from this run must start with a failing test.

Rechecked: **840/840 unit tests with no skips**, **15/15 Rust tests**, native/WASM clippy,
TypeScript, ESLint, production build, `audit:bridge`, `audit:wasm`, the 20-case
`audit:wasm -- --measure` grid and `audit:wasm:browser -- chromium firefox webkit`.
All numerical differences from native remain zero and the independent 0.0002-chip gate
is unchanged. The complete existing Playwright suite finished with **73 passed and one
flaky test passing its configured retry** (`keyboard.spec.ts`, randomized trainer glossary
visibility); that unrelated file and the trainer code were not edited. The targeted 21
solver/drill checks in the original record remain a narrower, earlier run.

Release scope also corrects the bridge spec's obsolete `peakRssBytes` description: zero
means unavailable in WASM, while linear memory is a separate observation, not process RSS.
Add `tasks/postflop-solver-bridge-spec.md` to the explicit W1 file list above.

The exact commit must be exported and its full unit/type/lint/audit/build checks repeated
before push. Hosted CI must then be observed green before W2 is landed; record its run ID
in the next milestone/release handoff. A configured CI job is not a completed hosted gate.
