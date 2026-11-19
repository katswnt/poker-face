# CPU-ceiling handoff — 2026-10-01

Historical checkpoint. The [October 4 handoff](codex-handoff-2026-10-04.md) supersedes
the authentication blocker and EV-export release requirement below, and records the
user-requested pause. The [November 18 handoff](codex-handoff-2026-11-18.md) records the
subsequent resume. Keep the measurements here as historical evidence.

**Interim, not a completion claim.** W1–W4 and P1–P4 are landed; P5 is an uncommitted
candidate. Vercel authentication is blocked and additional P5 release checks remain.
Kat has been asked to run `npx vercel@62.1.0 login` in her own terminal. Never ask for a
token in chat. No P5 commit, push or deployment was performed.

## Landed milestones

| Milestone | Commit | All-eight-jobs-green CI run |
|---|---|---|
| W1 single-thread WASM | `ebcd248` | `36753561883` |
| W2 bounded Worker | `bf44ef2` | `36757906224` |
| W3 browser verification | `0accb63` | `36763545452` |
| W4 live solver page | `a87b34a` | `36768099422` |
| P1 on-tree/full-range play | `ea47f6e` | `36804916249` |
| P2 off-tree river play | `1d581d8` | `36906885269` |
| P3 nested turn play | `bc4e5e5` | `36950939510` |
| P4 translated flop play | `735c901` | `36960266510` |

Diagnostic/research foundation commits also remain: `f394fb7` (original P1 admission
failure), `0fae3ed` (independent toy gadget study), `70dfdc0` (measured wider-range
foundation). Preserve the separate trainer planning commit `bd169a7`.

