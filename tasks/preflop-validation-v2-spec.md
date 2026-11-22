# Preflop continuation validation v2 — prospective contract

Written 2026-11-22 at `16f6460`, before new continuation observations, fitting or model
changes. This is CPU roadmap step 10; execution follows
[the completion plan](cpu-ceiling-completion-plan.md). The v1 diagnosis and every v1
artifact remain unchanged. This contract does not approve any production range.

## Question and accounting

Can a fixed, explicitly approximate continuation model predict **original from-now chip
values** closely enough to support its preflop decisions, across unseen boards and ranges?
Convergence of CFR on that model answers a different question. No target involves an
aggregate open/defence percentage, a familiar chart shape, or a commercial strategy.

At a continuation root let `P` be the existing pot, `S` each player's remaining stack,
and `c_i` player i's already-paid preflop contribution. A terminal has future contributions
`x_i` and gross receipt `r_i`. Define `G_i = r_i - x_i`: value from now, **including**
the existing pot. Then `G_0 + G_1 = P`, `-S <= G_i <= P + S`, and full-hand utility is
`G_i - c_i`. With dead money `d`, full-hand utilities sum to `d`. Fold, call, split,
all-in and returned uncalled chips must satisfy these identities. `G_i/P` is not a
probability and may exceed one or be negative.

Bridge order is OOP/IP; preflop-v1 order is IP/OOP. Its root `ev` is zero-sum relative
to an equal share of the starting pot: **`G_i = root.ev_i + P/2`**. Use 100 chips/bb.
Tests must exercise the player permutation and origins explicitly, including dead money.
Do not add independent `equity * R` payouts or repair totals by shifting targets.

## Frozen population, corpus and selection

The machine-readable manifest in `src/lib/solver/preflop-v2/` is authoritative. Generate
it once from the selection rules below, check its bytes/hash into the step-10 commit,
and regenerate byte-for-byte in the audit. No solver values enter the selection process.

- Standard 52-card deck; unordered two-card hands and three-card flops. Enumerate all
  **22,100** physical flops and their complete suit-permutation orbits. Reuse the v1
  twelve-stratum texture definition as a frozen modelling input; record its source hash.
- Both range profiles assign positive class-constant weights to **all 169 classes**, and
  expand each class to all its physical combinations. This includes the previously
  unmeasured weak and premium hands. No class borrowing, pruning or silent omission.
  Weights are dyadic numbers exactly representable in float32.
- Profile A (calibration): OOP weight 1 for every class; IP weight 1 for pairs, ace-high
  hands and two broadway ranks (T or higher), otherwise 1/2.
- Profile B (range holdout): OOP weight 1 for pairs, suited hands or two broadway ranks,
  otherwise 1/2; IP weight 1 for pairs or suited ace-high hands, otherwise 1/4.
  These are hand-written stress distributions, not proposed playing ranges.
- Identify the twelve B4 flop orbits as legacy anchors. Exclude them from new board
  selection; they are never called held out. Their fresh values must use these exact
  new ranges and settings, not the old B4 measurements.
- Sort each stratum's eligible orbit keys canonically. Draw six without replacement
  with Node `crypto.randomInt` before any outcomes exist; save every bounded draw index
  in a separate immutable selection transcript. Replay those indices against the sorted
  population to reproduce the manifest exactly. First three draws are calibration; next
  three are board holdout. This freezes **36 + 36** new boards, plus 12 legacy anchors.
  Do not redraw after seeing the cards or measurements. Require disjoint orbit identities,
  not merely different spellings of suit-equivalent boards. Store each orbit's physical
  multiplicity and the stratum's eligible-orbit/physical-flop counts. The random draws
  are frozen inputs; the audit replays them, it does not request fresh randomness.
