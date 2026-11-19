# R1 release handoff — 2026-11-19

R1 is shipped and deployed. Continue with **E1 live action values**, first writing
`tasks/live-decision-ev-spec.md` and failing tests. Follow
[the post-P5 plan and release record](post-p5-release-and-live-ev.md).
W1–W4/P1–P5 remain complete; PF4 remains gated. Push/fold drills and equity-vs-range
drills, then hand review, follow E1. No new training or game-coverage claim is made.

## Shipped

- `b5096562a775ba459d5c03ca5ed3527b39810d94`: production deployment safeguard, source/archive
  verification and pinned local JetBrains Mono to fix the observed upstream font-build failure.
- All eight jobs in [CI 44593644359](https://github.com/katswnt/poker-face/actions/runs/44593644359)
  passed. The main push created no automatic Vercel production deployment; the old verified
  engine remained live until the explicit release.
- Production: <https://pokerface.katswint.com/play>, deployment
  `dpl_6GCZ5TAmbEt6DxGrQuWisArCzzLn` (Ready, created 19:31:17 UTC).
- Public byte/source verification passed at 19:32:06.827 UTC. The release record lists
  all build, source, WASM and source-archive hashes. Both serving pages link matching source.

Exact clean commit, copied dependencies, fresh native/WASM: **1,067/1,067** unit tests,
typecheck, lint, 12 solver audits, both builds and Vercel packaging pass. Saved-only app:
87 pass/9 explicit asset-required skips. Prepared app: 96/96. Prepared three-browser
play: 28 pass/2 explicit zoom-API skips; live solver: 34/2. Deployed play: **28/2 in
146.505 s**, zero failures/flakes/retries. Narrow and true 200% zoom screenshots reviewed.

River v3 is unchanged: value **16.081056725 chips**, best-response gains
**0.014993444 / 0.003155818**, exploitability **0.009074631 chips**. Native/WASM deltas
are zero on four referee games; independent comparisons stay within **0.0002 chips**.

## E1 investigation, not implementation

The existing slice exporter calls the pinned engine's `expected_values_detail(actor)`.
These are from-now values: expected payout minus future payments, so folding is zero.
The ordinary live tree exports strategies only. Prefer an opt-in bounded teaching export
that leaves the default mathematical result unchanged; never infer EV from frequency/equity.

Validate every new action value independently on complete tiny river/turn games, both seats,
including blockers, zero reach, zero-frequency actions, forced prefixes, sunk bets and all-ins.
Measure export/memory cost against unchanged browser gates. Preserve saved-policy grades.
Do not silently replace a decision's grading model after an off-menu re-solve. Values concern
the local solved policy, not the later composed AI; keep the visible 23.4%-pot warning.

Engine/runtime edits invalidate source-bound P1–P5 evidence. Preserve historical artifacts
and add measured successor proofs, including fresh full numerical/log reproduction and
unchanged browser gates. Do not whitelist hashes, remove source checks, or weaken global
mathematical fingerprints to accommodate a new teaching field.

Detailed read-only findings are saved locally in ignored
`build/post-p5-2026-11-19/E1-investigation.md`. No E1 spec or implementation exists yet.
Physical-device performance checks remain open and nonblocking, as Kat directed.

## Untouched shared work

All 15 protected non-README hashes match the P3 safeguard; the trainer README hunks are
preserved separately from the release edits. Leave these tracked changes untouched:
`METHODOLOGY.md`, trainer `README.md` hunks, `e2e/keyboard.spec.ts`, `src/app/globals.css`,
`src/components/PokerSim.tsx`, `test/copy.test.ts`.

Leave these untracked paths untouched: `src/lib/poker/session.ts`, `test/session.test.ts`,
`src/lib/solver/postflop/configurable-flop/`, `tasks/configurable-flop-v2-plan.md`,
`tasks/poker-data-reuse-and-publication.md`. The paused flop draft still is not part of the
release; use isolated exact-commit checks, never a typecheck exclusion.

Local release checkout: `/private/tmp/poker-r1-exact-0cgb3iwk`. Evidence is preserved under
ignored `build/post-p5-2026-11-19/`, particularly `R1-ci.json`, `R1-current.json` and
`R1-exact-b509656/`. Those local paths are recovery aids, not public reproducibility inputs.
Use the README's pinned build/prepare/verify/Vercel commands for the next release.
