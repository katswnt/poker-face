# W4: bounded live-solver page

Initial implementation and local verification 2026-09-30, on the uncommitted W1/W2 tree at `8866180`.
During verification, Claude added the documentation-only `d8701e1` CPU-ceiling roadmap.
That commit is preserved; it did not change the application or numerical baseline.
That initial verification was not a public release or P1–P5 completion. The subsequent
milestone release verification is recorded below; historical snapshot numbers are retained
here so they are not confused with the later exact-commit checks.

## Scope and sequence

1. Add an explicit asset-preparation command: verify every W1 distribution file, copy the
   entire immutable hash directory (source, vendored dependencies and notices included),
   and offer a downloadable corresponding-source archive. Generated assets stay ignored.
   A normal build without prepared assets must still show the saved example and explain
   why live solving is unavailable. No remote deployment is part of this turn.
2. Add `/solver/live`, with route-local CSS matching the existing labs and native semantic
   controls. Keep Leduc and the existing river inspector intact; link from Leduc.
3. Plain-language form: four/five board cards, weighted ranges, pot, effective stack, shared
   turn/river bet menu, raise limit, iteration cap. Advanced Spot v1 JSON preserves more
   detailed trees. Never silently change imported rules or use generated preflop ranges.
4. Explicit preflight before solving; editing invalidates it. Display compatible deals,
   upper-bound export states/cells, engine/export/overhead reservations and refusal reasons.
   A fresh solve repeats admission. Retain W2 limits: ST, float32, 64 hands/player, 256 MiB
   reservation, 120 seconds, 10,000 iterations. No mobile-memory certification claim.
5. Real stage/elapsed/iteration/checkpoint progress, non-final root preview, cancel and
   errors/retry. Retain the last completed result but label it separately from edited inputs.
6. Root-hand inspector: action frequencies, strategy-following value and check-down equity.
   These are NOT per-action EVs or equity against a future calling range. Full-node action
   EV teaching is outside this minimal W4 hook; link to the existing river teaching lab.
7. Instant independently checked saved example; numerical reproduction script; unit tests
   for form/state/projection; production Next Worker tests, keyboard/320px/text-resize/metadata,
   refusal/cancel/asset-failure checks, and existing solver regressions.

## Decisions and mitigations

- Native controls reuse the project's keyboard primitives; no custom tabs/dialogs or focus
  traps. No new animation. CSS Modules reuse existing colors/spacing; dirty globals untouched.
- Plain inputs are easier to teach but deliberately narrower than Spot v1. Import JSON is
  explicit and shows its own game summary; it never falls back silently to the simple form.
- Root-only summaries keep UI work bounded and avoid attributing unavailable action EVs.
  Raw Result v1 remains downloadable after live solves for reproducibility/offline inspection.
- WASM preparation is an explicit release step, not an implicit Rust download during every
  Next build. CI must exercise both missing-assets and prepared-assets behavior.
- Engine/source hashes identify numerical inputs/build. Do not claim a public Git commit
  contains uncommitted changes. Public release still requires committing the corresponding
  application source and shipping the complete generated source/notices distribution.

## Initial working-snapshot verification (historical)

Verified on macOS arm64, Node 24.10.0, pinned Rust 1.98.1 / wasm-bindgen 0.2.104. The
isolation tree contains committed application code plus only W1/W2/W4-owned changes; the
unrelated trainer and paused configurable-flop edits are absent. This is a verified working
snapshot, **not an already-tested commit**: verify the exact staged tree again before pushing.

- **868/868 Node tests, no skips**, including nine new UI-boundary tests. Form validation,
  board removal, float32 normalization/underflow, reachable teaching presets, blocked-hand
  presentation, saved-payload hash, preflight invalidation, cancellation/late publication,
  saved-only descriptors and corrupted source/license files have assertions.
