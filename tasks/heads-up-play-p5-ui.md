# P5 — playable, inspectable heads-up practice

Prospective contract, 2026-10-01. Starts only after P4 `735c901` and all eight jobs
in CI `36960266510` passed. Implements step 9 of the CPU-ceiling roadmap, including
Kat's deployment and mandatory teaching-panel amendments. **Shipped as `22f513e`;
production deployment verified 2026-11-19.** Historical checkpoints below retain their
original status; the final deployment record supersedes their open-release instructions.

## Scope and implementation

- `/play` is a separate route and CSS module in the existing Poker Face theme. Native
  buttons, range/number inputs, selects and details retain browser keyboard behavior;
  no new component system, animation or global stylesheet changes. Follow baseline-ui
  and fixing-accessibility; existing CSS values/native primitives take precedence over
  installing Tailwind or a new UI library solely for this route.
- A framework-independent controller owns the hand, cancellation generation, observation
  history and in-memory session ledger. React subscribes; it does not implement poker rules.
  Compose the unchanged P4 flop adapter and P3/P2 live sources. All solving uses W2 Workers;
  public preparation and private teaching data stay separate. Native injection is test-only.
- Reuse the actual async hand reducer. Observe prepared decisions without altering their
  strategies. Cancellation keeps the latest valid reducer state. Retry never places a
  previously committed human bet again; stale work cannot replace a new hand or ledger.
- Human chooses BB (first to act), BTN (second), or alternating seats. Each new hand resets
  to the scripted 100bb formation; seed is visible/reproducible. Use the unchanged uniform
  12-flop selection, joint private deal, full ranges, bet rules and measured browser profiles.
- Real legal chip totals in a native slider plus typed input; distinguish raise-to from
  chips added now. Check/call/fold, explicit errors, retry, thinking/cancel, deal-again and
  readable action history. No arbitrary size snapping. No new solve/cache/range fallback.
- Local ledger only: do **not** import, edit or stage the protected `poker/session.ts` WIP.
  Completed hands count once. Net uses `scriptedSettlement`: both players started at
  10,000 chips, 50 external dead-blind chips enter each hand. Their nets sum to +50, not zero;
  P0's equal-pot-share zero-sum origin is a separate convention. Incomplete hands do not settle.

## Mandatory decision teaching

- Snapshot the actual public state and AI reach before each decision. Human hints are
  opt-in before acting; the completed decision remains inspectable. AI's private hand,
  hand-specific frequencies and values are hidden until hand completion, including from
  the rendered accessibility tree. The production solve never receives the human's cards.
- Call price `C` is unmatched chips, pot odds `C / (current pot + C)`. Polar bluff share
  is the same break-even number for a perfect nuts/air bettor against a bluff-catcher.
  Explain ties, no rake and no further betting; this is not a prescribed strategy.
- MDF uses the **last aggressor's newly risked chips**, not the raise-to total and not
  blindly the caller's price: `pot before that action / (pot before + chips risked)`.
  A raise may risk more than the following call costs. Test the zero-equity bluff EV
  identity independently and reuse the drills/library formula convention. At a check
  node show not applicable, with optional labelled sizing-preview math.
- Exact all-in equity: enumerate every compatible opponent combo and remaining runout,
  weighted by the AI's actual reaching range and conditioned on the learner's visible
  cards. Ties split. Use the existing independently tested `score7` evaluator in a
  **separate teaching Worker**; no Monte Carlo, future hidden runout, or actual AI hand.
  Pending/error/empty-compatible-range states never masquerade as zero equity. Cancellation
  terminates this worker; stale replies cannot attach to another decision. Show enumeration
  coverage/counts and label range/model limitations, not an exact-strategy claim.
- Show action frequencies with the AI's hand after completion, plus provenance: saved
  library, root solve, nested solve, translation, or P4 passive call rule; source/spot hash,
  iterations/quality when available, range retention and rung. Quantized original saved
  EVs stay labelled original-policy values. Translated/live action EVs not exported by
  the source remain unavailable; never substitute equity-times-pot for solver action EV.
