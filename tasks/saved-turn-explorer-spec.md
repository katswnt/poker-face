# M4 — saved turn explorer contract

Locked 2026-09-23 before implementation. Baseline `dce11e9`.
Parent: [CPU-first plan](cpu-postflop-solver-plan.md), M4.

## Scope

Add `/solver/postflop`, preserving all engines, saved policies, older labs, trainer work
and browser solve limits. This is an explorer of existing jointly solved turn/river
strategies, not a new solve, standalone curriculum, full-range product, or flop engine.
Publish complete navigation for two accepted M3 examples: `turn-v2-dry-value` and
`turn-v2-paired-short`. Their handcrafted three-hand ranges are teaching/test assumptions.
The wider 64-hand example stays offline; do not imply these UI examples demonstrate new
capacity or represent recommended preflop ranges. No new dependency or animation needed.

## Conditional mathematics

- Enumerate compatible physical private pairs and all 44 legal rivers per pair. Normalize
  product range weights once after blockers. Reach = initial deal probability × all
  earlier action probabilities × public-card probability. Retain both players' reaches.
- A hand inspection fixes only the current actor's own hand. Never inspect the hidden
  opponent hand when choosing an action. Changing the inspected hand does not fix a deal
  for later public navigation. Show this distinction next to the controls.
- Action frequency is the saved strategy. Action EV forces that action once, then follows
  both saved continuation policies. It does not maximize later choices or resolve the game.
  EV from now = net utility from hand start + this player's prior and current net payments.
  Differences use unrounded values. A fold is worth zero from now (including any refund).
- At a decision, normalize joint reach over opponent hands conditional on the actor's
  hand. A forced own action does not change that distribution. An immediate opponent
  response multiplies each weight by that hand's response frequency, then renormalizes.
  Report zero-probability responses with undefined posterior, not invented uniform ranges.
- Immediate fold probability is available only if the next node is an opponent decision
  with a fold choice. Distinguish it from any later fold probability.
- Static check-down share averages win + half tie over every legal remaining river with
  the current posterior, ignoring all later betting. Showdown share after an action
  conditions on reaching showdown under saved continuation play. Neither replaces EV.
- Public range action mixes weight each actor hand by its joint reach, never equally.
  Chance-card probabilities use public-history joint reach with both hands unknown, not
  whichever hand was last inspected. Unsupported cards remain listed but unavailable.
- Exact zero reach is off path. At reach <=1e-12 also withhold conditional facts for
  numerical reliability; explain why. Positive reach below 1e-6 receives a separate rare
  decision caution. Whole-game exploitability is not a local action-EV error bound.
- Legal off-path actions remain navigable. Frequencies remain visible but conditional EV,
  equity, range weights and response probabilities are null, never silently zero.
- Terminal money, matched contributions and returned excess follow unchanged turn-v2.
  Display both stacks and public actions; all-in runouts still reveal a river.

## Offline pipeline and bounded web data

Pure explanation math is independent of React and network code. One offline command
validates source hashes/schema, rules/game identity, legal policy and independent quality,
then derives all facts. Reproduce byte-identical chunks with a separate `--check` mode.
No source policy or engine imports in client code or initial page payload.

Split each example into one turn chunk and 48 river-card chunks. A river chunk contains
every public history for that card. Include all legal nodes and all compatible acting
hands, without silently pruning low-reach rows or rounding stored math. Metadata links
source request/policy/payload hashes and each derived chunk's SHA-256/byte count.
Digest checks establish integrity relative to the checked manifest, not authenticity.

Locked budgets: manifest <=128 KiB raw; initial turn chunk <=256 KiB raw; each lazy chunk
<=1 MiB raw; each scenario <=5 MiB gzip; complete two-example catalog <=10 MiB gzip and
<=64 MiB raw. Browser keeps at most two loaded chunks, one bounded pending response and
small manifest/navigation state. Abort superseded/unmounted loads; reject wrong version,
scenario, card, length/hash or shape; offer a retry without replacing the last valid view.
Use streaming byte limits before JSON parsing. Measure parse/validation time and sampled
heap separately; byte limits are not OS memory guarantees. If budgets fail, stop and
document the cause; do not quietly weaken them or truncate a scenario.

## Interface and accessibility

Instant server-rendered default turn view; scenario picker, native hand selector, legal
action navigation, back/start controls, turn-history shortcut and river selector. Keep
loading/error messages by the action, cancel/retry available, and old results clearly
identified while a requested view loads. Focus the new decision heading after navigation;
native selects keep focus on selection. No custom keyboard shortcuts or grid widget.

Show board, acting order, ranges, stacks, menus, exact enumeration versus approximate
strategy, iterations, both deviation gains and exploitability in chips/percent of pot.
Percent of pot is not “accuracy.” Plain default copy; detailed provenance in native
details. An accessible hand list/table substitutes for a decorative 13×13 range grid.
Numeric frequency labels, visible focus, 44px controls, no color-only meaning or motion.
Reuse existing palette/native primitives and route-specific CSS; do not touch dirty globals.

## Gates

Independent repeated-state reach/continuation checks on small fixtures and synthetic
policies, slow showdown and separate money replay, full source-grade preservation,
Bayes normalization, zero/rare reach, zero-frequency forced actions, response/posterior,
river blocker/chance, all-in/refund and weighted aggregate tests. Verify root policy EV
equals the independently graded value. Validate corrupt chunks, stale loads, cancellation,
retry and unmount behavior without real solves in a browser.

Production Playwright: instant view without worker/solve requests; both examples; turn
and river navigation; every legal choice/hand; keyboard/focus; associated errors; delayed,
failed and corrupt fetch recovery; 320/390/1280px, 200% zoom, long-value internal clipping;
metadata and bundle/payload checks. Inspect screenshots, not only overflow assertions.
Run full units/typecheck/lint/build, M3/M2 and older relevant artifact audits, and clean
staged-release checks. Preserve unrelated files and README hunks; stage explicit paths,
commit/push only after gates pass. Record actual evidence/limits in the M4 audit and plan.
