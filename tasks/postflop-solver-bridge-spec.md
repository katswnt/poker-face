# postflop-solver bridge — contract v1 spec and B0/B1 findings (2026-09-25)

Companion to `tasks/postflop-solver-bridge-plan.md`. Source of truth for the types is
`src/lib/solver/bridge/contract.ts`; the Rust side (`native/solver-bridge`) re-checks every
field it relies on. Engine: postflop-solver `9d1509fe5077d019825f833eed04b16d342dfda1`.

## Files

| Path | Role |
| --- | --- |
| `src/lib/solver/bridge/contract.ts` | Spot + Result contract v1 types, strict validation, explicit-tree builder, result check (browser-safe) |
| `src/lib/solver/bridge/contract-node.ts` | Canonical spot JSON and sha256 spot hash (node:crypto) |
| `src/lib/solver/bridge/fixtures.ts` | 3 referee spots, the lean benchmark (B3), the rich B1 draft, upstream-basic smoke spot, committed hashes; `LEAN_SRP_TREE`, `leanSrpSpot` |
| `native/solver-bridge/` | Rust crate, binary `solver-bridge` (`solve`, `estimate`), `Cargo.lock`, `rust-toolchain.toml` (1.98.1) |
| `scripts/bridge-runner.ts` | Node runner: child process, timeout, sampled RSS budget, cancellation, no partial results |
| `scripts/solve-bridge.ts` | `npm run solve:bridge -- --fixture <id> [--out result.json]` |
| `test/bridge-contract.test.ts`, `test/bridge-runner.test.ts` | Validation/hash/fixture tests; runner end-to-end (skips without the binary) |
| `native/solver-bridge/tests/bridge.rs` | Empirical engine-semantics tests (`npm run test:bridge`) |
| `src/lib/solver/bridge/referee.ts` | B2: lockstep tree-identity walk + policy adapter, self-reported value, gates, locked float32 tolerance |
| `src/lib/solver/bridge/referee-node.ts` | B2: referee engines (river v3, turn v2, flop reference) with their own graders and saved-artifact bounds; suit-isomorphism probe |
| `scripts/audit-bridge.ts` | `npm run audit:bridge` (gates) and `npm run audit:bridge -- --measure` (tolerance measurement) |
| `test/bridge-referee.test.ts` | Tree identity per referee game; corrupted trees/chance nodes/strategies/self-reports must fail (skips without the binary) |
| `native/solver-bridge/src/slices.rs` | B3/B4: `--slices` plan export (per-hand node detail, full subtrees for the referee) |
| `src/lib/solver/bridge/subgame-referee.ts` | B3: grade an exported river subgame with our factorized scorekeeper; subgame probability |
| `scripts/bench-bridge.ts` | `npm run bench:bridge [-- --experiment]` (local): B3 benchmark → `artifacts/benchmark-b3*.json` |
| `src/lib/solver/bridge/library/` | B4: model, encoder, browser loader, drill queries, invariant audit, flop/slice definitions |
| `scripts/build-bridge-library.ts` | `npm run generate:bridge:library` / `audit:bridge:library` (CI) / `reproduce:bridge:library` (local) |
| `test/bridge-library.test.ts` | Quantization, chunk validation, invariants, loader integrity, native slice export (skips without the binary) |

## Spot identity

`spotHash = sha256(canonicalSolverJson(validateBridgeSpot(spot)))` — sorted keys, no
whitespace, the same helper every other artifact hash uses. The runner writes exactly those
bytes to the spot file; the bridge hashes the bytes it reads, so `result.spotHash` must equal
the runner's hash (checked before a result is accepted).

## Unit mapping (verified empirically, `tests/bridge.rs`)

- **Players.** Player 0 = OOP (acts first every street) = postflop-solver player 0; player 1 = IP.
- **Chips.** Whole numbers everywhere; postflop-solver uses `i32`. `startingPot` = pot before
  the first postflop action; `effectiveStack` = chips each player still has behind. Contract
  limit 10^8 chips each. Stacks are equal by construction (postflop-solver has one effective
  stack); our referee games were chosen with equal stacks.
- **Bet/raise amounts are street totals.** Postflop-solver's `Bet(x)`, `Raise(x)` and
  `AllIn(x)` all mean "the actor's total contribution on this street becomes x" — exactly our
  `bet-to-x` / `raise-to-x`. Read from `BuildTreeInfo::create_next`
  (`stack[p] -= amount - prev_amount + to_call`) and confirmed: after `Bet(120)`, `Raise(300)`
  the per-street totals are `[120, 300]`; after `Bet(120)`-`Call` the next street restarts at 0
  and its all-in is `AllIn(780)` (= 900 − 120). The contract action is
  `{type: "bet"|"raise", to}`; `to` equal to the all-in total maps to `AllIn(to)` (postflop-solver
  converts `Bet(max)`/`Raise(max)` to `AllIn` itself). The export maps `AllIn` back to `bet`
  when not facing a bet and `raise` when facing one, and keeps the engine label
  (`engineAction: "AllIn(975)"`).
