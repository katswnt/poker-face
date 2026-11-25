# Codex handoff — 2026-11-24 CO–BTN full-reach completion

The diagnostic release `e0bc097efb541deb36b28c43316bf438170a5504` passed 1,185/1,185
isolated unit tests and all eight jobs in [CI 45537891627](https://github.com/katswnt/poker-face/actions/runs/45537891627).
Its [record](formation-export-diagnostic-v1-spec.md) preserves the original fourteen
saved-value failures, two identical native captures and the interrupted sandbox attempt.

The subsequent [full-reach v2 milestone](formation-full-reach-v2-spec.md) completes
CO–BTN coverage: all twelve frozen roots pass the original native, saved-value, file,
pack-size and referee gates, and all twelve freshly reproduce every exported data byte
and iteration count. Step 13 now has **three complete offline packs / 36 roots**.
The new pack is `public/solver-data/bridge-formations-v2/co-btn-srp-v1/`; the two v1 packs
and production `/play` stay unchanged. Manual teaching ranges are not solved preflop play.

## Evidence and limits

- The v2 encoder retains every positive native float32 reach, including subnormals.
  Strategy remains per mille; EV 0.1 chip; equity per mille. No threshold was widened.
- All 5,040 saved decisions pass, with 10,080 reach checks, zero skipped reach chains
  and 852 eligible opponent-value parent checks. The captured failed target retains
  all 179 opponent hands and agrees within 0.1 chip after the existing EV rounding.
- Six new generation solves plus twelve fresh reproductions added 22.261918 minutes.
  Total charged formation compute, including all historical failures, is 169.996544
  minutes against the original eight-hour cap. No new native run retried.
- Fresh quality is at most 0.2996826171875% of starting pot; peak RSS is 3,563,126,784
  bytes. Each fresh solve took 23.9–105.8 seconds on this M1 Pro. Device performance is
  still unmeasured; these are offline native observations.
- The 253 data files total 71,575,083 raw / 18,420,200 pinned-gzip bytes before the manifest.
  Combined v1+v2 formation bytes including manifests are 195,176,056 (<512 MiB).
- The full-precision river referee differs from native P0 value by 0.000003600254 chip;
  its conditional local exploitability is 0.05261196050626447% of river pot. This does
  not certify every later node or the rounded partial download.

Native experiment payload: `7e47665f5d71938e12e8adeef7fbcb393789c6d14ff4fc34f0f1446cbf36f1e8`.
Publication receipt: `a10dba20935ca91abb46d4e7e9ef64ca728fad64575df711e87a8bf04d598322`.
Manifest payload: `77313f2e2ad2e3fc15454bfdf4ba4240f95e321b4c550ebdfcc637370efb668e`.

## Preserved publication failure

The native experiment completed successfully, then the first final publication audit
refused a metadata identity: shortest float32 chip decimals parsed as float64 differed
from the engine's percentage by up to 8.786715022247e-9. The unchanged tolerance is 1e-9.
The pinned Rust source explicitly widens the original float32 before calculating percent.
A [prospective metadata correction](artifacts/formation-full-reach-v2/publication-v3/contract.md)
restored those exact float32 chip values. It changes no policy byte, native observation,
quality target or tolerance. The original manifest, full run log, failed source and
native experiment remain preserved; the corrected publisher passes the unchanged full
auditor. Do not edit source-hashed code to hide this history.

## Replay and release verification

`npm run audit:bridge:formations:v2` is the current read-only command: it checks native
journals, reused-input provenance, exact fresh reproduction, both publication identities,
every saved file and the independent referee without launching Rust. Existing
`audit:bridge:formations`, `audit:bridge:formation-export` and `audit:bridge:library`
continue checking unchanged historical packs and evidence. The original v2 controller's
`--check` targets its superseded manifest; use the npm command for the current pack.
Measurement and publisher destinations are immutable; do not retry historical commands.

Nine focused regressions pass, including fail-before-fix reach and metadata assertions.
The initial full suite passed 1,184/1,194; all ten failures were sandbox `spawn EPERM`
errors in existing RSS samplers. Preserve that log. The full unchanged suite requires
process-monitoring permission, as used for the native experiment; do not remove checks.
Exact release verification uses `/private/tmp/poker-co-diagnostic-exact-7gbr0dck` with
copied dependencies and matching native/WASM builds: `npm test`, `npm run typecheck`,
`npm run lint`, the four audits above, and `npm run build`. Logs and the final staged-tree,
commit and hosted-CI receipt are retained in `build/formation-full-reach-v2/`.
Push only after isolated checks pass, and observe every hosted job green before dependent
work. The preserved binary in that checkout has SHA256
`7cbe699d9b3197606a80a4c8500a37cfdd9685d309d5120ab5bc57a69d5226c0`;
the root worktree's older native binary is not an equivalent reproduction binary.

## Remaining boundaries and protected work

Preflop validation still failed its original compute/coverage gate; PF4 remains blocked.
The pinned external MCCFR best-response prerequisite remains independently failed;
training and dependent three-player continuations remain unattempted. This is not
completion of the entire research program. Neither failed gate was changed to admit work.
Production remains the source-verified H1 release, with no new deployment or phone claim.

All seventeen original dirty files remain safeguarded by
`build/co-export-diagnostic-2026-11-24/protected-hashes.json`; trainer/session work and
the paused configurable-flop draft remain outside this milestone. README uses an isolated
research-only staged blob, while its original trainer hunks remain in the working tree.
The old R0 scratch checkout was retired only after its distinct generated files were
preserved and all tracked edits were verified against committed source; the H1 production
checkout remains untouched. Full native outputs are retained under
`build/formation-full-reach-v2/native/` and the original diagnostic/cache locations.
