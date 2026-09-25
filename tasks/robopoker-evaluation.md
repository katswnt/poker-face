# robopoker evaluation — foundation for any-table-size play? (2026-09-25)

Read-only review of [krukah/robopoker](https://github.com/krukah/robopoker) (MIT, Rust,
223 stars) at commit **`0849bfe89a338931c344be2035e00185093b38d2`** (2026-09-10). Read
through `gh api`; nothing was cloned, built, or run. Paths below are relative to that repo.

## Short answer

- **Game engine: supports N players today.** `kicker::GameN<const P: usize>` handles 3,
  6 and 10 seats, with side pots, all-ins, blinds, button rotation and action order, and
  has tests for each.
- **Blueprint and search: heads-up only today.** The player count is a compile-time
  constant, `N = 2` unless you build with `--features sixmax`. As of 2026-09-05 the 6-max
  work is "engine readiness". No 6-max blueprint has been trained or evaluated. The
  hand abstraction assumes one opponent, and depth-limited search is a two-player L×L
  matrix.
- **Recommendation: borrow parts, don't build on it yet.** The `mccfr` crate works for
  any game and runs N-player external sampling, which is the useful part for us. First
  experiment below.

## 1. Player count

- `crates/pokerkit/src/lib.rs:48-56`:
  ```rust
  /// Number of players at the table. Compile-time — the `sixmax` feature flips
  /// the entire build to 6-max. `N` cannot be mixed within one process ...
  #[cfg(not(feature = "sixmax"))] pub const N: usize = 2;
  #[cfg(feature = "sixmax")]      pub const N: usize = 6;
  ```
  `players_suffix()` (lines ~62-68) panics for any N other than 2 or 6. Table sizes 3–5
  and 7–9 are not possible for a blueprint without code changes. `WORDS = if N > 2 { 4 } else { 1 }`
  widens the action-history key for multiway.
