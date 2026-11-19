# P5 pause checkpoint — 2026-10-04

Historical checkpoint. The [November 18 handoff](codex-handoff-2026-11-18.md) records
the resumed work and supersedes the temporary paths and current authentication status below.

**Paused at Kat's explicit request. Not a release.** Everything from this continuation
is saved in the primary workspace. No P5 staging, commit, push or deployment occurred.
All commands started during this continuation finished; no audit or build is left running.

## What shipped previously

W1–W4 and P1–P4 remain shipped; `HEAD` and `origin/main` are P4 `735c901`.
The [October 1 handoff](codex-handoff-2026-10-01.md) records every milestone commit,
all-eight-jobs-green CI run and measured corpus result. P4 CI `36960266510` was green
before P5 began. The [P5 task](heads-up-play-p5-ui.md) has the full ownership list,
implementation contract, frozen evidence hashes and release gates.

## Decisions and changes at this checkpoint

- Vercel CLI **62.1.0 login now works**. The user-approved login completed and `whoami`
  returned `katswnt`. Existing `.vercel/project.json` still binds the existing `poker-face`
  project. Do not request secrets, create a replacement project, or deploy stale assets.
- Kat selected **ship P5 with honest EV limits; add live EV export/grading next**.
  Live/translated EV grades are explicitly unavailable in this release, not a blocker
  requiring a new engine export. This supersedes the older §2.8 live-EV requirement.
  No mathematical, privacy, release or deployment gate was weakened.
- Added `src/lib/hu-play/decision-grade.ts` and
  `test/hu-play-decision-grade.test.ts`; wired the grade into `DecisionMath.tsx` with
  current public history passed by `PlayTable.tsx`. Teaching only: no engine, controller,
  admission, policy source or frozen corpus/action-rule edits.
- Grade = maximum exported action EV minus chosen action EV, in chips and bb. It is
  labelled **original saved policy**, not the value against the composed re-solving AI.
  Highest frequency is not treated as highest EV. Missing/partial values, off-menu bets,
  translated/live policies and mismatched public histories remain unavailable. Pending
  decisions have no grade. Two values rounded to 0.1 chip give at most 0.1-chip error in
  their difference; that is explicitly not a solver/model error bound or global guarantee.
- Updated the P5 contract, resolving spec and roadmap with the approved scope and pause.
  README remains untouched by P5 and still has unrelated trainer edits.

## Verification, with scope

New grade tests failed first (missing implementation), then **3/3 passed**, no skips.
Typecheck and lint passed after the grade/UI addition in the isolated development copy.
No new full-suite or browser run was started before the pause. The prior **1,057/1,057**
unit tests and prepared-browser **25 pass / 2 explicit non-Chromium zoom-API skips**
predate this addition. Do not claim a full 1,060-test pass or rendered grade coverage yet.

Completed candidate audits this continuation:

- `audit:hu-play:{library,p1,p2,p3,p4,p5,wide,gadget}` — all eight passed.
- `audit:river:{v3,factorized,exchange}`, `audit:turn:{vector,v2,explorer}` — passed.
- `audit:flop:{reference,source,library,explorer}`, `audit:bridge:library`,
  `audit:preflop`, `audit:equity-matrix` — passed.

The first flop-reference invocation was blocked by the sandbox's process-memory sampling
restriction (`spawn EPERM`); the authorized rerun passed unchanged. This was not a math
failure. River v3 still reproduces value **16.081056725 chips**, best-response gains
**0.014993444 / 0.003155818**, exploitability **0.009074631 chips**.

Previously retained P5 controller evidence remains unchanged: **200/200** complete and
exactly replayed hands, **301 accepted native attempts / 295 distinct public games**,
128 hands with turn decisions and 105 with river decisions. Report SHA-256
`31c14fab9e4176f2f109b03e95efe899dacb308dba369423ad3160df05bcb01b`.
P5's audit replays these preserved policies; it does not claim fresh solving or new timing.

Checkpoint logs are copied to ignored `build/p5-pause-2026-10-04/`:
`p5-grade-{red,green}.log`, `p5-oct4-{tsc,lint}.log`, and `p5-oct4-audit-*.log`.
Prior raw evidence/screenshots remain in `build/p5-safeguard-2026-10-01/` and the
locations documented by the P5 task. No evidence was deleted.

## Resume here, only when asked

1. Read AGENTS, the local Next guides, lessons, roadmap and P5 record; inspect status.
   Use Node 24 (`/opt/homebrew/bin/node` in the primary workspace) and pinned Rust 1.98.1.
2. Continue in `/private/tmp/poker-p4-exact.GdkqIQ`, which has copied dependencies and
   matches the primary owned P5 files/docs. Despite its name it is a **dirty P5 development
   copy**, not an exact P5 release checkout. Its engine assets were built for P4.
3. Add rendered grade checks: pending, original-policy ready with independently recomputed
   gap, off-menu refusal, and live unavailability. A seed-0 BB saved flop decision can
   supply an actual exported EV row; do not infer expected EV from action frequency.
   Rerun full units, tsc/lint and both saved-only/prepared build/browser paths. Preserve
   the full three-engine gate and its explicit Chromium-only zoom distinction.
4. Complete fresh artifact reproduction and remaining native/Rust/WASM parity/audit
   checks. Preserve every frozen case and source-bound report; controller/source changes
   require fresh retained capture, not silently replacing the original evidence.
5. Update README only with owned P5 hunks, safeguarding the trainer's current edits.
   Stage the P5 task's explicit files plus this handoff; never blanket-stage.
6. Commit P5; verify the **exact commit** in a new isolated checkout with copied (not
   symlinked) node_modules, unchanged tsconfig, full units/tsc/lint/relevant audits,
   native/WASM checks, reproduction, builds and browser gates. Push only after passing,
   then observe all eight CI jobs green.
7. Rebuild native/WASM and source-complete assets from that clean release checkout.
   Deploy to the existing authenticated Vercel project. Fetch deployed manifest, glue,
   WASM and AGPL source archive, compare bytes/hashes with the exact release build,
   and smoke-test public `/play`. **P5 is not done without deployment verification.**
8. Record actual commits, CI, deployment URL/identity/hashes and remaining phone checks.
   Live EV export/grading is the approved follow-up; push/fold drills, equity-vs-range
   drills and hand review remain later work. PF4 is still gated.

Disk space was about **2 GiB free** at this checkpoint. Use real APFS clonefile copies
for dependencies if appropriate (not symlinks), inspect space before clean builds, and
never delete source, protected work or retained evidence to make room silently.

## Untouched work

All 15 non-README protected file hashes still match
`build/p3-safeguard-2026-10-01/manifest.json`. The git index is empty. Protected files:

```text
METHODOLOGY.md
README.md                             # trainer hunks; no P5 changes yet
e2e/keyboard.spec.ts
src/app/globals.css
src/components/PokerSim.tsx
test/copy.test.ts
src/lib/poker/session.ts
test/session.test.ts
src/lib/solver/postflop/configurable-flop/{artifact-node,binary-node,compiled,protocol,rules,scorekeeper,session}.ts
tasks/configurable-flop-v2-plan.md
tasks/poker-data-reuse-and-publication.md
```

Do not overwrite, revert, exclude from type-checking, stage or commit that work. The
paused configurable-flop draft still prevents treating a dirty-primary build as a
release check; use isolation. Physical-device performance remains unvalidated, the turn
cache optional/unpublished, and unusual-size composed exploitability remains visible
on `/play` at the measured **23.4% of the local subgame pot**, not an expected win rate.
