# Configurable heads-up river solver v3 — release audit

**Status:** accepted as an isolated exact river library and reproducible teaching artifact

**Contract:** [configurable river v3 specification](configurable-river-v3-spec.md)

## What v3 adds

Version 3 retains the exact, heads-up, known-river model and expands its discrete betting tree:

- up to five opening bet-to amounts;
- up to five raise-to amounts;
- up to two raises after the opening bet;
- full minimum-raise checks;
- legal short all-ins;
- no raising into an opponent who is already all-in; and
- a measured one-million-equivalent-state admission ceiling.

The accepted fixture permits a bet, a raise, and a re-raise. Versions 1 and 2, their entry points,
and their artifacts are unchanged. Nothing in v3 is connected to the four-player trainer.

## The practical CPU boundary was measured first

The factorized engine was profiled under Node `v24.10.0` on `arm64` before the v3 limits were chosen.

| Profile | Deals | Public states | Equivalent states | CFR+ ms/iteration | Grade time | Grade workspace |
|---|---:|---:|---:|---:|---:|---:|
| Small | 750 | 21 | 15,751 | 0.53 | 2.67 ms | 506,568 bytes |
| More private deals | 5,052 | 21 | 106,093 | 3.40 | 6.89 ms | 3,401,192 bytes |
| Richer tree near the former ceiling | 4,060 | 57 | 231,421 | 7.22 | 14.85 ms | 7,419,496 bytes |
| Exploratory CPU boundary | 10,240 | 87 | 890,881 | 28.03 | 64.40 ms | 28,540,956 bytes |

The 890,881-state case compiled in about 52 ms and its structural typed arrays occupied 259,479
bytes. The measured result supports a one-million-state, 15,000-deal ceiling for deliberate local
work. It does not promise interactive thousand-iteration solves at that ceiling: at the observed
rate, 1,000 CFR+ iterations would take roughly 28 seconds before product overhead.

The profile script also proves the old 250,000-state entry point rejects a 287,965-state request.
The v3 limits are a separate contract, not a silent weakening of the older guard.

## Locked v3 fixture

```text
board                       Ks 8s 4s 2c 9d
expanded range entries      14 per player
compatible private deals    176
public betting states       63, stored once
public decisions/terminals  22 / 41
equivalent repeated states  11,089
information sets            308
starting pot                100 chips
stack behind                200 chips each
opening bets                50, 100, 200
raise-to targets            100, 150, 200
raises after opening bet    at most 2
```

The full repeated tree would contain 3,872 decisions and 7,216 terminals. The factorized solver
stores the public tree once and associates it with all exact blocker-compatible private deals.

## Rules and money checks

An independently written replay checks all 176 deals across all 41 public endings:

| Check | Result |
|---|---:|
| Deal/terminal combinations | 7,216 |
| Maximum deal-probability difference | exactly `0` |
| Maximum terminal-utility difference | exactly `0` chip |
| Maximum zero-sum error | exactly `0` chip |

Direct regressions cover full re-raises, the two-raise cap, minimum raises, short all-ins, calls,
folds, returned unmatched chips, and the rule that a player cannot raise when the opponent has no
chips left to answer.

Two hundred generated legal endings also conserve every chip and remain exactly zero-sum.

## Solver and hidden-information checks

- Factorized ordinary CFR exactly matches readable full-tree CFR: current strategy, saved strategy,
  cumulative regrets, and all checkpoints.
- The factorized value and legal information-set best responses match the readable scorekeeper
  across 30 generated mixed profiles.
- The same fixture configured with one raise reduces exactly to v2's deals, public actions,
  histories, terminal values, ordinary-CFR result, and grade.
- Information sets contain the acting player's hand and public state, never the opponent's hand.
- A deliberately illegal checker that sees the entire hidden deal obtains a strict advantage on a
  reduced fixture. The real scorekeeper does not receive that advantage.

## Reproducible accepted result

The committed artifact uses alternating CFR+ with delayed linear averaging:

| Measurement | Result |
|---|---:|
| Iterations | 1,000 |
| Regret passes | 2,000 |
| Extra reach-only averaging passes | 1,000 |
| Player 0 value | `+16.081056725` chips |
| Player 1 value | `−16.081056725` chips |
| Player 0 best-response gain | `0.014993444` chip |
| Player 1 best-response gain | `0.003155818` chip |
| Nash gap | `0.018149262` chip |
| Exploitability | `0.009074631` chip |
| Acceptance ceiling | `0.25` chip |

Exploitability is half the Nash gap because this is a two-player zero-sum game. It is reported in
net chips per hand. It says the saved strategy is a close approximation for this exact finite game;
it does not make every frequency uniquely correct or apply the result to unrestricted hold'em.

