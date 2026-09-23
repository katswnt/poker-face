# Sharing a river game and independently grading a strategy

This is a local CLI and TypeScript library for four bounded heads-up river benchmarks.
It is useful for comparing another solver or a learned policy with an auditable CPU
reference. It does not train a neural network, use a GPU, or solve unrestricted hold'em.

## First round trip

After `npm ci`, run these commands from the repository root. Choose new output names:
the CLI refuses to overwrite any existing file, including a policy being graded.

```sh
npm run solver:river -- list
npm run solver:river -- export weighted-blockers --out river-game.json
npm run solver:river -- solve weighted-blockers --out river-policy.json
npm run solver:river -- grade weighted-blockers --strategy river-policy.json --out river-grade.json
npm run audit:river:exchange
```

The first command lists the games. `export` writes the complete finite game, `solve`
writes the CPU reference policy, and `grade` independently measures how much either
player could improve against the submitted policy. Another implementation replaces
only the policy-producing step. Grading does not trust any producer's training loss,
regret totals, reported value, or claimed exploitability.

Omit `--out` to print JSON. Use `npm --silent run solver:river -- ...` in machine
pipelines so npm's own command banner does not precede the JSON. Diagnostics go to
stderr and invalid input exits nonzero without emitting a grade.

`solve` defaults to 1,000 alternating CFR+ iterations with averaging delay 20. For an
experiment, `--iterations N` accepts a whole number from 21 to 20,000; it does not
change the reference manifest. Keep training method, seed, work counts, hardware, and
timings in a separate experiment record. The minimal policy envelope does not accept
arbitrary metadata, and the grader cannot verify claims about how a policy was trained.

## Version-one benchmark set

| ID | Purpose | Deals | Equivalent states |
|---|---|---:|---:|
| `v3-two-raise` | Accepted multi-size, two-raise v3 example | 176 | 11,089 |
| `weighted-blockers` | Unequal weights and shared private cards | 8 | 169 |
| `short-all-in` | Unequal stacks, short raise, and returned chips | 4 | 133 |
| `board-ties` | Everyone plays the board; private cards still block deals | 3 | 73 |

These are correctness examples, not a representative poker strength benchmark or a
held-out training set. If used for training or tuning, they are not independent test
data. A future learned-policy comparison needs separately declared held-out games.
No iteration budget guarantees a particular exploitability on arbitrary inputs.

The checked-in [reference manifest](../src/lib/solver/river/exchange/artifacts/benchmarks-v1.json)
records exact counts, solver settings, game and policy hashes, independently measured
grades, and separate rules checks. `audit:river:exchange` regenerates and compares it
without writing. `generate:river:benchmarks` deliberately rewrites it; review that diff.
Old v3 artifact hashes remain unchanged: the exchange uses a new format-specific hash.

## Reading the exported game

The contract is defined by [TypeScript types](../src/lib/solver/river/exchange/types.ts)
and [export/import implementation](../src/lib/solver/river/exchange/exchange-node.ts).
All games have two players, zero rake, an explicit final board, weighted input ranges,
whole-chip sizes, equal prior contributions, and no future chance events after dealing
private cards. Player 0 acts first; player 1 acts second.

| Field | Meaning |
|---|---|
| `format`, `schemaVersion`, `rules` | `poker-face-river-game`, `1`, `configurable-river-v3` |
| `scenario` | Expanded exact ranges and weights, board, stacks, prior contributions, action order, and size menus |
| `conventions` | Payoff origin and units, action sizing, chance order, and legal observations |
| `chanceDeals` | Every compatible private-hand pair and its joint probability; array order is significant |
| `publicTree` | Public nodes in index order, starting at node 0, with history and either action edges or terminal payoffs |
| `informationSets` | Legal decision records: player, own cards, public-node index, opaque key, and action list |
| `gameFingerprint` | SHA-256 identity of the entire canonical payload, excluding this hash field |

To run the exported game without reimplementing poker rules:

1. Pick one entry in `chanceDeals` using its probability. Keep the full deal in the
   environment, and expose only each acting player's own cards to that player.
