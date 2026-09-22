# Compact heads-up river engine — release audit

**Status:** accepted as an isolated, CPU-only solver library

**Contract:** [compact river engine specification](compact-river-engine-spec.md)

## What was built

The accepted configurable river game can now be compiled into numbered typed arrays.
The hot solver loop works with numbers instead of rebuilding JavaScript objects, looking
up long string keys, and allocating action-value arrays on every iteration.

Two algorithms are available:

- **compact ordinary CFR**, which deliberately reproduces the readable solver; and
- **compact alternating CFR+**, which clips negative regret to zero and saves a
  reach-weighted, linearly weighted average strategy after a documented delay.

Both still enumerate every permitted private-hand pair, public action, and showdown.
The poker rules, money settlement, information sets, independent best responses, slow
oracle, and accepted artifacts remain in their original implementations.

This is not a full-range, earlier-street, multiway, continuous-bet-size, real-time, or
GPU-trained poker solver. It is not connected to the four-player trainer.

## Ordinary-CFR equivalence

On the accepted 3,697-state configurable river game, 1,000 iterations produced:

| Comparison | Maximum difference |
|---|---:|
| Saved action probabilities | exactly `0` |
| Current action probabilities | exactly `0` |
| Cumulative regrets | exactly `0` |
| Profile value and exploitability | exactly `0` chip |

The compact compiler keeps the readable engine's depth-first postorder. That detail
matters: summing equivalent floating-point values in a different order eventually sends
some near-zero regrets down different branches. Preserving the order made the two engines
match exactly rather than merely approximately.

The differential suite repeats the comparison across five other games with different
boards, weighted ranges, class-expanded ranges, unequal stacks, short all-ins, bet menus,
and raise menus. Reversing board cards, range tokens, and physical card order also leaves
the normalized result unchanged.

## CFR+ result

The accepted CFR+ check uses the same river demonstration as configurable v2:

```text
board                     Ks 8s 4s 2c 9d
compatible private deals 176
full states               3,697
information sets          112
starting pot              100 chips
stack behind              100 chips each
opening choices           check, bet 50, bet 100
later raise               raise to 100 after a 50-chip bet
```

The independent scorekeeper reports:

| Measurement | Result |
|---|---:|
| CFR+ iterations | 1,000 |
| Full-tree regret passes | 2,000 |
| Extra reach-only passes for averaging | 1,000 |
| Player 0 value | `+18.715047750` chips |
| Pinned external reference value | `+18.714495561` chips |
| Value difference | `0.000552189` chip |
| Exploitability | `0.001949335` chip |
| Locked limit | `0.25` chip |

The traversal counts are explicit because an alternating CFR+ iteration performs one
regret pass for each player. Calling 1,000 CFR+ iterations “the same work” as 1,000
ordinary simultaneous-update iterations would be misleading.

CFR+ also recovers Kuhn poker's known player-0 value of `−1/18` within `0.00001` chip at
1,000 iterations, with independently measured exploitability below `0.0001` chip. The
river scorekeeper, not the CFR+ regret table, decides whether the result passes.

## Measured speed

The locked local benchmark ran under Node `v24.10.0` on `arm64`. It warmed both engines,
then measured five end-to-end solves of 2,000 ordinary-CFR iterations. Each timing includes
that engine's tree construction.

| Engine | Median wall time |
|---|---:|
| Readable object-and-map engine | `572.93 ms` |
| Compact typed-array engine | `124.61 ms` |
| Observed speedup | **`4.60×`** |

This exceeds the predeclared `3×` local gate. It is a machine-specific observation, not a
promise that every computer will be 4.60 times faster.

For the demonstration, the compiled typed arrays occupy exactly `185,842` bytes and the
numeric working arrays occupy `157,736` bytes. Those figures exclude the JavaScript
objects used during compilation and the independent grade, so they are not a whole-process
memory claim.

## Safely wider ranges

The compact library entry point raises only one limit:

| Preflight limit | Readable v2 | Compact entry point |
|---|---:|---:|
| Expanded combinations per player | 128 | 128 |
| Compatible private-hand pairs | 500 | 2,000 |
| Projected full states | 50,000 | 50,000 |

A locked wider fixture contains 30 exact combinations per player, 750 compatible deals,
15,751 full states, and 240 information sets. A 400-iteration CFR+ solve took `320.94 ms`
in the audit run and finished at `0.012450794` chip exploitability. The readable public
entry point rejects the same request at its 500-deal limit.

