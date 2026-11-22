# D2 release handoff — 2026-11-21

## Shipped

The original W1–W4/P1–P5 plan, R1 release guard, E1 live action values, D1 push/fold
and D2 equity-versus-range practice are complete. D1 code `be05152` and closing record
`ffbb82c` are on main; all eight closing CI jobs passed in run `44957214650`.
D2 code is **`0851bedf330c651d41da86d60a3504b8f02421c8`**, with all eight jobs green in
[CI 44962474667](https://github.com/katswnt/poker-face/actions/runs/44962474667).

Production: <https://pokerface.katswint.com/drills?drill=equity-range>, deployment
`dpl_FC5Bpfggh9XYcXrsKs1WgMiqaa6x`. All 38 public drill files and six engine/source
assets match the tested release. Deployed checks: 76 pass, two existing non-Chromium
real-zoom skips, zero retries. All 48 drill checks pass. The [D2 record](drills-equity-range-d2.md)
contains the deployment URL, complete hashes, commands, assumptions and measurements.

## What was verified

Fresh exact checkout `/private/tmp/poker-drills-d2-exact-njfr76bs`, copied dependencies,
fresh native/WASM builds, 23 Rust tests, **1,122/1,122 unit tests** (zero skips), tsc,
lint, 17 solver/data audits, guarded production build, 112 full-app browser checks,
48 dedicated drill checks, 28 applicable play and 34 applicable live-solver checks.
The build hash is `b1838716556824d76f0f720d7874c96014034b4e90e3c0de97da6e4c5fc30219`.
AGPL source archive SHA-256:
`e6431505969ef8a1bae892fd27bb7a8e3b92757fdb66cde1e8ca63e50adca6e8`.
Engine source hash is unchanged; no solver code/data or frozen play evidence was revised.

D2's 36 frozen inputs cover 18 rivers and 18 turns. Every one of **3,780 distinct
hand/runout outcomes** and both players' seven-card scores agree with the independent
best-five evaluator. There are 24 removed blocked rows; weighting yields a total of
7,520, not extra random trials. The complete data file is **32,591 bytes**. Input checksum
and dataset identity are recorded in the D2 spec; both remain frozen and reproducible.
The ±2-point answer band is a practice tolerance, not a Monte Carlo error bar. Equity
assumes no further betting; these hand-written ranges are not solved opponent policies.

## Continue in order

1. Verify the exact D2 closing-document commit in a clean checkout with copied dependencies,
   full tests, tsc, lint and relevant audits; push its explicit files and observe green CI.
   Production stays on tested code `0851bed`; the docs-only commit needs no deployment.
2. Write the separate `/play` hand-review validation contract before implementation, using
   the existing immutable pre-action model identity and honest model-relative grading.
   Do not silently expand into arbitrary hand-history imports or unvalidated preflop advice.
3. Continue under the CPU roadmap's working rules. Physical phones remain unmeasured and
   nonblocking; PF4 stays gated. Preserve scripted preflop, hand-written ranges, 12 saved
   flops and the visible measured 23.4%-of-pot composed-policy weakness in `/play`.

## Untouched work and local records

The protected trainer/session work remains exactly as found: `METHODOLOGY.md`, trainer
README hunks, `e2e/keyboard.spec.ts`, `src/app/globals.css`, `src/components/PokerSim.tsx`,
`test/copy.test.ts`, `src/lib/poker/session.ts` and `test/session.test.ts`. Also untouched:
`src/lib/solver/postflop/configurable-flop/`, `tasks/configurable-flop-v2-plan.md` and
`tasks/poker-data-reuse-and-publication.md`. Do not stage, revert or repair them. No files
were excluded from TypeScript; the dirty main tree is not the verified release tree.

Records are in `build/drill-expansion-2026-11-21/`: `protected.json`, original trainer
README patch, explicit D1/D2 ownership lists, input freeze, fail-first and hash-mutant
logs, exact verification logs, CI records and deployment proofs. `D2-release-current.json`
is the current machine-readable checkpoint. Superseded candidate and D1 scratch checkouts were discarded after D2 production
verification to free disk space; their release logs and committed source remain retained.
