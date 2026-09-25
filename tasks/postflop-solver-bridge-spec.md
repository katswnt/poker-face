# postflop-solver bridge — contract v1 spec and B0/B1 findings (2026-09-25)

Companion to `tasks/postflop-solver-bridge-plan.md`. Source of truth for the types is
`src/lib/solver/bridge/contract.ts`; the Rust side (`native/solver-bridge`) re-checks every
field it relies on. Engine: postflop-solver `9d1509fe5077d019825f833eed04b16d342dfda1`.

## Files

| Path | Role |
| --- | --- |
| `src/lib/solver/bridge/contract.ts` | Spot + Result contract v1 types, strict validation, explicit-tree builder, result check (browser-safe) |
| `src/lib/solver/bridge/contract-node.ts` | Canonical spot JSON and sha256 spot hash (node:crypto) |
| `src/lib/solver/bridge/fixtures.ts` | 3 referee spots, 1 benchmark spot, upstream-basic smoke spot, committed hashes |
| `native/solver-bridge/` | Rust crate, binary `solver-bridge` (`solve`, `estimate`), `Cargo.lock`, `rust-toolchain.toml` (1.98.1) |
| `scripts/bridge-runner.ts` | Node runner: child process, timeout, sampled RSS budget, cancellation, no partial results |
| `scripts/solve-bridge.ts` | `npm run solve:bridge -- --fixture <id> [--out result.json]` |
| `test/bridge-contract.test.ts`, `test/bridge-runner.test.ts` | Validation/hash/fixture tests; runner end-to-end (skips without the binary) |
| `native/solver-bridge/tests/bridge.rs` | Empirical engine-semantics tests (`npm run test:bridge`) |
| `src/lib/solver/bridge/referee.ts` | B2: lockstep tree-identity walk + policy adapter, self-reported value, gates, locked float32 tolerance |
| `src/lib/solver/bridge/referee-node.ts` | B2: referee engines (river v3, turn v2, flop reference) with their own graders and saved-artifact bounds; suit-isomorphism probe |
| `scripts/audit-bridge.ts` | `npm run audit:bridge` (gates) and `npm run audit:bridge -- --measure` (tolerance measurement) |
| `test/bridge-referee.test.ts` | Tree identity per referee game; corrupted trees/chance nodes/strategies/self-reports must fail (skips without the binary) |

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

**Benchmark** `benchmark-srp-btn-bb-100bb-ks7h2d`: 100bb BTN vs BB SRP on K♠7♥2♦, 1bb = 100
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

## Left for B3

- The Griffin-scale benchmark (compressed): measure an int16 tolerance at its own scale first.
- Referee spot-checks of river/turn subgames of the big solve need a subgame-extraction path
  (export a subtree as a spot); not built in B2.