- **Engine** (`crates/kicker/src/game.rs`): `pub struct GameN<const P: usize>` (l.14),
  `HeadsUp = GameN<2>`, `FunTable = GameN<6>`, `NitTable = GameN<10>` (l.23-29).
  - Action order uses a seat-step "ticker" that skips folded and all-in seats
    (`next_player` l.395; `is_everyone_touched` l.449 keeps the BB option).
  - Side and split pots are settled strongest hand first (`crates/kicker/src/showdown.rs:1-45`).
  - Tests: `three_player_side_pot_conservation` (l.2025), `six_player_bb_option_raise`,
    `six_player_closure_at_aggressor`, `multiway_random_playout_invariants` (l.2100),
    and `phh conform` against the 10,000 Pluribus 6-max hands.
  - Known deviation: after a short all-in, the minimum-raise and reopen rules are
    deliberately more lenient than TDA rules (l.2140-2185: "Deliberately unchanged … would
    churn the choices mask that keys the live heads-up blueprint").
- **MCCFR is N-player.** The traverser rotates across players:
  `Self::T::from(self.epochs_ref() % Self::T::players())` (`crates/mccfr/src/strategy/book.rs:140`).
  `NlheTurn::players()` returns `pokerkit::N` (`crates/nlhe/src/turn.rs:31`). External
  sampling samples every non-traverser node (`crates/mccfr/src/sample/external.rs`).
- **Heads-up assumptions elsewhere:**
  - River abstraction = "exact equity against the uniform distribution of opponent hands"
    (`crates/deuce/src/observation.rs:27-46`), i.e. equity against one opponent.
    Abstraction tables "stay shared across player counts" (pokerkit l.60).
  - Depth-limited frontier is a 2-player game: `Payoffs<D>([[Utility; D]; D])`, "L×L
    payoff matrix" (`crates/subgame/src/depth/payoffs.rs`).
  - Safe re-solving tracks a single "opponent range" split into 4 worlds
    (`crates/subgame/README.md:30`, `N_WORLDS = 4`).
  - `crates/phh/README.md:3`: "the 6-max → 2-max reduction used to evaluate a
    **heads-up blueprint** against multiway logs."
  - Commit `8928ba0` (2026-09-05) is titled "6-max engine readiness". There is no later
    6-max training or evaluation commit.
  - `Chips = i16`, `STACK = 200` (100bb): one fixed stack depth.

## 2. Pipeline

| Stage | What they do | Where |
|---|---|---|
| Isomorphism | Waugh 2013 suit isomorphism; nanosecond evaluator | `crates/deuce` |
| Abstraction | River: 123M observations → K=101 equity buckets (no k-means). Turn: 1.76M, K=144. Flop: 1.29M, K=128. Preflop: 169 (lossless). k-means++ seeding, Elkan acceleration, EMD by Sinkhorn/Greenkhorn | `crates/lloyd/README.md:168-177`, `crates/forge/README.md` |
| MCCFR | `Flagship = Nlhe<LinearRegret, LinearWeight, PluribusSampling>`: linear CFR (DCFR 1,1,1), external sampling, Pluribus probabilistic pruning (warm-up, exploration, never prunes pre-terminal actions). DCFR(1.5, 0.5) and CFR+ are swappable | `crates/mccfr/README.md`, `sample/pluribus.rs` |
| Storage | **PostgreSQL 14+ required** for training. `FastSession::new(client)` runs clustering, then hydrates from and checkpoints to Postgres via `COPY IN` (`crates/forge/src/fast.rs:23-61`). `database`/`server` are feature-gated, so the library crates build without it | `crates/daybook` |
| Search | Depth-limited solving (4 biased continuations), safe world-partitioned re-solving, "nested" re-solving for off-tree bets | `crates/subgame` |
| Action translation | Pseudo-harmonic mapping onto a fixed size grid (`PLURIBUS_INDICES`), with 5% snap tolerance | `crates/pokerkit/src/translate/` |
| Bet menu | Opens of 2/3/4/5bb; flop `[¼, ½, ¾, 1, 2]`×pot; turn and river 4 sizes; shove always allowed | `crates/nlhe/README.md` |

**Compute (their numbers, README "resources"):** training 16 vCPU / 120 GB; Postgres
8 vCPU / 64 GB; analysis 1 vCPU / 4 GB. Abstraction tables: river 3.02 GB, turn 347 MB,
flop 32 MB. Turn clustering alone holds about 2.0 GB of histograms (`lloyd/README.md:264`).
The published litmus run used epoch 151.7M with 156K infosets. No wall-clock training
time is published, and no trained blueprint is downloadable (the v1.0.0 and v1.1.0
releases have no assets).

**M1 Pro 32 GB:** the abstraction tables fit, and clustering is probably feasible over
hours. The documented training setup (120 GB plus Postgres) does not fit. A heads-up
blueprint at their scale is not realistic on this machine. A 6-max blueprint would be
much larger, since infosets grow with the player count and the multiway action history
(4 words instead of 1). Small custom games on the `mccfr` crate alone are trivial to run.

## 3. Quality evidence

- **Slumbot, heads-up only.** Best variant `world+dirac`: −13.1 bb/100 ± 14.0 over 86.0K
  hands. Blueprint alone: −32.4 ± 6.1 over 480K hands. Uniform random: −136.5 (README
  Table 1). The CI is 1.96·σ/√n over raw per-hand P&L. AIVAT exists (`crates/arena`) but
  the table does not say it was applied. Note the CI on the best variant includes 0, and
  −13 bb/100 still means it **loses** to Slumbot. Their own conclusion: "sampling
  temperature, not search, is the dominant loss."
- **Litmus:** 34/40 hand-written strategy checks pass (for example "AKs ≈ AKo" and
  "BB defends"). The 6 failures are blamed on the flop abstraction merging AQo–A5o. These
  are shape checks, not exploitability measurements.
- **Exploitability:** `CfrNash::exploitability` = Σᵢ BRᵢ / N, computed over a *sampled*
  `Tree` (`crates/mccfr/src/strategy/nash.rs:15-25, 133-150`). Because poker is zero-sum,
  this equals NashConv/N, but only on the sampled subtree. It is validated against closed
  forms on Kuhn, Leduc and RPS only. There are no NLHE exploitability numbers.
- **Multiway:** no evaluation. The only multiway work is replaying Pluribus 6-max logs
  for engine conformance, and the `agree`/`duel` tools, which score the heads-up blueprint
  after reducing each hand to 2 players.

## 4. Integration with poker-face

- **Grading their strategies with our checker.** A real robopoker NLHE blueprint cannot
  be graded directly. It is keyed by abstraction bucket plus action history, while our
  checker needs exact per-combo information sets over a finite tree
  (`MultiwayExtensiveFormGame`, `src/lib/solver/multiway/game.ts`). What *does* work is
  their game-agnostic path: implement our locked river fixture as an `mccfr` `CfrGame`
  (`fn root() -> Self`, `turn`, `apply`, payoff), which is exactly what their
  `crates/kuhn` and `crates/leduc` do. Train it, then export `averaged_distribution(info)`
  for every infoset as JSON matching `serializeMultiwayStrategy` (keyed by our
  information-set keys). `deserializeMultiwayStrategy` then checks that the infoset and
  action sets match exactly, and `gradeMultiwayStrategy` reports per-player
  best-response gain.
- **Rust↔TS:** reuse the pattern of `native/solver-bridge` (pinned Rust CLI, versioned
  JSON in/out, referee in TS). A WASM build was removed upstream (commit `4394599`,
  "remove obsolete wasm.rs"). `mccfr`/`kicker`/`deuce` with default features have no
  Postgres or tokio dependency, so a WASM build of those may be possible, but that is
  unverified. Use CLI JSON first.
- **License:** MIT into AGPL-3.0-or-later is compatible. Keep their copyright notice and
  the MIT text (e.g. a `THIRD_PARTY_NOTICES` entry, plus the README credit alongside
  postflop-solver). Depend on the crates.io packages (`mccfr`/`kicker`/`deuce` 1.2.0),
  pinned in `Cargo.lock`, rather than vendoring.

## 5. Recommendation

**Don't use it as the foundation yet. Borrow parts, behind our referee.**

| Component | Verdict |
|---|---|
| `kicker` N-seat engine | Use as a **differential oracle** against our side-pot and action-order code. Don't adopt it as the rules source: it uses lenient short-all-in rules and one fixed 100bb stack |
| `mccfr` (N-player external sampling, LCFR/DCFR, pruning) | **Most useful piece.** A fast Rust CFR core for small multiway subgames that our TS best-response code can grade |
| `deuce` evaluator and isomorphism | Worth it if TS evaluation becomes a bottleneck. Easy to test against our evaluator |
| `lloyd` abstraction / blueprint / `subgame` | Not yet: tied to heads-up, needs Postgres and 120 GB, and has no multiway evidence |

### First experiment (small, verifiable, CPU-light)

**R0 — robopoker `mccfr` solves our locked 3-player river fixture, and our checker grades
it.**

1. Create a new crate `native/robopoker-referee/` that depends on `mccfr = "=1.2.0"`
   with default features only. Implement our Stage 1 fixture (`multiwayRiverV1Game`: 3
   players, 6 combos each, 90 pot, check/bet 30, fold/call, no raises) as
   `CfrGame`/`CfrInfo`/`CfrEncoder`. Information-set keys must be byte-identical to ours.
2. Train with `LinearRegret + LinearWeight + ExternalSampling` for a fixed seed and
   iteration count, then with `PluribusSampling`.
3. Output JSON holding the strategy, a hash of the fixture input, the robopoker commit,
   and their own `exploitability()` value.
4. In TypeScript, run `deserializeMultiwayStrategy` then `gradeMultiwayStrategy`, just as
   `subgame-referee.ts` does for postflop-solver.

**Success criteria:**
- The infoset and action sets match exactly (deserialize does not throw).
- Our max unilateral gain ≤ `MULTIWAY_ACCEPTANCE.maximumUnilateralGain` (0.45 chips),
  checked for every player, with the same seed giving the same result on repeat runs.
- Their Σ BR / N, taken on a full (unsampled) tree, agrees with our NashConv / 3 to within
  1e-6 (tolerance chosen for f32). If it does not agree, record which checker is wrong.
- Runs under 60 s and under 1 GB, as our acceptance gate requires.
- Stretch: repeat on the side-pot and 4-player fixtures, and run 10,000 random `GameN<3>`
  and `GameN<4>` river settlements through `kicker` against our side-pot payoffs.

If R0 passes, `mccfr` becomes a candidate Rust engine for Stage 4 (larger river ranges)
of `tasks/multiway-nlhe-solver-plan.md`, with our TS checker staying the gate. If
robopoker trains a 6-max blueprint and publishes multiway evidence, reassess the rest.
