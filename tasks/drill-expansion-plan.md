# Drill expansion: validation before teaching

Started 2026-11-21 from `747a293`. Execution order: D1 push/fold, D2 equity versus a
range, then a separately specified `/play` hand-review milestone. The original CPU
roadmap's working rules still apply. PF4 remains gated; neither drill consumes the
unvalidated preflop payoff model. No training or new solving in the browser.

## Architecture and tradeoffs

Extend `/drills`, its deterministic session, timer, review queue, and native controls.
Keep the seven fresh Mixed math generators and existing solver grading unchanged.
Due reviews continue to use the existing scheduler. New data loads only when selected;
the timer starts after validation. Loading failures are visible and retryable; removed
dataset versions are reported rather than replaced with a different question.

The original drill types are also in the frozen `/play` measurement dependency closure.
Add an explicit practice-type extension for the new question kinds; retain the existing
shared contracts and all play dependencies byte for byte. Re-run the existing source-bound
audits to prove that preservation. This is a module boundary, not an audit exemption.

Benefits: reuse verified math, deterministic replay, small downloads, no main-thread solve,
and a clear distinction between equity and betting value. Costs: saved approximate policies
have model limits; a small equity corpus has narrow coverage; practice is deliberately
sampled rather than a realistic deal distribution. Mitigate with visible assumptions,
source/version/hash identity, independent grading, exact counts for equity, explicit coverage,
and no claims of universal or exact GTO. A drill answer tolerance is never an engine error bar.

## Frozen D1 contract (before implementation)

Inputs are the existing 37 `pushfold-solutions.json` profiles at 2–20 bb in 0.5 bb steps,
the fixed six-decimal `equity-matrix.json`, and the canonical classes/card-removal counts.
Do not modify them. Two equal stacks **before** posting 0.5/1 bb blinds; no ante or rake.
Small blind acts first: fold or shove. Big blind faces the shove: fold or call. No limps,
smaller raises, other players, or later betting. This restriction is on the page.

For each of 169 hero classes, use compatible physical opponent hands. Let `S` be starting
stack, `D[h,k]` the ordered compatible-pair count, `E[h,k]` SB equity, `s[h]` shove frequency,
and `c[k]` call frequency. All action EVs below are **relative to folding now**, in bb;
posted blinds are sunk. They are not full-hand net profit.

- SB fold EV = 0. Shove EV = weighted average of `(1-c[k])*1.5 +
  c[k]*(2*S*E[h,k] - (S-0.5))`, using `D[h,k] / sum_k D[h,k]`.
- SB fold chance = compatible weighted average of `1-c[k]`. Equity if called is
  `sum_k D[h,k]*c[k]*E[h,k] / sum_k D[h,k]*c[k]` (null if no calls).
- BB fold EV = 0. Call EV = `2*S*equity - (S-1)`, where equity weights SB hands by
  `D[h,k]*s[h]`. Zero shove mass is unreachable and cannot be a question.
- BB call price = `S-1`, pot before call = `S+1`, final pot = `2*S`, required equity =
  `(S-1)/(2*S)`. Equity includes half of ties. Blockers affect every conditional range.
- Re-grade the actual serialized profiles. SB unilateral gain weights each local EV loss
  by `weight(h)/1326`; BB gain also weights the probability that SB shoves given BB's hand.
  Sum of the two gains must be **≤0.0005 bb for every depth**, the existing target.
  This is a whole-game measurement for the fixed rounded matrix, not a per-hand EV bound.
- A chosen action is correct when its loss versus the better action is **≤0.01 bb**
  (inclusive, floating slack 1e-9). Both actions may be accepted. Saved frequency does not
  override this rule. Show both action EVs/frequencies and the gap, rounded for display;
  grade unrounded values. Do not reuse the postflop 20%-frequency exemption.
- Seeded sampling: choose seat and depth uniformly, then an eligible hand class uniformly.
  Level 1 depths 2, 5, 10 bb with absolute action gap ≥0.25 bb; level 2 all 37 with gap
  ≥0.05 bb; level 3 all 37 and all reachable classes. Every seat/depth bucket must be nonempty.
  This is practice sampling, not the frequency of hands in real play. Target 20 seconds;
  never cut off an answer. Slow/missed answers use the existing review rules.
