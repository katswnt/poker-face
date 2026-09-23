# Vector turn engine — M2 locked contract

2026-09-23; baseline `6ed0469`. Locked before implementation or a new acceptance solve.
Parent: [CPU-first plan](cpu-postflop-solver-plan.md). M1 remains an unchanged reference.

## Scope and fixed acceptance

Add an offline hand-range-vector backend under `postflop/vector/`, keeping turn-v1's
betting, payouts, exact river enumeration, action order and information keys. No raises,
extra sizes, sampling, buckets, learned leaves, UI, GPU or native backend. Existing
engines, accepted artifacts and browser limits remain unchanged.

Initial new admission cap: 64 unblocked physical combinations per player, 100,000
iterations, bounded whole-chip v1 inputs, at most 16,384 characters per range. Relative
weights below 1e-12 of that player's maximum are refused, not rounded away. This explicit
numeric-conditioning guard does not change weights in an accepted game. Root-unsupported
hands may occupy range storage, but cannot create information sets or positive mass.

The M0-locked `POSTFLOP_M2_PROBE` is the primary acceptance: 64 combinations each,
3,773 compatible deals, 100-chip pot, 150-chip stacks, bets 50/100, no raises. Request
SHA-256 `279c58fd54b45fac11db44dcd2e840335496d6dbd69c400038e1bc37ce34f533`.
Use alternating CFR+, delay 20. Grade at 256, 1,024, 4,096, 16,384, 65,536 and 100,000
completed iterations; accept the first of those checkpoints at exploitability <=0.25
chip (0.25% of pot), with <=0.10 chip preferred but not required. At most ten minutes,
including compile, grade and export, and a conservative 1 GiB estimated/sampled worker
memory limit (stricter than the parent plan's 2 GiB ceiling). A missed gate is incomplete,
not a reason to shrink the fixture or loosen the target. No larger-range capacity claim.

## Representation and root measure

Use validated physical hands, independently max-scaled player weights, card-incidence
arrays and same-combination lookup. Count compatible deals and the root normalizer with
blocker sums, not a materialized pair or pair/runout list. Explicit pairs remain test
oracles. The public tree must cover all 48 board-unblocked rivers independently of private
hands; any pair has exactly 44 outcomes at 1/44. A bounded single-deal v1 rules harness
may supply public transitions/topology only; its private deck, ranks, weights and policies
must never be used for the wide game. Each information set is public node plus own hand,
and exists only if some structurally compatible opponent remains after public blockers.

Root probability is `w0[h0] * w1[h1] * compatible / Z`. Never independently normalize
reached player ranges. At every public node store per-hand action reach excluding root
weights/chance, and values already summed against the opponent's weighted action reach.
Terminal utilities use matched contributions with uncalled excess returned, as in v1.

## Terminal kernels and traversal equations

For hero cards a,b, compatible opponent mass is
`total - containing(a) - containing(b) + exactCombo(a,b)`.
The last term fixes double subtraction; identical hands remain incompatible. Fold values
are signed matched-chip amounts times that mass. Showdown uses exact rank-sorted legal
hands and separate strict-weaker/strict-stronger sweeps; ties contribute zero net utility.
Weights are rebuilt from current action reach at every call. Integer positive-support
counts distinguish actual zero from cancellation; numerically ill-conditioned positive
mass queries fall back to explicit compatible summation rather than inventing zeros.

Maintain a separate direct pair-scan kernel for both players, folds, all ranks and masks.
No terminal sweep scans all pairs in the ordinary well-conditioned case. Rank sorting and
hand scoring happen at compilation, not each iteration. Use float64, not compression.

For player i, the value vector at their node is the action-probability-weighted sum of
child vectors. At the opponent's node it is the **unweighted sum** of child vectors,
because the opponent's action probability is already in each child's reach. At chance,
mask hands containing the river and sum children times 1/44. Counterfactual regret is
`(childValue - mixedValue) * ownRootWeight/Z * pastChance`, where pastChance is 1 on
the turn and 1/44 on the river. Do not include own action reach in regrets or apply the
opponent's action probability twice. Average once per information set using own action
reach, with ordinary weight 1 or CFR+ weight `max(0, iteration-delay)`.

Ordinary CFR freezes both players then applies both updates. CFR+ alternates players
0 then 1, clips regrets to zero and averages the post-update profile, matching M1's
specified convention. Vector regrouping changes floating-point accumulation order;
there is no promise of identical long-run mixing to a scalar backend.

## Independent grader and numeric gates

The grader has its own depth-first vector traversal, bounded depth × hand workspaces,
and no access to regret/update code. It may share immutable rules/ranks and tested terminal
primitives. Evaluate profiles and best responses separately for both players. A response
maximizes only after hidden-opponent possibilities and future chance are integrated;
it cannot choose a turn action separately for future rivers or opponent hands.

Compare both kernels and graders on seeded/random complete profiles, asymmetric weights,
ties, shared cards, zero reaches, short/all-in/zero stacks, suit and weight transformations.
Compare tiny-game state/index/action counts exactly to M1/readable. Compare legal best
responses with exhaustive reduced policies and deliberately cheating oracles (which must
gain illegally). Preserve old hidden-card and future-card cheating regressions.

Finite checks come first. Probability normalization: 1e-12. Evaluation/gains/terminal
vectors: absolute tolerance 1e-10*S after the appropriate root normalization, with
S=max(1, maximum absolute terminal utility). At 1,2,10,100 iterations, normalized policy
differences <=1e-9; regrets/strategy sums <=1e-9*max(1,iterations*S). Investigate failures,
never simply widen tolerances. Long-run acceptance uses the independent grade, not matching
all tied mixing frequencies. The old artifact must still reproduce with its old backend.

## Resumption, process and artifacts

Chunking/snapshots cannot change a trajectory. A complete checkpoint contains version,
canonical game identity, algorithm/settings/budget, completed iterations, regrets and
average sums. Restore validates identities, dimensions, finite values, signs and bounds;
JSON round-trip must continue bit-identically. Saved average policy alone is not a restart.
Hash the checkpoint envelope; hashes detect corruption, not trustworthy provenance.

The isolated offline runner validates/admit inputs before wide allocation, reports real
stages, iterations, elapsed time, work and last grade with its iteration. Cancellation or
timeout terminates the worker without exporting an accepted result. Optional checkpoint
files retain only completed iterations using atomic temporary-write/rename; never replace
pre-existing user files. Resume into a different fresh output path. Failed/incomplete
quality is explicit. Memory estimates include grader/policies/checkpoint/serialization and
runtime headroom; V8 and sampled RSS are not an OS hard total-memory guarantee.

Hash canonical rules/input, full policy and quality metadata; exclude timing. Keep the
wide policy offline (no client-bundle import). Provide an audit command that reproduces
the accepted iteration count, hashes and independent grade without overwriting artifacts.

## Profiling and release

Lock the 8/16/32/64 prefix ladder from the fixed M2 request; 128/256 remain refused under
this milestone's initial cap. Profile compile, CFR iteration, grade, kernel, snapshot,
export and target-quality elapsed time. Five samples after warmup; no competing heavy
benchmarks. Report typed arrays separately from isolated process RSS and timeouts.
Compare vector kernels/grading with the naive pair variants on the same wide input and
M1/repeated/readable on admitted tiny inputs. The parent's 3x kernel/grade improvement is
an engineering target, not mathematical acceptance; disclose a miss and identify why.

Release requires focused differential/checkpoint/CLI tests, full domain tests, old solver
audits/reproduction, type-check/lint/build, existing keyboard/responsive browser regression,
and clean staged-export validation. Preserve unrelated local work and stage explicit paths.
Update README, parent execution record and roadmap honestly; do not mark M3 complete.

Algorithm-family reference: [Tammelin's CFR+ report](https://arxiv.org/abs/1407.5042).
It discusses vector traversal, alternating updates, nonnegative regret and delayed linear
averaging. This implementation's precise convention and all numerical claims require the
local independent tests above; no third-party implementation is copied.
