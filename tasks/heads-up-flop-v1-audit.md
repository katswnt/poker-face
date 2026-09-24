# M5 flop reference and wider backend — execution audit

2026-09-23, baseline `ab0cc2e`. **Implemented and numerically accepted; release checks recorded below.**
Contracts: [reference](heads-up-flop-v1-spec.md), [numeric backend](vector-flop-v1-spec.md),
[binary storage](flop-binary-v1-spec.md). Parent [plan](cpu-postflop-solver-plan.md).

## Tiny reference: accepted numerical run

The locked three-deal fixture counts both future cards and all three streets jointly.
It has 484,813 repeated states, 1,225 chance nodes, 215,472 decisions, 268,116 terminals,
149,936 information sets and 5,940 private-deal/ordered-runout pairs. Every terminal was
checked against separate line enumeration, chip replay and the slow 5-of-7 evaluator.

At the locked 1,024 alternating CFR+ iterations (delay 20):

- Player-zero value: +48.01679234615438 chips.
- Legal best-response gains: 0.00017498467515508764 / 0.003888477908759569 chips.
- Exploitability: 0.0020317312919573283 chips, below the unchanged 0.25-chip gate.
- The earlier recorded 256-iteration grade was 0.002699365368538764 chips. The locked
  reference run still completed all 1,024 iterations rather than changing its run contract.
- Payload SHA-256: `00e520f94b3b07fa9796a3765ab49ae99d75e2188adf5d89087e597fb62da725`.
- Policy SHA-256: `182ff2d87509afd51dff789f6e84215ae00573b253bf479dea0a131098b79bb8`.
- Canonical JSON: 17,979,246 bytes. Local Node 24/M1 Pro solve, independent grade, all-
  terminal audit and export: 38.27 seconds; sampled combined process peak 1,314,799,616
  bytes, below the 2 GiB limit. These are observations, not speed/memory guarantees.

Ordinary compact CFR matched the unchanged readable solver at 1/2/10 iterations before
acceptance. Separate compact and readable information-set graders agree. Invisible
predealing of both future cards preserves value and best response. Deliberately revealing
the turn, river, both, or opponent hand improves the responder's value in positive tests;
turn decisions separately cannot peek at the river. Reduced exhaustive responses agree.
Fixed flop-action/turn-card continuations reduce to the unchanged turn-v1 game, including
all action/chance branches and net utilities. No independently re-solved turns were averaged.

The first launch encountered a sandbox denial of `ps` process-memory sampling, before a
result was exported. The controller now catches a synchronous sampler launch failure and
terminates its owned worker. No leftover worker remained. The permission-enabled run
above enforced its original budget; no mathematical tolerance or target was weakened.

## Wider implementation and pre-acceptance profile

The locked synthetic 64-by-64 ranges have 3,755 compatible deals and 7,434,900 ordered
deal/runout pairs. The public tree has 191,844 nodes, representing 606,823,021 repeated
states without allocating them. There are 5,017,600 real information sets and 10,913,792
allocated action slots including zero padding for structurally impossible hand rows.

Numeric public-node/own-hand coordinates replace millions of repeated string keys.
They do not merge histories, private hands, cards or ordered runouts. The session carries
action reach separately from root/past/future chance; grading uses a separate recursive
pass. Exact board-local adapters reuse the audited incidence/rank kernel while masking
both public cards. Explicit-pair checks cover every one of 2,402 visible-board contexts.
No old source engine or artifact has been modified.

Preflight estimated 1,517,014,080 peak bytes under the unchanged 2 GiB cap. A separate
12-iteration profile (two warmup iterations, then ten observations; not acceptance) saw:

- Compile: 427 ms; measured iterations 918–1,254 ms; snapshot 96 ms; grade 1,282 ms.
- Structural typed arrays: 9,980,344 bytes; session buffers: 556,608,656 bytes.
- Largest per-evaluation grading workspace: 5,470,792 bytes, excluding input policy and
  retained returned response choices. This is not total process memory.
- Observed/process-reported peak RSS: 990,314,496 bytes. Full profile: 13.89 seconds.
- Exploitability after only 12 iterations: 1.2395029771755934 chips; **not accepted**.

Snapshot/checkpoint arrays are detached. Binary files use explicit float64 little-endian
encoding, bounded decompression, canonical headers, game binding, SHA-256 and strict
numeric/padding checks. Gzip bytes are not canonical identity. Per-file temporary-sibling
writes preserve the previous file until rename; no multi-file atomic-publication claim.
Real worker cancellation saved a complete checkpoint and restored the same policy as
uninterrupted work. The memory controller also samples while the solver is busy.

## Wider acceptance, reproduction and release checks

The locked wide fixture passed at its first scheduled 256-iteration grade (CFR+, delay 20):

