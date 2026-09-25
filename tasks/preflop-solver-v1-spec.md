# Preflop solver v1: spec (draft for review, 2026-09-25)

Goal: replace the hand-written BTN-open / BB-call ranges behind the B4 flop library
(`LIBRARY_PROVENANCE.ranges`, `fixtures.ts`) with ranges from **our own simplified preflop
model**: CFR+ on a small BTN-vs-BB preflop betting tree, with flop-reaching terminals valued by
equity × realization factor R, and R **measured from our own saved postflop solves**. Source:
option F of `tasks/preflop-ranges-research.md`. This is a model, not a full-game equilibrium.

Reused, already audited: `equity-matrix.json` (exact 169×169, all C(48,5) boards, card-disjoint
measure), `comboCounts.ts` (`DISJOINT`, `ORDERED_DISJOINT_PAIRS`), `pushfold.ts` +
`pushfold-solutions.json` (the PF1 oracle), `toy/game.ts` + `toy/best-response.ts` (grader
cross-check), the bridge contract hashing pattern (`contract-node.ts`).

## 1. Game definition

**Decision: 6-max BTN vs BB with the SB folded (dead 0.5), plus a heads-up structure used only
for the PF1 oracle.** Justification:
- The B4 library is 6-max BTN vs BB SRP: starting pot 5.5bb = 2.5 + 2.5 + dead 0.5, stacks
  97.5bb behind (`SRP_STARTING_POT`, `SRP_EFFECTIVE_STACK`). R measured from it only means
  something in the same formation, so the main game must reproduce that pot exactly.
- True HU (BTN = SB posts 0.5 and folding costs it) is a different game with different ranges;
  it is what `pushfold.ts` solves, so we keep it as a config variant to prove the engine
  reproduces the push/fold charts (PF1).

Structures (one engine, config-driven):

| Field | `6max-btn-bb` (main) | `hu` (PF1 oracle) |
|---|---|---|
| Posted by P0 (BTN, acts first preflop, IP postflop) | 0 | 0.5 (SB) |
| Posted by P1 (BB, OOP postflop) | 1.0 | 1.0 |
| Dead money in pot | 0.5 (SB folded) | 0 |
| Effective stack | 100bb (config) | S ∈ pushfold depths |
| Ante | none | none |
| Rake | `{ pct, capBb, noFlopNoDrop: true }`, **v1 default 0** | 0 |

Deal: P0 class h, P1 class k with probability `DISJOINT[h][k] / ORDERED_DISJOINT_PAIRS`.
Documented model limits: card removal from the four folded players is ignored; the SB always
folds (no SB cold-call/squeeze); strategies are per canonical class, not per suited combo.
Utility: chip EV in bb, net from hand start. With dead money the game is **constant-sum**
(net totals +0.5 every hand), which is strategically equivalent to zero-sum; with rake > 0 it is
general-sum (CFR+ has no guarantee there; see Risks), so rake stays a stub in v1.

## 2. Action abstraction (v1 menu, all sizes are "raise to", configurable)

```
BTN root:           fold | open 2.5                       (limp: off, flag `allowLimp`; open-jam: off)
BB vs open:         fold | call → SRP flop (pot 5.5)  | 3-bet 11 | jam 100
BTN vs 3-bet:       fold | call → 3BP flop (pot 22.5) | 4-bet 24 | jam 100
BB vs 4-bet:        fold | call → 4BP flop (pot 48.5) | jam 100
Any player vs jam:  fold | call → all-in showdown (pot 200.5)
```
~7 public decision nodes × 169 classes. No limp in v1: BTN limping is rare in published 100bb
6-max strategies and it adds a limped-pot type with no library behind it. `allowLimp` adds
BTN limp → BB check (limped flop, pot 2.5) | raise 4 for a later version. The tree builder
validates that every size is in (previous bet, stack] and that pots and stacks close exactly.

## 3. Terminal valuation

- **Fold:** exact. The folder loses what they put in; the other player wins the pot.
- **All-in called:** exact. `share_P0(h,k) = eq(h,k)` from the matrix (R = 1 by definition),
  weighted by `DISJOINT` for card removal. No approximation beyond class-level strategies.
