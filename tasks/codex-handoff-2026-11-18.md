# CPU-ceiling handoff — 2026-11-18

Resumed at Kat's request. **P5 is not complete until the deployed build and its AGPL
source have been verified.** This file supersedes the October 4 pause instructions;
the older handoffs retain their historical evidence. No post-P5 milestone has started.

## Shipped before this continuation

| Milestone | Commit | All-eight-jobs-green CI run |
|---|---|---|
| W1 single-thread WASM | `ebcd248` | `36753561883` |
| W2 bounded Worker | `bf44ef2` | `36757906224` |
| W3 browser verification | `0accb63` | `36763545452` |
| W4 live solver page | `a87b34a` | `36768099422` |
| P1 full-range play | `ea47f6e` | `36804916249` |
| P2 off-menu river play | `1d581d8` | `36906885269` |
| P3 nested turn play | `bc4e5e5` | `36950939510` |
| P4 translated flop play | `735c901` | `36960266510` |

This continuation began with `HEAD` and the remote main branch at P4 `735c901`.
The diagnostic/research commits `f394fb7`, `0fae3ed`, `70dfdc0` and the independent
trainer planning commit `bd169a7` remain intact. See the October 1 handoff and individual
milestone records for their measurements and exact-release evidence.

## P5 implementation and scope

The [P5 record](heads-up-play-p5-ui.md) contains the full prospective contract, explicit
ownership list, fail-first tests and frozen artifact identities. `/play` uses the actual
P4/P3/P2 controller and browser Workers, with legal chip sizing, seat/seed controls,
real progress, cancellation/retry, history and an independent local completed-hand ledger.
Teaching includes independently tested pot odds, MDF, polar bluff share, exact weighted
equity against AI reach in a separate Worker, provenance and source links. AI private
cards and hand-specific strategy stay hidden until completion.

Kat's October 4 scope decision remains binding: ship **original saved-policy action EV
gaps**, then add live EV export/grading separately. The saved gap is best exported EV
minus chosen exported EV; neither action frequency nor equity substitutes for value.
Live/translated/off-menu grades are explicitly unavailable. Saved EVs are not values
against the composed re-solving opponent. The 0.1-chip rounding bound is not a solver
error bound. No grading change entered the controller, source closure or frozen corpus.

New November 18 browser assertions exercise pending/ready/off-menu/live grading in all
three engines. Seed 0's exported check/bet EVs are 62.3/61.8 chips; choosing the 182-chip
bet displays the independently subtracted 0.5-chip gap (0.005 bb). README now explains
the implemented page, its limits and the remaining release/follow-up work. Only P5's
README hunks are owned; the trainer's pre-existing changes remain in the working tree.

Keep the visible unusual-size warning: P2 measured **23.4% of the local subgame pot**
in composed-policy exploitability, not expected winnings or a global bound. Preflop is
scripted; the ranges are hand-written; there are 12 saved flops; this is not exact GTO.
The optional partial turn cache remains unpublished and disabled. PF4 stays gated.

## Candidate verification (not exact-release verification)

The old temporary development checkout had been mostly purged. Reconstructed a fresh
P4-based candidate at `/private/tmp/poker-p5-resume.QZEHsU`, overlaying only P5's explicit
files and copying node_modules with APFS clone copies, not symlinks. Unchanged tsconfig;
no protected draft files or artificial exclusions. Node 24.10.0, pinned Rust 1.98.1 and
wasm-bindgen 0.2.104. The restored bindgen CLI is at
`/private/tmp/poker-p5-tools-20261118/bin/wasm-bindgen`.

- Full unit suite: **1,060/1,060**, zero skips/failures, 178.953 seconds.
- Native tests: **21/21**; native/WASM format and clippy with warnings denied passed.
- Typecheck, clean lint and saved-only/prepared production builds passed.
- All 24 standalone audits listed in the P5 record passed, including preserved P1–P4
  source-bound evidence and reproducible river/turn/flop artifacts. River v3 remains
  value **16.081056725 chips**, gains **0.014993444 / 0.003155818**, exploitability
  **0.009074631 chips**. The preflop audit reproduces the research model; it does not validate it.
- Four native/WASM referee/probe cases have exactly equal mathematical output and
  independent grader error below **0.0002 chips**. W1 parity and W2 Worker lifecycle
  harnesses passed all three browsers, including hard cancellation and fresh recovery.