- **Minimum raise.** `to ≥ currentBet + (currentBet − actor's street total)` (i.e. at least the
  last increment again), or all-in. Heads-up with equal stacks this equals our engines'
  `lastFullRaise` rule. Minimum bet 1 chip. `add_line` rejects `Raise(239)` after `Bet(120)`.
- **Rounding (menu mode, upstream semantics).** Pot % sizes: `round(pot × pct/100)` where pot
  includes the pending call; a raise of X% pot is `prev + round(potAfterCall × X%)`; `prevBet`
  multiples round `prev × m`; results are clamped to `[min, all-in]`; a size leaving
  SPR-after-call ≤ `forceAllInThreshold` becomes all-in (e.g. the upstream 2.5x re-raise to 750
  becomes `AllIn(900)`); `mergingThreshold` merges close sizes PioSOLVER-style;
  `addAllInThreshold` adds all-in when max ≤ threshold × pot. `rake` must be 0.
- **Raise cap.** postflop-solver has no raise-count limit (it re-raises until all-in). The
  contract's `maxRaisesPerStreet` is a bridge extension: after building, every raise beyond the
  cap (including all-in raises) is removed with `ActionTree::remove_action`. Tested.
- **Explicit trees.** Built from an empty-menu `TreeConfig` (only check/call/fold), then edited
  top-down with `add_action`/`remove_action` until each node matches; a second pass must make no
  edits. Any node postflop-solver cannot represent fails loudly
  (`explicit tree cannot be represented at root/Check: ...`, or the engine's own
  `Invalid bet amount ...`). Chance nodes are implicit in postflop-solver and one `chance`
  node in the contract; an all-in call before the river is a `showdown` terminal in both.
- **Utility origin.** `result.root.ev` = net chips relative to the start of the spot (excluding
  `startingPot`), our referees' convention (hand-start utility minus equal prior
  contributions). postflop-solver's raw `expected_values()` is the pot share returned
  (`engineEv = ev + startingPot/2`): a sure winner of a 100-chip check-down has
  `engineEv = 100`, `ev = +50`.
- **Exploitability.** postflop-solver reports `(MES_ev0 + MES_ev1)/2` in chips = half the sum of
  both best-response gains, the same "half Nash gap" convention as our artifacts. Measured every
  10 iterations (as upstream), and once more after `finalize`.
- **Weights.** Per-combo weights in (0, 1], required to be exactly float32-representable so both
  engines see identical inputs; fixtures normalise each player's range by its largest weight
  (probabilities unchanged). Combos overlapping the board are rejected, not silently dropped, so
  `result.hands[p]` is exactly the spot's combo list, in the spot's order.
- **Chance normalisation.** Each turn/river card has weight 1/(unseen cards given both hands),
  as in our engines (`chance_factor` 45/44 on a flop spot).

## Isomorphism and dealt cards in the export

postflop-solver stores one subtree per suit-isomorphism class of turn/river cards (only when
both ranges and the board are symmetric in the swapped suits). The exporter walks the
interpreter with `play(card)` for **every** card in `possible_cards()`; the interpreter applies
the suit swap, so every real card gets its own chance child with strategies already permuted to
the real hands. `representative: false` marks cards served through a swap (of this card or the
turn before it). Tested: on `QsJh2h3s` with club/diamond-symmetric ranges, river 4c vs 4d
strategies are the club↔diamond permutation of each other and exactly one is representative.
`impossibleCards` lists unseen cards postflop-solver never deals because no hand pair survives
them (they carry zero probability); `children.length + impossibleCards.length` = unseen cards.
`exportScope: "first-street"` stops at the first chance node (`truncated: true`).

## Locked fixtures (hashes in `fixtures.ts`)

Referee trees are derived by walking our engines' own public rules; the bridge rebuilt all three
node-for-node (actions, chip amounts, terminals, every chance child). Solved at the fixtures'
0.01%-pot target:

| Spot | Engine | Hands | Public nodes (players/chances/terminals) | Exported nodes | Iterations | Exploitability | Value P0 (ours) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `referee-river-v3-demo` | configurable river v3 demo | 14 × 14 | 22 / 0 / 41 | 63 | 600 | 0.0090 chips | 16.0896 (16.0811 artifact) |
| `referee-turn-v2-dry-value` | configurable turn v2 corpus | 3 × 3 | 60 / 5 / 97 | 6,507 | 520 | 0.0097 | 12.1884 (interval 12.145–12.250) |
| `referee-flop-reference` | tiny joint flop reference | 2 × 2 | 52 / 12 / 53 | 189,900 | 100 | 0.0097 | 48.0143 (interval 48.0129–48.0170) |