- **See flop (SRP/3BP/4BP):** pot P, remaining stacks irrelevant beyond pot type. Zero-sum,
  bounded, per-matchup form:
  ```
  a = eq(h,k)·R_IP(t,h),  b = (1 − eq(h,k))·R_OOP(t,k)
  share_IP(h,k) = a / (a + b),   share_OOP = 1 − share_IP      (t = pot type)
  ```
  This keeps shares in [0,1] and sums to the pot (unlike the naive `pot·eq·R` for both players,
  which neither conserves the pot nor stays below it). R is a lookup `R[position][potType][class]`.
- **Rake (stub):** when enabled, subtract `min(pct·P, capBb)` from flop and all-in pots
  (no flop, no drop). Library solves are rake 0, so measured R stays rake-free.

### 3.1 Defaults before the library exists (literature ballpark, flat across classes)

| Pot type | R_IP (BTN) | R_OOP (BB) | Note |
|---|---|---|---|
| SRP | 1.05 | 0.85 | IP > 1, OOP < 1 is the standard finding (research §3) |
| 3BP | 1.00 | 0.90 | lower SPR (≈3.4) compresses realization |
| 4BP | 1.00 | 1.00 | SPR ≈ 1.1: close to all-in |

Table is data (`realization-defaults.json`) with its own hash, recorded in every result.

### 3.2 Estimating R from the library (PF3)

Interface needed from B4 (abstract; the manifest format may still change). A
`RealizationSample` per library spot:
```
{ spotHash, potType: "srp", startingPot, rangeProvenanceHash, exploitabilityPctPot,
  flop: [c,c,c], flopWeight,               // stratum weight: see below
  perCombo[player]: { weight, rootEv, rootEquity } }   // flop root, full precision, not quantized
```
`rootEv` uses the bridge convention (net, excluding `startingPot`), so the pot share is
`s = (rootEv + P/2) / P`. `rootEquity` is all-in equity vs the opponent's flop-root range.
If the published chunks only carry quantized EV (0.001bb) that is acceptable; reach-rounded
omissions must be reported, not silently dropped.

**Flop weights.** The 12 library flops are a texture sample, not random. Each of the 1,755
canonical flops (× suit multiplicity = 22,100) is assigned to one library flop by a
deterministic texture classifier (`classifyFlopTexture`, checked in, tested); `flopWeight` =
fraction of flops in that stratum. Per combo, flops that collide with its cards are skipped
and weights renormalized.

**Estimator (per player p, class c, pot type t), ratio of weighted means:**
```
S̄(c) = Σ_f w_f Σ_{x∈c} r_x s_x / Σ_f w_f Σ_{x∈c} r_x      (r_x = combo's range weight)
Ē(c) = same with rootEquity
R̂(c) = S̄(c) / Ē(c)
```
The ratio cancels flop luck (a hand that hits has both high EV and high equity). Report
`Ē(c)` next to the exact matrix equity vs the same range as a sampling diagnostic.

**Shrinkage.** Effective sample `n_c = (Σ_f w_f Σ r_x)² / Σ_f (w_f Σ r_x)²`-style Kish size.
`R(c) = (n_c·R̂(c) + κ·R̂(bucket(c))) / (n_c + κ)`, with buckets {pairs, suited Ax, suited
broadway, suited connectors/gappers, other suited, offsuit broadway, offsuit Ax, other offsuit}
and κ = 4 (config). Classes with no library reach (outside the library range) take the bucket
value; buckets with none take the default. Clamp R to [0.3, 1.6] and report every clamp.