- A simple range-composition summary reuses the drills' made-hand/draw categories and
  blocker removal. It is descriptive, not a proof of value/bluff intent.
- Visible copy: scripted preflop; hand-written ranges; 12 saved flops; approximate strategy
  for specified finite games, **not exact GTO**; local re-solving is not a global guarantee.
  Explain the P4 passive rule and explicit unsupported/refused decisions.
- On-page warning cites P2's **23.4%-of-subgame-pot composed-policy local exploitability**:
  unusual bet sizes can exploit this AI. Not expected winnings, not every hand, not a
  global bound. Independent individual-solve grades do not erase this result.
- Corresponding AGPL source archive and source/build hashes remain visible/linked.

## Gates (fixed before implementation)

1. Fail-first controller tests: actual reduction, real-chip settlement, unique ledger,
   reproducibility, hidden-card redaction/non-interference, cancel before and after a
   human commitment, retry, source failure and stale-result rejection.
2. Independent mathematical checks: pot/call/raise arithmetic, MDF bluff EV identity,
   polar bluff-catcher indifference, exactly enumerated turn/river and selected flop
   reference comparisons, weighted ties, blockers, empty support and range scaling.
   All displayed numbers trace to tested structured facts; unavailable numbers stay null.
3. Freeze **200 seeds (0–199), alternating AI seats**, before running the UI-layer audit.
   Use the same controller as React and the real P4/P3/P2 sources. Scripted human decisions
   exercise passive and off-menu sizing. Freeze the deterministic action-selection rule
   in the audit before measurements. Every hand must finish, conserve all 20,050 chips,
   replay exactly and enter the ledger once. Retain failures; no reselection or gate weakening.
4. Browser e2e: a full hand by keyboard, off-menu bet, real thinking/cancel/retry, missing
   assets and load failures, hand privacy, source links, math and settlement. Responsive
   screenshots at 320/390/1280px, no overflow/clipping, visible focus and 200% text/zoom.
   Required prepared path in Chromium/Firefox/WebKit; saved-only build clearly unavailable
   for play rather than substituted with a stub AI.
5. Preserve P1–P4 source-bound audits and exact results; full unit suite, tsc, lint, Rust,
   native/WASM parity, relevant audits, artifact reproduction and both production builds.
   Explicit-file milestone commit, README hunks only. Repeat exact-commit verification in
   a fresh isolated checkout with **copied** dependencies, then push; all eight CI jobs green.
6. Deployment is required: rebuild native/WASM from that clean release checkout, prepare
   the hash-addressed source-complete assets, deploy to the existing Vercel project, fetch
   deployed manifest/glue/WASM/source archive, check bytes/hashes against that exact build,
   and smoke-test deployed `/play`. Reject the stale primary build. Record commit, URL,
   deployment identity and hashes. Never call P5 complete on local tests alone.

## Trade-offs and mitigations

The compact game gives reproducibility, inspectable mathematics and local/private solving,
but limited formations/boards and an exploitable composition. Keep the warning prominent;
do not promote PF4 or claim global safety. Flop translation can use a passive rule; identify
it explicitly. Live action EVs are not currently exported: say unavailable instead of
manufacturing numbers. Exact flop equity can take time: background Worker, honest pending
state, cancel and decision-bound results. The human reach is a model and legal deviations
may leave it without support: retain the hand and explain refusal rather than inventing
weights. Mobile performance is unvalidated; conservative unknown-device admission remains,
physical device checks come last and do not block measured desktop work. Firefox turns can
take tens of seconds; never promise Chromium's measured p95 to every browser or input.

The optional incomplete turn cache is not a P5 dependency. The ledger is intentionally
in-memory and separate from trainer WIP. After P5: prospective contracts for push/fold and
equity-vs-range drills, then `/play` hand-review mode; these do not unlock PF4.

## Progress / owned files

Contract written before implementation. Exact ownership, fail/pass evidence, measured
results, CI and deployment records will be added as each gate is actually met. P4 release
annotations in its record/spec/roadmap accompany this milestone. No protected work is owned.

