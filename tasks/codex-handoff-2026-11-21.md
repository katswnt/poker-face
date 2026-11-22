# Codex handoff — 2026-11-21

## Current checkpoint: both new drills shipped

W1–W4/P1–P5, the release guard (R1), live action values (E1), push/fold practice (D1)
and equity-versus-range practice (D2) are complete. The latest detailed handoff is
[D2's release handoff](codex-handoff-2026-11-21-d2.md); read it before continuing.

- D1 code: `be05152`; release record: `ffbb82c`. All eight closing CI jobs passed in
  [run 44957214650](https://github.com/katswnt/poker-face/actions/runs/44957214650).
- D2 code: `0851bed`. All eight CI jobs passed in
  [run 44962474667](https://github.com/katswnt/poker-face/actions/runs/44962474667).
  The exact clean commit passed 1,122 unit tests (zero skips), 23 Rust tests, tsc,
  lint, 17 audits, guarded production build and all applicable browser checks.
- Production: <https://pokerface.katswint.com/drills?drill=equity-range>, deployment
  `dpl_FC5Bpfggh9XYcXrsKs1WgMiqaa6x`. All 38 drill files and six engine/source assets
  match their expected hashes. Deployed browser checks: 76 pass, two existing
  non-Chromium real-zoom skips, zero retries. Both drill types pass all three browsers.

D1 independently grades 12,506 saved decisions across 37 restricted push/fold games;
its maximum combined unilateral gain is 0.000046464518117771554 bb against the unchanged
0.0005 bb gate. D2 enumerates 3,780 distinct outcomes for 36 frozen turn/river examples,
with two independent hand evaluators and a 32,591-byte download. Practice tolerances
are not solver error bounds. Exact equity for a stated range is not a solved strategy.

Before starting the next milestone, verify and observe green CI for the closing-document
commit containing this handoff; `build/drill-expansion-2026-11-21/D2-release-current.json`
tracks the local execution checkpoint. Production stays on the tested code commit above;
documentation-only closure does not require deployment. Then write the separate `/play`
hand-review validation contract before implementing it. PF4 remains gated. Physical-device
checks are still unmeasured and nonblocking by Kat's instruction.

The trainer/session edits and their README hunks, paused configurable-flop draft and
pre-existing data-publication note remain untouched. See the detailed handoff's exact
list and `build/drill-expansion-2026-11-21/protected.json`. Never stage or repair them as
part of this work. No TypeScript files were excluded; verify exact commits in isolation
with **copied** dependencies rather than testing the dirty main tree as a release.