2. Start at public node 0. At a player node, locate the information-set record using
   that node index and the acting player's private cards. Its key selects the policy.
3. Select a legal action, then follow that edge's `child` node index.
4. At a terminal, take `utility0ByDeal[dealIndex]` as player 0's result and its negative
   as player 1's result. Do not add the pot, subtract bets again, or remove old contributions.

Utility is **net chips from the hand's start, including prior contributions**, not the
whole payout or the value only from the current decision. `bet-to-N` and `raise-to-N`
mean a player's total contribution on the river, excluding chips committed before it;
they are not increments and not pot fractions. The exported edges already enforce the
minimum-raise, all-in, and raise-limit rules. Terminal payoffs already return uncalled chips.

The environment contains both hands and payout tables because it must score the game.
Those are not permitted agent observations. An information set deliberately groups
different opponent hands together. Do not split it by hidden cards, even during grading.

## Writing a policy file

The root object must contain exactly these five fields:

- `format`: `poker-face-river-policy`.
- `schemaVersion`: `1`.
- `gameFingerprint`: copy the fingerprint from the exported game unchanged.
- `units`: `net-chips-per-hand`.
- `strategy`: an object mapping **every** exported information-set key to an object
  mapping **every** legal action to its probability.

Keys are opaque and case-sensitive. Copy them rather than parsing their internal
punctuation. Include zero-frequency actions and decisions that your current policy
never reaches. Probabilities must be finite JSON numbers in `[0,1]`; their sum at each
decision must be within `1e-12` of one. Full precision is required. A producer using
float32 probabilities should normalize them in float64 before export; rounded display
percentages will often fail. Poker Face will not repair or renormalize an imported policy.

There is no `game`, payoff override, opponent-card key, producer quality score, or
value-prediction field in a policy. Unknown fields, missing choices, arrays in place of
maps, mismatched fingerprints, and malformed probabilities are rejected. The CLI
accepts regular JSON files up to 8 MiB, not FIFOs or executable plugins.

`grade <benchmark>` reconstructs that benchmark from the local trusted catalog. It
does not import the exported game file. V1 intentionally does not support arbitrary
external game definitions or browser policy uploads. To add a benchmark, extend the
catalog in a reviewed, versioned change and reproduce its checks and reference manifest.
The library can prepare other bounded v3 requests supplied by trusted local code, under
the separate 100,000-equivalent-state export cap; the larger solver limit is unchanged.

## Reading the grade

The grade records the game fingerprint, a SHA-256 hash of the canonical complete policy
envelope, both player values, both best-response values and gains, Nash gap, and the
two-player exploitability convention. Values are full enumeration with floating-point
arithmetic, not Monte Carlo estimates.

```text
gain0 = bestResponseValue0 - value0
gain1 = bestResponseValue1 - value1
Nash gap = gain0 + gain1
exploitability = Nash gap / 2
```

A gain is how many chips per hand that player could earn by changing their whole
strategy while the other player keeps theirs. The average of the two gains is not
the larger player's gain, so keep both visible. This convention is only for the
two-player zero-sum games here, not the repository's separate multiway proofs.

Compare independent policies by their values and deviation gains. Do not require
matching action percentages: different mixtures can be equally good. Exact byte
equality is a reproducibility check for the same implementation and settings, not a
general definition of poker correctness. A measured zero, especially in the board-tie
fixture, is not a claim of exact universal GTO.

## Integration and trust limits

For an accelerated CFR implementation, first round-trip the CPU policy and reproduce
its grade, then export the accelerated policy and compare quality at matched work and
elapsed time. For a learned policy, query only legal observations and export the whole
policy on separately declared test games. A value-only predictor needs prediction-error
tests and cannot itself receive a policy exploitability score.

Hashes detect identity/content changes, not a malicious producer or data leakage during
training. Strict information-set imports constrain the submitted policy, not its author's
training process. No collaborator-specific adapter exists yet. Inspect that project's
rules and outputs and agree on code reuse/licensing before combining implementations.
No third-party implementation code was copied to build this exchange.
