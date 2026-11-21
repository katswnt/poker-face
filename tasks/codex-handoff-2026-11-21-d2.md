# D2 release handoff — 2026-11-21

D1 push/fold is live (`be05152`). Its closing record `ffbb82c` passed all 1,110 isolated
unit tests, typecheck, lint and 16 audits, then all eight jobs in
[CI 44957214650](https://github.com/katswnt/poker-face/actions/runs/44957214650).
Production is still D1 at this checkpoint.

D2 is implemented under the [frozen contract](drill-expansion-plan.md) and
[prospective input freeze / implementation record](drills-equity-range-d2.md).
All 36 hand-written cases remain byte-identical to the pre-answer freeze. Both evaluators
agree on all 3,780 outcomes; the lazy download is 32,591 bytes. All 68 focused drill tests,
typecheck, lint, production build and 48 three-engine drill checks pass. Release gates remain:
exact commit in a clean checkout with copied dependencies, full unit suite, all relevant
solver/data audits and builds; push main and observe eight green CI jobs; fresh WASM/source
assets, guarded Vercel deploy, public data/source checks and deployed drill/play checks.

Use `build/drill-expansion-2026-11-21/D2-release-current.json` for the current local
checkpoint and `D2-owned-files.json` for the explicit ownership list. Only D2 README
hunks may be staged; `D2-readme/README.staged.md` is the prepared clean blob. Candidate
checkout `/private/tmp/poker-d1-close-1dp0sfgd` reuses the completed D1 documentation
verification checkout and its copied node_modules; it now contains D2 work and is **not**
an exact release checkout. Do not deploy the candidate.

Do not touch the trainer/session files, their README hunks, the paused configurable-flop
draft or the pre-existing data-publication note. Their baseline is
`build/drill-expansion-2026-11-21/protected.json`. No TypeScript exclusions. The dirty
main working tree is not the release verification target. PF4 stays gated; no full-game
GTO or live-re-solving safety claim changes. Physical devices remain unmeasured and
nonblocking by Kat's instruction.

After D2 release verification: close its records and write the separate `/play` hand-review
contract. Keep the existing game limits and visible unusual-size exploitability warning.