- **16/16 native Rust tests**. No mathematical engine changes in W4.
- Isolated typecheck, ESLint and production build pass. Both prepared-assets and missing-
  descriptor/saved-only production builds pass. Only generated assets are excluded from
  TypeScript/ESLint; the paused source draft is not excluded.
- **27/27 prepared-page Playwright checks**: nine in each of Chromium, Firefox and WebKit.
  These exercise the real Next-bundled Worker, a custom solve and strategy download, source/
  license links, actual-progress cancellation and recovery, oversized refusal, input errors,
  asset failure/retry, metadata, accessible names and keyboard focus. No solver mocks.
- **15/15 saved-only page checks** across those browsers; the 12 live-only tests are explicitly
  skipped in this mode, not counted as passing. The example starts without a Worker and the
  solve control is disabled with an explanation.
- **21/21 existing Chromium regressions**, alongside the nine new Chromium checks (30/30).
  Leduc, the existing river lab and drills still work.
- 320/390/1280 CSS-pixel screenshots and overflow assertions pass in all three engines;
  200% root-font enlargement also passes. Representative mobile/desktop screenshots were
  visually inspected. This is not physical-phone, actual-browser-zoom or screen-reader
  certification. macOS WebKit's full keyboard traversal uses its native Option–Tab behavior;
  ordinary Tab skips links there. The test checks the actual sequence through skip link,
  result region, hand selector and disclosure; the page's tab order was not customized.
- `audit:wasm` repeats the four locked referee cases plus the larger parity-only smoke:
  zero observed native/WASM numerical deltas, unchanged **0.0002-chip** independent gates.
  `audit:wasm:example` reproduces the new saved projection byte for byte. `audit:river:v3`
  reproduces +16.081056725 value and 0.009074631 exploitability; `audit:preflop` reproduces
  the existing diagnosed model without promoting it. PF4 remains gated.
- The complete source archive's **1,670 source/notice files** match the distribution manifest.
  Extracting it into a fresh directory and following `source/BUILD.txt` compiles offline.
  The rebuild matches all exported numerical fields on river, turn, tiny-flop and suit-
  isomorphism fixtures at 100 iterations (zero deltas). Cross-layout binary identity is
  not claimed. Two consecutive preparations of the same distribution reproduce the same
  descriptor/archive; archive metadata may differ across fresh builds/platforms, so the
  archive has its own content hash rather than claiming the WASM build hash.

The main worktree still has exactly **nine pre-existing type errors** in the paused
configurable-flop draft (`policy.ts`, `FlopV2`, `FlopV2Game`). A root production-build attempt
also encountered unavailable Google font downloads; the isolated build with the existing
font cache succeeds. Do not call the entire dirty worktree green. The seven unrelated
trainer/session file hashes and every unrelated README hunk remain unchanged. Nothing was
staged, committed, pushed or remotely deployed by this milestone. Hosted CI is configured,
not observed running for these uncommitted changes.

## Reproduce and release preparation

First follow W1's pinned Rust/wasm-bindgen installation instructions. From a clean-scope
checkout containing W1/W2/W4:

```sh
npm run build:bridge
npm run build:wasm
npm run test:bridge
npm test
npm run audit:wasm
npm run audit:wasm:example
npm run test:wasm:ui
npm run audit:river:v3
npm run audit:preflop
npm run typecheck
npm run lint
npm run prepare:wasm:live
POKER_FACE_LIVE_REQUIRED=1 npm run build
CI=1 POKER_FACE_LIVE_REQUIRED=1 npx playwright test --config=playwright.live.config.ts
CI=1 POKER_FACE_LIVE_REQUIRED=1 npm run test:e2e
```

`prepare:wasm:live` validates every distribution file and rejects stale source, copies the
**whole** immutable distribution, creates a source archive and writes the build-time pointer
`public/solver-live/current.json`. All these generated files are ignored. The app serves the
source/build instructions/licenses alongside the binary; do not deploy a binary-only copy.
Use the required-build flag for a live release so absent assets fail the build instead of
silently producing a saved-only deployment. A clean checkout without preparation supports:

