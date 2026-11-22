# H1 — review completed `/play` hands

Prospective contract, 2026-11-21, before implementation or measurements. Baseline
`1d90561`; all eight closing D2 CI jobs passed in run `44965504398`. D1 and D2 are
deployed and verified. Follow the CPU roadmap working rules, AGENTS and lessons.

## Outcome and scope

Keep completed hands from this page in a bounded, tab-lifetime review collection.
Between deals, select a completed hand and step through its decisions in order. Show
the board, pot, stacks, chosen action, original action frequencies/values, model-relative
comparison, price math, range equity and source identity at that moment. Reveal the
final outcome separately. A won pot is not proof of a good decision; losing is not
proof of a mistake. No summed EV-gap score or GTO-correct badge.

Offer a versioned JSON download of the complete review inputs. No uploads, arbitrary
hand-history parsing, cross-device sync, persistent browser storage, new solves, preflop
advice or new games in H1. Reloading or leaving the page clears review. Explicitly say
that downloaded reviews cannot yet be imported into the app. Physical phones remain
unmeasured and nonblocking. PF4 stays gated.

## Architecture and mathematical contract

- A React-independent review module consumes only the existing completed `PlayView`,
  ledger row, and copies returned by `equityInput`. It never modifies the controller,
  policy source, RNG, settlement, solver, teaching evaluator or decision grader. The
  existing source-bound P1–P5/E1 evidence must still audit unchanged. Capture is a
  read-only observer in `PlayTable`; capture failure is visible but cannot break play.
- Require completion and revealed cards before capture. Hand identity uses the session
  ledger ID, not the seed: playing one seed twice creates two reviews. Record the serving
  build and engine-source SHA-256. No current-hand/private data is exposed through review.
  Review is mounted only between hands; starting another hand closes it.
- For every recorded decision, validate its public state against the exact prefix of the
  completed public history. The next committed event must be that actor's action. Reject
  duplicates, missing decisions or mismatched histories rather than manufacturing advice.
  Deep-copy and freeze data; later controller changes, outcomes and range updates cannot
  mutate a completed snapshot. Order by public event index, not source preparation order.
- Equity receives exactly the learner's cards, the board at that decision and its retained
  AI reaching range. Never use the final board or actual AI hand. Reuse the separate
  teaching Worker and its cancellation/stale-result protections, with no synchronous
  enumeration or solver fallback. Equity is the share with no further betting, not call EV.
- Reuse `decisionPrice` and `gradePlayDecision`. EVs remain in chips internally (100 = 1bb).
  Gap is best listed value minus chosen value in that same pre-action model, never a
  comparison across solves. Preserve saved/local basis, ungraded off-menu/translated/missing
  rows, real zero values and rounding caveats. A small local exploitability number is not
  a bound for each hand or for the composed AI. No aggregate accuracy score.
- Retain at most 20 reviews and 8 MiB of serialized review payload; individual payloads
  above 2 MiB are refused explicitly. Evict oldest first and report that eviction. These
  are serialized-byte limits, not measured JS heap limits. No Workers/native buffers or
  full policy trees are retained. All 200 frozen P5 hands must fit individually without
  dropping decisions. Measure maximum/per-hand p95 bytes and capture latency.
- The review UI uses native controls, the existing page theme, accessible card names,
  labelled selection and previous/next controls, table captions and visible focus.
  Keep the active-hand inspector unchanged. Keep scripted preflop, hand-written ranges,
  12 saved flops, the 23.4%-pot warning and corresponding AGPL source links on the page.

## Pros, costs and mitigations

Preserving actual snapshots makes the lesson reproducible without another solve or GPU.
It avoids hindsight and preserves model provenance. The cost is tab-lifetime storage,
limited retained history, and occasional unavailable grades. State these limits beside
the controls, offer a full-input download, and show the reason for unavailable values.
Do not silently replace them with equity, a later model or the action taken most often.

Review adds memory and another presentation of teaching math. Bound serialized storage,
keep capture out of the policy pipeline, reuse the existing mathematical functions/Worker,
and independently test every displayed numeric convention. Do not change audited math
or frozen evidence to make the new UI easier to implement. Review capture failures must
leave the original hand and ledger usable.

## Frozen validation and release gates

