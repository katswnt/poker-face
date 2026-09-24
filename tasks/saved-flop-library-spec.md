# M6 saved flop library — implementation contract

Locked 2026-09-23 before library generation. Parent:
[CPU-first plan](cpu-postflop-solver-plan.md). M5 rules, solver and grades stay unchanged.
This extends the collection to three streets; `/solver/postflop`, `/solver/river` and
`/solver/lab` retain their current behavior. New route: `/solver/flop`.

## Scope and gates

- Six initial scenarios: five handcrafted, small teaching ranges covering dry, two-tone,
  paired, connected and monotone boards; plus the already accepted synthetic 64-by-64
  capacity example. These are supplied postflop assumptions, not solved preflop ranges.
- [Input definitions](../src/lib/solver/postflop/flop-library/fixtures.ts) and
  [SHA-256 hashes](saved-flop-library-input-hashes.json) are frozen before any new acceptance solve.
  All use flop-v1: one capped opening bet per street, no raises, two players, no rake,
  exact ordered runouts, first/second action order on every street, returned excess.
- CFR+, float64, delay 20, 100,000-iteration maximum; independent grades at the M5
  checkpoints; accept only at exploitability <=0.25% of starting pot, prefer <=0.10%.
  Keep the 2 GiB/10-minute per-solve limit. Never shrink an unsuccessful fixture silently.
- One local job at a time. Canonical game, algorithm, version and quality settings form
  a content-addressed cache key. Cache reuse requires full validation and independent
  regrading, not just file existence. Restart from complete iteration-boundary checkpoints.
  A queue report distinguishes accepted, incomplete, failed and not-yet-run jobs.
- The existing wide result may be reused only when these identities agree; do not solve
  it again merely to generate a new progress display. Keep measured runtime out of hashes.

## Publication and loading

Validate the complete policy before making browser data: canonical source hash, rules
identity, counts, numeric policy, options, iteration, independent values/gains and quality.
Each manifest binds every slice's version, source hash, byte count and SHA-256. The site
must refuse a missing, mismatched or corrupted slice, never substitute a nearby scenario.

Do not ship the 87 MB numeric source policy to the browser. Separate flop and turn views
from lazy river-policy groups. A river group contains at most four river cards for one
turn. Each fetched slice is <=1 MiB raw; initial default view <=256 KiB raw; manifest
<=256 KiB raw. First-view transfer must remain below 5 MiB gzip and the complete initial
catalog below 100 MiB gzip. Raw sizes, gzip sizes and parse/load observations are measured
and reported separately. Gzip is transport, not identity. Keep only the active slices
and required flop/turn ancestry, not an unbounded visited-board cache.

## Conditional mathematics

Use the same definitions as the M4 explanation contract: joint compatible reach;
forced-action EV under the saved continuation policy; sunk-cost-adjusted EV from now;
gap from the highest action EV; immediate opposing responses; current and response-
conditioned ranges; and separate static check-down versus selected-showdown shares.

For flop/turn facts, stream complete compatible private deals through the saved tree
offline. Reuse bounded per-deal/depth scratch, not a private-pair-by-public-node matrix.
Accumulate only the front-street facts needed by the browser. Full river facts for every
private hand/history would be unnecessary bulk and are not an initial download.

At a selected river, calculate exact conditional explanations in a Web Worker from
the validated saved policy slice. This is evaluation, not a new CFR solve. Preflight
the selected subtree and reject over 100,000 repeated states. A flop-v1 river subtree
has at most nine public states, so even the 3,755-deal fixture fits this ceiling. No
main-thread fallback. Typed request IDs reject stale completions; cancelling terminates
the owned worker. No fake solver progress or percentage-of-accuracy indicator.

Public-card navigation keeps both hands unknown. Inspecting one private hand affects
that explanation only, not the next public card's probability. A hand's own action
frequency cannot reveal the opponent's actual cards or a future card. Zero reach means
undefined conditional facts. Reach <=1e-12 withholds fragile conditionals; below 1e-6
gets a rare-decision warning. Whole-game exploitability is not a local EV error bar.

## Interface

- Native scenario, board-texture and first/second-role controls; explicit action order.
  No invented real-seat provenance for the synthetic case. Position here means who
  acts first and second; range inputs remain visible and downloadable.
- A range grid summarizes using joint reach, with an exact physical-combo selector and
  an accessible table/list alternative. Do not equally average hand cells or hide suits.
- Follow legal actions and both public cards, step back and reset. Versioned scenario,
  source hash and public history identify shareable links; invalid links fail visibly.
- Show assumptions, original pot/stacks, declared street sizes, iteration count, both
  best-response gains, exploitability in chips and percent of pot, and source identity.
- Always label the result an approximate strategy for this finite game, not exact or
  universal GTO. Unsupported boards, extra sizes, raises and preflop are not implied.
- Apply baseline-ui and fixing-accessibility: existing native primitives, route CSS,
  visible focus, labeled controls, relevant status/error announcements, no new animation,
  no changes to dirty global/trainer files. Preserve focus during view navigation.

## Verification and tradeoffs

Streaming explicit deals favors transparent explanations and bounded memory over maximum
export speed. Measure its cost; if it cannot fit, profile before adding a second optimized
math path. Lazy river evaluation adds an asynchronous boundary: cover cancellation,
failure/retry, stale IDs, source mismatch and bounded work with tests. Small teaching
ranges improve clarity but are not scale evidence; the accepted wide example remains
selectable and is labeled synthetic. No claim of matching Griffin's unseen engine.

Required gates: independent forced-action/payoff checks on tiny cases; global value
agreement with the saved grade; blocker/chance/zero-reach tests; full source and slice
reproduction on Node 20/24; queue/cache corruption and resumption tests; unit/type/lint;
existing solver audits; production build and browser regressions; keyboard, 320/390/1280
widths, 200% text size, internal clipping, actual desktop/mobile lazy-load measurements.
Record untested browsers and assistive technologies honestly. Source engines/artifacts
and unrelated local work must remain intact. M7 is conditional: no native/GPU work is
needed merely to make the milestone list look complete if this target fits its budgets.
