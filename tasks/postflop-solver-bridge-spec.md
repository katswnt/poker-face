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

## Left for B2

- Referee adapters: grade the exported strategy with our independent best-response code on
  each engine's own game representation; compare values and gains; fix the float32 tolerance
  from measured error.
- Turn the node-for-node tree comparison (done ad hoc here) into a failing test and
  `npm run audit:bridge` in CI.
- Referee spots currently target 0.01% pot with a 20,000-iteration cap; confirm those settle.