- Prepared full-app Chromium: **96/96**, zero skips/retries.
- Prepared P5 Chromium/Firefox/WebKit: **28 passed, 2 explicit non-Chromium zoom-API
  skips**, zero retries. W4: **34 passed, 2 explicit zoom-API skips**, zero retries.
- Saved-only full app: **87 passed, 9 live-only skips**. Saved-only three-browser P5:
  **13 passed, 17 explicit live/zoom skips**; W4: **22 passed, 14 explicit skips**.
  Refusal is tested; skipped live cases are not claimed as passing in this build.
- Reviewed 320px and real 200% browser-zoom screenshots. Native controls and route CSS
  preserve visible focus and unclipped layouts; protected global styles were not changed.

Logs are under `/private/tmp/p5-nov18-*.log`, with browser results in correspondingly
named external directories. Copy release evidence to ignored
`build/p5-resume-2026-11-18/` before ending the turn; temporary paths are not durable.
Fresh native and WASM candidate engines were rebuilt. Their source hash is unchanged:
`a2852d8ab1701a796d7f32b71be37092082cd622a264dd5c60854684c0a068d2`.
Candidate assets identify the P4 base commit and must **not** be deployed as P5.

The preserved P5 corpus remains **200 complete/replayed hands, 301 accepted native
attempts, 295 distinct games**, 128 hands reaching turn decisions, 105 reaching rivers.
All 20,050 chips are conserved per hand; human/AI net totals −38,316/+48,316 sum to
200 × 50 external dead-blind chips. This is a correctness corpus, not a strength or
browser-latency estimate. The original report hash remains
`31c14fab9e4176f2f109b03e95efe899dacb308dba369423ad3160df05bcb01b`.
Fresh one-thread native reproduction also passed **200/200**, all 301 attempts. All
295 complete numerical policies, all hand logs/decision hashes/ledger rows, inputs,
capture source and request sequence match the original exactly, excluding timing and
memory telemetry. Fresh report hash:
`35e65bafce2172b312cbb9228354c02b4292669ce665f23c7013d746bdda52bc`;
sorted numerical-policy hash:
`105662b68999e1592c545683bc3bed50671d8b0dd5bb7c9894839fc83b524f2f`.
Original checked-in evidence was not replaced. Exact-release results remain to be recorded.

## Remaining release gates / resume order

1. Candidate audits and fresh reproduction passed. Preserve all cases, quality gates
   and numerical results through exact-commit verification.
2. Commit only P5's explicit files and README blob from the isolated copy. Test that
   exact commit in a new checkout with copied dependencies: full units, tsc, lint,
   Rust/native/WASM, audits/reproduction, both builds and browser gates. Push only after
   success; observe all eight hosted CI jobs green. Never stage the primary README whole.
3. Deploy only assets freshly rebuilt from that clean P5 release commit to the existing
   Vercel `poker-face` project. Fetch and compare deployed manifest, glue, WASM and source
   archive bytes/hashes; smoke-test `/play`; record URL, deployment identity and hashes.
4. Record final release/deployment identities. Only then mark P5 and steps 1–9 complete.
   Next: live EV export/grading, then push/fold and equity-vs-range drills, then hand review.

**External dependency:** Vercel CLI 62.1.0 `whoami` reports an invalid token again.
Kat was asked asynchronously to run `npx vercel@62.1.0 login` locally and confirm success.
October 4's successful login is historical, not proof of current authentication. No
credentials are requested in chat; no new project or deployment has been created.
Independent release checks continue while login is pending.

Physical iOS Safari / Android Chrome measurements remain open and do not block the
approved desktop path. Once deployed: full hand, narrow-screen controls, turn/river
progress and cancellation, retry without duplicate betting, teaching Worker and source
download. Chromium's frozen P3 turn p95 4.26 s is not a promise for phones or Firefox
(previous observer p95 51.8 s). No new phone/performance claim was made here.

## Untouched work

All 15 protected non-README hashes matched
`build/p3-safeguard-2026-10-01/manifest.json` at resume. The original trainer README
bytes/patch were saved under `build/p5-resume-2026-11-18/`; a diff against the isolated
P5 README preserves exactly the original trainer additions/deletions.

```text
METHODOLOGY.md
README.md                             # trainer hunks only; P5 hunks are separate
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

Never overwrite, revert, stage or commit these protected changes; never exclude the
paused draft from typecheck. Primary's dirty tree is not a release verification checkout.
