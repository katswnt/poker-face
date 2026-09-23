# River Lab one-change comparisons — release audit

Date: 2026-09-22. Base commit: `299cab8`.

## Delivered scope

The existing `/solver/river` now has **Change one thing**. Pin an inspected decision,
change the opponent range, opening bet menu, or opponent stack, check the pair's size,
then solve the changed game. The pin and any previous complete comparison survive
draft edits, cancellation, and worker failure. Re-pinning is explicit.

The comparison worker wraps the existing resumable River Lab runtime; it does not
implement another solver or restart training to manufacture progress. Both players
adapt with the same CFR+ iteration count and averaging delay as the pin. The worker
constructs the single-field edit and enforces the **combined 100,000-state ceiling**
before allocating a solve, scorekeeper, or teaching workspace. This is a pair-size
guard, not a promise about total browser memory or completion time.

No engine, existing worker/session implementation, scorekeeper, accepted artifact, or
four-player trainer was changed. No third-party implementation code was copied.

## Mathematical and teaching review

- **Decision identity:** player, exact own cards, and full public action history. Keys
  from different game IDs are not treated as interchangeable. Removed histories and
  fully blocked pinned hands do not fall back to another decision.
- **Action identity:** join by action, not array position. Missing actions are marked
  illegal rather than assigned zero frequency. Off-path values and deltas stay unknown.
- **Conditional values:** differences use each saved profile's own posterior beliefs
  and continuation strategy. They do not claim a guaranteed gain at equilibrium.
- **Rare decisions:** display the joint reach of the hand and history; flag reach below
  0.001. A short-stack experiment illustrates why low whole-game exploitability can
  coexist with large conditional errors at rare decisions. This warning threshold is
  a teaching heuristic, not a certified conditional-error threshold.
- **Whole-game bounds:** legal best responses bound player p's equilibrium value by
  `[u[p] - gain[1-p], u[p] + gain[p]]`. Subtract interval endpoints in opposite order for
  the changed game's difference. Tests enclose Kuhn's known value for both players and
  the known difference between two payoff-shifted Kuhn games. Bounds are rounded
  outwards for display; direction claims use those displayed bounds. They are labeled
  subject to floating-point arithmetic, not statistical
  confidence intervals or conditional action-value error bars.
- **Honest comparisons:** equal iterations do not mean equal convergence; action
  frequencies need not be unique. Both independent grades remain visible. The UI
  explicitly calls the strategies approximate and specific to their finite games.

## Verification

The working tree includes pre-existing, unrelated trainer/session edits and tests.
The full-suite counts below describe that working tree, not solely this commit.

- `npm test`: **451 passing** (13 new comparison tests).
- `npm run test:e2e`: **31 passing** (11 new comparison browser tests).
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed.
- Artifact reproduction: Kuhn, Leduc, river v1, configurable v2/v3, and the exchange
  benchmark manifest passed without overwriting artifacts.
- Compact CFR, compact scorekeeper, and factorized audits passed with zero numeric
  differences against their retained reference paths.
- Boundary profiling passed: 10,240 deals, 87 public states, 890,881 equivalent states;
  approximately 27.15 ms per iteration and 60.50 ms per independent grade in this local
  Node v24.10.0/arm64 run. Timings are observations, not browser guarantees.

The v3 example still has 176 deals, 63 public states, 11,089 equivalent repeated states,
and 308 information sets. Its 1,000-iteration profile remains:

- player-zero value `+16.081056725` chips;
- best-response gains `0.014993444` / `0.003155818` chips;
- exploitability `0.009074631` chips;
- rules SHA-256 `36ec8173c65b6c503a2e11636f63538a38dd65acf031d5b675abf695f521bbab`;
- artifact SHA-256 `320759e74808f8c5cb784b0e92c3410de02567252346d671a7b0a6eb722ea4e9`.

## UI, accessibility, and reliability review

Baseline-ui and fixing-accessibility guided reuse of native controls and the existing
scoped CSS, associated field errors, visible focus, native keyboard activation,
live task status, and no added animations or UI dependencies. Visual checks inspect
setup, results, and action comparisons at 320/390/1280 px and 200% text. No horizontal
overflow was detected. These are Chromium checks, not a screen-reader certification.

Worker tests cover cancellation in preparation, solving, grading, explanation, and
final matching; no partial comparison is published. Tests also cover overlapping
commands, stale cancellations, stale UI responses, crashed-worker recovery, no-op
inputs, a pair of individually allowed games exceeding the combined cap, and exact
agreement with the synchronous solve and independently generated teaching facts.

Development checks exposed test assumptions, not engine discrepancies: Chromium's
native select uses portable type-ahead rather than macOS End/arrow behavior; a
100-chip opponent still permits larger wagers with uncalled chips returned, while an
opponent already all-in at 50 cannot be raised. The keyboard regression uses that
actual all-in boundary. Existing engine rules were preserved.

## Limits and next steps

Pins and comparisons live only in the current page. There is no history export,
browser policy importer, opponent locking, earlier-street comparison, or GPU adapter.
Changing position, board/blockers, or the starting pot remains deferred until its
decision-identity and payoff semantics are specified. Cancellation remains cooperative:
an individual preparation, grading, or explanation operation must finish before yielding.
The larger solver remains script-accessible under its separate limits.

All unrelated local files remain unstaged and unchanged. Only comparison-owned changes
and matching documentation are intended for this milestone; README staging excludes
its pre-existing trainer edits.