- Pot types, all at 100bb starting stacks with 0.5bb dead money: SRP contributions
  2.5bb each / pot 5.5bb / 97.5bb behind; 3BP 11 / 22.5 / 89; 4BP 24 / 48.5 / 76.
  Same frozen `LEAN_SRP_TREE` as B3/B4, float32, no rake. Record its canonical hash.
  This is **504** required native root observations: 84 boards × 3 pot types × 2 profiles.
  Filter board-blocked combinations explicitly before constructing a bridge spot, keeping
  their removal counts. Never renormalize away unobserved classes/boards.
- Fit uses only profile A legacy/calibration observations. Freeze the resulting candidate
  hash before measuring or reading profile B or board-holdout values. All B observations
  are range tests; the B board-holdout intersection tests both changes. A later candidate
  revision requires a new held-out contract/version; do not reuse this test set for tuning.

Suit orbit reduction is valid here only because complete class-constant ranges and the
rules are suit symmetric. The executable contract must reject using these weights for
arbitrary suit-asymmetric input ranges. Physical-flop multiplicities are not probabilities
conditional on a private hand; the joint measure below still applies.

## Joint chance measure and an additive control variate

For compatible private hands `(h,k)`, prior mass is `w_0(h) w_1(k) / Z`, where `Z` is
the sum over compatible ordered pairs. Given both hands, every legal unordered flop has
probability **`1 / C(48,3) = 1/17,296`**. Thus

`Pr(h,k,B) = w_0(h) w_1(k) 1[all cards distinct] / (Z * 17,296)`.

For a fixed hand, condition using its compatible opponent mass before the flop. A board
changes that mass. Uniform boards followed by independently normalized surviving ranges
are not this measure. Normalizing each hand over the few selected representatives is
not this measure either. Verify both conditioning orders by exhaustive tiny-deck sums.

For a class-conditional quantity, a suit-orbit representative's contribution is multiplied
by the orbit's physical size. For an explicitly known orbit use inclusion probability 1;
for a uniform sample of `n` eligible orbits in a stratum of size `N`, use `pi=n/N`.
Inverse-inclusion weighting must apply to **unnormalized joint numerators**, with the
known full-population denominator. No self-normalization over sampled boards.

An optional variance reduction is fixed prospectively: write
`G_i(B) = P * equity_i(B) + T_i(B)` and estimate only the future-betting transfer `T`.
The unconditional equity expectation is available from the existing exact-enumeration
matrix (with its fixed rounding error recorded). Add the inverse-inclusion estimate of
`T` to that known baseline. Jointly weighted `T_0 + T_1 = 0` on every board, so this
preserves constant-sum accounting without moving observed targets. This is an additive
control variate, not the v1 ratio estimator or a claim that board-selection error cancels.

Calibration estimates combine measured legacy anchors with the new calibration sample
weighted over the nonlegacy population. For validation, anchors and calibration orbits
are now known; board holdouts sample the remaining population with its **updated** counts.
For profile B, those known-orbit observations are still measured only after the candidate
is frozen. Report held-out residuals separately from these full-population estimates.
Do not call shared known terms independent test observations.

## Candidate and tiny references (step 11, not production)

First implement an immutable pairwise continuation-payoff table with the accounting above.
Use exact tiny joint games to test conditioning, player order, optional future wagers,
uncalled returns and reduction to checkdown/all-in payoffs. The reference must use legal
information sets: actions may depend on own cards and public history, never the opponent's
actual cards. Independently enumerate fixed-profile values and best responses. Include a
case with `G > P`, a negative `G`, a split and a zero-transfer checkdown. No bridge value
or fitting routine may serve as both the implementation and its sole oracle.

One predeclared fitting candidate: for each pot type, an additive class-transfer table
`G_IP(h,k) = P * EQ(h,k) + a_h - b_k`, and `G_OOP = P - G_IP`. Fit the two marginal
sets by joint-mass-weighted least squares to **original**, unshifted calibration targets.
Use the minimum-norm solution with the weighted mean of `b` fixed to zero; record rank,
conditioning and residuals. No target pinning, clipping, inferred missing values, or
defence-rate feedback. If the inferred table violates physical payoff bounds, fail it.