The artifact contains the normalized rules, preflight, traversal counts, saved strategy, exact
grades, convergence checkpoints, independent-check results, and a SHA-256 binding to all 308
reproducible teaching decisions. Tests regenerate those decisions instead of adding roughly 1.4 MB
of duplicated derived data to the repository. The artifact also carries two top-level hashes:

```text
rules   36ec8173c65b6c503a2e11636f63538a38dd65acf031d5b675abf695f521bbab
payload 320759e74808f8c5cb784b0e92c3410de02567252346d671a7b0a6eb722ea4e9
```

Regeneration reproduces the committed bytes. Changing rules, values, or saved bytes invalidates the
hash.

## Teaching-data boundary

For bounded games, v3 can export the existing structured teaching facts:

- action frequency;
- expected value from the hand's start;
- expected chip change from the current decision;
- distance from the best measured action;
- immediate opponent responses and fold probability;
- showdown win, split, and loss rates;
- showdown equity; and
- the blocker-aware opponent range after the observed public actions.

Bulk teaching export still constructs the readable repeated tree. It therefore fails before solving
above 100,000 equivalent states. Larger solves return strategy and grade data; a future UI should
calculate one requested decision at a time rather than materializing every explanation.

## Independent open-source referee: attempted, not forced

The pinned MIT [`noambrown/poker_solver`](https://github.com/noambrown/poker_solver) commit
`6a10442877ffc8fd28af93e16e279b9bbdd97b2a` was inspected again in a temporary checkout. It supports
multiple raises, but its later raise menu is expressed as fractions of the pot after calling. V3's
menu is a list of absolute raise-to targets shared across public branches.

With several opening sizes, one reference fraction maps to different chip targets on different
branches. Adding enough fractions to reach all v3 targets also adds reference actions that v3 does
not have. That is a different game tree, so no numerical comparison is reported. V3 instead inherits
the already pinned external evidence through its exact one-raise reduction to v2.

No reference code was copied or linked into Poker Face.

## Six-perspective review

### Expert CTO — pass

V3 is additive, versioned, bounded, and reversible. It reuses the factorized numeric engine through
a narrow shared contract while keeping version-specific poker rules readable. V1 and v2 remain
independent regression oracles. The artifact stores the strategy and a hash of derived teaching
facts rather than duplicating every explanation in JSON.

### Expert poker player — pass for the declared abstraction

The betting sequence now includes a real re-raise. Minimum raises, short all-ins, calls, returned
chips, exact blockers, exact showdowns, position, and stack caps behave correctly. The solver still
uses only declared sizes. A strategically useful unlisted wager is unavailable by design, so this is
not unrestricted no-limit poker.

### Expert math professor — pass

The finite game, utility origin, chance distribution, information sets, regret algorithms, and
quality metric are explicit. Ordinary CFR has a differential oracle; CFR+ is graded independently;
and the accepted approximation has measured deviation gains for both players. The external solver
comparison was withheld when the trees could not be made identical.

### Expert poker teacher — pass for structured evidence

Every saved decision has values, action differences, responses, outcomes, equity, and an updated
opponent range derived from the strategy. No prose calls the result exact GTO. The remaining product
work is to turn those facts into a small number of plain lessons rather than showing the learner a
wall of solver numbers.

### Expert product person — pass as a lab milestone

The solver now answers materially richer river questions and records how long larger classes of
question take. Bulk explanations have a separate safety limit. It is still isolated from the live
trainer, so an experimental heads-up answer cannot be mistaken for advice in the trainer's
four-player game.

### Expert software engineer — pass

Rules, factorized compilation, solving, grading, oracle replay, teaching facts, artifact hashing,
profiling, and public preparation are separate. Tests cover reductions, generated profiles,
generated legal endings, hidden-card cheating, deterministic solves, stale artifacts, resource
rejection, and old v2 explanation behavior. The implementation reports rather than hides its
remaining repeated-tree teaching cost.

## Known limits

- River only; there is no future community card.
- Heads-up and zero-sum only.
- At most two raises after the opening bet.
- Bet sizes are discrete whole-chip targets.
- Runtime remains proportional to deals × public states × solver passes.
- Bulk teaching data is capped at 100,000 equivalent states.
- The scorekeeper still uses repeated deal/public working arrays.
- No automatic bet sizing, suit isomorphism, sampling, workers, WebAssembly, or native backend.
- No v3 UI or trainer integration in this milestone.

## Defensible portfolio claim

> I profiled the exact CPU solver before expanding it, then built a versioned heads-up river game
> with explicit bet sizes and bet–raise–re-raise lines. It exactly enumerates blockers and
> showdowns, matches readable CFR and independent best responses, checks all 7,216 locked terminal
> outcomes with a separate oracle, and commits a hashed 0.0091-chip-exploitable teaching artifact.

Do not shorten that to “I built a complete no-limit hold'em solver.”