- Stable review identity: full dataset SHA-256 + exact half-bb depth + seat + hand index.
  Never clamp malformed depths, reinterpret old versions, or use a seed instead of the key.
- Generate one hash-verified chunk per depth, ≤200 KiB each and ≤8 MiB total. Pin the
  manifest in the source; include hashes of inputs, generator, and this frozen contract.
  The byte-for-byte regeneration audit must fail on changed inputs or data.

### D1 gates and release checklist

- [x] Fail-first tests: independent physical-combo recomputation of all 12,506 decisions
  and all 37 profile grades; analytic fold/call fixtures; blocker/normalization/EV-sign
  regressions; grade boundary and close decisions; deterministic generation/review.
- [x] Loader tests: hash/length/schema corruption, missing file, retry after failure,
  malformed/stale review keys. Session timer starts on resolution, stale/wrong responses
  cannot replace the active question; preserve old storage and drop only the selected review.
- [x] Byte reproduction, all quality gates, all sampling buckets, measured download sizes.
- [x] Browser: keyboard answer/Next/focus, loading/retry/stale switch, persisted review,
  correct explanation, 320/390/desktop layouts, 200% zoom, three engines, screenshots.
- [ ] Exact commit with copied dependencies: full unit suite (native/WASM tests available),
  typecheck, lint, relevant existing solver audits, new artifact audit, production build.
- [ ] Explicit owned files only (README hunks only), push main, all eight CI jobs green.
- [ ] Clean-checkout WASM rebuild and guarded Vercel deployment; deployed source archive,
  hashes, new drill and `/play` smoke checks verified. Record commit and measured results.

## Frozen D2 contract (before implementation)

After D1's release is green, add 36 explicitly hand-written cases, 12 per level, on turns
and rivers only. Freeze the exact cases before computing their answers. Each case has two
hero cards, four or five board cards, and up to 12 explicit opponent two-card combinations
with positive integer weights 1–10. No duplicate unordered opponent combination. Known
hero/board cards must be distinct. Remove blocked opponent combinations, show the removal,
then normalize remaining weights; reject an empty compatible range.

For each compatible opponent combination enumerate every remaining river (44 on a turn)
or the single completed board on a river. Equity is `sum(weight*(wins + ties/2)) /
sum(weight*runouts)`. Preserve integer wins/ties/losses per combination and a rational
weighted total. Report actual combination/runout outcomes separately from weighted totals.
Independent evaluator must agree on every outcome, not just rounded percentages. This is
exact enumeration for the specified cards and range; it does not predict future betting EV.

Learner sees the hero cards, board, and complete weighted range before answering. Numeric
guess accepted within ±2 percentage points, explicitly a practice tolerance, not sampling
uncertainty. Explain splits, blockers, and why different ranges change equity. No Monte
Carlo or hidden opponent-strategy claim. Level 1 simple river ranges, level 2 richer rivers
and simple turns, level 3 weighted ranges, blockers and turns. Seed chooses a case uniformly
within level. Versioned, hash-verified lazy data and review identity as in D1.

### D2 gates and release checklist

- [ ] Freeze 36 inputs and expected coverage before implementation/measurement.
- [ ] Fail-first evaluator/count, invalid input, blocker, half-tie, weight-scale,
  card/range-order and suit-permutation tests; independent verification of every outcome.
- [ ] Exact byte reproduction, all 36 cases, complete range display, ≤200 KiB total data.
- [ ] Same loader/session/storage, keyboard/three-engine/mobile/zoom and release gates as D1.
- [ ] Record exact commit, CI, deployment/source verification, numbers and limitations.

## Records

Read-only D1 feasibility check before this contract: all 37 rounded profiles passed the
existing 0.0005 bb gap target using the existing scorekeeper; maximum
0.000046464518110411746 bb at 18.5 bb. The new independent drill audit must reproduce it.
Implementation and release measurements belong below, outside the frozen contract sections.

Owned paths anticipated for D1: this plan, a D1 record, `src/lib/drills/practice-types.ts`,
new `src/lib/drills/push-fold/` and `public/drill-data/push-fold-v1/`, existing drill
generators/rng/session/scheduler/storage/grade/index, `/drills` components/CSS/metadata,
new drill tests/audit/build script/Playwright config, package scripts, CI audit step, and
only the README drill paragraph. No solver, `/play`, frozen evidence, trainer or global CSS edits.