Marginal observations do not identify the true pairwise payoffs. This additive family is
an explicit approximation to test, not a mathematical reconstruction theorem. Only the
exact tiny-game representation/scorekeeping checks are exact; a passed fit is not exact GTO.
Keep the old bounded-share formula as a labelled control, never select a model by the test
set. No online outer range/leaf-value loop is authorized by this fixed-game experiment.

## Frozen budgets and acceptance

Budgets are conservative execution limits chosen before measurements, not measured
performance claims. Use native estimates for **all 504** roots before any large solve.

- One heavy solve at a time; at most 8 native threads; float32 only. Per-root estimated
  allocation plus export reservation ≤12 GiB; sampled RSS hard stop 16 GiB. Per-root
  wall time ≤600 s, ≤5,000 iterations, ≤4 hours total native solve wall time for the corpus.
  Keep raw evidence/reproduction records ≤1 GiB. A required refusal/time-out or incomplete
  corpus is a failed coverage gate, not permission to replace a board/range or use int16.
- Native reference target: reported exploitability ≤0.001% of the subgame pot. Report it
  in chips and pot units. It bounds whole-game deviation only, **not per-hand value error**.
  Repeat the frozen tiny native/referee reductions at the existing 0.0002-chip tolerance;
  any disagreement stops the dependent experiment. Large root values remain explicitly
  external-engine observations, not independently certified full-game values.
- Exact-measure/accounting reductions: absolute discrepancy ≤1e-10 on the frozen tiny
  games (chip scale ≤100). Normalization, compatible-card support and full-hand constant
  sum must agree with a separate direct enumeration. Deliberately wrong independent
  board sampling, wrong origins, per-hand self-normalization and opponent-card-dependent
  policies must fail the corresponding tests.
- Report every class/pot/profile: original predicted/observed from-now EV, difference in
  bb, observed mass, coverage and sampling uncertainty. Report both maximum error and
  joint-mass-weighted mean absolute error, without dropping zero or inconvenient values.
  Empirical held-out targets: maximum absolute class error ≤0.01bb and weighted mean
  absolute error ≤0.002bb for **each** pot/profile test group. These are model acceptance
  tolerances, not claimed confidence bounds or per-hand exploitability thresholds.
- Show uncertainty separately. Stratified sample variance is an estimate, not a guaranteed
  interval. Where rigorous finite-population bounds are used, use the physical payoff
  bounds and the actual selection design; do not manufacture precision from Kish size.
  A candidate preflop action may not be promoted unless its total payoff uncertainty is
  below half its best-versus-runner-up action-value margin. Missing or insufficiently
  bounded uncertainty means **unvalidated**, even if empirical residual targets pass.
- PF4 needs **all** coverage, reference, structural, held-out and decision-uncertainty
  gates. An uncertain/tied decision must be treated as such, never converted to confident
  advice. Failure keeps all production hand-written ranges and their labels unchanged.
  Passing only a restricted tiny game or the numerical solver does not satisfy PF4.

If any necessary large-corpus admission gate fails, finish the independent tiny/reference
work, record all estimates and stop the large-fit branch. Continue only with independent
roadmap work. Do not spend the four-hour solve budget on a corpus already known to be
incomplete. If the corpus fits, exhaust the predeclared experiment before concluding failure.

## Step-10 release gates and ownership

- [x] Freeze the manifest, settings, selection/source hashes and original contract text
  before observations; require exactly 504 roots and all declared texture/range coverage.
- [x] Fail-first tests and an audit for corpus identity, disjoint suit-orbit holdouts,
  range symmetry/coverage, invalid inputs, exact tiny joint measure and chip accounting.
- [x] Verify old preflop artifacts/diagnosis and deployed game data remain unchanged.
- [x] Exact isolated commit, copied dependencies: full unit suite, tsc, lint, new contract
  audit and relevant old solver audits; explicit files/README hunks; push and all CI green.