All three postflop-solver values fall inside our saved artifacts' equilibrium intervals — early
evidence the utility origin, chance weighting and chip mapping agree (B2 makes it a gate).
A tiny 2×2 river test game plateaued at 0.026 chips (0.026% pot) after 2000 iterations: set the
B2 float32 tolerance from measurement, not from these targets.

**B0/B1 benchmark, now the "rich" variant** `benchmark-srp-btn-bb-100bb-ks7h2d` (the pass/fail benchmark was re-locked to the lean Fold tree in B3; see "B3 benchmark results"): 100bb BTN vs BB SRP on K♠7♥2♦, 1bb = 100
chips (sizes round to 0.01bb): pot 550, stack 9750. Ranges are **hand-written approximations,
not solved** (BB flat 609 combos with partial weights on 3-bet hands; BTN open 502 combos after
blockers). Bets 33/75/125% + all-in every street, one raise per street; thresholds 1.5/0.15/0.1;
pass bar 0.3% pot. Memory preflight (`solver-bridge estimate`) forced one trim of the raise menu:

| Raise menu (flop/turn/river) | float32 | int16 compressed |
| --- | --- | --- |
| 3x + all-in / same / same (first draft) | 57.0 GB | 28.9 GB |
| 3x / 3x / 3x | 52.7 GB | 26.8 GB |
| 3x / 3x / all-in | 48.2 GB | 24.4 GB |
| 3x / all-in / 3x … all-in / 3x / 3x | 35.9 GB | 18.2 GB |
| **3x + all-in / all-in / all-in (locked)** | **32.8 GB** | **16.6 GB** |
| all-in / all-in / all-in | 21.2 GB | 10.7 GB |

The locked menu keeps a real flop raise and fits the 24 GiB cap only compressed. If B3 must
compare compressed vs uncompressed on a 32 GB machine, only the all-in-only raise menu fits in
float32 — Kat to decide (a hash re-lock).

## Smoke timings (M1 Pro 10 cores, 32 GB, Rust 1.98.1 arm64, release, 10 rayon threads)

- **Upstream `examples/basic.rs` via our contract** (`smoke-upstream-basic`, Td9d6h Qc, pot 200,
  stack 900, "60%, e, a" / "2.5x", river donk 50%): 167 × 250 hands, root actions
  `Check, Bet(120), Bet(216), AllIn(900)` and `Fold, Call, Raise(300)` as upstream asserts;
  100 iterations to 0.911 chips (0.456% pot) in 0.37 s solve; estimate 12.1 MB (6.4 MB
  compressed); peak RSS 18 MB. Running the upstream example itself on the same machine gives
  the identical exploitability sequence (0.91105 at 100), average equity 53.06% and average EV
  91.89 — our contract path reproduces upstream bit for bit.
- **Referees**: 12 ms, 272 ms and 1.3 s total (flop export of 189,900 nodes: 0.29 s).
- **Benchmark** (locked menu, `compression: auto` → int16, 20-minute cap): build 0.2 s;
  estimate 16.64 GB, peak RSS 16.44 GB (the estimate is accurate). Allocation + first 10
  iterations took 266 s, then ~15 s per iteration (including the exploitability pass every 10).
  Exploitability (chips; pot 550): 651 @10, 357 @20, 137 @30, 84 @40, 57 @50, 44 @60, 78 @70
  (int16 noise), when the runner's 20-minute cap killed it with no result published (as
  designed). Not converged: 44 chips = 7.9% pot vs the 1.65-chip (0.3%) bar. Feasible on this
  machine but the pass bar is a multi-hour solve (rough guess 500–1000 iterations ≈ 2–4 h);
  B3 should give it a 4-hour `timeoutMs` (currently 1 h in the locked spot) or trim the
  tree/ranges, and measure whether int16 noise stalls it above 0.3% pot.

## Build notes

- The default `bincode` feature is disabled: its `2.0.0-rc.3` requirement now resolves to
  bincode 2.0.1, which the pinned source does not compile against. We never use
  postflop-solver's file format. As a root crate the pinned source also trips the
  deny-by-default `dangerous_implicit_autorefs` lint; as a dependency its lints are capped, so
  our build is clean (to run upstream examples directly: `RUSTFLAGS="--cap-lints warn"`).
- `npm run build:bridge` / `npm run test:bridge` / `npm run solve:bridge`. CI job `bridge`
  installs Rust 1.98.1, caches cargo, builds, runs `cargo fmt --check`, `clippy -D warnings`,
  `cargo test`, then `test/bridge-runner.test.ts` against the real binary.

## B2 referee results (2026-09-25)

`npm run audit:bridge` solves the three locked referee spots (hashes checked against
`BRIDGE_FIXTURE_HASHES`) plus a suit-isomorphism probe, then for each result:

