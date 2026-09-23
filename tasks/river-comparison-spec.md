# River Lab — one-change comparison contract

## Scope

Pin a completed result and the currently inspected player, exact hand, and public
action history. Change exactly one declared input: the opponent's weighted range,
the shared opening-bet menu, or the opponent's remaining stack. Keep board, own range,
own stack, starting pot, raise targets/limit, CFR+ algorithm, averaging delay, and
iteration count fixed. Both players adapt in the new solve; this is not opponent locking.

The original result is reused, not retrained to animate progress. One resumable worker
session solves the changed game. The worker itself constructs the single-field change,
validates the anchor, and counts both games before allowing a solve. The sum of the two
equivalent repeated-state counts must not exceed 100,000. Individual parsing, deal,
range, iteration, and teaching limits still apply. Work shown is for the new solve only;
it excludes preparation, grading, and explanations and is not a time prediction.
No-op checks compare sorted declared bet menus, numeric stacks, or the compatible
joint deal distribution (absolute probability tolerance 1e-14). Unavailable declared
bet sizes can still yield an unchanged effective action tree; no strategic effect is promised.

## Mathematical boundaries

- Match decisions by player, unordered exact private cards, and exact action history,
  never by an opaque information-set key or by a convenient fallback decision.
- A removed history or a hand with no compatible opponent deal has no matching decision.
  Explain this; do not substitute another hand or history.
- Join action rows by legal action identity. An absent action is unavailable, not zero
  frequency. Off-path decisions retain unknown conditional values and are not compared
  as confident recommendations.
- Frequency differences are percentage points. Chip-value differences compare taking
  that action and then following each game's saved strategy, conditional on reaching
  the pinned decision. Changed beliefs/continuations are part of the comparison.
- Report each independently measured exploitability and both best-response gains.
  Equal iteration counts do not imply equal quality or unique action frequencies.
- For player p with profile value u and legal best-response gains g, the two-player
  zero-sum minimax value lies in [u - g[1-p], u + g[p]]. This follows from the guarantee
  of the fixed own strategy and the opposing fixed strategy's best-response ceiling.
  For two different games, subtract intervals as [new.low - old.high,
  new.high - old.low]. These are whole-game bounds before private cards, subject to
  floating-point arithmetic, not statistical confidence intervals or error bars for
  conditional hand/action values. No equilibrium ordering is claimed when they overlap.
- Show the joint reach probability of the exact private hand and public history in
  both profiles. Below 0.001 (one in 1,000 deals), add a teaching warning about rare
  decisions. This is a conservative display heuristic, not a mathematical accuracy
  threshold; the engine's existing off-path threshold and null values are unchanged.

## Interaction and safety

Pinning is explicit; later changes to the main form or inspector cannot change it.
Editing comparison inputs invalidates preflight, but a completed comparison stays
visible with its own saved change label. Cancellation/errors never publish partial
comparisons or erase the previous complete result. Ignore stale request IDs; reject
overlapping worker commands. Yield before final publication so cancellation also works
during explanation/inspection. Only one main/comparison task runs at a time in the UI.

Use native labeled controls, associated errors, visible focus, live task status, real
completed iteration counts and elapsed time, and route-scoped CSS. Test narrow screens,
keyboard operation, 200% text, real-worker completion/cancellation, and stale responses.
No new dependencies, engine changes, old artifact changes, or trainer edits.

## Deferred

Board/blocker, pot/price, and position changes need their own comparison semantics.
GPU integration, policy imports in the browser, opponent locking, earlier streets,
unbounded solves, persistence, and claims about Griffin's backend are out of scope.