Step 10 owns validation/manifest/measure helpers under `src/lib/solver/preflop-v2/`,
`test/preflop-v2-contract.test.ts`, `scripts/audit-preflop-v2-contract.ts`, package/CI
audit wiring and the completion-plan documentation paths. It owns no v1 solver or native
engine changes. The fitting model, fresh observations and tiny strategic solver are step 11;
declare their files and exact tiny fixtures before implementing them.

## Execution record

The immutable original contract is `src/lib/solver/preflop-v2/frozen-contract.md`;
its SHA-256 is `cab23a48a48c8c1d70db6b3afbb88611a768f718afbb15389c24c6678822a471`.
The sampling text was corrected **before any draw or outcome** from deterministic hash
ranking to one-time uniform draws with a saved transcript. This avoids calling a fixed
ranking a probability sample. No draws have been replaced.

`selection.json` replay hash: `21f1d3f87025c1539db4825ac6bf7e7668d0a7f74856614bc989376203d8eef9`.
`manifest.json` payload hash: `01fb5ca7cdb6532be5f2c81191c2fd7835d2b942255294f9c0a26a4daf10a313`;
file hash: `5b0b4ac3b13872cc897a0b2daa8f524747c212494563094e03515d22e8a44826`.

Measured input coverage: 22,100 physical flops, 1,755 complete suit orbits, 12 legacy
anchors + 36 calibration + 36 held-out boards; 504 distinct spot hashes. Every profile
starts with 1,326 physical hands/player in 169 classes. Every flop explicitly removes
150 blocked hands/player, leaving 1,176; some class/board combinations can have zero
legal mass, which future reports must retain and identify rather than impute.

Nine focused tests pass. Their initial run failed because the new implementation did
not exist; the intermediate run still failed until the immutable selection/manifest was
created. Independent ordered six-card deals on an eight-card deck verify both conditioning
orders. Tests also verify suit reduction only for class-conditional symmetric ranges,
inverse-inclusion totals over every possible tiny sample, negative/greater-than-pot
values, refunds, splits, player order, dead money and deliberate invalid inputs. The
strategic hidden-card and exact joint-game tests are step 11, not claimed here.

The unchanged native referee audit exposed a 0.000005-chip zero-sum rounding residual.
A separate failing-then-passing boundary test now requires exact references to retain
1e-10 accounting tolerance, while float32 callers must explicitly request at most the
existing 0.0002-chip B2 bound. Mapping reverses player order and adds P/2 without shifting
values; the raw residual is preserved for reporting. No corpus input, gate or observation
was changed. This corrects an adapter that initially required exact arithmetic from
already-audited finite-precision engine output.

Commands: `node --import tsx --test test/preflop-v2-contract.test.ts`,
`npm run audit:preflop:v2:contract`, `npm run --silent diagnose:preflop`.
The diagnosis still has SHA-256
`d95b71e978f0c98650fe4583182d8ed99a2406060d0065a51b94590e96cc508d`.
The one-time `--freeze` command refuses existing inputs; ordinary audits replay the
saved selection and reproduce the canonical manifest bytes without new randomness.

No continuation-corpus solve, fitted model, performance measurement, validation pass or range promotion
is asserted. Release `912616aef21b34bdbdfec3aaffa455e7f1705b8c` is on `origin/main`.
Exact isolated checkout with copied dependencies: 1,142/1,142 tests, zero skips
(138,016.525584 ms), typecheck, lint, 20 relevant audits, diagnosis reproduction and
production build passed. All eight jobs in [CI 45065228344](https://github.com/katswnt/poker-face/actions/runs/45065228344)
passed before starting step 11. CI included 23 Rust tests and three-browser checks:
34 live-solver checks, 48 drill checks and 55 play/review checks; the existing browser
zoom skips remain. The copied dependency root was a real directory; its internal `.bin`
links were preserved after correcting an initial copy setup error. No compiler exclusion
or gate was changed. Protected file hashes and the trainer README patch were unchanged.
The public production descriptor was checked on November 22 and still matched H1;
this research-only release did not require deployment.