1. **Tree identity** (`refereeWalk`). The exported tree is walked in lockstep with our engine's
   own public state (not the spot's explicit tree): node kind, actor, street, board, committed
   chips, action list with chip amounts, terminal outcome/folder and chance cards must be equal,
   or the audit fails with a path such as `root/bet50: actions [fold, call, raise151] ≠ ours [...]`.
   At every chance node each card our engine deals must be an exported child (isomorphic cards
   included) or in `impossibleCards`, and for every impossible card our engine must also find no
   compatible private pair. Our engines' all-in-before-the-river chance node (then settlement) is
   compared as postflop-solver's single showdown terminal; both average the same runouts.
2. **Policy adapter.** Each exported float32 strategy column is renormalized in float64 (largest
   observed |sum − 1| 1.3e-7; > 1e-5 fails) and written to our information-set key for that
   (public state, hand), in our action order. Every information set of our engine must be filled
   exactly once; a hand our engine plays but the export leaves null fails. Exported hands our
   engine has no information set for (zero reach: e.g. 6,144 flop (node, hand) pairs after a
   runout that kills the opponent's whole range) are counted, not graded.
3. **Our grade**, with each engine's own acceptance grader: river v3 `gradeFactorizedRiverStrategy`,
   turn v2 `gradeVectorTurn`, flop `gradeVectorFlop` cross-checked by the generic exact
   `gradeStrategy` (agree ≤ 1e-9). postflop-solver's exploitability is never used in our number.
4. **Gates** (`refereeGates`, tolerance τ = `BRIDGE_FLOAT32_TOLERANCE_CHIPS` = 2e-4 chips):
   (a) |self-reported exploitability − our exploitability| ≤ τ; (b) |self-reported value −
   our value| ≤ τ, the self-report is zero-sum within τ, our value of their strategy lies inside
   the saved artifact's certified interval [v0 − gain1, v0 + gain0] (self-report: ± τ), and the two
   certified intervals intersect; (c) our exploitability ≤ the game's existing quality gate
   (0.25 chips for all three, read from the artifacts' `acceptance`).

Results (M1 Pro, 10 threads, float32; the locked runs reproduce B1's numbers bit for bit):

| Spot (iterations) | Their exploitability | Ours | Their value P0 | Ours | Artifact interval (payload hash) | Our interval for their strategy |
| --- | --- | --- | --- | --- | --- | --- |
| river v3 demo (600) | 0.009005547 | 0.009005300 | 16.0896236 | 16.0896219 | [16.0779009, 16.0960502] (`320759e7…`) | [16.0785970, 16.0966076] |
| turn v2 dry value (520) | 0.00971508 | 0.00971560 | 12.1883645 | 12.1883584 | [12.1452739, 12.2495660] (`1221202f…`) | [12.1782790, 12.1977102] |
| flop reference (100) | 0.009672165 | 0.009672742 | 48.0142840 | 48.0142830 | [48.0129039, 48.0169673] (`00e520f9…`) | [48.0113278, 48.0306733] |
| isomorphism probe (620) | 0.009411812 | 0.009411622 | 27.1259588 | 27.1259592 | none (not a saved game) | [27.1217077, 27.1405309] |

Largest locked-run discrepancies: exploitability 5.8e-7, value 6.1e-6, self-report zero-sum
8.9e-6 chips — all ≤ τ/20. No disagreement was found. Walk sizes: river 22/0/41
player/chance/terminal nodes, 308 information sets; turn 2,410/5/4,092, 6,930; flop
84,400/444/105,056, 149,936 (216 impossible cards, all confirmed dead by our engine); probe
1,642/5/2,556, 9,444 with **65 non-representative (suit-swapped) river children**. The three
locked games have no suit symmetry, so the probe (turn v2, board Ks8h4s2h, clubs↔diamonds-
symmetric ranges `AcKd AdKc AcAd QcJd QdJc 9c9d` vs `KcQc KdQd AcQd AdQc JcJd TcTd`, not a
locked hash) is what proves swapped cards reach the real hands: exporting the swapped subtrees
without the card permutation raises our grade from 0.0094 to 0.115 chips and moves the value by
0.011, failing gates (a) and (b) (test `suit-isomorphic cards …`).

**Tolerance derivation** (`npm run audit:bridge -- --measure`, 80 solves, ~2 min): each of the
four games solved at 10/30/100/300/1000 iterations (target 1e-9 % pot so the cap binds), with
1 thread and 10 threads, uncompressed and int16-compressed, each graded by us. (The locked
referee spots, target 0.01 % pot, settle at 600/520/100 iterations, far below their 20,000 cap.)

| Precision | Solves | max \|Δ exploitability\| | max \|Δ value P0\| | max self-report zero-sum error |
| --- | --- | --- | --- | --- |
| float32 | 40 | 4.33e-6 | 1.21e-5 | 8.0e-6 |
| int16 compressed | 40 | 3.09e-6 | 6.36e-4 | 8.74e-4 |

- 1 and 10 threads gave bit-identical results in every case, so the measured spread is
  float32 rounding, not scheduling. It does not sample other CPUs/compilers (CI is x86_64 Linux,
  where SIMD width and FMA contraction can differ).
- τ = 10 × the float32 maximum (1.21e-5, probe value at 100 iterations), rounded up to the next
  1-2-5 step = **2e-4 chips**. The 10× margin is for unsampled hardware/reduction orders; τ is
  still 2e-4 % of the 100-chip referee pots and 50× below their 0.01-chip solve target, so any
  disagreement at the level of the solve's own accuracy fails. It was fixed from this measurement
  before being applied, and the gates pass with margin ≥ 20×; nothing was tuned to pass.
- int16 compression leaves the self-reported **exploitability** as accurate as float32 (it
  grades the same decompressed strategy) but its **root EVs** are off by up to 8.7e-4 chips, so
  τ does not cover compressed results. B3 (compressed benchmark) must measure its own bound at its
  scale (pot 550, stack 9,750) before comparing values.
- Scope: τ is absolute chips for games at the referee scale (pots ~100, stacks ≤ 200). A larger
  game needs a re-measurement, not a scaled guess.

Runtime: `npm run audit:bridge` 6.6 s wall after the build (flop 5.9 s of it: 1.0 s solve, the
rest parsing the 189,900-node export and the two graders). CI's `bridge` job runs it after the
referee tests (`test/bridge-referee.test.ts`); first CI run pending push.

## Result v1 in the browser (B5 plan; no schema change)

A live (wasm32) solve writes the same Result v1. Fields whose meaning changes there:
`memory.peakRssBytes` is the final linear-memory size (`memory_size(0) × 65536`; linear memory
never shrinks, so it is the peak); `engine.threads` is the rayon pool size (1 for the
single-thread build); `timings` come from `performance.now()`. `spotHash` must still equal a
JS `crypto.subtle` SHA-256 of the canonical spot bytes. Admission before allocation:
`src/lib/solver/bridge/wasm-admission.ts` (see `tasks/postflop-solver-wasm-spec.md`).

## B3 benchmark results (2026-09-25)

**Re-lock (decided by the lead before the first solve).** The B1 menu (33/75/125% + all-in for
both players, every street) estimated 16.6 GB int16 and ~15 s/iteration (2–4 h), so the
pass/fail benchmark is now `benchmark-lean-srp-btn-bb-100bb-ks7h2d` (hash `b9e032fc…`): the same
flop, pot, stack and hand-written ranges on Griffin's own lean **Fold** tree (`LEAN_SRP_TREE`):

- OOP (BB) bets flop 33%/66%, turn 66%, river 50%/100%; IP (BTN) bets 66% every street.
- Raises: raise-to = bet + 0.6 × (pot + 2·bet) = postflop-solver's `PotRelative(0.6)` raise
  (pot after the call × 0.6 on top of the bet): exact, not an approximation. One raise per street.
- All-in: postflop-solver's `forceAllInThreshold` 0.2 is the same rule (a size becomes all-in when
  the stack left behind is ≤ 0.2 × the pot after the opponent calls); the only approximation is
  that the threshold is rounded to whole chips (0.01 bb). No extra all-in size
  (`addAllInThreshold` 0), no merging (0), no donk menu (OOP leads use OOP's bet menu, as in Fold).
- Test `lean_fold_tree_raises_to_call_plus_60_pct_and_forces_all_in_at_0_2_pot` pins these
  amounts (e.g. raise to 205 over a 66 bet into 100; the same raise with 240 behind is all-in).

The old spot keeps its hash (`cbe72c…`) as the documented "rich" variant, not a gate.

**Solve** (`npm run bench:bridge`, `src/lib/solver/bridge/artifacts/benchmark-b3.json`; M1 Pro, 10 threads):

| Run | Iterations | Exploitability | Wall | Peak RSS | Self-reported value (BB, BTN) |
| --- | --- | --- | --- | --- | --- |
| float32 (locked spot) | 170 | 1.554 chips = **0.283% pot** | 224 s (clean; 260 s in the artifact run, lint running alongside) | 6.01 GB (estimate 6.00) | −64.974 / +64.974 |
| int16, same spot with compression on | 160 | 1.596 = 0.290% | 202 s | 3.06 GB (estimate 3.05) | −64.996 / +64.997 |
| int16 stopped at 170 | 170 | 1.433 = 0.261% | 245 s | 3.06 GB | −64.961 / +64.960 |

Build 0.07 s, allocation < 3 ms, export < 20 ms; almost all time is DCFR iterations
(~1.3 s each, including the exploitability pass every 10). Both precisions fit this machine.
float32 curve (chips, every 10 iterations): 1359, 492, 172, 43.1, 18.7, 11.4, 7.92, 8.66, 4.90,
3.77, 3.63, 6.15, 4.11, 2.99, 2.47, 2.09, 1.78, 1.55. int16 tracks it (1359, 502, 157, 38.5,
17.9, 10.9, 7.64, 9.08, 8.34, 10.4, 5.81, 3.74, 2.94, 2.44, 2.08, 1.80, 1.60); the non-monotone
bumps are DCFR's, in both. Repeated runs are bit-identical.

**Compression discrepancy on this spot.** At the same 170 iterations, int16 vs float32:
root value Δ 0.013 chips (0.002% pot), exploitability Δ 0.12 chips, flop strategies differ by a
reach-weighted mean total-variation distance of 0.010 (worst flop node 0.026). Against our own
grader on the six river subgames below, postflop-solver's float32 subgame values agree to
≤ 7.0e-6 chips; int16 values are off by up to 2.8e-3 chips (and its self-reported values fail
zero-sum by up to 5e-3). So int16 is fine for strategies and for the 0.3% gate, but its EVs
carry ~1e-3-chip noise at this scale; the library uses float32 (every spot fit).

**Referee spot-check** (`gradeRiverSubgame`, `src/lib/solver/bridge/subgame-referee.ts`). The
bridge's new slice export (`--slices`, below) writes six river subtrees with both players' reach
at the subtree root; our factorized river scorekeeper (river v3's acceptance grader) grades
postflop-solver's river strategy on every blocker-compatible deal weighted by reach0 × reach1.
The public tree comes from the export (no second rules implementation); payoffs from the
exported chip totals and our hand evaluator. Subgames were chosen before the solve for line variety.

| River subgame (float32) | Hands in play | Deals | Pot | Local exploitability (ours) | Reach probability | prob × local |
| --- | --- | --- | --- | --- | --- | --- |
| `x x 9c x x 3s` (checked to the river) | 569 × 417 | 213,797 | 550 | 0.467 chips = 0.085% | 1.1e-4 | 5.3e-5 |
| `b182 c Ad x x 5h` | 540 × 432 | 209,863 | 914 | 28.5 = **3.12%** | 4.7e-7 | 1.3e-5 |
| `x b363 c 7c x b842 c Jd` | 277 × 302 | 74,654 | 2,960 | 2.71 = 0.091% | 1.4e-5 | 3.8e-5 |
| `x x Th b363 c 2s` (OOP turn lead called) | 438 × 329 | 129,593 | 1,276 | 1.05 = 0.083% | 2.8e-5 | 3.0e-5 |
| `x x 9c x x 3s x` (IP after a river check) | 551 × 417 | 207,022 | 550 | 0.150 = 0.027% | 6.9e-5 | 1.0e-5 |
| `x x 9c x x 3s b275` (IP facing a half-pot bet) | 522 × 417 | 196,608 | 825 | 0.414 = 0.050% | 2.5e-5 | 1.0e-5 |

- Values: postflop-solver's subgame value (from its exported per-hand EVs) equals our evaluation
  of its strategy within 7.0e-6 chips in all six (int16: ≤ 2.8e-3). No disagreement found.
- Local exploitability is *given the arriving ranges*, not the whole-game number. Five of six are
  ≤ 0.1% of their pot. The outlier is a line reached with probability 4.7e-7 (OOP's small c-bet
  called, then the ace turn checked through): CFR spends almost nothing there, and its whole-game
  weight is 1.3e-5 chips. Every row satisfies the bound it must: probability × local
  exploitability ≤ the whole-game exploitability (1.55 chips), checked by the script.
- Coverage: 6 river subgames out of millions of river nodes; flop and turn decisions are not
  graded by us at this scale. **Turn subgames were not graded**: our turn engines (turn v2 /
  vector turn) take one street-relative chip menu shared by both players, which cannot express
  Fold's player- and pot-dependent river sizes. The 64-hand vector flop engine cannot play this
  game either (flop-v1: one size, no raises, ≤ 64 hands); B2's tiny flop referee is the
  whole-game agreement check.

**Experiment: how much do extra IP sizes buy?** (`npm run bench:bridge -- --experiment`,
`artifacts/benchmark-b3-experiment.json`; a measurement, not a gate.) Same flop, ranges and
tree, but IP may bet 33%, 66% or 125% on every street instead of 66% only; both solved to
0.15% pot in int16. (A float32 attempt of the richer tree, 22.9 GB, pushed the 32 GB machine
into ~20 GB of swap and was stopped; int16 needs 11.6 GB, and its EV noise here is ~1e-3 chips.)

| Tree | Iterations | Exploitability | Wall | Peak RSS | BB value | BTN value |
| --- | --- | --- | --- | --- | --- | --- |
| lean (IP 66%) | 240 | 0.805 chips (0.146%) | 384 s | 3.1 GB | −64.83 | +64.83 |
| IP 33/66/125% | 400 | 0.811 chips (0.147%) | 1,948 s | 11.7 GB | −74.58 | +74.58 |

The two extra IP sizes are worth **+9.75 chips to BTN (0.098 bb, 1.8% of the pot)** on this
flop, against a resolution of ±1.6 chips (the two exploitabilities summed): real, but small,
for 3.8× the memory and ~5× the time. BB's value drops by the same amount (zero-sum). One flop,
one formation: not a general claim about bet-size value.

## Slice export (bridge extension, B3/B4)

A solved flop game is far too large to export whole (the benchmark's first-street export is 21
nodes; its full tree has millions). `solver-bridge solve … --slices plan.json`
(`BridgeSlicePlanV1`, `validateBridgeSlicePlan`, Rust `src/slices.rs`) names what to write, and
the plan's sha256 is recorded in `result.slices.planHash` (the spot hash is unchanged, so one
solved spot can be sliced differently). Paths are tokens from the flop root: `x c f`, `b<to>` /
`r<to>` (street totals, all-in included), a card name at chance nodes, and `s<i>` (the i-th sized
action, input only).

- `flop.maxDepth`, `turn {cards, maxDepth, maxPriorRaises}`, `river {boards, maxDepth,
  maxPriorRaises}`: decision nodes with at most `maxDepth` actions on their street, for the
  listed cards, on lines with at most `maxPriorRaises` raises on earlier streets.
- Each sliced node: actor, actions, per-hand strategy, per-action EV of the actor, both players'
  per-hand EV, reach and (optionally) equity. EVs are **from now** (postflop-solver's
  convention at a node: chips won back from the pot minus chips still to be paid; fold = 0).
- `subtrees`: whole subtrees (result-tree format) with root reach and EV, for referee grading.
- `unreached` lists planned cards/boards the walk never dealt (never silently dropped).
- Subtree paths are resolved right after allocation, so a bad plan fails before solving.
- Verified: Rust tests (`slice_plans_select_nodes_by_street_depth_and_report_dead_cards`,
  `slice_plan_errors_fail_before_solving`); `test/bridge-library.test.ts` checks exported
  slices of the tiny flop referee against the library invariants and our river grade, and that
  a corrupted exported strategy raises our grade.

## B4 spot library (2026-09-25)

`public/solver-data/bridge-v1/` — generated by `npm run generate:bridge:library`
(`scripts/build-bridge-library.ts`, definitions in `src/lib/solver/bridge/library/spots.ts`).

**Contents.** Formation BTN vs BB SRP 100bb (pot 550, 9,750 behind, 1 bb = 100 chips), the
benchmark's hand-written approximate ranges (labelled "hand-written approximations, not solved"
in every spot file and the manifest) and the lean Fold tree. Engine credit in the manifest:
postflop-solver, AGPL-3.0, commit `9d1509fe…`. 12 flops, chosen for texture; all solved in
float32 and all passed the 0.3%-pot gate (none rejected):

| Spot | Texture | Iterations | Exploitability (% pot) | Solve | Peak RSS | BB value (chips) |
| --- | --- | --- | --- | --- | --- | --- |
| Ks7h2d | dry high | 170 | 0.283 | 210 s | 5.8 GB | −65.0 |
| Ad8c3s | ace-high dry | 150 | 0.278 | 196 s | 5.5 GB | −60.5 |
| KhQdTc | broadway | 180 | 0.282 | 249 s | 5.5 GB | −71.5 |
| 9h8h6c | wet connected two-tone | 150 | 0.278 | 126 s | 3.4 GB | −35.1 |
| Qs9s4s | monotone | 160 | 0.297 | 63 s | 1.7 GB | −51.0 |
| Td7d3c | two-tone middle | 140 | 0.287 | 114 s | 3.5 GB | −50.1 |
| 8s8d3h | paired middle | 220 | 0.294 | 181 s | 3.6 GB | −9.2 |
| 5h4c2d | low connected | 170 | 0.277 | 236 s | 6.0 GB | −40.7 |
| Tc9d7s | middle connected | 140 | 0.299 | 191 s | 5.6 GB | −18.0 |
| AhTh5c | ace-high two-tone | 140 | 0.270 | 113 s | 3.3 GB | −73.0 |
| JcJd4s | paired high | 220 | 0.294 | 185 s | 3.6 GB | −59.7 |
| 7c6c5d | low wet two-tone | 160 | 0.284 | 130 s | 3.6 GB | +4.3 |

The first flop took 210 s; at that rate 2.5 h allowed ~40 flops, so the count (12) was set by
the lead's 8–12 range and the size budget, not time. Total generation 30 min (solves are
sequential; suit isomorphism makes monotone/two-tone boards smaller). Values are net chips from
the start of the flop; the solves stop at the first 10-iteration checkpoint ≤ 0.3%, so each
value is only as good as ±1.6 chips of exploitability.

**Slice policy** (the full tree × ~1,100 hands is far too big to ship):
- flop: every flop decision node (8 per spot: all flop betting lines, raises included);
- turn: 8 hand-picked turn cards per flop (overcards, board pairs, flush/straight completers,
  bricks); decisions with ≤ 2 turn actions before them (OOP's first action, IP after a check,
  IP facing a lead, OOP facing a stab, OOP facing a raise of its lead) on the 4 flop lines that
  reach the turn without a raise: 20 nodes per card;
- river: 2 turn+river boards per flop; decisions with ≤ 2 river actions before them on the 12
  unraised flop+turn lines: 84 nodes per board;
- raised pots stay flop-only (thin, rare lines). 336 nodes per spot.
Every node has both players' per-hand reach, from-now EV and equity, plus the actor's per-hand
strategy and per-action EV — enough for pot odds, MDF, bluff ratios, blockers and range
composition.

**Format** (`src/lib/solver/bridge/library/model.ts`). `manifest.json` (79 KB) lists per spot:
spot hash, slice-plan hash, engine precision/threads, iterations, exploitability, values, solve
time, peak RSS, flop descriptor, and a `{url, bytes, sha256}` for every file. Per spot, under
`<id>/<spotHash>/`: `spot.json` (the canonical contract spot: its sha256 *is* the spot hash),
`root.json` (full-precision float32 flop-root weight, normalized weight, net EV and equity per
combo for both players, plus the flop descriptor: for the preflop solver's realization
estimate; the UI does not need it), `flop.json`, `turn-<card>.json`, and river chunks split
by flop line so each file stays under 1 MiB (`river-<turn><river>-<flop line>.json`, e.g.
`river-Qh2c-x.b363.c.json`). Chunk rows are quantized integers: reach relative to the node's
largest reach (1e-4; hands that round to 0 are omitted and their mass recorded in
`omittedReach`), strategy per mille summing exactly to 1000, EVs in 0.1 chip (0.001 bb), equity
per mille. Relative reach was needed: with absolute 1e-4 units, thin lines (an OOP turn lead)
lost two-thirds of their range to omission and the opponent-EV invariant failed by 1,270 chips.

**Sizes.** 229 data files, 68.6 MB raw, **17.3 MB gzip** (+ manifest 79 KB raw); largest chunk
534 KB raw; budget 40 MB gzip.

**Loader** (`src/lib/solver/bridge/library/load.ts`, browser-safe): `loadLibraryManifest`,
`loadLibraryRanges`, `loadLibraryChunk` fetch lazily and refuse any file whose URL prefix, byte
count or sha256 differs from its manifest reference, then schema-check it (identity, board vs
path, live-list order, per-hand shapes, strategies summing to 1000). `query.ts`: node by path,
decoded hand rows, pot odds, MDF, range action frequencies.

**Audit** (`npm run audit:bridge:library`, ~6 s, no engine; CI main job):
1. manifest schema and gate; every file's bytes + sha256; no extra or missing files; totals;
2. spot hash and slice-plan hash rebuilt from code equal the manifest (code/data in sync), and
   `spot.json` hashes to the spot hash;
3. `root.json` identity, ranges hash, descriptor, and agreement with the flop chunk's root node;
4. invariants on every node (`invariants.ts`): reach chain (initial weight × saved probabilities
   along the path; 672 checks per spot, all complete; max error 1.6e-3 vs tolerance
   1.5e-4 × max + 1e-3 per step), actor EV = Σ p × action EV (max 5.5 chips at pots up to
   ~20,000; tolerance 0.1 + 0.15% of the largest action EV), opponent EV = frequency-weighted
   child EVs at nodes whose actions all lead to saved nodes (57 per spot; max 1.7 chips;
   tolerance 0.5 + 1%), fold EV = 0, EV and equity bounds. Tolerances are the quantization
   bounds; the measured maxima above sit inside them;
5. re-grade of the saved referee sample (`referee-sample.json`, the full-precision river
   subgame `x b363 c Qh x b842 c 2c` of Ks7h2d, 92,087 deals) with our factorized grader:
   exploitability 0.412 chips (0.014% of its 2,960 pot), reproduced to 1e-9, and
   postflop-solver's value agrees with ours to 3.3e-5 chips (gate 0.01).

`npm run reproduce:bridge:library [-- --only <id>]` re-solves from scratch and requires
byte-identical chunks: local only (~30 min and up to 6 GB per solve; CI runners are x86_64
where float32 reduction order may differ, the same reason `audit:flop:vector` is local).
Checked once after generation (and after a rebuild of the binary): `--only srp-btn-bb-qs9s4s` re-solved byte-identical in 66 s. Raw results are cached in `.cache/bridge-library/` (git-ignored) so an
interrupted generation resumes.

**Not in B4:** UI, turn/river slices beyond the policy above, other formations, solved ranges.