- Player-zero value: +3.2140528544632727 chips.
- Best-response gains: 0.04094237565192227 / 0.007236279441873883 chips.
- Exploitability: 0.024089327546898076 chips, under the locked 0.25-chip gate and the
  preferred 0.10-chip level in this 100-chip-pot finite game.
- Payload hash: `12c1c22e242147558306fcf51bc9d3fe4626071d96e063d8adf9791f7edbc815`.
- Uncompressed policy content hash: `30b9f2f774df637608e7591582bac5e08ed8b3a4b96ed29e258d54a6b8127b5f`.
- Full policy file: 87,310,644 raw bytes, 30,003,284 gzip bytes on Node 24. Compression
  is transport, not canonical identity or an initial browser download.
- Job including compile/solve/grade/export: 232.07 seconds; including parent decoded-
  policy verification and independent regrading: 234.13 seconds. Sampled combined peak
  1,047,707,648 bytes (worker 968,900,608), below the unchanged 2 GiB/10-minute envelope.

This earns the 64-by-64 single-size/no-raise M5 numerical capacity gate. It does not
solve preflop, unrestricted bet menus, arbitrary full ranges or a three-player game.
The ranges remain explicitly synthetic. M7 native/parallel work is not needed for this
locked target; richer menus and later scale must earn a new measured gate.

Both complete artifacts now reproduce on local Node 24.10.0 and Node 20.20.0: identical
canonical manifests, uncompressed binary policy bytes, values and grades. Node 24's wider
repeat took 232.85 seconds for the job (235.14 including parent verification); Node 20
took 572.65 seconds (577.75 including verification). The latter is close to the ten-minute
deadline, not evidence of headroom on slower machines. Sampled combined peaks on those
wide repeats were 1,037,533,184 and 1,006,551,040 bytes respectively. Node 20 compressed
the same policy to 29,939,518 bytes; differing gzip output is expected and not a strategy
identity change. Reference repeats also agreed on both runtimes (38.34 / 49.36 seconds).

Regular CI reproduces the tiny reference and rebuilds/regrades the complete saved wide
policy. Full wider solve reproduction is an explicit extended workflow so its near-limit
runtime is not multiplied into every browser check. Source verification checks versions,
counts, rules identity, complete binary contents/options and independent grade; a matching
checksum alone cannot authorize an incorrect or incomplete source for publication.

The custom CLI refuses pre-existing output/checkpoint paths and uses a default quality
target of 0.25% of the starting pot. An explicit `--target` is in chips. Cancellation
preserves a complete earlier checkpoint; output and resume checkpoint paths are separate.

## Release verification

On local macOS/M1 Pro, Node 24.10.0, Next.js 16.3.3:

- Working tree: 659 unit tests passed. The final strengthened flop suite has 25 passing
  tests on Node 24 and Node 20.20.0, including ordinary/CFR+ policy and regret parity
  through 100 iterations, real checkpoint cancellation/restart, sparse input refusal,
  checksum/numeric validation and exclusive initial output creation.
- Exact staged release, without unrelated local features: **648 unit tests passed**.
  The difference is 11 tests in preserved trainer/session work. M5 itself adds 25 tests.
- Type-check and lint passed in both the working tree and the exact staged export.
- Production builds passed in both. Production Chromium: 50 working-tree tests and
  47 clean-release tests passed, with zero retries. The extra 3 browser tests belong
  to preserved local trainer work, not M5.
- All existing `audit:turn:v2`, `audit:turn:vector`, `audit:turn:compact`, `audit:turn`,
  `audit:turn:explorer`, `audit:river:v3`, `audit:river:factorized`,
  `audit:river:exchange`, `audit:leduc` and `audit:kuhn` passed unchanged.
- The complete wide source regrade also passed in the exact staged export. Both full
  flop reproductions passed on Node 20/24 as recorded above. Extended historical
  multiway/profile commands were not all rerun for this additive milestone.

The first browser attempt failed before launching any test because the default
Playwright cache was absent. The already installed project browser at
`/private/tmp/poker-face-playwright` was then selected with `PLAYWRIGHT_BROWSERS_PATH`;
all checks passed without changing application code, dependencies or assertions.

The staged release was exported to a new temporary directory, with all 526 indexed
files matched by Git blob hash. No unrelated trainer files were staged. All seven
unrelated non-README files retain their initial SHA-256 hashes; the README's original
trainer additions/deletions remain exact and unstaged. Only solver-owned README hunks
are included. No old solver source or artifact bytes changed.

No new UI is introduced by M5. The existing production checks retain their keyboard,
responsive and conditional-teaching coverage; this is not a fresh screen-reader,
Safari or Firefox certification. M6's six inputs and library contract are frozen, but
its implementation and generated scenarios require their own release evidence.

## Next

Continue directly into the M6 queue, checked browser slices and `/solver/flop` explorer.
No native/GPU backend is necessary for the accepted M5 target. Future richer flop menus,
larger ranges and acceleration remain new measured targets, not implied capabilities.
