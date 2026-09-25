# postflop-solver bridge — plan (draft for review, 2026-09-25)

## Goal

Use [b-inary/postflop-solver](https://github.com/b-inary/postflop-solver) (AGPL-3.0, Rust,
development suspended since 2023) as poker-face's fast heads-up postflop engine, so real
100bb ranges with several bet sizes solve on a laptop CPU. The existing TypeScript engines
stay unchanged and become the **independent referee**: every postflop-solver result that is
small enough is re-graded by our own best-response code before it is accepted.

Serves the north star: realistic, verified spots to drive instant-math drills, and later
live re-solving for heads-up play against the AI.

## Non-goals (this plan)

- Porting our TypeScript engines to Rust. They are the referee; speed does not matter there.
- Preflop solving, multiway, browser/WASM live solving (later milestones; see end).
- Copying any postflop-solver code into `src/`. It is a dependency, not vendored source.

## Licensing and isolation

- Repository is AGPL-3.0-or-later (commit 60b971f), compatible with postflop-solver.
- All postflop-solver use lives in one crate, `native/solver-bridge/`, behind a versioned
  JSON contract (spot in → result out). App and TypeScript code depend only on the contract,
  so the engine can later be swapped (clean-room engine or commercial license) without
  touching them.
- Pin the dependency to commit `9d1509fe5077d019825f833eed04b16d342dfda1` in `Cargo.toml`
  and commit `Cargo.lock`. Upstream warns it makes breaking changes without version bumps.
- README credits postflop-solver when the bridge first ships, and the app links to source.

## Architecture

```
spot.json ──► solver-bridge (Rust CLI, native arm64/x86_64)
                ├─ builds PostFlopGame (CardConfig + ActionTree)
                ├─ solves (DCFR) to a target exploitability / iteration cap / time + memory budget
                └─ writes result: tree + per-node per-hand strategy + EVs + self-reported exploitability
result ──► scripts/*.ts (Node) ──► referee grade (our independent best response)
                                  ──► saved library slices for the UI (existing explorer pattern)
```

- **Spot contract v1** (`src/lib/solver/bridge/contract.ts` + JSON Schema): board (flop,
  optional turn/river), both ranges as explicit per-combo weights (not only range strings,
  so our side and theirs agree exactly), starting pot and effective stack in integer chips,
  per-street/per-player bet and raise menus, all-in and merging thresholds, target
  exploitability, iteration cap, memory cap. A content hash identifies every spot.
- **Explicit-tree mode:** for referee games the bridge accepts the exact action tree (every
  node's legal actions in chips) and edits postflop-solver's `ActionTree` to match, so both
  engines solve an identical game. Menu mode (percent sizes, geometric, thresholds) is for
  library spots; the resulting concrete tree is always exported.
- **Runner:** a Node wrapper reusing the existing runner pattern (child process, timeout,
  sampled RSS budget, cancellation, no partial results published). Uses postflop-solver's
  `memory_usage()` to refuse oversized spots before allocating.

## Milestones

### B0 — contract before engine
- [x] Spot contract v1 types, JSON Schema, hashing, validation (reject overlapping cards,
      zero-weight ranges, non-integer chips, trees that do not close).
- [x] Unit mapping documented: chips, pot, "bet-to" vs postflop-solver's bet/raise amounts,
      rounding rules, rake = 0.
- [x] Lock 3 referee games (small enough for our engines): one river v3 game, one turn v2
      game, one tiny flop game, each with committed hashes.
- [x] Lock 1 Griffin-scale benchmark game: 100bb single-raised pot flop, 2–3 sizes per street
      and 1 raise, published-style ranges. Pass bar: exploitability ≤ 0.3% of the pot.

### B1 — build and smoke test
- [x] `native/solver-bridge/` crate, pinned dependency, `cargo build --release` on native
      arm64; `rust-toolchain.toml` pins the Rust version (not the host triple).
- [x] Bridge CLI solves the upstream `basic` example; record time/memory on the M1 Pro.
- [x] CI job builds the crate and runs its tests on Linux (added; first run pending push).

B0/B1 done 2026-09-25: see `tasks/postflop-solver-bridge-spec.md` for the contract, unit
mapping, locked hashes, timings and deviations (no separate JSON Schema file: `validateBridgeSpot`
is the strict schema; the benchmark raise menu was trimmed to fit 32 GB).

### B2 — referee: prove the two engines agree
- [ ] Explicit-tree mode reproduces our three referee games node for node (action sets and
      chip amounts identical at every public node; test fails on any mismatch).
- [ ] Export postflop-solver's full average strategy for each game; our independent grader
      computes both players' best-response gains and the game value.
- [ ] Gates: postflop-solver's self-reported exploitability and ours agree within the float32
      noise floor (tolerance fixed in B0 from measured f32 error, not tuned to pass); game
      values agree within the same bound; our grade of their strategy passes each game's
      existing quality gate.
- [ ] Wire `npm run audit:bridge` into CI (fast: small games only).

### B3 — Griffin-scale benchmark
- [ ] Solve the locked 100bb flop game; record iterations, time, peak memory, compressed vs
      uncompressed, exploitability curve.
- [ ] Where our 64-hand vector flop engine can play the same game, compare values and grades.
- [ ] Referee spot-check the river and turn subgames of the big solve with our engines.

### B4 — spot library for drills
- [ ] Generator: formations × flops → bridge solves → saved slices (existing hash-bound
      chunk pattern), with per-spot exploitability recorded and gated.
- [ ] Size budget for the shipped library; lazy loading as in `/solver/flop`.

## Decisions needed from Kat (before B4, not before B0)

1. **Range source for library spots.** Our current ranges are synthetic; Griffin's are
   self-described placeholders. Options: licensed published charts, or a simplified
   preflop solve later. Pick before generating a shipped library.
2. **Which formations and flops** (e.g. mirror Griffin's 9 formations for direct comparison,
   or start with SRP BTN vs BB only).
3. **Bet menus** for the library (e.g. 33/75/125% + all-in, one raise).

## After this plan

- **B5 — WASM live solving:** compile the bridge for the browser in a Web Worker. Threads
  need COOP/COEP headers (Vercel config); keep a single-threaded fallback.
- **Heads-up play with live re-solving** off the saved line.
- **Multiway AI:** evaluate robopoker (MIT) at that stage.

## Risks

- Upstream is unmaintained: pin, and keep the contract so the engine is replaceable.
- Tree-semantics mismatch (merging, force all-in, donk sizes) → explicit-tree mode for any
  comparison; never compare menu-mode trees across engines without exporting the tree.
- float32 vs our float64: fix tolerances from measured error in B0.
- Memory on full-range flops: check `memory_usage()` first; use 16-bit compression when needed.