## Candidate evidence — 2026-10-01 (not a release)

The candidate lives durably in the primary working tree and in the development copy
`/private/tmp/poker-p4-exact.GdkqIQ`. That copy started at exact P4 `735c901` with copied
dependencies and freshly rebuilt P4 engine assets; it is now dirty P5 development, **not**
an exact P5 release checkout. Do not deploy those P4 assets or the stale primary build.

- Full candidate unit suite: **1,057/1,057**, no failures, cancellations or skips,
  105.740773666 seconds. `npm run typecheck`, `npm run lint`, and prepared `npm run build`
  passed. These are candidate checks, not the required exact-commit release verification.
- The frozen human rule is in `scripts/hu-play-p5-human.ts`: seeds 0–199, 100 per seat;
  seed modulo five selects first-human-decision flop all-in, flop 43%-pot-plus-one-chip,
  turn 37%-plus-one, river 61%-plus-one, or passive play. Sizing is constrained only by
  legality, with a one-chip displacement off an exact menu match if legal. Other actions
  use supported passive play or the highest-frequency own-hand action; missing model
  columns use legal check/call. No reselection after failures. This is a scripted test,
  not a measurement of how strong a human or the AI is.
- **200/200 hands completed and replayed exactly**, using **301 accepted native solve
  attempts / 295 distinct public games**. 128 hands reached turn decisions, 105 reached
  river decisions. Every public state conserved 20,050 chips; each final ledger row
  appeared once. Human net −38,316 chips and AI net +48,316 chips sum to the 10,000
  external dead-blind chips introduced over 200 deals. They are not win-rate estimates.
- Saved evidence retains every hand and raw policy. `npm run audit:hu-play:p5` checks the
  original source closure, policies/quality, exact request sequence, public/private
  boundary, log and decision hashes, conservation and the entire ledger. Corruption and
  missing-policy tests fail. Replay is not advertised as a new solve or browser timing.
- Report SHA-256: `31c14fab9e4176f2f109b03e95efe899dacb308dba369423ad3160df05bcb01b`.
  Capture-source hash: `acaf3e6e27fb20f8818ffe5209453094397550db260367e26e38e40c7c7b5104`.
  Evidence gzip: 11,608,120 bytes,
  `468f96df1dd227b18b4223cbb4b9635fdb53c316ad2d08eda2a3843922db0b77`.
- Teaching checks independently recompute call and raise prices, MDF bluff indifference,
  polar bluff-catching indifference, exact weighted flop/turn/river equity, blockers,
  ties, empty support and range-scale invariance. The teaching Worker is separate from
  the AI's solve Worker. No future dealt card or actual AI hand enters its input.
- Controller checks cover cancellation before and **after** a human commitment, retry
  without duplicate betting, source failure, stale loads, disposal, redaction and settlement.
- A failing seed-error accessibility test caught missing `aria-invalid`/error association;
  both are fixed. Initial WebKit keyboard failure was the test's use of macOS Tab mode
  (which skips buttons); it now uses native Option-Tab, like the existing W4 gate. No
  manual tab-order implementation or additional tabindex was added.
- Final required prepared-browser run: **25 passed, 2 explicitly skipped**, no retries,
  1.2 minutes. Chromium, Firefox and WebKit each passed full-hand keyboard play, actual
  turn-Worker cancel/retry, missing-engine recovery, on-page warning/source/metadata,
  independent displayed-price/ledger checks and 320/390/1280px layouts. Chromium passed
  actual 200% browser zoom; its API-only test is explicitly skipped in Firefox/WebKit,
  which both passed 200% text checks. Reviewed narrow Chromium and desktop Firefox
  screenshots; no horizontal overflow in the tested layouts. This is desktop browser
  emulation, not physical-device performance evidence.
- The saved-log check compares canonical serialized logs: P0's infinite CDF-boundary
  distance for deterministic actions serializes to JSON null. This existing convention
  changes neither action probabilities nor replay identity.