```sh
npm run build
CI=1 POKER_FACE_LIVE_SAVED_ONLY=1 npx playwright test --config=playwright.live.config.ts
```

This turn's immutable WASM/source identity is unchanged from W2:

- Build: `b04b2fe6a92ed3530f48aa48d8af41905a65df49c6581701eeec667bacc50a2c`.
- Source: `8e80080fa222b0aa6fd8e2828425a637e15bfb799893dbcf6b4e8cea2e3f5880`.
- WASM: 748,486 bytes; `d3c96880b60f748c1bbed728e8f339f3548a2ddc8e0cbdfef5bd8fb7140735e5`.
- This local source archive: `f8c633b7e717fe9ef485e093761b66488e5c31610186cfe6576ea6c1db23129d`.
- Saved example payload: `b9fac5d1e63b275eb6b4d28bc1c6940e598e449959d52e9f98618dd9b251477d`.
  The turn example completes 520 iterations; engine exploitability 0.00971508 chips,
  independent exploitability 0.009715601225684267 chips. Saved JSON omits variable timings.

## Owned paths and next steps

New W4 files (explicit list; do not stage entire directories containing W1/W2 or user work):

```text
e2e/live-solver.spec.ts
e2e/fixtures/browser-zoom/manifest.json
e2e/fixtures/browser-zoom/background.js
playwright.live.config.ts
scripts/build-live-example.ts
scripts/prepare-bridge-live.mjs
src/app/solver/live/page.tsx
src/app/solver/live/LiveSolver.tsx
src/app/solver/live/live.module.css
src/lib/solver/bridge/live/input.ts
src/lib/solver/bridge/live/view.ts
src/lib/solver/bridge/live/ui-state.ts
src/lib/solver/bridge/live/deployment-node.ts
src/lib/solver/bridge/live/example.json
tasks/postflop-solver-w4-ui.md
test/bridge-live-ui.test.ts
```

W4 also changes `.github/workflows/ci.yml`, `.gitignore`, `eslint.config.mjs`, `tsconfig.json`,
`package.json`, `src/app/solver/lab/LeducLab.tsx`, `src/app/solver/page.tsx`,
`src/app/solver/river/RiverLab.tsx`, `src/app/solver/postflop/TurnExplorer.tsx`,
`src/app/solver/flop/FlopExplorer.tsx`, `tasks/postflop-solver-wasm-spec.md`,
`tasks/solver-lab-roadmap.md`, `tasks/cpu-ceiling-roadmap.md`, and **only README's browser-roadmap hunk**. Several of those
paths already contain W1/W2 changes; their separate records describe that ownership. Preserve
the original trainer README hunks when constructing any staged blob. No generated `target/`
or `public/solver-live/` file belongs in a source commit.

Next: review and land clean-scope milestone commits, observe hosted CI, then complete release
and real-device checks without raising the current caps. Policy-backed play P1 follows the
[CPU-ceiling roadmap](cpu-ceiling-roadmap.md) and [play spec](heads-up-play-resolving-spec.md).
Its full-range/pruning measurement and independent-grading gates are still research work,
not implied by a working browser UI. No P1–P5 implementation or completion is claimed here.

## Milestone release verification — 2026-09-30

W1 (`ebcd248`, CI run `36753561883`), W2 (`bf44ef2`, `36757906224`) and W3
(`0accb63`, `36763545452`) were committed, tested in isolated exact-commit copies, pushed
in order and observed fully green before this W4 release work resumed. W4's release
candidate was checked on `0accb63` plus only the owned paths above, with a copied (not
symlinked) `node_modules`. The commit containing this record must repeat the gates in a
fresh exact-commit copy before push; its commit/hosted-run identity belongs in the closing
handoff. Do not infer a prepared public deployment from a source commit or green CI.

