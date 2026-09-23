# Trainer equity accuracy: fixed-budget estimates and exact river enumeration

This milestone changes the heuristic trainer, not the finite-game solvers. More
precise showdown equity does not turn the trainer into a solved strategy.

## Contract

- Enumerate every allowed, blocker-compatible opposing hand on a heads-up river
  (at most 990 hands). Use the existing selected-style range filter, uniformly
  over eligible hands. Do not consult the opponent's actual hidden cards.
- For layered calls, enumerate the joint opponent assignment, then score each
  layer against only its eligible opponents. A one-opponent side pot in a
  multi-opponent call is not an independent heads-up deal.
- Other production estimates use a fixed 10,000 accepted independent deals.
  Keep the existing seeded, whole-tuple rejection sampler and split-pot shares.
  Do not stop early based on the observed result.
- Preserve explicit Monte Carlo entry points for independent estimator tests.
  Production entry points choose enumeration when inexpensive and report the
  method explicitly. Enumeration has zero sampling standard error, not zero
  uncertainty about the opponent model.
- Measure standard error from actual shares or total layered returns. Explain
  one standard error separately from an approximate 95% sampling margin (1.96
  standard errors). Neither is a guaranteed bound; neither covers wrong ranges
  or unmodeled later betting. A zero empirical variance is not proof of no
  sampling error.
- Preserve the two-standard-error close-call safeguard; exact equality at the
  call price remains close. No equilibrium or universal profitability claims.
- Calculate hand decisions and larger readouts in a Web Worker. Keep the pure
  synchronous engine usable in tests and scripts. No silent main-thread fallback
  when workers fail. New requests/unmount terminate old workers, and stale
  messages cannot replace current results. Loading/error states are accessible.
- Preserve all unrelated local work. The existing full-hand calculation is
  extracted from committed code; optional extra money snapshots preserve the
  uncommitted readout's data without committing that readout itself.

## Evidence required

Fast enumeration versus the independent five-card evaluator; blockers, ties,
layer eligibility and returns; multi-seed sampling versus exact answers;
fixed-budget determinism; worker request/error/stale/unmount tests; browser
responsiveness and keyboard/regression checks; actual 1,000/10,000 timings. Record
hardware/runtime and distinguish timings from a cross-device performance claim.