Fail-first logs: `/private/tmp/poker-p5-{teaching,controller,worker,corpus,evidence,nav}-red.log`,
`/private/tmp/poker-p5-ui-red.log`, `/private/tmp/poker-p5-validation-red.log`.
Candidate logs: `/private/tmp/poker-p5-full-unit-first.log`, `poker-p5-tsc9.log`,
`poker-p5-lint9.log`, `poker-p5-build5.log`, `poker-p5-ui-three-final.log`.
Raw native capture: `/private/tmp/poker-p5-ui-native-first`.

Commands used from the development copy (Node 24.10, pinned Rust 1.98.1):

```sh
node --import tsx scripts/audit-hu-play-p5-playing.ts --out /private/tmp/poker-p5-ui-native-first
node --import tsx scripts/audit-hu-play-p5.ts --pack /private/tmp/poker-p5-ui-native-first
npm run typecheck
npm run lint
npm test
npm run build
CI=1 POKER_FACE_LIVE_REQUIRED=1 npx playwright test --config playwright.play.config.ts --retries=0 --reporter=line
```

The capture/pack commands refuse overwriting previous evidence. Use a new directory for
fresh capture. The three-engine gate is now wired into required prepared-assets CI, and
the saved-evidence audit into the main CI job; this configuration is **not yet pushed**.

## October 4 checkpoint — paused at Kat's request

Kat selected **ship P5 with honest EV limits; add live EV export/grading next**.
This supersedes the older §2.8 requirement to export live action EVs before P5 ships;
it does not waive mathematical or release checks. Saved-policy human-action grades
are implemented in the teaching-only `decision-grade.ts`, outside the AI/source-bound
controller. They compare highest exported EV with chosen EV, not highest action frequency.
Off-menu actions, live/translated policies, missing EVs and unrelated histories are not
graded. Values are original-policy EVs, not composed-AI EVs. The two rounded values give
a maximum 0.1-chip rounding error in their difference, not a solver/model error bound.

Three new fail-first grade tests pass; typecheck and lint pass in the development copy.
The full 1,057-test run and three-browser results above **predate** this addition. Do not
claim 1,060 full-suite tests or browser verification of the new grade until rerun. Add
rendered pending/ready/off-menu/live grade assertions on resume. No engine, controller,
source-bound corpus, frozen action rule or admission limit changed in this checkpoint.

All eight heads-up standalone audits passed again (library, P1, P2, P3, P4, P5, wide,
gadget). Broader audits passed: river v3/factorized/exchange; turn vector/v2/explorer;
flop reference/source/library/explorer; bridge library; preflop; equity matrix. The first
flop-reference attempt was sandbox-blocked on process-memory sampling (`spawn EPERM`);
its authorized rerun passed without changing the gate. These are candidate audits,
not exact-release checks. Logs are preserved under `build/p5-pause-2026-10-04/`.

See [the October 4 handoff](codex-handoff-2026-10-04.md) for the exact pause/resume point.

## October 4 authentication and release checkpoint (historical)

Vercel CLI 62.1.0 `whoami` returned **“The specified token is not valid”** on
2026-10-02 UTC (October 1 locally). No deployment was attempted. The existing
`.vercel/project.json` identifies `poker-face`; no new project or credential was created.
Kat was asked to run `npx vercel@62.1.0 login` locally. Never request a token in chat.
On October 4 the approved login completed, and CLI 62.1.0 `whoami` succeeded as
`katswnt`. Authentication is no longer the known blocker. No deployment was attempted.
P5 is **uncommitted, unpushed and undeployed**. Do not start post-P5 milestones or mark
step 9 complete. The authentication blocker does not excuse any verification gate.

Remaining release work:

1. Run the full app browser suite, saved-only build/refusal path, independent audit commands
   and fresh artifact reproduction. Repeat required three-browser checks on the exact commit.
2. Finish browser coverage of the saved-policy grade under Kat's October 4 decision;
   live action EVs and live human-action EV-loss grades remain an explicit follow-up.
   Never fabricate them or represent them as completed. Rerun the full candidate suite.
