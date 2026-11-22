# H1 release handoff — 2026-11-21

## Shipped

W1–W4/P1–P5, R1, E1 and the agreed D1/D2/H1 teaching sequence are complete.
D1 code `be05152` and D2 code `0851bed` remain unchanged. H1 is `6ca2f9a`, followed
by screenshot fix **`de7f0d6174fb3510d8595ed987bff88ca8232b86`**; all eight jobs passed in
[CI 44972899823](https://github.com/katswnt/poker-face/actions/runs/44972899823).

Live: <https://pokerface.katswint.com/play>, deployment `dpl_HHoAePwiogWCLqgcSbCELVGEfFcB`.
See [the H1 contract and release record](hand-review-h1-spec.md) for full build/source
identities, exact commands, the original CI failure and measured results. The failed
package was never deployed. The fix preserves full 200% screenshot coverage with
overlapping viewport tiles; it changes no layout, math, timeout or quality gate.

## Behavior and evidence

Review up to 20 completed hands / 8 MiB of serialized snapshots in tab memory. Step
through the original board, ranges, prices, frequencies and action values. Equity runs
in a separate cancellable Worker against the range at that decision. Final outcomes
stay separate; no hindsight, summed EV-gap score, new solve or policy change. Starting
a new hand closes review. JSON download includes complete inputs and build identity;
leaving/reloading clears the archive. Import, uploads and persistence are not implemented.

All **200** frozen hands, **1,031** decisions and **301** solve requests are preserved,
with no missing snapshots or changed logs/ledgers. Independent checks cover 295 faced-bet
prices and 321 supported human EV comparisons; 184 human comparisons remain explicitly
unavailable, alongside 526 AI decisions. Capture p95 **10.667 ms**, max **12.596 ms**;
max serialized hand **194,022 bytes**. Twenty retained records total **1,943,603 bytes**;
180 old records evicted. These byte counts are not JS heap measurements.

Exact release: copied dependencies, fresh native/WASM, **23 Rust tests**, **1,133 unit
tests**, no unit skips, tsc/lint, **18 audits**, guarded production builds. Local browser
passes: 121 full-app, 48 drills, 55 play/review and 34 live; only existing zoom skips.
Hosted play/review passes 55 with no retries. Deployed checks pass **103**, with two
existing skips and zero retries. All six public engine/source files and all 38 drill
files match the clean release. Engine source hash remains unchanged. No protected
file or frozen source-bound play evidence was revised.

Build SHA-256: `a34c636fd90da5bcef285d97ce3af961b4550e7e78f77960357056982d2fdb4a`.
AGPL archive SHA-256: `268ec4566f9caecf08cd1411f98d71666050ecf784fed91c4a05bff957a8238f`.
The documentation-only closing commit is verified separately and does not change the
deployed code identity.

## Remaining boundaries and next work

No H1 release gate remains open. Physical iOS/Android checks are still unmeasured and
nonblocking; use the [physical-device checklist](codex-handoff-2026-11-19.md#boundaries-and-next-work).
For H1, also open a completed review, navigate decisions, calculate/cancel range equity
and download its JSON on each phone. Record device/browser, responsiveness and any
refusal, reload or crash. Keep scripted preflop, hand-written
ranges, 12 saved flops and the visible **23.4%-of-subgame-pot composed-policy weakness**.
Approximate local strategies and model-relative grades do not certify global safety or
exact GTO. The optional partial turn cache is not a deployment prerequisite.

The original CPU roadmap's steps 10–14 were outside this execution target. The next
solver research milestone is the prospective preflop validation contract: frozen held-out
boards/hands, a verified joint measure and payoff representation checked against exact
tiny games. Do that before model v2; **PF4 stays gated**. Further formations, multiway
research and review imports/persistence need their own scope and validation contracts.

## Untouched work and records

Preserved exactly: `METHODOLOGY.md`, trainer README hunks, `e2e/keyboard.spec.ts`,
`src/app/globals.css`, `src/components/PokerSim.tsx`, `test/copy.test.ts`,
`src/lib/poker/session.ts`, `test/session.test.ts`, the paused
`src/lib/solver/postflop/configurable-flop/` directory, `tasks/configurable-flop-v2-plan.md`
and the existing `tasks/poker-data-reuse-and-publication.md`. Do not stage, revert or
repair them. No TypeScript exclusions were added. The dirty main tree is not the
verified release tree.

Safeguards: `build/drill-expansion-2026-11-21/protected.json` and the starting trainer
README patch. H1 evidence: `build/hand-review-2026-11-21/` (original contract, fail-first
logs, exact release checks, tile coverage, CI records, source/data/deployment proofs and
`current.json`). The clean deployed checkout is `/private/tmp/poker-h1-fixed-90bavjbh`;
keep it available until its replacement is verified. Closing-doc checks use a separate
clean checkout with copied dependencies; production stays on `de7f0d6`.