The final review added assertion-first coverage for three gaps: missing full-load live-page
links from the other solver navigations, a distinction between the solver reservation and
total browser memory, and **actual browser zoom**. All three assertions failed first. The
navigation test now follows a document request from each of `/solver`, `/solver/lab`,
`/solver/river`, `/solver/postflop` and `/solver/flop`. No trainer/global-style changes.

The zoom fixture uses Chromium's real `tabs.setZoom(2)` in an ephemeral profile with a
permission-free, test-only extension. It verifies the browser-reported zoom factor, a
1280→640 CSS-pixel viewport and doubled device-pixel ratio, no horizontal overflow and
keyboard focus through the result/hand selector. It captures the actual browser surface:
Playwright's ordinary CSS-pixel screenshot clipping cropped the zoomed surface, even though
the page itself reflowed correctly. Result/setup screenshots were visually inspected.
This is distinct from the existing 200% root-font checks in all three engines; Firefox and
WebKit do not claim this Chromium-specific browser-zoom API check. See the primary
[Playwright extension guide](https://playwright.dev/docs/chrome-extensions) and
[Chrome zoom API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom).

Release-candidate measurements on the M1 Pro, macOS 26.4.1, Node 24.10.0:

- **874/874 unit tests**, no skips; **16/16 native Rust tests**; typecheck, lint and both
  saved-only/prepared-assets production builds pass.
- **34 prepared-page browser tests pass**, no retries, across Chromium/Firefox/WebKit;
  two explicitly skipped zoom cases are Chromium-only. **22 saved-only tests pass**,
  with 12 live-only and two Chromium-only cases explicitly skipped, not counted as passes.
- **86/86 full Chromium application tests pass**, no retries. Existing solver, comparison,
  explorer, drills and trainer tests are preserved.
- 320/390/1280px and enlarged-text overflow checks pass in all engines; representative
  desktop/mobile and actual-zoom screenshots inspected. No physical-device or screen-reader
  certification is claimed.
- `audit:bridge`, `audit:wasm`, `audit:wasm:example`, `audit:river:v3`, `audit:preflop` and
  `audit:bridge:library` pass. Native/WASM numerical deltas remain zero on the four locked
  referee fixtures and larger parity-only smoke. The independent tolerance remains
  **0.0002 chips**. River-v3 and the saved example retain their published numbers/hashes.
- Repeated asset preparation is byte-identical for the same distribution. The downloaded
  archive contains **1,670 matching source/notice files**, builds offline via `source/BUILD.txt`,
  and its rebuilt engine matches exported numerical fields on all four referee fixtures
  at 100 iterations. No cross-layout binary-identity claim.

Candidate source identity is `c5ec5c8a4f3c1f16994b52d382f0406961ebdffd11f8ca24dec282f97585933d`;
WASM size **748,486 bytes**. Candidate build hash
`634a6828e344d29f904bafe4678cb9414365066c940ffda8bd0ccf7d3c8d8b0e` and source-archive hash
`033140817c98bb96ce42f858aadbcd99e69bd66bc887fa1d6c8527fa2a570e8d` identify this parent-based
snapshot, not the later exact-commit build. Rebuilding the exact commit can change those
build/archive hashes; source identity and numerical gates must remain unchanged.

Use the reproduction commands above, adding `--retries=0` for the recorded local browser
runs. Run the saved-only build/tests **before** preparation (or in a separate clean copy);
then prepare, require assets at build time and run the prepared suite. Run the complete
Chromium suite with `CI=1 POKER_FACE_LIVE_REQUIRED=1 npx playwright test --retries=0`.
The CI prepared-page step includes the navigation, memory-copy and genuine zoom tests.

Baseline-ui/fixing-accessibility kept changes to native controls, visible focus and scoped
existing-theme CSS; fixing-metadata checked deterministic route-specific title/canonical/
social tags. No animation or framework migration. Physical mobile budgets, deployed-asset
verification and P1–P5 remain separate work. PF4 remains gated. Trainer/session files,
their README hunks and the paused configurable-flop draft remain untouched.