3. Update only accurate P5 README hunks; README has not been edited by P5 yet. Tick only
   actually met spec boxes, enumerate explicit files, commit, then verify that exact commit
   in a fresh checkout with **copied node_modules**, unchanged tsconfig and all required gates.
4. Rebuild native/WASM and source-complete assets from that clean release checkout, push
   the verified milestone and observe all eight CI jobs green. Once Vercel authentication
   works, deploy the exact verified build and fetch/check engine, glue, manifest and AGPL
   archive bytes/hashes; smoke-test public `/play`. Record deployment identity and URL.
5. Update the closing handoff with actual release identities. Physical iOS/Android checks
   remain open and must not be described as measured or block the approved desktop path.

## Explicit P5 ownership (no blanket staging)

```text
.github/workflows/ci.yml
package.json
playwright.play.config.ts
e2e/play.spec.ts
src/app/play/page.tsx
src/app/play/PlayTable.tsx
src/app/play/DecisionMath.tsx
src/app/play/play.module.css
src/app/drills/Drills.tsx                    # only the /play navigation link
src/app/solver/lab/LeducLab.tsx              # only the /play navigation link
src/app/solver/live/LiveSolver.tsx           # only the /play navigation link
src/lib/hu-play/ui-controller.ts
src/lib/hu-play/ui-browser.ts
src/lib/hu-play/teaching.ts
src/lib/hu-play/teaching-worker.ts
src/lib/hu-play/teaching.worker.ts
src/lib/hu-play/teaching-client.ts
src/lib/hu-play/decision-grade.ts
scripts/hu-play-p5-human.ts
scripts/audit-hu-play-p5-playing.ts
scripts/audit-hu-play-p5.ts
test/hu-play-ui-controller.test.ts
test/hu-play-teaching.test.ts
test/hu-play-teaching-worker.test.ts
test/hu-play-p5-corpus.test.ts
test/hu-play-p5-evidence.test.ts
test/hu-play-decision-grade.test.ts
tasks/artifacts/hu-play-p5-ui.json
tasks/artifacts/hu-play-p5-ui.json.gz
tasks/artifacts/hu-play-p5-ui-summary.json
tasks/heads-up-play-p5-ui.md
tasks/heads-up-play-p4-flop.md                # P4 exact-release annotations only
tasks/heads-up-play-resolving-spec.md
tasks/cpu-ceiling-roadmap.md
tasks/codex-handoff-2026-10-01.md
tasks/codex-handoff-2026-10-04.md
tasks/codex-handoff-2026-11-18.md
README.md                                  # P5 hunks only, not trainer hunks
```

## Resumed candidate verification — 2026-11-18

Kat resumed work. The durable primary files matched the pause: all 15 protected non-README
hashes unchanged; origin/main still P4 `735c901`. macOS had purged most of the old temporary
checkout/tool installation, so a new candidate was reconstructed at
`/private/tmp/poker-p5-resume.QZEHsU`: local clone of P4 plus the explicit P5 files above,
with genuinely copied node_modules (APFS clone copies, not symlinks). No draft exclusions.
The pinned native and WASM engines were rebuilt; source hash remains
`a2852d8ab1701a796d7f32b71be37092082cd622a264dd5c60854684c0a068d2`.

- Full candidate suite **1,060/1,060**, zero skips/failures, 178.953 seconds.
- **21/21 Rust tests**, native/WASM format and clippy, typecheck, clean lint and both
  saved-only/prepared production builds passed. A concurrent lint attempt saw warnings
  in temporary Playwright trace JS; those generated traces were preserved outside the
  checkout, and the normal unchanged lint command then passed without warnings.
- Prepared P5 page: **28 passed, 2 explicit non-Chromium zoom-API skips**, no retries,
  1.6 minutes. All three engines check the pending saved grade, frozen seed-0 exported
  EV inputs, the independently subtracted 0.5-chip gap for the 182-chip bet, off-menu
  unavailability and live unavailability. No numerical or timeout gate changed.
- Prepared full app: **96/96 passed**, no skips or retries, 1.1 minutes. Prepared W4
  three-browser page: **34 passed, 2 explicit non-Chromium zoom-API skips**, no retries.