- [x] Fail-first unit tests for incomplete capture refusal, same-seed distinct IDs,
  idempotence, deep isolation, malformed/missing/duplicate prefixes, stale final-board or
  hidden-card equity inputs, capacity/oldest eviction, oversized refusal and JSON export.
- [x] Independently calculate price/MDF/bluff-share and best-minus-chosen gaps for both
  seats, bets/raises, tied/zero values, missing columns, off-menu and translated choices.
  Verify earlier-board equity with the independent best-five evaluator on bounded cases.
- [x] Replay all **200 unchanged P5 cases** with their hash-checked preserved E1 policies,
  through the real controller. Review on/off must preserve every log/decision hash, ledger
  and solve request. All actions have matched review snapshots; all retained rows match
  original values/ranges; every grade is independently recomputed. No new solve needed.
  This tests preservation, not new solver accuracy. Maximum capture <=100 ms and every
  record <=2 MiB on this laptop; report p50/p95/max and serialized storage/eviction counts.
- [x] Three-engine browser checks: keyboard navigation, repeated seeds, next-deal closure,
  completed-only data, correct numbers/labels, download, reload clearing, equity cancel/
  retry and stale selection; no solver/data fetch caused by review. 320/390/1280px and
  200% text zoom reflow, real Chromium 200% zoom, screenshots inspected. No new skips.
- [ ] Exact clean commit, **copied** dependencies, fresh native/WASM assets: full units,
  tsc/lint, new review audit, D1/D2 reproduction and existing bridge/WASM/river-v3/P1–P5/
  E1/preflop/wide/gadget audits, production build and full applicable browser suites.
- [ ] Explicit owned files/README hunks only; protected work unchanged. Push main and
  observe all eight CI jobs green before any next milestone.
- [ ] Guarded pinned Vercel deploy from that exact clean release; deployed review/play
  smoke and public engine/source/data hashes verified. Record commits, CI, measured
  numbers and remaining limits; update the handoff and this checklist honestly.

## Owned paths

New: `src/lib/hu-play/review.ts`, `src/app/play/HandReview.tsx`,
`src/app/play/review.module.css`, `test/hu-play-review.test.ts`,
`scripts/audit-hu-play-review.ts`, `e2e/play-review.spec.ts`, this spec and an H1 handoff.
Existing: `src/app/play/PlayTable.tsx`, `playwright.play.config.ts`, `package.json`,
`.github/workflows/ci.yml`, relevant README hunks and the canonical handoff.
No controller, DecisionMath, engine, old audit, frozen artifact, protected trainer/session
file, paused draft or global CSS change. Amend ownership prospectively if inspection
finds a real need; never weaken the gates or overwrite unrelated work.

## Execution record

The candidate is implemented in the isolated checkout. Local records live in
`build/hand-review-2026-11-21/`. Exact-commit, CI and deployment gates remain open.
The clean D2 closing checkout is reused as an isolated candidate with copied dependencies;
the deployed D2 exact checkout remains available until the replacement is verified.


### Candidate verification — 2026-11-21

Eleven new unit cases were written fail-first (missing module/audit, then the duplicate
completion observer), with 26 focused review/controller/snapshot/math tests passing.
The initial UI test failed on the absent review; the direct keyboard entry also failed
before implementation. A test-only malformed-board error matcher was corrected to include
its actual board-validation message. No mathematical input or gate changed.

The real controller emits a progress reset carrying its old completed view after clearing
old observations at the next deal. The observer ignores already captured ledger IDs before
reading those observations. A dedicated red/green regression covers this, and the corpus
now captures through actual controller subscriptions. No controller change was needed.

All 200 original P5/E1 hands and **1,031 decisions** are preserved, with **301 identical
solve requests**, zero log/decision mismatches and zero missing snapshots. Independently
checked: 295 faced-bet price calculations; 321 supported human EV comparisons; 184 explicitly
unavailable human comparisons; 526 AI decisions. Both seats and earlier turn equity have
separate analytic/best-five checks. Original policy evidence is reused, not re-solved.

Serialized per-hand bytes: p50 **102,512**, p95 **158,429**, max **194,022**. Capturing and
retaining through the observer: p50 **7.301 ms**, p95 **11.001 ms**, max **13.288 ms** on this
laptop, below the frozen 100 ms gate. The final 20 reviews total **1,943,603 bytes**;
180 older reviews were evicted. These are serialized payload sizes, not heap measurements.

