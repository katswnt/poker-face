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

The initial six-policy scan passes: 2,520 decisions, 5,040 reach checks, no skipped
reach chains, 426 eligible opponent-value parent checks and no invariant failures.
Every root has 420 decisions. Scan payload:
`cf0c491a916133fbea9ef9687b28dc2b9e9e40debe6f2a22833e56714c62f420`.
The originally failing board's complete saved export now has maximum opponent-value
error 0.28153141415100436 chip; the captured target alone is below 0.1 chip with all
179 opponent hands retained. Two regression assertions failed against the original
encoder before the change; all five codec/schema/splitting tests then passed.

The frozen native controller starts from environment payload
`051b34a720d01652f8a16b7e9428137f44cf8278ce5133fe7a2a959506e39736`, binding source and
binary hashes before new work. Typecheck and focused lint pass before launch. Full
publication and fresh-reproduction results follow here when observed.

### Complete native experiment and publication

All six remaining roots pass. All twelve fresh repeats match every exported file hash,
iteration count and referee value. The new runs add 1,335,715.065708002 ms; cumulative
charged native time is 10,199,792.660663003 ms (169.996544 minutes), including all old
failures. There were no native retries. Selected historical inputs plus all fresh raw
outputs total 308,038,474 bytes. Native experiment payload:
`7e47665f5d71938e12e8adeef7fbcb393789c6d14ff4fc34f0f1446cbf36f1e8`.

Fresh repeats take 23,892.805042–105,771.412833 ms, peak at 3,563,126,784 RSS bytes, and
reach at most 0.2996826171875% starting-pot exploitability. These are this machine's
observations, not browser/device performance promises. All 5,040 saved decisions pass:
10,080 reach checks, zero skipped reach chains, 852 eligible opponent-value parent checks.
Maximum reach error is 0.001521215756; actor EV error 6.0644 chips; opponent EV error
2.655619342038 chips. Each remains within its unchanged scale-dependent v1 tolerance.

The first final publication audit failed a chip/percentage metadata identity at its
unchanged 1e-9 tolerance. Native `Exploitability.chips` is `f32`; `pct_pot` widens that
float32 to float64 before division. Parsing the shortest decimal directly as float64
introduced up to 8.786715022247e-9 percentage discrepancy. The first mismatch was
0.2980935573577881 versus 0.2980935538461538. No native policy or value invariant failed.
The candidate manifest, complete run log and original audit source are preserved under
`tasks/artifacts/formation-full-reach-v2/publication-v3/`; the native report's `complete`
status describes the native phases, not that failed publication.

A [prospective metadata correction](artifacts/formation-full-reach-v2/publication-v3/contract.md)
then restores the exact native float32 chip values using `Math.fround`. It changes only
manifest quality metadata and adds a hash-bound publication revision. Every one of the
253 data files remains byte-identical. Quality and metadata-identity tolerances remain
unchanged; the restored identity is exact on all twelve roots. A dedicated regression
failed before correction, then passed. All nine new tests pass, including malformed and
unavailable values, subnormals, legacy-reader refusal, deterministic splitting/key order,
missing parts, hashes and native-journal corruption.

The complete v2 library audit passes after correction. Publication receipt:
`a10dba20935ca91abb46d4e7e9ef64ca728fad64575df711e87a8bf04d598322`;
manifest payload `77313f2e2ad2e3fc15454bfdf4ba4240f95e321b4c550ebdfcc637370efb668e`.
The 253 data files total 71,575,083 raw / 18,420,200 pinned-gzip bytes before the manifest.
Combined published v1+v2 formation bytes, including manifests, are 195,176,056 (<512 MiB).
All ordinary/referee file caps pass. The independent river referee has 15,987 deals and
21 public nodes; P0 value −131.72498523094586 versus native −131.72498883119937 differs
by 0.000003600254 chip. Its local exploitability is 1.840366378509131 chips, or
0.05261196050626447% of the 3,498-chip river pot. This does not certify all later nodes
or the rounded partial download.

Commands used, with full logs in `build/formation-full-reach-v2/`:

```sh
node --import tsx --test test/formation-full-reach*.test.ts
node --import tsx scripts/measure-full-reach-v2.ts --measure
SOLVER_BRIDGE_BIN=/private/tmp/poker-co-diagnostic-exact-7gbr0dck/native/solver-bridge/target/release/solver-bridge \
  node --import tsx scripts/build-full-reach-v2.ts --run
node --import tsx scripts/publish-full-reach-v3.ts --publish
npm run audit:bridge:formations:v2
```

Measurement/publisher commands are historical recipes with immutable destinations, not
repeat/retry commands. The npm audit is read-only, checking every attempt, both publication
identities and all published data without Rust. The original controller's `--check`
describes the superseded candidate and is not the current audit. Another native experiment
requires separately declared records/budgets. Original v1 data, native/WASM sources,
production `/play`, PF4 and external MCCFR stay unchanged.

The first isolated full-suite invocation used the restricted sandbox: 1,184/1,194 passed,
zero skips, with ten existing native/worker tests failing because their `ps` RSS sampler
received `spawn EPERM`. The full 164,034.786708 ms log is retained as `exact-unit.log`.
The unchanged suite is then run with process-monitoring permission, matching the successful
native experiment environment; no test, sampler, timeout or numerical assertion is altered.
Final isolated results and hosted CI are retained in the local release receipt.
