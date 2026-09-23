# River Solver Lab — release audit

Date: 2026-09-22. Contract: [River Solver Lab specification](river-solver-lab-spec.md).

Status: accepted. The final working-tree regression run passed all 402 unit tests and all 20
production Chromium tests. Type-checking, lint, production build, the listed artifact reproduction
checks, factorization audit, and boundary profile passed.

## Delivered behavior

`/solver/river` opens a saved river decision without running a solve in the browser. It offers
editable v3 inputs, a small preset, exact preflight counts, bounded custom worker solves,
independent quality measurements, cancellation, and a decision inspector. The Leduc route links
to the new lab and retains its existing lessons.

The browser ceiling is 100,000 equivalent repeated states, 2,000 iterations, 128 range combinations
per player after board removal, and the existing v3 sizing and raise limits. Chip inputs are
bounded, odd pots are rejected rather than rounded, and each custom solve uses a 20-iteration
averaging delay. Larger script limits are unchanged. Preflight work estimates are node visits,
not invented runtime promises.

The inspector distinguishes prior contributions from future chip change, caps short all-in calls,
removes returned overbets from the final call pot, labels conditional showdown share, and withholds
off-path values. Opponent ranges update by Bayes' rule after observing a response. Forcing one's
own action with a known hand does not itself reveal opponent cards.

## Mathematics and preservation

The synchronous and chunked APIs share the existing arithmetic loop. Arbitrary chunk partitions,
snapshot reads, delayed averages, ordinary CFR, CFR+, checkpoints, and cumulative regrets have
regressions. Ordinary CFR agrees exactly with the independent readable implementation.

The 1,000-iteration chunked v3 strategy is byte-for-byte identical to the serialized checked-in
strategy. The complete v3 artifact also reproduces, including its independent 7,216-terminal audit:

| Measurement | Reverified value |
|---|---:|
| Compatible deals | 176 |
| Public states | 63 |
| Equivalent repeated states | 11,089 |
| Information sets | 308 |
| Player 0 value | +16.081056725 chips |
| Player 0 best-response gain | 0.014993444 chips |
| Player 1 best-response gain | 0.003155818 chips |
| Exploitability | 0.009074631 chips |

Rules SHA-256: `36ec8173c65b6c503a2e11636f63538a38dd65acf031d5b675abf695f521bbab`.
Artifact SHA-256: `320759e74808f8c5cb784b0e92c3410de02567252346d671a7b0a6eb722ea4e9`.

The factorization audit reports exactly zero ordinary-CFR, CFR+, and scorekeeper differences.
Its wider fixture still has 5,052 deals, 21 public states, and 106,093 equivalent states, and is
correctly refused by the browser. Kuhn, Leduc, river v1, and configurable river v2 artifacts also
reproduce without changes.

## Tests and verification

The handoff matched the initial tree: all eight listed unrelated files were already dirty.
The initial full suite had 388 passing tests. The new working-tree suite has **402 passing tests**,
including 14 new tests for sessions, worker boundaries, inputs, and mathematical teaching facts.

New tests cover actual completed-iteration events, independent grades matching the script API,
cancellation at each task yield, restarting after cancellation, overlapping commands, stale cancel
IDs, direct-command limit enforcement, malformed input recovery, snapshot stability, all-decision
inspection, compatible-path posterior weighting, blockers, zero-probability responses, off-path
values, and short-call prices. Existing hidden-card-cheating and solver regressions remain green.

All eight new production Chromium tests pass: saved-example inspection through a real worker,
field validation and focus, custom solving, stale preflight invalidation, oversized refusal,
completed-iteration progress, cancellation and restart, keyboard operation, and responsive layouts.
Screenshots at 320, 390, and 1280 pixels plus 200% text size were inspected. Forms, numeric results,
action comparisons, and range tables remain readable without page-level horizontal overflow.

The existing trainer and Leduc browser checks were also run. One intermediate run exposed an
unrelated random-hand-dependent trainer test at `e2e/keyboard.spec.ts:43`: after one preflop action
with pocket eights, there was no `.explained-term-button`, so its unconditional tooltip assertion
failed. It passed in prior runs. That test and all other unrelated handoff files remain untouched;
this observation is not presented as a River Lab regression or silently fixed in this milestone.
The final full browser run passed all 20 tests without retries. The intermittent failure remains
a known limitation of the unrelated trainer test, not something a passing rerun repairs.

Commands used:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run audit:river:v3
npm run audit:river:factorized
npm run audit:river:v2
npm run audit:river
npm run audit:leduc
npm run audit:kuhn
npm run profile:river:factorized
```

Browser binaries were absent in this environment. Playwright Chromium was installed into
`/private/tmp/poker-face-playwright`, and browser runs used that `PLAYWRIGHT_BROWSERS_PATH` plus
permission to bind the local production server. No dependency or lockfile changes were needed.

## Performance observations and limits

The existing boundary profile was rerun under Node v24.10.0 on arm64. The largest case still had
10,240 compatible deals, 87 public states, and 890,881 equivalent states. Its median was 26.71 ms
per CFR+ iteration and 63.54 ms to grade; compilation took 54.05 ms. These are local measurements,
not browser speed guarantees. They do not justify expanding the conservative browser ceiling.

The initial saved example sends about 86 KB of JSON: a decision menu, settings, quality, provenance,
and one detailed explanation. Subsequent explanations are requested in the worker. Bounded bulk
teaching construction and grading still run synchronously inside that worker; cancellation waits
for the current operation. The main UI remains responsive. A worker failure retains the displayed
result and offers recovery, but a lost custom worker context must be solved again for further
inspection. No partial cancelled strategy is published as a completed result.

Native controls, scoped CSS, visible focus, correctly associated errors, consistent DOM order,
and no added animation follow the baseline-ui and fixing-accessibility guidance. Browser tests
found and corrected helper text leaking into accessible names and focus being requested before
React re-enabled invalid inputs. Decision selectors retain keyboard focus while explanations load.

## Portfolio claim

> I built a river teaching lab around an audited finite poker game, with reproducible chunked CFR+
> in a worker, independent exploitability measurements, exact card enumeration, and explanations
> of action values and changing opponent ranges. The displayed strategy is an approximation for
> the specified game, not universal or exact GTO.

No claim is made about unrestricted no-limit hold'em, earlier streets, multi-player strategy,
unique action frequencies, or monotonic improvement at every checkpoint. Unrelated working-tree
files were checked against their initial SHA-256 values and are excluded from this milestone.