Typecheck, lint (zero warnings after transient Playwright traces finished) and production
build pass. **27/27 new browser checks** pass in Chromium, Firefox and WebKit in 39.6 s,
zero retries/skips. Screenshots at 320px and desktop were inspected; all expanded details
reflow. The direct keyboard anchor avoids scrolling through the existing inspector.
All engines test 200% text reflow; Chromium also uses actual extension-set 200% browser zoom.

One browser test initially checked a download button inside a closed disclosure. It now
opens every disclosure and waits for the rendered review before checking names/layout.
This preserves the accessibility requirement and covers the previously hidden controls.
No product error was suppressed, no accessibility assertion removed, and no timing or
quality tolerance increased. The frozen play inspector, mathematical engine, session
controller, graders, Workers and old evidence files are unchanged.

Commands: `npm run audit:hu-play:review`; `node --import tsx --test
 test/hu-play-review.test.ts test/hu-play-ui-controller.test.ts
 test/hu-play-live-value-snapshot.test.ts test/hu-play-decision-grade.test.ts
 test/hu-play-teaching.test.ts`; `npm run typecheck`; `npm run lint`;
`POKER_FACE_LIVE_REQUIRED=1 npx playwright test --config playwright.play.config.ts
 play-review.spec.ts` (builds production first). Candidate uses the unchanged D2 prepared
engine for UI testing only; the exact release must rebuild its own native/WASM/source assets.


### Pre-push zoom-evidence correction

Unpushed commit `281a839` passed fresh native/WASM builds, 23 Rust tests, **1,133/1,133
unit tests** (zero skips; 144.696 s), tsc and lint. Verification was deliberately stopped
before the remaining audits when visual review found that Playwright's full-page capture
cropped the real-zoom image. The UI itself passes the strengthened check: browser zoom 2,
CSS viewport width halved, device-pixel ratio doubled, no horizontal overflow, keyboard
navigation works. The test now saves a CDP viewport screenshot plus those measurements;
the screenshot was inspected and shows readable controls/cards. No application code or
quality threshold changed. Repeat the full exact-commit sequence on the amended commit.


### Hosted screenshot failure and fix forward

Code commit `6ca2f9a6313aae7a50dedae1070dafdc3530c199` passed the complete isolated
release sequence: copied dependencies, freshly rebuilt native/WASM assets, 23 Rust tests,
1,133/1,133 unit tests (zero skips), tsc, lint, all 18 specified audits and production
build. Browser results: 121 full-app, 48 drill, 55 play/review and 34 live checks pass;
the play and live suites each retain their two existing non-Chromium native-zoom skips.
No retries. Exact replay capture p50/p95/max: 7.449/10.799/13.143 ms. All numerical
preservation and size results above remain unchanged.

After push, CI run `44970183319` failed in `bridge-wasm` job `137048046854`: Linux
WebKit cannot take a single screenshot taller than 32,767 pixels. The 200% text cases
at 320px and 390px exceeded that capture limit after the original semantic and layout
assertions passed. The failing suite recorded 53 pass, 2 fail and 2 existing skips;
retries reproduced the same error. The package was **not deployed**. Production stayed
on D2. This is a failed release gate, not a passed test or a mathematical failure.

Fix forward only in the test: wait for the existing inspector equity/fonts to settle,
then capture every part of the unchanged 200% page in viewport tiles with 80px overlap.
Assert first/last coverage, no gaps, unchanged page height and no horizontal overflow;
save a coverage JSON alongside screenshots. No content is hidden, zoom reduced, test
skipped, timeout increased or assertion removed. The original full-page 100% captures
and real Chromium 200% browser-zoom check remain. All nine width/browser cases passed
locally (22.7 s, zero retries), capturing 40 tiles per 320px page, 32 per 390px page,
and 15–16 per desktop page. Representative narrow WebKit tiles were visually inspected.
Typecheck and lint pass. A first lint attempt found generated Vercel bundle code in the
old release checkout; deleting that obsolete generated package restored the normal clean
verification scope without changing lint configuration.

Repeat the exact-commit sequence and hosted CI for this fix; then deploy from its clean
fresh build. Logs and the original failure excerpt are retained under
`build/hand-review-2026-11-21/`. The original contract and numerical gates are unchanged.
