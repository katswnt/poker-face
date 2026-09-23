# River Solver Lab — browser teaching contract

The `/solver/river` route teaches the audited configurable river v3 game. It is separate from
the Leduc lab, the push/fold explorer, and the four-player trainer. This milestone adds a product
surface and a resumable execution boundary; it does not change poker rules, utility definitions,
information sets, the CFR+ update order, or the independent scorekeeper.

## Inputs and conservative limits

- Five distinct river cards and two explicit weighted ranges using the existing parser.
- Player 0 acts first (out of position); player 1 acts second (in position).
- An even, positive whole-chip starting pot, split equally into prior contributions. Odd pots
  are rejected, because silently rounding or assuming unequal prior investment changes v3's game.
- Positive stacks behind, up to five opening bets, up to five raise-to targets, and 0–2 raises.
- Chip inputs are bounded at 1,000,000; range text is bounded at 2,000 characters per player.
- Browser solves allow at most 100,000 equivalent repeated states and 21–2,000 iterations.
  The fixed averaging delay is 20. These are admission limits, not speed guarantees.
- With zero raises, an empty raise menu is normalized to an unused target of 1 because the
  underlying versioned v3 contract requires a nonempty menu. No raise becomes available.

Preflight runs in the worker. It parses ranges, removes board blockers, enumerates compatible
private deals, and counts the public tree without building the repeated tree or allocating CFR
state. It reports deals, public states, equivalent states (`1 + deals × public states`), and
approximate node visits (`deals × public states × iterations × 5`). Five counts the two
forward/backward regret passes and one forward averaging pass; grading and explanations are extra.
Invalid games and inputs beyond the v3 library's own admission limits return errors.

The browser ceiling is checked again on every solve command before compilation, including commands
that bypass the UI's preflight button. Larger admitted v3 games remain available through scripts;
no engine admission limit is raised by the UI. Editing any field invalidates preflight.

## Execution and cancellation

`createFactorizedRiverCfrSession` owns one persistent numeric workspace. `advance` continues its
regrets and average-strategy sums; it never restarts. The existing synchronous solve wrapper uses
the same session, preserving iteration order and artifact bytes. The engine has no React,
worker, scheduling, or clock dependency.

The worker runtime injects a clock, event sink, and yielding scheduler. Each chunk finishes at
most 16 iterations or stops after an iteration once 16 ms have elapsed. An individual iteration
cannot be interrupted. Independent grading occurs approximately every 100 completed iterations
and at completion. Each reported grade includes the actual iteration it measured. Exploitability
need not decrease monotonically.

Cancellation is checked at task yields before preparation, chunks, grading, explanation creation,
and publication. It reports the completed iteration count, leaves the previous result intact, and
does not label an ungraded partial strategy as a completed result. Preparing, grading, and teaching
operations are synchronous within the worker; cancellation waits for the current operation.
Unmounting terminates the worker. Request IDs discard stale messages, and simultaneous solves are
rejected. A failed inspection restores the previously displayed selection.

The iteration bar measures completed learning iterations, not convergence or remaining time.
Elapsed time uses the local monotonic clock and includes preparation, grading, and explanations.
The checked-in example has no invented elapsed time.

## Teaching and information boundaries

The server renders one checked-in explanation and the decision menu (about 86 KB of JSON), so
opening the example does not require a browser solve. Additional decisions are inspected in the
worker. The worker may build all existing teaching facts below the conservative teaching ceiling,
but only one detailed explanation is sent to React at a time.

Each decision exposes saved action frequencies, exact action EVs against that approximate saved
strategy, the gap from the highest measured EV, immediate responses, next-response fold probability,
terminal outcome probabilities, conditional showdown share, and the blocker-aware opponent range.

- EV from hand start uses the engine's net-chip convention.
- EV from now adds back the acting player's already-paid contribution. Folding is zero from now,
  up to floating-point roundoff. Display rounding does not affect calculations.
- The call price is capped by remaining chips. The final call pot excludes returned uncalled chips.
- Showdown equity is conditional on reaching showdown after the selected action, with ties worth
  half. It is unavailable if showdown has essentially zero probability.
- Off-path decisions (reach at most `1e-12`) show unavailable values and ranges, not confident advice.
- For a known private hand, forcing one's own action does not change the opponent range. Observing
  an opponent response updates each possible hand by its information-set response probability,
  then normalizes. Zero-probability responses have no invented posterior. Blocked hands stay zero.

The product always labels the result an approximate strategy for this finite game, never exact or
universal GTO. Explanations connect price, position, blockers, ranges, stack depth, and discrete
bet sizing to these facts. The settings that produced a result stay attached to it while the form
is edited. Custom results are explicitly distinguished from the hashed release artifact.

## Accessibility and implementation boundaries

Use the existing dark neutral and green palette, scoped CSS, native labeled controls, native
disclosures, visible focus, 44-pixel control targets, a skip link, and actual table headers.
No custom keyboard widget or animation is needed. DOM order and visual order agree on narrow
screens. Errors are associated with fields, announced, and focus the first invalid input; general
errors and solve completion focus the status panel. Rapid iteration updates are not live announcements.

The baseline-ui and fixing-accessibility skills informed these choices. The requested CSS module
and the existing native-control pattern are preserved without installing a new UI framework.
Global CSS and all unrelated handoff changes are outside this milestone.

## Acceptance

- Chunk boundaries and snapshots preserve ordinary CFR, CFR+, delays, checkpoints, and regrets.
- Ordinary CFR still agrees exactly with the independent readable solver.
- The chunked 1,000-iteration v3 strategy matches the checked-in artifact exactly.
- Worker progress, cancellation, stale cancellation, overlapping commands, error recovery, and
  direct-command resource rejection have tests.
- Response posteriors agree with independent compatible-path weighting. Short calls, returned
  overbets, zero response mass, off-path decisions, and blocked cards have direct tests.
- The full unit suite, v3 reproduction, prior heads-up artifact reproduction, factorization audit,
  current boundary profile, type-checking, lint, production build, Playwright user flows, keyboard
  checks, and responsive visual inspection pass before release.