- All 24 standalone candidate audits passed: river v3/factorized/exchange;
  turn vector/v2/explorer; flop reference/source/library/explorer; bridge library;
  preflop; equity matrix; heads-up library/P1/P2/P3/P4/P5/wide/gadget; native bridge;
  WASM parity; saved live example. River v3 reproduces value **16.081056725 chips**,
  gains **0.014993444 / 0.003155818**, exploitability **0.009074631 chips**.
- W1 numerical parity and W2 production-Worker lifecycle harnesses passed in Chromium,
  Firefox and WebKit. Native and WASM mathematical output agrees exactly on all four
  referee/probe cases; independent grader differences remain below **0.0002 chips**.
  These correctness checks do not establish new latency or physical-device claims.
- Fresh one-thread native capture completed **200/200**, with **301 accepted attempts
  and 295 distinct games**, no failures. Independent replay and comparison checked every
  numerical policy cell, all 200 logs/decision hashes/ledger rows, the frozen source
  closure and complete solve request sequence against the original evidence: **exact match**.
  Timing/memory telemetry was excluded from numerical comparison. Fresh report SHA-256:
  `35e65bafce2172b312cbb9228354c02b4292669ce665f23c7013d746bdda52bc`;
  sorted numerical-policy hash:
  `105662b68999e1592c545683bc3bed50671d8b0dd5bb7c9894839fc83b524f2f`.
  Original checked-in evidence was not replaced. Command:
  `node --import tsx scripts/audit-hu-play-p5-playing.ts --out /private/tmp/p5-nov18-native-reproduction`;
  comparison helper and raw capture are retained with the primary safeguard.
- Saved-only full app: **87 passed, 9 live-only skips**, no retries. Separate three-browser
  P5 page: **13 passed, 17 explicit live-only/zoom skips**. W4 saved-only: **22 passed,
  14 explicit live-only/zoom skips**. Skips are never counted as passes.
- Reviewed current 320px hand/teaching and actual 200% browser-zoom screenshots. The
  existing CSS-module theme/native controls were retained; no global CSS or trainer edits.
- README now has owned P5 implementation/limits and roadmap hunks in the isolated copy.
  Applied only those hunks to primary after saving its original bytes/diff; all unrelated
  trainer additions/deletions still match. Staging must use the isolated README blob only.

Current logs: `/private/tmp/p5-nov18-*.log`; screenshots:
`/private/tmp/p5-nov18-prepared-play-results/`. Primary safeguards belong in
`build/p5-resume-2026-11-18/`. Exact-commit checks, hosted CI, and deployment remain gates;
these candidate numbers are not a release claim.

**Authentication reopened:** CLI 62.1.0 `whoami` now reports “The specified token is not
valid.” Kat was asked asynchronously to run `npx vercel@62.1.0 login`. No credentials
were printed or requested in chat; no deployment attempted. Local verification continues.

## Exact-commit verification and push — 2026-11-18

P5 code is committed and pushed as **`22f513e61e3579deb0fa16de2de361c7377a3041`**,
using exactly the 38 owned paths above. README's staged blob contained only P5 changes;
its remaining worktree diff is exactly the original trainer additions/deletions. All
15 protected non-README hashes remain unchanged. No tsconfig exclusion was introduced.

Verified the exact commit at `/private/tmp/poker-p5-exact.boqiiugt`, with real copied
node_modules and fresh native/WASM builds, before push:

- **1,060/1,060 unit tests**, zero skips/failures/cancellations, **173.334 seconds**.
  Typecheck, warning-free lint, **21/21 Rust tests**, both crate format checks and clippy passed.
- **33 standalone audits** passed: all 24 listed in the candidate record, plus math,
  Kuhn, Leduc, river v1/v2/compact/scorekeeper and turn v1/compact. W1 parity and W2
  production-Worker lifecycle checks passed Chromium/Firefox/WebKit. Native/WASM math
  matches exactly on the four referee/probe cases; independent differences remain
  below the unchanged **0.0002-chip** tolerance.
