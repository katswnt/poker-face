# CO–BTN full-reach export v2

Frozen prospectively on 2026-11-24 after diagnostic commit `e0bc097` passed all eight
jobs in [CI 45537891627](https://github.com/katswnt/poker-face/actions/runs/45537891627).
That release passed 1,185 isolated unit tests; hosted verify passed 1,092 with 93 native
environment skips and 104 browser checks with 17 declared skips. No test retried.
The diagnosis and every original source, observation, validator and published pack remain
unchanged. This is a new representation experiment, not a reclassification of the v1 failure.

## Representation and fixed checks

Use a distinct version-2 chunk/root/manifest namespace under
`public/solver-data/bridge-formations-v2/co-btn-srp-v1/`. Retain every positive native
float32 reach as an absolute JSON number, reconstructed with `Math.fround` from the
native serializer's shortest decimal. This matters for subnormals: native `1e-45` and
`3e-45` encode the first and second positive float32 values, with ratio two. Reject
positive inputs that become zero; never omit positive reach. Zero reach has no saved row.
Keep strategy at 1/1000, EV at 0.1 chip and equity at 1/1000, using the unchanged
largest-remainder encoder. Preserve unavailable EV/equity as null. Strict v2 validation
checks shapes, board/card identities, positive exact float32 reach, zero omitted mass,
maxima, integer values and column sums. Legacy readers must reject v2 chunks.

Reuse the unchanged numerical invariant audit by a lossless unit conversion:
`reachUnits = absoluteReach / reachMax * 10000`, with no rounding or omitted hands.
The adapter is an algebraic audit input, never a v1 serialized artifact. Every existing
actor/opponent EV, bound and reach-chain tolerance stays fixed. Regression tests must
retain all 179 positive-reach opponent hands in the captured parent and eliminate all
14 known failures; include an independently calculable blocker example and subnormals.

Canonical sorted compact JSON determines bytes. Logical slices stay identical. Before
measurement, permit deterministic physical parts split greedily in native node order
at 1 MiB or 200 nodes. Part numbers start at zero with no gaps, and manifest references
bind each part's hash, size and count. Reject a single oversize node, missing/duplicate
parts or paths. No corpus, hand, menu or slice reduction and no file-cap increase.

## Bounded execution and publication

First encode and audit all six available complete native policies (the five original
accepted CO–BTN cache results and diagnostic run zero), retaining their distinct provenance.
On any gate failure record it and stop; do not tune the representation after measurement.
Only if all six pass, solve the six unattempted original roots in frozen corpus order.
Then freshly reproduce all twelve roots, requiring identical canonical exported bytes
and iteration counts, and the original full-precision river referee checks. Reused
generation inputs are labelled reused, never fresh. No partial CO–BTN publication.

Before fresh solves freeze controller/source hashes and the original binary identity
`7cbe699d9b3197606a80a4c8500a37cfdd9685d309d5120ab5bc57a69d5226c0`.
Reuse verified original preflights only because binary, inputs and slice plans are unchanged.
Preserve complete raw output before encoding, even when validation fails. Immutable attempt
records precede native work; no automatic retry. An interrupted unmeasured attempt costs
the full 1,800,000 ms. Process/RSS monitoring needs the same permission as the successful
diagnostic experiment; request that environment before launching, not after a failure.

All original limits remain: 8 threads, float32, 3,000 iterations, 0.3% starting-pot quality,
1,800 seconds per solve, 12 GiB estimated reservation, 16 GiB RSS, eight aggregate native
hours. Start the cumulative charge at 8,864,077.594955001 ms including all prior failures.
Ordinary files ≤1 MiB, referee ≤8 MiB, gzip per formation ≤40 MiB using pinned pako 2.1.0,
total published v1+v2 formation bytes ≤512 MiB, each raw native result ≤64 MiB, selected
v2 native input/cache ≤1 GiB (historical evidence retained separately). Preserve referee
native agreement ≤0.01 chip and re-grade agreement ≤1e-9. Never change a gate after results.

## Release

Add regression tests before the fix, a hash-bound result and read-only audit in CI.
Stage only explicit owned paths; preserve trainer/session and paused configurable-flop
work. Verify the exact staged tree in isolation with full unit tests, typecheck, lint,
relevant old/new audits and prepared production build. Commit/push and observe all eight
hosted jobs green. Record commands, values, identities and any stopped gate below.
No app integration, PF4 promotion, MCCFR change or deployment is included.

## Execution record

Implementation has not yet been measured. Publication remains withheld.
