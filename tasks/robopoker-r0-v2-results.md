# R0 v2 — scorer repaired; fixed training run fails convergence

Observed 2026-11-25 PST under the [prospective contract](robopoker-r0-v2-contract.md).
The separately versioned local fork passes its full-tree scoring prerequisites.
The first 100,000-epoch ExternalSampling run then exceeds the original 0.45-chip
maximum unilateral-gain limit. Stop at that gate: its planned second run and both
PluribusSampling runs are unattempted; three-player turn/river remains blocked.
No convergence tuning, changed iteration count, seed search or tolerance change.

## What changed

Local `mccfr 1.2.0-poker-face.1` adds `CfrExact::exact_full_tree` to a preserved
copy of registry 1.2.0. It validates full actions/terminal leaves/perfect recall,
accumulates chance and opponent reach, selects one response per information set
from deepest own-decision history to shallowest, and evaluates the final response.
The existing TS referee uses independent recursive information-set optimization;
tiny games also enumerate every pure response. No statewise hidden-card choice is
allowed. The weighted hidden-state witness returns 17.5, not the clairvoyant 32.5.

Only the vendored Cargo version and module exports differ from original files;
the new scorer is additive. The original `CfrNash` methods, training/sampling code,
default features and all transitive dependency versions are unchanged. The local
adapter calls the repaired method explicitly. `upstream-sources.json` binds every
copied original file, with MIT notices preserved. This is a tested local repair,
not evidence that unmodified upstream 1.2.0 passes. Original R0's failed artifacts,
native crate and audit remain unchanged and still reproduce the original failure.

Training and stored probabilities remain float32. The export includes the exact
f32 values as f64 and explicit f64 row normalization. Both raw and normalized
measures are evaluated over the full tree; an independent direct evaluation
checks raw profile values. Only normalized rows are certified probability
strategies. The training run's largest normalization effects are 1.055341914e-6
chip in a profile value and 1.005670539e-6 chip in a best-response value. Those
effects are reported, not silently absorbed into the 1e-6 agreement threshold.
The normalized profile itself is graded identically by both implementations.

## Measurements

M1 Pro, Darwin arm64, Rust 1.98.1; one worker, one tree per epoch, tree seed
20261122, LinearRegret + LinearWeight. Native timing includes input parsing,
validation, training where applicable, complete-tree raw/normalized grading and
policy export preparation. Compilation and independent Node grading are separate.

| Check | Native time | Peak RSS | Score disagreement | Result |
|---|---:|---:|---:|---|
| Sequential witness, two fresh processes | 0.730 / 0.242 ms | 1,802,240 B | 0 | Pass; player-0 BR = 10 |
| Original uniform river, two fresh processes | 95.998 / 80.234 ms | ≤12,533,760 B | 5.116e-13 chip | Pass; all 58,726 expanded states |
| Weighted hidden, zero opponent reach, thirds | 0.044–0.089 ms | ≤1,835,008 B | ≤8.882e-16 chip | Six fresh passes; exact repeats |
| ExternalSampling, 100,000 epochs | 1,836.766 ms | 12,943,360 B | 2.621e-14 chip | **Convergence fails** |

The trained process wall time is 1,841.329 ms. Its normalized profile values are
`[10.29027520851703, 2.8970991113146423, -13.187374319831664]` chips.
Independent best-response values are
`[10.822829667888152, 3.6214974408548875, -13.086981613310765]` chips.
Unilateral gains are **[0.5325544594, 0.7243983295, 0.1003927065]** chips.
The mean gain is 0.4524484985; the acceptance metric is the maximum, **0.7243983295**,
which exceeds **0.45**. Numerical agreement, execution time and RSS pass. This
result applies to this frozen fixture, algorithm configuration, seed and count;
it does not establish that longer training or other configurations cannot converge.

Ten prerequisite processes and one training process were observed. All raw process
results were saved before assessment, exclusive-create. Evidence:
[freeze](artifacts/robopoker-r0-v2/freeze.json),
[result](artifacts/robopoker-r0-v2/result.json), and the eleven adjacent attempt files.
Freeze payload SHA-256:
`260b81a760bfe21685c690619bb3ee912dc9f0cd777bc6e7ffb32e64f175baf3`.
Result payload SHA-256:
`3872c489ad7ebe55f488ace1158bfa27184bcde5f64f74cf1ad1aef955931030`.

## Validation and reproduction

The Rust regression first fails numerically: original BR **1**, expected **10**.
It then passes with the repair. Four Rust tests and four TS tests cover input
validation, exhaustive witnesses, perfect-recall rejection, actual native scoring,
false certificates, profile completeness, explicit normalization and saved source
identity. TS first fails on its missing audit module. All final focused tests pass.

The initial timed rebuild compiles successfully in 1.82 seconds, but macOS denies
`time -l` its `sysctl kern.clockrate` query; that wrapper exits 1. The unchanged
warm rebuild with process-statistics permission completes in 0.13 seconds with
67,174,400-byte peak RSS. Neither figure is a clean dependency-build benchmark.
An early root TypeScript check also reads ignored backup copies and the untouched
paused configurable-flop draft; it fails there. The isolated source check passes.
These environment/mixed-worktree failures are preserved under
`build/robopoker-r0-v2/`; no unrelated files are changed to hide them.

```sh
npm run audit:robopoker:r0:v2
cargo test --release --locked --manifest-path native/robopoker-referee-v2/Cargo.toml
npm run reproduce:robopoker:r0:v2
```

Audit/reproduction exit zero means the saved **convergence rejection** is verified.
Reproduction replays the saved sequence with the same inputs and compares every
numerical output, then checks fresh time/RSS. It is verification, not permission
to continue the stopped candidate or relabel a repeated run as a new successful
experiment. Hosted CI retains original R0 and additionally builds/tests/replays v2.
Release verification and untouched-work details are in the
[November 25 handoff](codex-handoff-2026-11-25.md).
