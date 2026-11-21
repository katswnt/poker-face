# D1: push/fold practice

Implementation started 2026-11-21 from `747a293`. Contract:
[drill-expansion-plan.md](drill-expansion-plan.md), frozen D1 section.
Status: candidate implemented; exact-commit, hosted CI and deployment gates pending.

## What changed

`/drills?drill=push-fold` practices small-blind fold/shove and big-blind fold/call
decisions from the existing saved 2–20 bb, 0.5/1 blind profiles. The browser does not
solve or load the equity matrix. It downloads one hash-verified depth at a time.
Feedback explains both action values, saved frequencies, the gap, conditional equity,
fold probability or call price, and the effects of removing the learner's cards.

Values are in bb **relative to folding at the decision**, not full-hand profit.
The 0.01 bb inclusive answer band is a teaching choice, not a mathematical accuracy
claim. No postflop mixed-frequency exemption applies. Both actions can be accepted.
The restricted game and approximate strategy are labelled on the page. No PF4 inputs.

The existing review queue now stores a versioned dataset/stack/seat/hand key. A removed
version produces a visible error and an explicit removal action. Failed downloads can
be retried. Loading time does not consume the answer timer, and stale or mismatched
async replies are ignored. Existing math seeds and postflop grading remain unchanged.

The practice-type extension leaves the original shared drill contracts unchanged because
they are part of `/play`'s frozen measurement closure. E1's source-bound audit passes;
no source hashes, archived evidence, or gates were revised.

## Candidate measurements

| Check | Result |
|---|---|
| Rounded saved profiles re-graded | 37 / 37 |
| Independently recomputed decisions | 12,506 / 12,506 |
| Largest combined unilateral gain | 0.000046464518117771554 bb at 18.5 bb |
| Existing profile limit | 0.0005 bb; all pass |
| Largest depth download | 47,962 bytes |
| Complete numerical data | 1,763,288 bytes in 37 files |
| Per-depth / total limits | 204,800 / 8,388,608 bytes; pass |
| Focused old + new drill unit tests | 56 / 56, zero skips |
| Three-engine browser checks | 24 / 24, zero retries or skips, 15.2 seconds |
| Layouts checked | 320, 390, 1280 CSS px; 200% CSS zoom reflow |
| TypeScript, lint, production build | pass in isolated candidate |
| Existing E1 audit | pass; frozen play dependencies unchanged |

Dataset identity at candidate check:
`90edb16e88236f983c73ec4907e65d71c38b917597d92ffa1143d959be032a4c`.
Every data byte is reproduced from source and contract hashes. Physical-phone testing
is not claimed. Screenshots were inspected at 320 and 1280 px; the value column identifies
bb in its heading so the numbers remain separated on narrow screens.

## Validation and failure records

Tests were written first. `test/drills-push-fold.test.ts` initially failed because the
implementation modules did not exist (`/private/tmp/drills-d1-red.log`). The browser test
failed against the unchanged production build because the new control was absent
(`/private/tmp/drills-d1-ui-red.log`). A schema test then failed on a missing conditional
equity check and passed after the validator fix. A new pre-answer hint assertion failed
before the accessible grading hint was added (`/private/tmp/drills-d1-hint-red.log`).

A same-length, valid-schema equity mutation is rejected specifically by SHA-256.
Temporarily bypassing only that check makes the assertion fail; the production implementation
was restored unchanged (`/private/tmp/drills-d1-hash-mutant.log`).

The independent numerical test enumerates compatible physical opponent combinations for
every hero class, without the engine's `DISJOINT`, class-index or payoff helpers. It
recomputes every action EV, conditional equity, fold chance and both whole-game gains.
Other tests cover sunk blinds, unreachable ranges, grade boundaries, versioned replay,
hash/size/schema failures, retry, stale replies, and review persistence. Browser checks
cover keyboard focus and actions, Tab/Enter disclosure, pending mode switches, download
failure, unavailable versions, and reflow. Initial browser failures from broad selectors
matching Next's route announcer and a focus assertion after intentionally moving focus
were corrected in the tests; gates were not loosened.

Reproduction and focused checks:

```sh
npm run audit:drills:push-fold
node --import tsx --test test/drills-*.test.ts
npm run typecheck
npm run lint
npm run audit:hu-play:e1
npm run build
CI=1 npx playwright test --config playwright.drills.config.ts --retries=0
```

## Release gates

- [x] Frozen contract, failing tests first, independent values and serialized-profile grades.
- [x] Byte reproduction, sampling coverage, bounded/lazy loading and review identity.
- [x] Candidate keyboard, responsive and three-browser checks; visible model/grade limits.
- [ ] Exact commit in isolation with **copied** dependencies, full native/WASM-enabled unit
  suite, typecheck, lint, relevant solver audits and production build.
- [ ] Push explicit D1 files to main; all eight hosted CI jobs green.
- [ ] Clean-checkout WASM rebuild; guarded Vercel deploy; deployed source archive and build
  hashes match; deployed drill and `/play` checks pass.

## Ownership and next step

D1 owns its plan/record and drill-spec addition; the new push-fold modules/data/test/audit,
practice types, minimal existing drill session/storage/registry/grade/consumer type changes,
drill page components/CSS/metadata, Playwright checks/config, package/CI audit commands,
and its README paragraphs only. The trainer/session work, paused configurable-flop draft,
all mathematical solver code/data and `/play` code/evidence are untouched.

After D1 release gates pass: freeze the 36 hand-written turn/river inputs for D2, then
implement exact equity-versus-range drills with independent outcome enumeration. Hand
review follows D2 under its own prospective contract.
