# Heads-up turn-and-river reference v1 — release audit

Date: 2026-09-22. Contract: [heads-up-turn-v1-spec.md](heads-up-turn-v1-spec.md).

## Outcome and limits

The first **offline heads-up** two-street reference is implemented. It reuses the
unchanged ordinary full-tree CFR learner and independent information-set scorekeeper.
It does not extend the river-only factorized engine, change its artifact, introduce
sampling, or add an earlier-street UI. It does not complete the separate three-player
turn stage. No third-party implementation was copied, and no new dependency was added.

Both streets are solved as one game. A turn choice is made before the river chance node;
river decisions retain the turn history. Chance/action reach preserves the weighted,
blocker-compatible joint distribution. Every branch ends at a real fold or showdown.
There are no learned or guessed leaf values.

## Reproducible result

Run `npm run audit:turn` to reproduce and compare the canonical artifact without writing
it. `npm run solve:turn` deliberately regenerates it. Both use the locked fixture and
16,384 ordinary CFR iterations; neither is CFR+ or Monte Carlo.

| Measurement | Result |
|---|---:|
| Compatible private deals | 3 |
| Legal river cards per deal / deal–river pairs | 44 / 132 |
| Full tree states / chance nodes | 3,592 / 10 |
| Decision states / terminal states | 1,596 / 1,986 |
| Information sets | 1,088 |
| First player's value | +50.01255964562273 chips |
| First player's best-response gain | 0.008481881975271222 chips |
| Second player's best-response gain | 0.020804422711719894 chips |
| Exploitability (half Nash gap) | 0.014643152343495558 chips per hand |
| Locked maximum exploitability | 0.10 chip per hand — passed |

The first 16,384-iteration run passed the pre-set threshold; it was not weakened after
looking at the answer. Local observed solve/artifact generation took about 13 seconds
on Node 24.10.0, arm64. Timing is not a correctness gate or a browser performance claim.

- Rules SHA-256: `b7aca81487749ed21b51478400da52352d3fc433b1b1925971938b134cb413c1`
- Payload SHA-256: `bd98eacacfb5de375cc8c485dfde8c44e890e41a151afa0d15caebcb7019995e`

The rules hash covers the complete state walk, chance probabilities, legal actions,
information-set keys and terminal utilities. The payload binds those rules to the
request, complete average strategy, both gains, convergence, independent rules audit
and acceptance gate. Elapsed time is excluded. CI now runs the byte-reproduction check.

## Evidence and independence

The 13 new focused tests cover:

- The exact tree count and 1/4, 1/2, 1/4 compatible-deal probabilities; the shared queen
  of spades removes the fourth pairing. Every nonfold turn branch has exactly the 44
  physically available river cards, each weighted 1/44 conditional on that private deal.
- A separate audit expands the five allowed betting lines per live street, replays chip
  payments independently, and scores every showdown with the slow five-of-seven evaluator.
  It checks all 1,986 fixture terminals, with zero payout/probability/zero-sum difference.
  Deliberately changing terminal money, root weights or river weights makes this audit fail.
  A second-agent review caught a NaN-comparison false-negative in the audit itself;
  explicit finite/probability checks and mutation regressions now reject it. No accepted
  fixture value or game rule changed.
- Unequal stacks, short calls, capped bets, all-in runouts, folds before the river,
  carried contributions, zero-stack starts, ties, and returned uncalled chips. Seeded
  property checks cover additional small stack/bet combinations.
- Nine fixed-river continuations (three turn histories × three river cards) reduce to
  existing v3 no-raise action order and terminal utilities. This is a rules reduction,
  not a claim that independently solving those rivers yields the same joint strategy.
- In a reduced forced-opening-shove game, information-set best response agrees with all
  four pure response policies. Predealing the river while keeping it hidden preserves
  value and legal best response. Exposing it in the turn information set improves the
  responder by more than five chips—an illegal advantage absent from the real grade.
- The same private hand/public turn history groups different opponent hands together;
  different turn histories stay separate on the river. A controlled 80% versus 20%
  opening strategy changes a conditional opponent mix from 1/3 to 2/3; revealing its
  ace then removes that combination entirely. No independent-marginals shortcut is used.
- Deterministic solving and update-order equivalence, finite complete strategies,
  malformed/future-conditioned policy rejection, hash tampering, and regrading the saved
  average strategy. The full solve reproduces bytes through the CLI, separate from units.

The new game shares the existing range parser/card representation and generic game
interface. The slow payout oracle does not independently reimplement range syntax.
Its independent raw-weight calculation requires finite positive product/sum mass;
it rejects extreme overflowing weights even when the production game's scaled
normalization accepts them. Rescale such weights before using this reference audit.
This limitation is tested and does not affect the locked fixture.
The grader is independent of CFR's regrets, not an external third-party turn solver.
No direct external turn-solver parity or full-range playing-strength claim is made.

## Final release verification

The integrated working tree passed 483 unit tests and 38 Chromium browser tests,
type-checking, lint and the production build. A separate export of only the staged
release passed 472 unit tests, 35 Chromium browser tests (no retries), type-checking,
lint and the production build. The different totals are the preserved, uncommitted
local features and tests, not skipped release tests. The clean export also passed
the 13 focused turn tests and byte-for-byte turn artifact reproduction.

Existing Kuhn, Leduc, river v1/v2/v3, exchange and all five multiway artifacts reproduced.
The exhaustive 2,598,960-hand five-card audit, compact-engine/scorekeeper audits and
factorization audit passed. The boundary profile still handled 10,240 compatible deals,
87 public states and 890,881 equivalent repeated states; observed timings were 27.86 ms
per CFR+ iteration and 63.21 ms per grade, not performance acceptance thresholds.
No previous solver engine or saved artifact was modified.

The clean-release browser check exposed a new trainer test's accidental dependence
on uncommitted session-reset behavior. The test now exercises current-request error,
keyboard retry and navigation cleanup shared by both trees; no product behavior was
changed to satisfy it. Only explicit owned paths and clean candidates for overlapping
files are staged. Existing unrelated local work remains uncommitted.

## Engineering and next step

Hard caps are 8 unblocked range entries per player, 16 compatible private deals, 25,000
full states, 100,000 iterations and 16 checkpoints. Preflight counts a small public
betting skeleton before full-tree expansion. Whole chips, bounded text, copied/frozen
input, normalized relative weights and rejection of underflow prevent ambiguous inputs.
This readable CPU reference prioritizes inspectability over large-range speed.

Next: a bounded teaching view that explains one turn choice and its river consequences.
Conditional action-value semantics, useful examples and a browser execution budget must
be specified before adding that UI. More ranges, bet sizes, raises, flop play, learned
leaves, GPU acceleration and sampled multiway play remain separate milestones.