P4's exact commit passed 1,042 unit tests, tsc/lint/build, native/WASM checks and full
fresh native and WASM corpus reproduction before push. Its eight CI jobs were observed
green before P5 started. See [P4's release record](heads-up-play-p4-flop.md).

## Measurements that matter

- P1 unchanged full-range gates: 1,000 deterministic/conserved hands; Chromium p95
  approximately 4.37 seconds turn and 77.6 ms river. No pruning was needed.
- P3 frozen live-turn corpus: 200 cases, Chromium p95 approximately 4.26 seconds,
  inside the unchanged 10-second target. Firefox p95 approximately 51.8 seconds;
  never generalize Chromium's latency to all browsers/devices.
- Optional partial turn cache: 674/2,352 roots; 50,071,208 raw bytes, sum of compressed
  chunks 20,079,534 bytes. Potential membership 238/765 (31.1%), **not observed cache
  hits**. It is unpublished, not enabled on `/play`, and not a P4/P5 dependency.
- P4 frozen 200 parent/action cases: all 12 saved flops and both seats; 57 cases used
  the explicitly labelled passive rule. Chromium continuation p95 2,441.9 ms turn,
  62.6 ms river, 37 ms flop. Three-engine exact parity; observed WASM linear-memory
  peak 22,937,600 bytes (21.875 MiB), not total browser or phone memory.
- P2's composed-policy weakness remains: **23.4% of the local subgame pot**, not a
  global bound or expected human win rate. It is prominently displayed on `/play`.
- P5 candidate: **1,057/1,057 unit tests**, zero failures/skips (105.74 seconds), tsc,
  lint and prepared production build passed. Three-browser prepared page checks:
  **25 passed, 2 explicit non-Chromium zoom-API skips**, no retries; all engines check
  text resizing and responsive layouts. Tests include real turn cancellation/retry,
  missing-engine recovery, keyboard full-hand play and independently recomputed math.
- P5 real UI-controller corpus: **200/200 completed and replayed**, **301 accepted
  native solve attempts / 295 unique public games**, 128 turn hands, 105 river hands.
  Exact 20,050-chip conservation per deal and ledger agreement. Human/AI nets
  −38,316/+48,316 chips include 200 × 50 external dead-blind chips; not a strength test.

## P5 implementation and preserved evidence

The [P5 task](heads-up-play-p5-ui.md) is the authoritative prospective contract, file
ownership list, commands, hashes, fail/pass evidence and remaining gates. It contains:

- A React-independent real-reducer controller and W2-only production solve factory.
- `/play`, route-scoped CSS, native controls, seat/seed selection, real bet sizing,
  elapsed/iteration progress, cancel/retry, history and a local completed-hand ledger.
- Decision teaching: pot odds, MDF using the aggressor's actual newly risked chips,
  polar bluff share, exact blocker-aware range equity in a separate Worker, AI mix
  revealed only after completion, and explicit source/quality/range-retention provenance.
- Honest unavailable live action EVs; saved EVs labelled original-policy values, not
  composed-play values. **Full §2.8 live human EV-loss grading is still open.** Do not
  call the entire teaching specification complete or invent EVs from equity.
- A frozen human script and source-bound compressed corpus, executable replay audit,
  corruption tests and mandatory CI configuration for replay and three-browser UI.

Evidence report hash:
`31c14fab9e4176f2f109b03e95efe899dacb308dba369423ad3160df05bcb01b`.
Capture-source hash:
`acaf3e6e27fb20f8818ffe5209453094397550db260367e26e38e40c7c7b5104`.
Gzip: 11,608,120 bytes,
`468f96df1dd227b18b4223cbb4b9635fdb53c316ad2d08eda2a3843922db0b77`.
`npm run audit:hu-play:p5` replays preserved policies; it does not run new native solves.

All owned source/test/artifact changes are saved in the primary working tree. The
development copy is `/private/tmp/poker-p4-exact.GdkqIQ`, now dirty P5 despite its name.
It has copied dependencies and prepared P4 engine assets. Raw capture is preserved at
`/private/tmp/poker-p5-ui-native-first`; logs/screenshots are listed in the P5 task.
Do not mistake candidate tests for exact-commit isolation or deploy this old asset build.

## Resume order

1. Renew/check Vercel authentication. Existing project binding is in `.vercel/project.json`;
   do not create another project or disclose credentials. CLI 62.1.0 `whoami` returned
   “The specified token is not valid.” No deployment was attempted.
2. Finish P5's open EV/export/grade coverage honestly, with failing tests first. Preserve
   the frozen corpus; any change in its bound controller/source closure needs new retained
   reproduction evidence, not overwritten claims.
3. Run full app/browser regressions, saved-only build, relevant standalone audits and
   fresh reproduction. Update README **owned hunks only** (none added for P5 yet).
4. Commit only P5's explicit paths; use a fresh isolated checkout with **copied**
   node_modules for exact-commit full unit/tsc/lint/audit/native/WASM/build/browser checks.
   Never exclude or overwrite the dirty draft to make the primary tree compile.
5. Rebuild native/WASM assets from the clean release checkout, push the verified commit,
   observe all eight CI jobs green, deploy to the existing Vercel project, fetch and
   verify deployed manifest/glue/engine/source-archive hashes and smoke-test `/play`.
6. Record the exact release/deployment identities here; only then mark P5 complete.
   After P5: push/fold drills, equity-vs-range drills, then `/play` hand review. PF4 stays gated.

Physical-device checks, once the deployed release exists: iOS Safari and Android Chrome
at real narrow widths, a complete hand, turn/river wait and cancellation, retry without
duplicate bets, equity hints, memory/refusal behavior, focus/zoom and source download.
List results with device/OS/browser identities; their absence does not block approved
desktop work and is not permission to claim phone performance.

## Untouched work

These are not owned by P5 and must not be staged, overwritten, reverted or committed:

```text
METHODOLOGY.md
README.md                             # unrelated trainer hunks
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

All 15 non-README protected hashes still match
`build/p3-safeguard-2026-10-01/manifest.json`. P5 did not edit README. No files were staged
or committed during this P5 continuation. The data-reuse note stays separate and unpublished.
