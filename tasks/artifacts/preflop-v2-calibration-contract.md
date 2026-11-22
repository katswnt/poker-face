## Execution record

The 504-root capacity screen passed (report pending release audit); this permits the
original calibration experiment. Before any full-deck solve, declare these additional
owned files: `src/lib/solver/preflop-v2/observations.ts`,
`scripts/solve-preflop-v2-calibration.ts`, `test/preflop-v2-observations.test.ts`, and
`tasks/artifacts/preflop-v2-calibration.json` and the immutable execution-protocol copy
`tasks/artifacts/preflop-v2-calibration-contract.md`. This is an execution protocol, not a change
to the frozen input or acceptance gates.

Run the 144 profile-A legacy/calibration roots in their original manifest order, one
native process at a time, eight threads, exactly the frozen spot limits (600 seconds,
5,000 iterations, 0.001% pot target, float32). Sample RSS every 50 ms, retain raw stderr
progress and sampled peaks even on failure, and kill at 16 GiB. Include finalization and
export in the wall budget. Total solve wall time remains four hours; raw evidence remains
at most 1 GiB. Do not invoke any profile-B or board-holdout solve before fitted-parameter
hash freeze. Stop at the first necessary solve-quality, time, memory or coverage failure;
unattempted rows stay unmeasured, not inferred failures. No partial strategy or progress
checkpoint is a passing continuation observation. Preserve raw successful JSON and verify
it with the existing bridge contract; retain per-hand `engineEv` (payout minus future
contributions, OOP/IP order), without clipping or target shifts. Do not fit until all 144
calibration observations pass. If they do, declare and implement the already-frozen
additive candidate's fitting/export files before proceeding. A runtime/coverage failure
blocks PF4, but does not falsify a candidate that was never fitted.
