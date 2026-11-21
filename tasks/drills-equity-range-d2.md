# D2: equity versus an explicit range

Started after D1 code `be05152` and closing record `ffbb82c` passed all eight CI jobs
([closing run 44957214650](https://github.com/katswnt/poker-face/actions/runs/44957214650)).
Status: candidate implemented and independently checked; exact-commit, CI and deployment gates pending.
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
- [ ] Exact commit with copied dependencies: full unit suite, tsc, lint, solver/artifact
  audits and production build; explicit milestone files and README hunks only.
- [ ] Push main; all eight CI jobs observed green before deployment.
- [ ] Fresh clean native/WASM rebuild, guarded Vercel deployment, public source/data hash
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

Exact-commit verification, hosted CI and deployment measurements will be recorded here
when observed; candidate success alone is not a release claim.