- Saved-only and prepared production builds passed. Prepared full app **96/96**;
  P5 three-browser **28 pass / 2 explicit zoom-API skips**; W4 **34 / 2**. No retries.
  Saved-only full app **87 / 9**, P5 **13 / 17**, W4 **22 / 14** (passes/skips).
- The first saved-only run omitted `POKER_FACE_LIVE_SAVED_ONLY=1`, so it did not execute
  the explicit disabled-control assertions. A further saved-only build ran those tests
  with that flag in all three browsers: **3/3 P5 and 3/3 W4**, zero skips/retries. The
  previously tested prepared build/assets were then restored unchanged. No assertion,
  timeout or quality gate was weakened. Skips are never counted as passes.
- Fresh one-thread native capture and independent replay/comparison again passed
  **200/200 hands, 301 accepted attempts, 295 distinct games**. Every exported numerical
  cell, hand log, decision hash, request sequence and ledger entry matches the original.
  Fresh report hash `c37e62fd6d0c50231ff14616e11e08580eae86976f9bdcd2ff0076a6d76cf699`;
  numerical-policy hash remains
  `105662b68999e1592c545683bc3bed50671d8b0dd5bb7c9894839fc83b524f2f`.

The exact checkout remains clean. Durable logs, commands, raw capture, comparison helper,
screenshots and the complete prepared distribution are under
`build/p5-resume-2026-11-18/exact-22f513e/`; `verification.json` binds them to this commit.

Clean-release asset identities (locally verified November 18; deployed and checked November 19):

| Identity | Value |
|---|---|
| Build | `ed25d3e95b8a4a63b35837a09d467fb23146b1f701510b335e9ac67b5f57d8e3` |
| Source | `a2852d8ab1701a796d7f32b71be37092082cd622a264dd5c60854684c0a068d2` |
| WASM SHA-256 | `44a9d687dc9f208bd6d112797189becb36e47d518fcfaa5cde681d47a114d2e3` |
| WASM bytes | 796,120 |
| Source archive SHA-256 | `b459519b9bfe75e01e3d1836c43b078102689c678f5b757651798f71eb9db5e5` |

