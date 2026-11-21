# Codex handoff — 2026-11-21

## Current checkpoint: D1 shipped; D2 next

W1–W4/P1–P5, R1/E1 and now D1 push/fold practice are complete. D1 code is
`be05152646d493a656e5062b07326bd6f0b2b084`; all eight jobs in
[CI 44952657754](https://github.com/katswnt/poker-face/actions/runs/44952657754) passed
before production deployment. The [D1 release record](drills-push-fold-d1.md#verified-release--2026-11-21)
contains the exact measurements, deployment identity, source/data hashes and limitations.

Production: <https://pokerface.katswint.com/drills?drill=push-fold>, deployment
`dpl_HynauesGcebg5NbS8JsmmTHW55VR`. All 37 published drill files and six engine/source
assets match the exact tested release. Deployed browser checks: 52 pass, two existing
non-Chromium real-zoom skips, zero retries. All 24 new drill checks pass.

## What was verified

The exact clean code checkout `/private/tmp/poker-drills-d1-final-ciod7tcm` has **copied**
node_modules, fresh native/WASM builds, 23 passing Rust tests, **1,110/1,110 unit tests**
(zero skips), tsc, lint, 16 audits and a guarded production build. All 104 full-app,
24 dedicated drill, 28 applicable play and 34 applicable live browser checks pass.
No numerical gates or frozen solver inputs changed.

D1 independently recomputes all 12,506 decisions and all 37 serialized profile grades.
The largest combined unilateral gain is 0.000046464518117771554 bb against the unchanged
0.0005 bb gate. Largest download: 47,962 bytes; all depths: 1,763,288 bytes.
Dataset: `90edb16e88236f983c73ec4907e65d71c38b917597d92ffa1143d959be032a4c`.
The 0.01 bb practice tolerance is not a per-hand accuracy guarantee. Approximate restricted
push/fold profiles do not unlock PF4. Existing scripted preflop, hand-written ranges,
12 saved flops and 23.4% composed-policy weakness remain labelled in `/play`.

## Continue in order

1. Verify the exact D1 closing-document commit in isolation, push its explicit files,
   and observe all eight CI jobs green. Production stays on the tested D1 code commit;
   a documentation-only commit does not need deployment.
2. Freeze D2's 36 hand-written turn/river inputs **before computing answers**, following
   [the prospective contract](drill-expansion-plan.md#frozen-d2-contract-before-implementation).
   No D2 cases or implementation exist at this checkpoint. Write failing tests first,
   independently verify every outcome, then implement and meet the same release gates.
3. Specify `/play` hand review separately after D2. Do not silently broaden that scope.

Physical-device checks remain open and nonblocking by Kat's instruction. No GPU training
is required for these drills. Do not promote the unvalidated preflop payoff model.

## Untouched work

The trainer/session work and paused configurable-flop draft remain exactly as found:
`METHODOLOGY.md`, trainer hunks in `README.md`, `e2e/keyboard.spec.ts`,
`src/app/globals.css`, `src/components/PokerSim.tsx`, `test/copy.test.ts`,
`src/lib/poker/session.ts`, `test/session.test.ts`,
`src/lib/solver/postflop/configurable-flop/`, `tasks/configurable-flop-v2-plan.md`,
and `tasks/poker-data-reuse-and-publication.md`. Do not stage, revert or repair them.
The paused draft still prevents treating the dirty working tree as a verified release;
no files were excluded from TypeScript. Verification was against the exact committed tree.

Preservation baseline, README residual patch, explicit 69-file D1 ownership list, final
file hashes and live release checkpoint are in `build/drill-expansion-2026-11-21/`.
Use `D1-release-current.json` for the latest local machine-readable checkpoint. The earlier
unpublished `2db414c` was amended only to add the stronger hash test and its record; its
partial verification is superseded by the complete verification of `be05152`.
