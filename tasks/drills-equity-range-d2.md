# D2: equity versus an explicit range

Started after D1 code `be05152` and closing record `ffbb82c` passed all eight CI jobs
([closing run 44957214650](https://github.com/katswnt/poker-face/actions/runs/44957214650)).
Status: shipped and verified in production, 2026-11-21.
Contract: [drill expansion plan](drill-expansion-plan.md#frozen-d2-contract-before-implementation).

## Prospective input freeze

[36 hand-written inputs](drills-equity-range-d2-inputs.json), SHA-256
`58c6a5a980c677a293ce3faaeea7b6b1804d9b07406651d899da9c7b34827426`, frozen before computing any answers. Exactly 12 cases per level:
12 simple rivers; 6 richer rivers and 6 simple turns; 12 weighted turns with blocked
combinations. Total: 18 rivers, 18 turns, 12 unequal-weight cases and 12 cases with
blocked rows. Every level-3 case includes a row blocked by the hero and one by the board.
The maximum input range has six combinations. The parser still permits up to 12.
Cases e25/e26 keep cards fixed and change weights; e27/e28 change the hero's ace suit
and the corresponding impossible combination. These are deliberate teaching contrasts,
not a representative sample of poker play. Do not tune cases after observing answers.

## Implementation contract

Pure input validation and enumeration, a separately implemented slow reference audit,
and a small hash-verified data file. No browser solve or Monte Carlo. Existing math,
push/fold and postflop drills keep their grading and frozen dependencies. Preserve exact
integer per-combination counts and weighted rational totals; verify each of both players'
seven-card scores and each win/tie/loss outcome independently. Remove impossible rows
before normalizing. Relative weights are assumptions, not learned frequencies.

Show the complete weighted range before answering. Guesses must be in 0–100 percent;
±2 percentage points is the inclusive practice tolerance (1e-9 rounding slack), never
an uncertainty estimate. Use a 30-second target with no cutoff. Show exact count fractions
and mark displayed decimals as rounded. Equity is the average pot share if no more bets
are made, including half of splits; it is not a call EV or a strategy recommendation.

Costs: only 36 cases, no flop exercise or arbitrary range editor, and possible memorization.
Mitigations: explicit coverage, levels, weighted/blocker contrasts, visible assumptions,
repeatable review keys, independent enumeration, and no skill-rating or universal-GTO claim.
Keep the initial route lightweight by lazy loading only when selected; refuse stale dataset
keys and malformed/corrupt downloads with retry or explicit removal. Data cap: 200 KiB.

## Gates

- [x] Freeze exact inputs and expected structural coverage before answers/implementation.
- [x] Failing tests first; invalid inputs, every outcome, split pots, blockers, weights,
  order/suit invariance; independent recomputation of every displayed numerical fact.
- [x] Deterministic generation, tolerance boundaries, full-key review, loader integrity,
  retry, stale replies, timer and storage checks; prior drill behavior preserved.
- [x] Byte reproduction, 36 cases, complete range display, ≤200 KiB.
- [x] Three browsers, keyboard, failure/retry/review, 320/390/1280 px, 200% reflow; screenshots.
- [x] Exact commit with copied dependencies: full unit suite, tsc, lint, solver/artifact
  audits and production build; explicit milestone files and README hunks only.
- [x] Push main; all eight CI jobs observed green before deployment.
- [x] Fresh clean native/WASM rebuild, guarded Vercel deployment, public source/data hash
  checks and deployed browser checks; record measurements and remaining device limits.

## Measurements and release

| Candidate check | Measured result |
|---|---|
| Frozen input cases | 36: 18 river, 18 turn |
| Distinct hand/runout outcomes independently checked | 3,780; both players' hand scores and every outcome agree |
| Weighted total across cases | 7,520; not extra distinct runouts or random trials |
| Blocked range rows removed | 24 |
| Complete data download | 32,591 bytes; limit 204,800 |
| Focused old + new drill tests | 68 passed, zero skips |
| Typecheck / lint / production build | pass in isolated candidate |
| Three-engine drill checks | 48 passed, zero skips/retries, 24.0 seconds; 24 new D2 + 24 D1 |
| Visual checks | 320/390/1280 CSS px and 200% CSS zoom; inspected narrow and desktop screenshots |
| Existing D1 dataset | unchanged; independent grade/byte reproduction passes |

D2 dataset SHA-256:
`1702f32ea735ddf13eb7f3eb244888309f11bbf7da861f41442435dacd594d48`.
Physical phones and native browser zoom for these drills are unmeasured. No new timings
are claimed for the old solver corpora. Candidate logs: `build/drill-expansion-2026-11-21/D2-candidate-logs/`.

Fail-first evidence: missing implementation modules, out-of-range numeric grading and
async dispatch; absent deployed UI; and abbreviated blocker names in the visible explanation
cell. The latter assertion initially matched hidden card labels, so it was narrowed to the
explanation cell before observing the intended failure and fixing the copy. A unit-only
analytic tie fixture incorrectly put the fourth ace in the hero's hand; the corrected fixture
puts all four aces on the board so equal king kickers actually split. **No frozen input changed.**

A same-length modified download still passes schema and case-index validation but fails
SHA-256. Bypassing only that check makes the test fail; the original loader was restored
byte for byte. Independent reference code imports the slow best-five evaluator, with its
own deck, card conversion, blocker checks and accumulation; no fast evaluation or enumeration
helper is shared. Order, suit permutation, weight scaling and half-ties have explicit checks.

Commands:

```sh
npm run audit:drills:equity-range
npm run audit:drills:push-fold
node --import tsx --test test/drills-*.test.ts
npm run typecheck
npm run lint
npm run build
CI=1 npx playwright test --config playwright.drills.config.ts --retries=0
```

Owned files: new equity-range modules/manifest/data, frozen inputs, reference/generator,
unit/e2e tests, shared card rendering extracted without behavior changes, drill UI/CSS,
minimal registry/type/grade/storage integration, package/CI commands, records/spec checkboxes,
and only the README equity-drill paragraphs. Explicit staging list is retained locally as
`build/drill-expansion-2026-11-21/D2-owned-files.json`. No solver, `/play`, trainer or paused
configurable-flop edits belong to D2. Hand review is next, under a separate contract.

## Verified release — 2026-11-21

Code commit: `0851bedf330c651d41da86d60a3504b8f02421c8` (29 explicit files; README
hunks only). All eight jobs passed in [CI 44962474667](https://github.com/katswnt/poker-face/actions/runs/44962474667),
observed green at `2026-11-21T23:56:11.659Z` before deployment.

The exact clean checkout with **copied** node_modules passed fresh native and WASM builds,
23 Rust tests, **1,122/1,122 unit tests** (zero skips, 135.582 seconds), typecheck, lint,
and 17 audits: both drill datasets, equity matrix, native bridge, WASM parity/example,
river v3, play library/P1/P2/P3/P4/P5/E1, preflop reproduction, wide-range and gadget study.
All prior numerical gates and frozen solver inputs remain unchanged. The guarded production
build and **112 full-app browser tests** passed. Dedicated three-engine checks: **48 drills**
(24.5 seconds), 28 play / 2 existing non-Chromium real-zoom skips, and 34 live-solver /
2 equivalent skips. Zero retries; the new drill has no skipped tests.

Pinned Vercel 62.1.0 production deployment:
`dpl_FC5Bpfggh9XYcXrsKs1WgMiqaa6x`, immutable URL
<https://poker-face-qkiij48nd-kat-swints-projects.vercel.app>, serving
<https://pokerface.katswint.com/drills?drill=equity-range>.

- Build hash: `b1838716556824d76f0f720d7874c96014034b4e90e3c0de97da6e4c5fc30219`.
- Engine source: `f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981` (unchanged).
- Corresponding source archive: `e6431505969ef8a1bae892fd27bb7a8e3b92757fdb66cde1e8ca63e50adca6e8` (4,808,708 bytes).

Public checks fetched and matched all six engine/source assets, verified both engine pages'
source links, and matched all **38 drill files** (1,795,879 bytes including unchanged D1 data).
Deployed browser checks: **76 passed, 2 existing non-Chromium real-zoom skips**, zero retries,
2.4 minutes. All 48 drill checks pass across Chromium, Firefox and WebKit. Exact logs and
public proofs are retained under `build/drill-expansion-2026-11-21/`.

The production app is the tested code commit above. Subsequent closing-document commits
record the observations; they do not replace the deployed build or its source identity.
Physical-phone checks remain open and nonblocking by Kat's instruction. Hand review follows
under its own prospective contract; PF4 remains gated.
