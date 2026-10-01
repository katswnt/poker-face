# Codex handoff — 2026-09-30

## Outcome and remaining decision

**W1–W4 are shipped. P1–P5 are not complete.** The P1 admission/coverage gate fails under
the roadmap's current browser limits and prescribed wide-range game. The independent
TypeScript part of P4 is implemented, pushed and verified with all eight hosted CI jobs
green. No playable `/play`, production resolve ladder or Rust gadget is claimed.
Follow `cpu-ceiling-roadmap.md`'s working rules and browser architecture;
older native-server/degradation ideas in the draft play spec are superseded.

Continuing the product path needs Kat's direction on a **new measured admission/coverage
plan**, not more iterations or a hidden reduction of the game. Options are wider browser
ranges after physical-device memory/latency measurement, or a coverage-complete precompute
design that addresses rivers, betting lines and omitted strategy columns as well as turns.
A smaller range-restricted teaching game changes the requested product. No option was
silently selected, no cap raised, no 99% retention floor relaxed, and PF4 remains withheld.

## Commits and hosted gates

Each code commit was tested in a fresh isolated checkout with **copied node_modules** before
push to `origin/main`. Every hosted job was observed green before the next milestone began.
P4's independent study started only after the failed P1 diagnostic release was green.

| Work | Commit | Hosted CI |
| --- | --- | --- |
| W1 shared resumable native/WASM session, single-thread build and parity | `ebcd248` | [36753561883 — green](https://github.com/katswnt/poker-face/actions/runs/36753561883) |
| W2 bounded Worker, export-aware admission, real progress/cancellation | `bf44ef2` | [36757906224 — green](https://github.com/katswnt/poker-face/actions/runs/36757906224) |
| W3 measured Chromium/Firefox/WebKit resource profile | `0accb63` | [36763545452 — green](https://github.com/katswnt/poker-face/actions/runs/36763545452) |
| W4 accessible `/solver/live`, saved example and source-complete asset preparation | `a87b34a` | [36768099422 — green](https://github.com/katswnt/poker-face/actions/runs/36768099422) |
| P1 **failed-gate diagnosis**, not a play policy | `f394fb7` | [36773596576 — green](https://github.com/katswnt/poker-face/actions/runs/36773596576) |
| Independent P4 Resolve/Max-margin study, not production P4 | `0fae3ed` | [36779205846 — green](https://github.com/katswnt/poker-face/actions/runs/36779205846) |

README changes are confined to the browser/play roadmap paragraph. The trainer README
hunks stayed unstaged and byte-equivalent to the starting patch after normalizing line
numbers. AGPL source links stay on engine-serving pages. No unrelated files were staged.

## Browser solving: what shipped and what did not

`/solver/live` offers guided turn/river setup, advanced Spot JSON, explicit admission,
real Worker progress/cancel/error/retry, and root-hand frequencies, values and checkdown
equity. It is an approximate strategy for a specified finite game, not exact/universal GTO.
No live flop, per-action live EV panel, GPU training or global poker-strength claim.
The independent saved example works without live assets. Production live solving requires
the explicit source-complete asset preparation step; **public deployment of those assets
has not been verified**. The Leduc and other existing labs remain intact.

Unchanged browser limits include float32, turn/river only, 64 hands/player, 256 MiB solver
reservation, 120 seconds, 10,000 iterations, bounded menus/explicit trees, 100,000 export
nodes and 32 MiB JSON. The reservation is **not a total browser-memory cap**. There is no
automatic compressed solve, main-thread fallback or silently smaller game.

W3's 24 fixtures × three browsers produced 63 admitted and nine refused jobs in fresh
processes, with 100 iterations per admitted job. Machine: M1 Pro, 32 GiB, macOS 26.4.1,
Node 24.10. Frozen grid/report details are in `postflop-solver-w3-verification.md`.

| Browser | Observed admitted request-to-result wall times | Largest sampled total process RSS |
| --- | ---: | ---: |
| Chromium | 52.4–1,305.5 ms | 330,186,752 bytes |
| Firefox | 88–16,145 ms | 1,089,961,984 bytes |
| WebKit | 37–1,236 ms | 423,100,416 bytes |

RSS includes baseline/shared pages and WebKit's relevant XPC processes. It is sampled,
not a certified continuous heap peak or physical-phone OOM test. No cap increase follows
from these desktop measurements. Physical iOS/Android and assistive-technology checks
remain open; multi-threaded WASM is not shipped.
Wall times include Worker startup, loading, preflight, solve, export and result delivery;
each input was observed once. They are not p50/p95 estimates or convergence certificates.

W4 exact-commit checks: **874/874 unit tests**, 16 Rust tests; tsc/lint; saved-only and
prepared builds; 34 prepared three-browser cases passed with two Chromium-only zoom
exceptions skipped on Firefox/WebKit; 22 saved-only cases passed with 14 explicit skips;
86/86 complete prepared Chromium smoke tests. All browser runs used zero retries.
Widths 320/390/1280, native keyboard controls, 200% font resize and actual Chromium 200%
browser zoom were checked. Route-scoped styling and native controls follow baseline-ui
and fixing-accessibility; metadata was checked separately. No dirty global stylesheet edit.

The W4 source archive was independently rebuilt offline: 1,670 source/notice files matched,
and native/WASM numerical comparisons matched on the audited fixtures. Release hashes:

- Source: `c5ec5c8a4f3c1f16994b52d382f0406961ebdffd11f8ca24dec282f97585933d`.
- W4 build: `e90bc5eb4c73cbf8e50d1a400926c5cf82ff3e2e5f624e34eb69c09dc8050080`.
- WASM, 748,486 bytes: `7f6fd51167a66c439f9a9817503d6dc404b7e95efb2fcc867720d6af2bf05f3b`.
- Source archive: `fa02014ae90aa77f7abaaf8ce4e76b467da3f55b6065aa598653e257c94240a3`.

These identify that verified release, not assets served by an uninspected public deployment.

## P1: measured blocker

See `heads-up-play-p1-admission.md` and `artifacts/hu-play-p1-admission.json`.
The frozen audit uses seeds 0–4095, all 12 saved flops, the real P0 reducer, actually played
per-mille strategies, compatible private dealing and unscripted remaining-deck runouts.
It freezes the first 32 reached roots on each street, not roots selected for admission.
It binds 121 published input files; its roots contain no private deal or hidden runout.

| Measurement | Turn | River |
| --- | ---: | ---: |
| Reached roots | 3,131 | 354 |
| Both ranges retain ≥99% within 64 hands | **0** | **0** |
| Exact saved root available | 474 | 0 |
| No saved policy for that board | 2,627 | 354 |
| Median hands needed for 99%, OOP / IP | 541 / 384 | 368.5 / 263 |

Only 1,066 of 4,096 prefixes completed using saved policies; 3,030 stopped without a policy,
including nine missing a positive-reach strategy column. The river sample is conditional
on a preceding covered turn; it is not an unconditional river sample. Translation changes
bet sizes, not boards. Seed 0 needs 554/364 hands and has no saved turn policy; its SPR
17.727 also exceeds the current browser menu limit of 10. Hand count is not the only gate.

Native full/pruned EV and full-range exploitability comparisons remain **unmeasured**, not
zero: the stipulated 99%-mass browser candidate does not exist at the blocked roots.
P1's 1,000 complete production-AI hands, ≥20 river referee checks and latency/leak gates
are not met. P2, P3 integration, production P4 and P5 remain blocked. P0's equal-share
starting-pot net convention is not a validated real-preflop/session ledger for the 50-chip
dead blind; do not feed it into session profit without reconciling real stack changes.

Diagnosis payload: `5708279f22c75c316a8d97dd4dfb1d857976127da11b3527f50e4c390cc807f9`.
P1 exact-commit checks: **884/884 tests**, no skips; 16 Rust; tsc/lint/build; admission,
bridge, library, river-v3 and preflop audits. Additional saved-only Chromium: 82 passed,
four explicit live-only skips, zero retries. All eight hosted jobs green.

## Independent P4: what the study established

See `heads-up-play-p4-study.md` for the frozen contract, complete table, citations and
reproduction commands. `src/lib/solver/river/resolving.ts` adapts the unchanged TS compact
CFR+ engine. Bounds are independently graded per-hand counterfactual BR values of a
**complete translated blueprint in the expanded game**. Zero-modeled-reach hands remain
protected; gadget hand choices stay hidden from the AI. Only the AI policy is grafted.

The study compares translation, unsafe, unsafe-at-parent, Resolve and Max-margin on a
12,145-state expanded river-v3 game and a 49,193-state turn-v2 game with one added river
bet. The latter is **a river replacement inside a fully graded turn game**, not a turn gadget.
Both gadget modes pass the frozen per-hand and whole-game 0.0002-chip increase targets.

- Unsafe river re-solving increases the opponent's whole-game BR by **9.202488671 chips**;
  Max-margin lowers it by **0.118838561** versus translation. Unsafe-at-parent happens to
  perform better in that fixture, so no universal ranking is asserted.
- Unsafe-at-parent in the turn fixture lowers aggregate BR but increases one protected
  hand's value by **1.206626799 chips**. Aggregate improvement is not per-hand protection.
- Turn-fixture Resolve fails the per-hand bar at 1,000 iterations (+0.037341351) and
  10,000 (+0.000546684), then passes at 100,000 (-0.000054893). The report retains all attempts.
- An analytic toy game reproduces Max-margin's known 5/8–3/8 strategy and 1/4 margin;
  exhaustive pure responses cross-check the grader. A separate rare-hand test has gadget
  Nash gap below 1e-10 while one hand gains 0.5 chips: aggregate gap alone never certifies it.

Report payload: `909f2a92a2ebaad1c151bc5da5cca7c36d6c10d86aba5c22dc23980a6f10df30`.
No new poker rules engine, native fork, browser cap change, production fallback or preflop
range promotion. This research result does not unblock `/play` or prove a Rust-path guarantee.

P4 exact-commit isolation: **899/899 unit tests**, no skips, 16 Rust tests, tsc/lint/build,
gadget/P1 report reproduction, river-v3, full turn-v2 corpus, native bridge, library and
preflop audits passed. One first full run stalled in the existing flop-explorer cancellation
test file (idle process, no assertion reported). The file passed independently 7/7; only
that stalled process was terminated, leaving an explicit failed-run log, then the unchanged
full suite passed 899/899 without concurrent audits. No test, timeout or gate was changed.
Logs: `/private/tmp/poker-p4-commit-unit.log` (interrupted),
`/private/tmp/poker-p4-commit-unit-retry.log` (passed),
`/private/tmp/poker-p4-flop-check.log` (isolated file). The unchanged hosted domain suite
also passed; all eight CI jobs were observed green before this documentation closeout.

## Untouched work — do not stage, revert or hide it

Remaining pre-existing modified files: `METHODOLOGY.md`, trainer hunks in `README.md`,
`e2e/keyboard.spec.ts`, `src/app/globals.css`, `src/components/PokerSim.tsx`, `test/copy.test.ts`.
Remaining pre-existing untracked files: `src/lib/poker/session.ts`, `test/session.test.ts`,
`tasks/configurable-flop-v2-plan.md`, and seven files in
`src/lib/solver/postflop/configurable-flop/` (`artifact-node.ts`, `binary-node.ts`,
`compiled.ts`, `protocol.ts`, `rules.ts`, `scorekeeper.ts`, `session.ts`).

The paused draft still causes its original **nine root-worktree tsc errors** (missing
`policy`, `FlopV2` and `FlopV2Game`). Exact commits type-check because unrelated untracked
work is not in the commit, **not because tsconfig excludes it**. The draft's future remains
undecided. The trainer/session file hashes still match the starting hashes:

```text
ba643a5cadcc7bcf7f078403bb2903cfe1bfb1e0ecf05090589d632fa3e7c4ae  METHODOLOGY.md
799e71c4cd230b04c219e61090f8559239aa9ae7894221e5db0783a5a2636e94  e2e/keyboard.spec.ts
de3afb05a57dc7e90cdb4ae8374dc3252895d19378348ba76aad2a05edee830a  src/app/globals.css
8310cd1b1c35a6da68071e6ecf611e632b7f12d486d7d70c0cb30a8ed39cccd1  src/components/PokerSim.tsx
fc63ca8ec6b59aba06e88c1a1dd5719b2c498d686f1839fa5f3d4ba52855d53a  test/copy.test.ts
c54824e93f9a7b4754da63b26e5fdd1b3d99bbee5b595787654af0d2a0e163c6  src/lib/poker/session.ts
b21f57c303be97ea8f7df5719871c0d1b0468e6d230233d32f6c12caacb7ab5f  test/session.test.ts
```

The v3 regression remains +16.081056725 chips for player zero and 0.009074631 chips
exploitability. Diagnosed preflop artifacts reproduce, but reproduction does not validate
their payoff model. The validation contract/held-out small-game work still precedes any PF4.

## Continuation after Kat selected wider-range research

The earlier blocked status is historical. Kat authorized the rivers-first sequence in
[the P1 wider-range record](heads-up-play-p1-wide-feasibility.md), with physical devices last.
Research results now include all 64 native estimates and one-thread quality solves, 32
independent river grades, 18 paired browser timing jobs and 192 full-range browser quality
observations. All quality runs reached 0.3% pot; all browser numerical hashes match native.

Rivers: browser p95 66.8 / 188 / 65 ms (Chromium / Firefox / WebKit), maximum WASM high-water
1,900,544 bytes. Turns: p95 4,525.3 / 52,061 / 4,580 ms, maximum WASM high-water 22,937,600
bytes. Firefox's larger process overhead and much slower turns are not hidden behind an
average browser multiplier. The simple timing envelope covers only 107/192 observations.
The seven hash-bound reports and recomputed summary are under `tasks/artifacts/hu-play-p1-wide-*`.
Summary payload: `6970a2e7ab470bccb640aa18bcd67491b655f03eadbbac4d58232639d9f3163a`.

One prerequisite parser defect was fixed with serde_json `float_roundtrip`: valid exact-f32
JSON weights previously moved by one f64 ULP during parsing and were rejected. Native/WASM
regressions preserve strict validation, and raw decimal `0.03` is still rejected. Existing
solver algorithms, input ranges and quality tolerances did not change. All 64 estimates,
70 native numerical solves and 32 river grades reproduce locally; timing/RSS are observations,
not byte-identical performance promises. The native/WASM referee grid remains unchanged.

Proposed **unshipped** play profile: 640 hands/player, SPR ≤18, exact lean menu, float32,
first-street export, 1,000 iterations/120-second watchdog, 32 MiB engine ceiling and bounded
export. Keep the 128 MiB fixed overhead; total solver reservations 256 MiB desktop and
192 MiB mobile/unknown, further lowered by device-memory hints. Every recorded case fits;
the largest proposed reservation is 166,514,968 bytes. This is not phone certification.
Production W4 admission remains 64 hands/player and SPR ≤10; `/play` is not shipped.

Next: land this research/parser foundation only after isolated exact-commit verification
and green CI, then implement the scoped production profile and real sources and run the
unchanged P1 gates. The 12 original full-precision library result caches exist locally and
may support a separate complete-column flop policy supplement; do not overwrite the frozen
B4 files or invent omitted strategies. The real-source 1,000-hand replay/conservation/leak
and river-referee gates remain required. The device checklist is ready in the record and
is not a reason to wait. All protected trainer/session and paused-flop work remains untouched.