This is a conservative ceiling increase, not an unrestricted-range claim. A fixed river
board still permits more than a million ordered private-hand pairs before the betting
tree is considered.

## Failure modes now covered

- **Changed math hidden by faster code:** ordinary CFR must match strategies, regrets,
  value, and exploitability, not merely look plausible.
- **Floating-point drift:** the compiler preserves the readable traversal and action
  order.
- **Hidden-card cheating:** final strategies use the same audited information-set keys,
  and the independent best response still chooses once per information set.
- **Forgotten decisions:** compact compilation independently rejects imperfect recall.
- **Miscounted work:** CFR+ regret traversals and averaging passes are reported separately.
- **False convergence:** every accepted strategy is graded by the existing independent
  information-set best response.
- **Non-reproducible output:** repeated ordinary-CFR and CFR+ runs produce identical
  strategies and regrets.
- **Resource blow-up:** exact deal and full-state limits remain preflight gates.
- **Regression elsewhere:** every prior solver artifact regenerated byte-for-byte.

## Six-perspective review

### Expert CTO — pass for an additive performance layer

The readable implementation remains the source of truth, the faster engine is separately
named and versioned, and the public compact entry point keeps hard limits. No trainer or
learner-facing behavior changed. Reverting this milestone would not invalidate earlier
artifacts.

### Expert poker player — pass for the existing river game

This change does not alter position, ranges, blockers, legal bets, minimum raises, short
all-ins, returned chips, or showdowns. It makes the same finite heads-up river game run
faster. It does not expand the game to earlier streets or many players.

### Expert math professor — pass with an explicit approximation boundary

Ordinary CFR has an exact differential oracle. CFR+ is defined step by step, checked on a
game with a known analytic value, and measured with independent best responses in chip
units. A low exploitability is evidence of a close approximation, not proof that every
reported action frequency is the unique exact equilibrium.

### Expert poker teacher — pass as solver infrastructure

The engine can feed the existing structured action values, responses, outcomes, and
posterior ranges. No new prose was added and no raw regret is shown to learners. A future
interface still needs a separate copy and usability review.

### Expert product person — pass with no product integration

The milestone improves wait time and safely admits a somewhat wider class of lab inputs.
It does not yet solve a learner's arbitrary poker hand, and it is not presented inside
the four-player trainer. Limits and approximation quality remain visible library facts.

### Expert software engineer — pass

Compilation, numeric solving, configurable input, grading, and poker rules remain
separate. Typed-array storage is measured directly. Tests cover exact equivalence,
multiple fixtures, card-order invariance, determinism, invalid options, imperfect recall,
known Kuhn value, wider preflight, and CFR+ convergence.

## Known limits and next engineering decision

- The implementation is compact and typed-array based, but it is not yet a specialized
  blocker-sparse range matrix or SIMD engine.
- It is single-threaded. Determinism should be preserved before considering workers.
- The independent object-tree best-response checker will become a bottleneck before the
  numeric CFR loop does on much larger games.
- The 50,000-state ceiling remains. Full river ranges, more raise levels, and many bet
  sizes still exceed it.
- No CFR+ artifact replaces the accepted configurable-v2 artifact. The audit command
  regenerates and independently grades the candidate result instead.
- DCFR was deliberately not added. CFR+ already cleared the quality and speed gates;
  adding another algorithm without a measured need would increase the verification
  burden.

The next performance decision should come from a profile of a deliberately larger but
still auditable game. Likely candidates are a compact independent best-response checker
and a river-specific blocker-sparse representation. Rust, WebAssembly, workers, and suit
isomorphism should be considered only after that measurement.

## Defensible portfolio claim

> I kept my readable river solver as an oracle, compiled the same finite game into typed
> arrays, and made ordinary CFR 4.6 times faster on a controlled local benchmark without
> changing one saved probability or regret. I then added an independently graded CFR+
> candidate that reached 0.00195-chip exploitability in 1,000 iterations, while retaining
> hard state limits and the original hidden-information checks.

Do not shorten that to “I built a full poker solver.”

## Verification record

The milestone passed:

- the full repository test suite, including compact differential and known-value tests;
- Next.js route type generation and strict TypeScript checking;
- the complete ESLint run with no warnings;
- the optimized production build for `/`, `/solver`, and `/solver/lab`;
- exhaustive comparison of all 2,598,960 five-card poker hands with canonical category
  counts; and
- byte-for-byte regeneration of Kuhn, Leduc, river v1, configurable river v2, every
  three-player river artifact, and the four-player river artifact.
