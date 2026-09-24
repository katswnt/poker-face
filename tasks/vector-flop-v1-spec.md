# M5 range-vector flop backend — locked implementation contract

2026-09-23; extends the [tiny flop reference](heads-up-flop-v1-spec.md) without changing
its rules or accepted artifact. The tiny reference passed 1,024 CFR+ iterations at
0.0020317312919573283-chip exploitability; that is not this wider capacity gate.

## Representation and exact computation

- Keep `flop-v1`: one capped opening size per street, no raises; all three streets
  jointly solved with exact ordered turn/river enumeration and full remembered history.
- Build the public tree once. Public nodes remain distinct for different histories;
  only immutable hand ranks/blocker data share a visible-board context. No chance-node,
  policy, history, suit or terminal-value abstraction is introduced.
- Store information coordinates numerically as public node + acting player's hand.
  Two action slots per admitted hand row, including zeroed padding for physically
  impossible rows. Published information-set counts exclude padding; policy validators
  require padding to remain zero. Readable string maps are small-oracle/export adapters,
  not millions of repeated resident strings in the production backend.
- Per-visible-board compatibility uses exact incidence counts. Root normalization is
  the joint compatible product mass. Terminal values use the already audited rank-sweep
  kernel through board-local views, with BOTH revealed cards masked. Test against a
  separate explicit-pair kernel on every visible board and both players.
- Forward arrays carry action reach only. Terminal weights are opponent root weight
  times opponent action reach. Chance backups divide by 45 then 44; counterfactual
  regret separately multiplies past chance 1, 1/45 or 1/1980 exactly once. Average
  strategy uses own action reach once per information set, never per opposing hand.
- Ordinary CFR freezes the full strategy for an iteration; update each unique numeric
  information row only after its child values are known. CFR+ alternates player 0 then
  1 with a fresh frozen strategy, floors regrets at zero, then uses the post-update
  policy for delayed linear own-reach averaging. No sampling/pruning/neural leaf values.
- Independent depth-first grading integrates hidden hands/future cards before maximizing
  at a responding player's observed node/hand. It must not use solver value buffers,
  deltas, regrets or reported quality. Both native numeric policies and oracle mappings
  have strict shape, finite-number, probability, padding and identity validation.

## Admission, execution and data

Separate caps: 64 unblocked hands/player, 250,000 public nodes, 12,000,000 action slots,
2 GiB conservative estimated peak AND sampled combined worker/controller RSS, one job,
10 minutes end-to-end, 100,000 iterations. Refuse before public-node × hand allocations.
Never raise older turn/reference/browser caps. Count flop/turn/river betting skeletons
before multiplying 49/48 public and 45/44 private multiplicities.

Preflight storage estimate initially reserves 384 MiB overhead, 56 bytes/action slot,
16 bytes/public-node × both range widths, 400 bytes/public node, and 32 MiB board/rank
data. It includes solver, immutable data, independent grading, snapshot/checkpoint and
serialization headroom; calibrate against measured peaks, not just typed-array sums.
Signed 32-bit array indices must fit; equivalent repeated-state counts are safe integers
but need not fit 32-bit because they are not allocated.

Iteration-chunk sessions never restart for progress. Detached snapshots/checkpoints
record completed iterations; restoration must be bit-identical. Cancellation/timeouts
retain only a complete validated checkpoint, not partial iteration updates. A compact
binary float64 policy/checkpoint format may avoid giant JSON number/string duplication;
specify endian order, length, hashes and atomic file replacement before enabling writes.
Compressed bytes are transport only; canonical identity uses uncompressed content.

## Locked wider acceptance case

Board `9c 7d 4h`, pot 100 (50 each), behind stacks 75/75, bets 25/25/25.
Generate the 49-card board-unblocked deck in existing `RIVER_DECK` order, enumerate every
unordered two-card combination in ascending deck-index order, canonicalize combinations.
For each player take 64 entries: index `(offset + 17*i) mod 1176`, offsets 0 and 7;
entry weight `1 + (i mod 4)`. Name `flop-vector-wide-64`. Lock generated inputs/hash
before its first solve. At least 2,000 compatible private deals and reachable betting
on all three streets are required; do not shrink ranges or streets after a failed run.

CFR+, averaging delay 20; grade at 256, 1,024, 4,096, 16,384, 65,536 and final (100,000).
Accept the first scheduled saved average with exploitability <=0.25 chip, with <=0.10
preferred. Run envelope above is binding. Report quality in chips and percent of pot,
never percentage accuracy. Failure remains failure; profile before optional M7 changes.

## Required evidence before publishing

- Exact public/chance/action/payoff/observation reductions to the reference; full
  ordinary-CFR trajectories at 1/2/10 iterations and CFR+ short-run policy/grade parity.
- Both-card blockers, shared hands, nonuniform weights, zero reaches, tied rank groups,
  scale/suit transformations; vector/explicit kernels and independent graders agree.
- Reference artifact regraded unchanged; additional short/unequal/all-in/held-out cases.
- Hidden-hand and both-future-card cheating detection; full perfect-recall histories.
- Chunk invariance, real progress/cancellation, resume, malformed/corrupt/truncated and
  wrong-game policies/checkpoints, atomic writes and preflight overflow/refusal tests.
- Profile compile/solve/grade/export separately without concurrent heavy jobs; publish
  measured storage/RSS/time and actual complete quality, not iteration throughput alone.
- Reproduce accepted raw policy/manifest on Node 20/24; preserve old artifacts; full
  clean-release unit/type/lint/build and browser regressions before milestone commit.

M6 then adds reproducible catalog jobs and bounded browser slices. M7 acceleration is
conditional: numeric storage and buffer reuse are in scope here; a native toolchain,
third-party licensed engine, bigger envelope or changed mathematical model is not.