[Hosted CI 44440812002](https://github.com/katswnt/poker-face/actions/runs/44440812002)
completed successfully with **all eight jobs green**, observed directly for `22f513e`.
Run completed November 18 locally (02:26:13 UTC November 19). The saved `ci.json` contains
the exact run/commit, all eight job identities and completion times. The hosted P5
three-browser gate and 200-hand audit both passed. Reviewed the exact-release WebKit
320px screenshot and Chromium real-200%-zoom screenshot as well as the candidate images.

**Deployment authentication gate:** CLI 62.1.0 reported logged out, but Safari retains
the existing `katswnt` Vercel account and `poker-face` project. Started the previously
authorized CLI login. Its prefilled device-code page left Allow Access disabled; the
normal manual-code flow enabled it. After confirming this self-initiated CLI request,
Vercel required **Verify Your Identity → Use Passkey**, and 1Password required unlocking.
Kat was asked to complete that prompt; no password/recovery code was requested in chat,
no vault contents were inspected, and no authentication protection was bypassed.
The earlier request to start another login command is superseded by this pending prompt.

No agent-issued prepared deployment, temporary project or replacement project was created.
The dashboard shows a Git-triggered deployment for the pushed commit; that is not the
required source-complete prepared release and has not been accepted as P5 deployment evidence.
P5 remains incomplete until the required Vercel deployment, public smoke and deployed
engine/source byte checks pass. Do not deploy stale primary assets. Post-push annotations
in this record/spec/roadmap/handoff remain local for the closing release record.


## Verified production deployment — 2026-11-19

Kat completed Vercel authorization. CLI 62.1.0 `whoami` confirmed `katswnt`.
The existing project `prj_8UShl6kVnEvFt520xt1vTTKP2kjj` was retained. No new project,
plan change, authentication bypass or deployment-protection change was needed.
This closes the historical authentication/deployment gate above.

- Release commit: `22f513e61e3579deb0fa16de2de361c7377a3041` (clean exact checkout,
  copied node_modules; native/WASM rebuilt there, not copied from stale primary assets).
- Production: [pokerface.katswint.com/play](https://pokerface.katswint.com/play).
- Immutable deployment: [poker-face-2fu7i7l3d-kat-swints-projects.vercel.app](https://poker-face-2fu7i7l3d-kat-swints-projects.vercel.app).
- Deployment ID: `dpl_HEnua5L5HjMq57U6fpKuzWj9dqDs`, Ready, production, created
  2026-11-19 17:37:21 UTC. Vercel inspection confirms the canonical production alias.
- Pinned CLI commands in the clean release checkout: `pull --yes --environment=production`,
  `POKER_FACE_LIVE_REQUIRED=1 npx --yes vercel@62.1.0 build --prod`, then
  `npx --yes vercel@62.1.0 deploy --prebuilt --prod --archive=tgz`.
  Source remained clean. Packaging used Next 16.3.3 / Node 24.10.0 and the existing
  project's Node 24.x setting. The compressed upload was approximately 102 MB.
- Public fetch at 17:38:02 UTC: current pointer, manifest, JS glue, WASM, licence notices
  and corresponding AGPL archive all HTTP 200 and **byte-for-byte identical** to the
  clean build. `/play` identifies that build, links that archive and displays the
  measured 23.4%-of-subgame-pot warning. This is independent of the upload result.
- Deployed P5 Playwright suite: **28 passed, two explicit non-Chromium real-zoom-API
  skips, zero failures/retries**. Existing assertions/timeouts unchanged, no local server.
  All three engines completed the keyboard/off-menu hand with conserved ledger, live
  turn cancellation/retry without charging twice, missing-engine refusal/recovery,
  saved-EV teaching, source download, labelled inputs and 320/390/1280px layouts.
  Chromium additionally passed real 200% zoom. Desktop browser emulation does not
  establish physical-phone performance or safety.

| Public file | Bytes | SHA-256 |
|---|---:|---|
| `current.json` | 493 | `6a91c533ff8f49707089a88efb49a16aa285adc0fa7c30ee8ce28c869526d574` |
| `manifest.json` | 287,681 | `f8c32ddc5674b244f96a59e0e045e98e3fd405991fcc3126f46439cd2fe81652` |
| `solver_bridge_wasm.js` | 12,345 | `87195a67b9da89d28bd5a47297f3b5018f20a25eb3bbf011c7f53bdc8716661f` |
| `solver_bridge_wasm_bg.wasm` | 796,120 | `44a9d687dc9f208bd6d112797189becb36e47d518fcfaa5cde681d47a114d2e3` |
| `LICENSES.txt` | 436,641 | `3433266e057c04c5ddd72ca6b3eb83593fe712d70f6057a22a2446ea58347379` |
| corresponding source `.tar.gz` | 4,806,831 | `b459519b9bfe75e01e3d1836c43b078102689c678f5b757651798f71eb9db5e5` |

Build/source identities are in the preceding table. Logs, exact remote test configuration,
JSON results, screenshots and byte-verification helper/output are retained in ignored
`build/p5-release-2026-11-19/`; prior complete release evidence remains in
`build/p5-resume-2026-11-18/exact-22f513e/`. The remote configuration points to the
unchanged `e2e/play.spec.ts`, sets the public baseURL, three desktop engines, one worker,
180-second test timeout and zero retries; it omits the local webServer.

P5's release gates are met. Closing documentation owns only README status/architecture
hunks, this record, the resolving spec, CPU roadmap and November 18/19 handoffs.
The docs commit must pass isolated full tests, typecheck, lint and relevant audits before
push, with all hosted CI jobs observed green. It does not change the deployed app/engine
release `22f513e`. After any Git-triggered docs deployment settles, retain/re-promote
this prepared production deployment and recheck public bytes: a default Git build lacks
the ignored prepared assets. Never replace this with a saved-only build by accident.