**Fit step.** Because the terminal form normalizes per matchup, raw R̂ does not exactly
reproduce measured shares. Iterate `R ← R · S̄_measured / S̄_model` (model shares computed on
the library's own ranges) until max per-class share error < 0.005 or 50 steps. Test asserts it.

3BP/4BP: keep defaults until a library exists for them; the result records which cells were
measured and which were defaulted.

### 3.3 Sensitivity analysis (reported with every published solve)

Sweep R_OOP(SRP) ∈ {0.70, 0.80, 0.85, 0.90, 1.00}, R_IP(SRP) ∈ {0.95, 1.05, 1.15}, one-at-a-time
bucket ±0.1, and 3BP/4BP defaults ±0.1. Report BTN open %, BB defend % (call + 3-bet), BB 3-bet %,
BTN 4-bet %, and range L1 distance vs baseline. Checked in as a table, not tuned against.

## 4. Solver

- Vector-form CFR+ over the public tree: per node, per-class regret vectors; opponent reach
  vectors; terminal values as `DISJOINT ⊙ payoff` matrix-vector products (O(169²) per terminal).
  Alternating updates, regret floor at 0, linear averaging (weight t) with a short delay (d = 0
  by default, configurable). DCFR (α=1.5, β=0, γ=2) behind a flag for comparison.
- Stop: exploitability ≤ **0.001 bb/hand** (1 mbb; push/fold reaches 5e-5) checked every 100
  iterations, hard cap 100k iterations; not converged ⇒ result marked failed, not published.
- Deterministic (no sampling): same config hash ⇒ byte-identical result JSON.
- Files: `src/lib/solver/preflop/{contract,tree,terminal,realization,cfr,grader}.ts`,
  `scripts/solve-preflop.ts`, results in `src/lib/solver/preflop/artifacts/`.

## 5. Independent grader

- `grader.ts`: exact best response for each player by backward induction on the same public tree
  over 169 classes, with its own traversal (does not import `cfr.ts`). Shares only
  `terminal.ts` (the rules) and the contract. Exploitability = (gain_P0 + gain_P1)/2 in bb/hand;
  also report per-player gains and game value.
- Cross-check 1: build the same game as a `toy/game.ts` `ExtensiveFormGame` on a reduced class
  set (e.g. 13 pairs + 7 suited aces, with `DISJOINT` chance weights) and require
  `toy/best-response.ts` values = `grader.ts` values within 1e-9.
- Cross-check 2 (PF1): grade our HU jam/fold strategies with `pushfold.ts`'s own
  `sbBestResponse`/`bbBestResponse`/`sbPayoff`.
- Terminal rules are tested by hand-computed cases (fold payoffs, pot closure, R = 1 ⇒ share = eq,
  share ∈ [0,1], zero/constant-sum).

## 6. Validation targets (published aggregates, research §3; secondary sources)

| Metric | Published band | Our expectation / model difference |
|---|---|---|
| BTN RFI % | ~43% (2.5bb, raked, SB can 3-bet) | Wider: our SB always folds and rake = 0. Flag if outside 38–65%. |
| BB defend vs 2.5x (call + 3-bet) | ~52–58% raked; wider no rake | Research band 55–70% for no rake. Flag outside it. |
| BB defend lower bound | MDF-style ≥ 37.5% | Hard test (must hold). |
| BB 3-bet % vs BTN | no citable figure found in research | Report only; add a target when a cited source exists. |
| Rake direction | more rake ⇒ tighter preflop | When rake stub is on: BTN open % and BB defend % must not widen. |

Structural checks (`npm test`): frequencies in [0,1] and sum to 1; AA/KK never fold at any
node; open range roughly monotone in hand strength within buckets (report violations);
reproducible from config hash. Targets are sanity bands: **R is never tuned to hit them.**

## 7. Iteration loop (ranges → library → R → ranges)

```
ranges_0 = hand-written (current) → library_0 (B4) → R_1 → solve → ranges_1
ranges_1 → library_1 (regenerate 12 flops) → R_2 → solve → ranges_2 ...
```
- Library input for round n: BTN range = open frequency, BB range = call frequency (the SRP
  reach), expanded class → combos, provenance
  `"poker-face preflop CFR+ v1, 6-max BTN vs BB (SB folded), R=<table hash>, no rake, config <hash>"`.
- Damping: `R_{n+1} = ½·R_new + ½·R_n`.
- Stop when both hold: combo-weighted L1 change in BTN-open and BB-call ranges < 2% of 1,326
  combos, and max |ΔR| over buckets < 0.02. Hard stop after 3 library rounds (each is ~1 hour of
  CPU); if not met, publish the last round labelled "not converged after 3 rounds" with the
  deltas, or keep hand-written ranges (Kat decides).
- Each round's R table, ranges and library hashes are checked in so the chain is auditable.

## 8. Honesty and README wording

- Always "simplified preflop model"; **never "GTO preflop"** or "solved preflop" alone.
- README (after PF4): "Preflop ranges come from our own simplified preflop solve: CFR+ on a
  BTN-vs-BB preflop tree (SB assumed folded), flop play modelled by equity × realization factor
  R measured from our saved postflop solves. No ante, no rake. A model, not a full-game
  equilibrium. Matches published aggregates within <bands> (sources linked)." Link this spec.
- Until PF4 ships, keep the current hand-written label unchanged. Never cite a commercial
  product as a source; aggregates only, as validation. Keep README and code in sync (tests in
  `test/copy.test.ts` pattern for the provenance string).

## 9. Milestones

### PF0 — contract
- [ ] `PreflopSpotV1` (structure, blinds, dead money, stack, rake, menu, R table ref, solver
      options) + `PreflopResultV1` (per-node per-class strategy, EV, exploitability curve,
      grader output, measured-vs-default R cells, provenance); strict validation, sha256 hash.
- [ ] Tree builder with pot/stack closure checks; terminal rules module + hand-computed tests.

### PF1 — all-in-only sanity (push/fold as a special case)
- [ ] `hu` structure, menu {fold, jam} / {fold, call}, every depth in `pushfold-solutions.json`.
- [ ] Game value within 1e-4 bb of pushfold's; pushfold's own BR functions give nash gap ≤ 5e-4;
      shove % and call % within 0.5 points; per-class freq equal except documented threshold hands.
- [ ] Changing any R leaves PF1 output bit-identical (no flop terminals).

### PF2 — full action abstraction with default R
- [ ] 6-max menu of §2, default R; exploitability ≤ 1 mbb/hand; both grader cross-checks pass.
- [ ] Validation table + sensitivity table generated and checked in.

### PF3 — R from the library
- [ ] `RealizationSample` adapter over B4 output; texture classifier + flop weights (sum to 1).
- [ ] Estimator, shrinkage, fit step; re-solve; diff vs PF2 ranges reported.

### PF4 — feed ranges to the next library
- [ ] Emit library ranges + provenance; run the §7 loop to its stop rule; update
      `LIBRARY_PROVENANCE`, README, METHODOLOGY in the same change.

## 10. Tests (all in `npm test`, none need the native bridge)

- `preflop-pushfold-equivalence`: PF1 at every saved depth (the regression anchor).
- `preflop-terminal-rules`: fold/all-in/flop payoffs by hand; share bounds; constant-sum;
  R = 1 everywhere with SRP/3BP/4BP ⇒ flop share = equity.
- `preflop-grader-crosscheck`: `grader.ts` vs `toy/best-response.ts` on the reduced game.
- `preflop-convergence`: saved PF2 result re-graded ≤ 1 mbb/hand; re-solve reproduces hash
  (short-iteration version in CI, full in `audit:preflop`).
- `preflop-realization`: estimator on a synthetic library where true R is known (built from
  the terminal model itself) recovers it within 0.01; shrinkage pulls low-n classes to bucket.
- `preflop-validation`: MDF bound, AA/KK never fold, weights in [0,1], sums = 1.

## 11. Risks

- **R depends on the opponent's range and the postflop tree.** The library's lean tree (few bet
  sizes) and its input ranges shape measured R; the loop reduces but does not remove this.
- **12 texture-picked flops** give noisy per-class R; mitigated by the ratio estimator,
  stratum weights, shrinkage, and published diagnostics. Classifier choice is a modelling input.
- **SB always folds, no multiway, no folded-player card removal:** BTN opens wider than real
  6-max; stated in README, not hidden.
- **Only SRP is measured;** 3BP/4BP R are assumptions until those libraries exist.
- **Rake makes the game general-sum;** CFR+ convergence is not guaranteed; v1 keeps rake = 0.
- **Loop may oscillate** (range ↔ R feedback): damping + 3-round cap + honest labelling.
- **Class-level strategies** hide suit-specific play (e.g. which A5s combos to 3-bet).
- **Temptation to tune R to published aggregates:** forbidden; targets only flag, never fit.
