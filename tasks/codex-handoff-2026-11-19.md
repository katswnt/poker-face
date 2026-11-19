# CPU-ceiling closing handoff — 2026-11-19

**W1–W4 and P1–P5 are shipped.** [Play the solver-backed AI](https://pokerface.katswint.com/play)
is deployed from clean release `22f513e`. Public engine and corresponding AGPL source
bytes match that release, and all 28 applicable deployed P5 checks pass in the three
desktop browser engines (two explicit non-Chromium real-zoom-API skips, no retries).
This supersedes the open authentication/deployment instructions in the
[November 18 handoff](codex-handoff-2026-11-18.md). No post-P5 implementation has begun.

## Shipped commits

Each milestone was verified in isolation with copied dependencies before push; all eight
hosted CI jobs were observed green before dependent work continued.

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
| P5 playable/inspectable UI | `22f513e` | `44440812002` |

P5's [release CI](https://github.com/katswnt/poker-face/actions/runs/44440812002) finished
2026-11-19 02:26:13 UTC. Prior diagnostic/research commits `f394fb7`, `0fae3ed`, `70dfdc0`
and trainer planning `bd169a7` remain intact. This closing documentation is committed
separately; it does not change the production app/engine release or frozen numerical corpus.
Its own exact-commit checks and hosted CI must pass before closing the task.

## Production identity

- App/code release: `22f513e61e3579deb0fa16de2de361c7377a3041`.
- Vercel deployment: `dpl_HEnua5L5HjMq57U6fpKuzWj9dqDs` (Ready, production).
- Immutable URL: https://poker-face-2fu7i7l3d-kat-swints-projects.vercel.app.
- Public alias: https://pokerface.katswint.com.
- Existing project: `prj_8UShl6kVnEvFt520xt1vTTKP2kjj`; no new project or protection changes.
- Build: `ed25d3e95b8a4a63b35837a09d467fb23146b1f701510b335e9ac67b5f57d8e3`.
- Source: `a2852d8ab1701a796d7f32b71be37092082cd622a264dd5c60854684c0a068d2`.
- WASM: 796,120 bytes, SHA-256 `44a9d687dc9f208bd6d112797189becb36e47d518fcfaa5cde681d47a114d2e3`.
- Corresponding AGPL archive: 4,806,831 bytes, SHA-256
  `b459519b9bfe75e01e3d1836c43b078102689c678f5b757651798f71eb9db5e5`.

Native/WASM engines were rebuilt from `/private/tmp/poker-p5-exact.boqiiugt`, a clean
checkout of that exact commit with node_modules copied, not symlinked. Pinned toolchain:
Rust 1.98.1, wasm-bindgen 0.2.104, Node 24.10.0, Next 16.3.3. After Kat authorized the
Vercel CLI, the existing production settings were pulled, the prepared production package
built locally, then uploaded using CLI 62.1.0 `deploy --prebuilt --prod --archive=tgz`.
No stale primary/candidate assets were used.

The public manifest, glue, WASM, notices, pointer and source archive were independently
fetched and compared byte for byte. `/play` links the matching archive and identifies
the build. Full file hashes, exact deployment commands and the public verification
record are in [P5's deployment section](heads-up-play-p5-ui.md#verified-production-deployment--2026-11-19).

**Deployment maintenance:** a default Git-triggered Vercel build does not contain the
ignored prepared engine assets. After the docs push settles, retain/re-promote the
verified prepared production deployment and recheck public bytes. Future app releases
must rebuild/prepare their own corresponding assets, deploy prebuilt, and repeat the
identity checks; never silently replace live play with a saved-only deployment.

## Measurements and tests

- Exact P5 release: **1,060/1,060 unit tests**, no skips/failures/cancellations,
  **173.334 seconds**. Typecheck/lint, **21/21 Rust tests**, format/clippy and
  **33 standalone audits** passed. No draft exclusions or relaxed gates.
- Four native/WASM referee/probe cases have exact mathematical parity; independent
  discrepancies remain below **0.0002 chips**. W1/W2 numerical/lifecycle tests pass
  Chromium, Firefox and WebKit, including hard cancellation and fresh recovery.
- Both saved-only and prepared production builds pass. Prepared full app **96/96**;
  P5 **28 pass / 2 explicit zoom-API skips**, W4 **34 / 2**. Saved-only full app
  **87 / 9**, P5 **13 / 17**, W4 **22 / 14**. Six supplementary saved-only disabled-control
  checks passed with `POKER_FACE_LIVE_SAVED_ONLY=1`; the initial omitted flag was corrected.
- Fresh native P5 reproduction: **200/200 complete hands**, **301 accepted solve attempts /
  295 distinct games**. All numerical policies, logs, decision hashes, ledger entries,
  frozen source/input closure and request sequence exactly match the original, excluding
  time/memory telemetry. 128 hands reach turn decisions; 105 reach rivers.
  Human/AI net totals −38,316/+48,316 sum to 200 × 50 external dead-blind chips.
  This is a correctness corpus, not a win-rate or browser-latency estimate.
- Fresh report hash: `c37e62fd6d0c50231ff14616e11e08580eae86976f9bdcd2ff0076a6d76cf699`.
  Sorted numerical-policy hash: `105662b68999e1592c545683bc3bed50671d8b0dd5bb7c9894839fc83b524f2f`.
  Original checked-in report `31c14fab9e4176f2f109b03e95efe899dacb308dba369423ad3160df05bcb01b`
  was not replaced.
- Deployed unchanged P5 tests: **28 pass / 2 explicit skips**, zero failures/retries.
  All three engines pass full keyboard/off-menu play, conserved ledger, live turn
  cancellation/retry, missing-engine recovery, saved EV teaching, source download,
  input errors and 320/390/1280px layouts. Chromium passes real 200% zoom. Reviewed
  deployed WebKit 320px and Chromium 200%-zoom screenshots; readable controls, visible
  focus and no clipping. These are desktop browser checks, not physical-phone validation.
- Prior frozen P3 Chromium turn p95 **4.26 s**, Firefox observer p95 **51.8 s**.
  P1 full-range median local exploitability **0.2445% of pot**; no pruning enabled.
  P2 composed local exploitability reaches **23.4% of subgame pot**, visibly explained
  on `/play`. Individual small solve errors do not certify the composed opponent safe.
- River v3 preserved: value **+16.081056725 chips**, best-response gains
  **0.014993444 / 0.003155818**, exploitability **0.009074631 chips**.

Durable local evidence is ignored under `build/p5-resume-2026-11-18/exact-22f513e/`
(all exact-release logs, assets, raw capture, helpers and CI identity) and
`build/p5-release-2026-11-19/` (deployment, public bytes, remote tests/screenshots,
closing-doc checks and final CI). Do not commit environment files or credentials.

## Boundaries and next work

P5 has no remaining numerical or deployment gate. Physical iOS Safari and Android Chrome
checks remain open under Kat's approved nonblocking device policy. On each device: deal
and complete a hand; try narrow controls; cancel/retry a live turn and river without a
duplicate bet; inspect exact range-equity teaching; download corresponding source; record
browser/device, wall time, memory where available, and any refusal or crash. Desktop
p95 measurements must not be advertised as phone limits.

Preflop is scripted, ranges are hand-written and flops are limited to 12 saved textures.
Flop translation sometimes uses a labelled passive call rule. Strategies are approximate
for those finite games, **not exact GTO**. Local re-solving has no global guarantee.
The partial optional turn cache stays disabled/unpublished; no claim of complete coverage.

Kat's October 4 scope decision shipped original saved-policy EV gaps. Live, translated
and off-menu action grades are explicitly unavailable; neither equity nor action frequency
is substituted for an EV grade. Next: specify and test live action EV export/grading,
then push/fold and equity-vs-range drills, then `/play` hand review. Write prospective
validation contracts first. PF4 remains gated; reproducing the flagged preflop model does
not validate it, and restricted push/fold drills do not unlock it.

## Untouched work and staging boundary

Only P5's implementation and owned README hunks entered `22f513e`. Closing documentation
owns this handoff, the November 18 handoff, P5 record, resolving spec, CPU roadmap and
README status/architecture hunks. README staging uses a clean HEAD-based blob, preserving
all trainer additions/deletions. All 15 protected non-README hashes continue to match
`build/p3-safeguard-2026-10-01/manifest.json`.

```text
METHODOLOGY.md
README.md                             # original trainer hunks remain dirty
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

Never overwrite, revert, stage or commit these unrelated changes. The paused configurable-
flop draft remains untracked and outside the release checkout, with no tsconfig exclusion.
The local session ledger deliberately preserves the unrelated trainer/session work.
