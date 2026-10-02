# P4 — production flop translation

Status: implementation and candidate gates pass; exact-commit isolation, push and CI
are the remaining release steps. Not enabled in `/play`.
The prospective contract below was written before code or measurements.
P3 `bc4e5e5` passed exact-commit isolation and all eight jobs in CI `36950939510`
before this work began. The separate TypeScript gadget study `0fae3ed` is already
shipped; it is not a safety guarantee for this production adapter.

## Scope

Keep the unchanged 12-flop, 100bb scripted BTN/BB formation: 550 chips initially in
the pot, 9,750 behind, including the separate 50-chip dead small blind. Ranges remain
hand-written; no PF4 promotion. No live flop solve, engine fork, learned values, pruning
or enlarged browser/quality limits. Reuse the complete hash-checked flop supplement.

Add a browser-safe adapter around the saved flop and a new full-hand composition around
the existing P3 turn/river controller. Keep the existing P1–P3 implementations and
evidence bytes unchanged. Ordinary on-tree play must remain numerically/log-identical.
No React or trainer changes in this milestone.

## Translation contract and topology edge cases

Maintain two public histories while the flop is played:

- **Real history:** the reducer's actual actions, pot, stacks and minimum raises.
- **Saved history:** the corresponding path in the unchanged library tree. This is an
  approximation for choosing actions, never the chip ledger or a claim about real-price EV.

Reconstruct and validate both histories and both reach vectors from the public root on
preparation. Each actual action multiplies its actor's reach exactly once. AI reach uses
the **actual projected distribution**; human reach uses the explicitly modelled saved
action likelihood. No private card, future runout or actual-hand-dependent preparation.
The translation coin uses the hand seed, public path and actual action, as in P2/P3;
the seed is never supplied to the numerical solver.

At a saved player node, project each saved sized action by its increment as a fraction
of the pot after calling. Apply that fraction to the real pot after calling, round to
whole chips, then enforce the real minimum/maximum. Preserve an explicitly saved all-in
as a real all-in. A saved check becomes a call when real chips are faced. A saved raise
against a real all-in becomes a call: raising an all-in is never legal. Merge probabilities
of saved actions that project to the same real action; never discard their reach mass.
For the fixed one-raise lean flop menu, any collision requiring a future branch choice
must be shown to end further betting or explicitly refused, not silently pick a policy.

An off-menu human size maps between the projected menu's supported neighbours using
the existing pseudo-harmonic formula. Check/call is zero additional betting after the
call. Below the smallest or above the largest supported size, use the boundary action.
Exclude references with no compatible posterior and report those exclusions. A nonterminal
action with no supported model is an explicit refusal, never an invented uniform range.

**Saved-street-end extension:** a tiny bet can map to a saved check that ends the street;
an extra raise can map to a saved call after the library's raise limit. There is then
no saved AI response node. The adapter explicitly uses a forced real call to finish that
street (or a check if no price is faced), with probability one for every possible AI hand.
This is a labelled passive continuation rule, **not a solver-derived response**. It is
exploitable and carries no saved action EV. It must have direct tests, corpus counts and
per-decision provenance, rather than masquerading as an ordinary saved decision.

After any price/path translation, all action EVs are unavailable at the real prices.
Do not scale old EVs or present them as current. Provenance records the mapping,
saved path, projected actions, and whether the passive continuation rule was used.
The unchanged on-tree case retains its original saved-policy EV label.

On the next real street, discard the saved flop continuation. P3 prepares the **actual**
turn/river board, pot, stacks and arriving played/modelled ranges. An actual all-in call
runs out without inventing another decision. Cancellation/supersession cannot commit
a pending human action, multiply its reach or publish stale preparation.

## Pros, limitations and mitigation

- Uses the existing audited library with no additional engine or large flop download.
  Pure translation is cheap, but its prices and human model can be wrong. Keep the real
  ledger separate and re-solve the next street; never call this globally safe or exact GTO.
- Supports unusual sizes without changing the actual legal game. Terminal/check/raise-limit
  mismatches require the passive extension above; expose its frequency and lack of EVs.
  The required P5 unusual-size warning remains, including P2's measured 23.4%-pot result;
  that number is not an upper bound for this adapter.
- Projection can merge actions. Sum the actual action likelihoods for each hand and
  test the subsequent public state. Refuse an unresolved future-branch ambiguity.
- Reconstruction avoids hidden mutable chip/range state, but costs repeated small-table
  work. Measure it first; cache only exact public preparations if needed.
- New wrappers preserve historical source-bound proofs. This is not permission to
  allow-list changed old code: any required old-code change needs fresh successor evidence.

## Fail-first implementation sequence

1. Pure action projection and pseudo-harmonic selection: boundaries, all-ins, minimum
   raises, collisions, zero-support references and real/saved ledger separation.
2. Public-only flop source: exact on-tree reduction, custom sizes, passive continuation,
   exact reach reconstruction, cancellation/supersession and private-card non-interference.
3. Full-hand wrapper: actual turn/river roots via the unchanged P3 controller; exact
   replay and real chip conservation through the existing reducer.
4. Frozen corpus and independent audit; browser/native observations; release proof.

## Prospective evidence and release gates

- [x] Assertion-based failing tests before behavior changes; at least 10,000 seeded
  pure translation/legality cases. This is not described as 10,000 native-solved hands.
- [x] Freeze **200 distinct (public flop parent, actual action)** cases before native
  play/timing. There are fewer than 200 distinct saved flop parents; do not claim otherwise.
  Cover all 12 flops, both seats, root/check/bet/raise parent families and minimum,
  intermediate, near-all-in and all-in sizes. Freeze the selection rule and bytes before
  observing continuation solves; retain every failure and passive-extension count.
- [x] Every frozen continuation completes deterministically with actual-chip conservation
  under the unchanged quality/admission rules, or records an unsatisfied gate. Independently
  grade every reached river; grade sampled complete turn games where tractable.
- [x] Repeat the roadmap's 1,000-hand production conservation/replay/leak gates. For
  unchanged on-tree requests, reusing the hash-checked P3/P1 captured policies is explicitly
  a controller replay check, not a new native solve or latency measurement. New off-tree
  requests need fresh solves and numerical reproduction.
- [x] Production Chromium Worker parity and measured per-street p50/p95, unchanged
  **10 s turn / 2 s river** p95 gates and **0.3%-pot** quality. No phone certification.
  Other-browser Worker regression checks remain; do not extrapolate a Chromium speed promise.
- [x] Existing gadget per-hand and whole-game bars remain unchanged and its report
  reproduces. No production gadget/safety claim.
- [ ] Full unit, typecheck, lint, relevant solver/artifact/native/WASM/browser checks and
  production build; README hunk only; explicit milestone commit; exact-commit isolation
  with copied dependencies; push; all eight CI jobs green before P5.

## Initial ownership

New production modules: `src/lib/hu-play/flop-projection.ts`,
`src/lib/hu-play/flop-translation.ts`, `src/lib/hu-play/sources/flop-play.ts`,
`src/lib/hu-play/sources/translated-heads-up.ts`; their new tests and this record.
Add measurement/proof paths explicitly when created. Package/CI P4 entries, the P4 spec
checkboxes, roadmap status and only P4 README hunks are owned. Carry forward the completed
P3 release annotations in its record/spec/roadmap. Do not stage trainer/session files,
the paused configurable-flop draft, the separate data-reuse note or unrelated planning docs.

## Measurement checkpoint — 2026-10-01 (not a release)

Fail-first logs in `/private/tmp/`: `poker-p4-projection-{red,green}.log`,
`poker-p4-mapping-{red,green}.log`, `poker-p4-source-{red,green}.log`,
`poker-p4-wrapper-{red,green}.log`, `poker-p4-corpus-{red,green}.log`,
`poker-p4-browser-gates-{red,green}.log`, and `poker-p4-release-red.log`.
The final release-evidence test is intentionally still failing until its measured
bundle exists. Targeted source/reducer tests cover saved-policy reduction, merged
all-in likelihoods, actual minimum raises, the passive extension (including an extra
raise after the saved raise cap), forged reach, hidden-field rejection and cancellation.

The 200-case selection freezes 50 cases each at root/check/bet/raise parents, all
12 boards in each family, both AI seats, 40 minimum, 40 all-in, 40 near-all-in and
80 interior amounts. These are distinct **parent/action pairs**, not 200 parents.
All selection uses only the already-published saved flop policy, before new solving.
Frozen input: `/private/tmp/poker-p4-frozen.pEhJMu/capture`, SHA-256
`4c8739f4691bb7bb5e39e6d02058550a60853f2124f61efaaf3fe97b27f98908`.
Compressed input is 654,973 bytes, SHA-256
`62412bae740df5d5ab8a1855dfa4e10c37f8aea84d3fc851aa2d7dc196895e44`.

The first 1,000 P1 seed-frozen hands pass twice through the new full-hand wrapper:
every requested public game, numerical policy hash, complete log and ledger is
identical to P1/P3. Capture: `/private/tmp/poker-p4-full-hands.e5IArs/capture`.
This is replay/composition evidence using hash-checked P3-era native policies, not
1,000 fresh solves or a new timing claim. No historical policy or source was changed.

Initial native capture `/private/tmp/poker-p4-native.DmhQwr/capture` completes all
200 cases with exact replay and chip conservation. 159 solves: 107 turns and 52 rivers.
Every reached river is independently graded; maximum **0.29933009868348176% pot**
passes the unchanged 0.3% target. **57 cases use the passive saved-street-end rule**;
that is not a solver-derived response or a safety claim. Initial native report hash:
`f55d0412b46f2d7a83c255f243ecf2d24e5222a7d8589d14373881be11bdf6fc`.

The initial production Chromium Worker capture
`/private/tmp/poker-p4-browser.mzEUG1/capture` passes 200/200 with exact native parity:
flop response p95 36.9 ms, turn-request p95 2,441.1 ms, river-request p95 62.4 ms.
93 cases finish on the flop with **zero** live solves; they are preserved and are
not counted as zero-second turn/river measurements. There are 107 actual turn and
52 actual river observations. Worker counts equal retirements. Physical phones are
not certified. A brief read-only TypeScript inspection overlapped this desktop run.

Type-checking found that an asynchronously assigned elapsed-time variable inferred
`never` in an exported audit result. Its existing runtime null guard remains; an
explicit numeric result annotation fixes the type. The engine, game, policy, quality
and timing code are unchanged. Nevertheless, strict source binding requires fresh
native/browser evidence: repeat at `/private/tmp/poker-p4-native-final.tm3Fjp/capture`
and `/private/tmp/poker-p4-browser-final.3apwR7/capture`. Keep the initial captures;
do not allow-list the source change. Typecheck and lint passed after the correction.

Complete-turn reference selection is the **first reached turn in each fixed family**,
not selection by grade: seeds 0, 50, 102 and 150. Only export scope changes; their
complete policies must reduce exactly to the actually played first-street policies.
Independent grades, three-browser observations and full release checks remain open.

### Refreshed numerical / complete-turn evidence

The annotation-corrected native audit again passes 200/200; every public solve key,
numerical cell hash, grade, full log, ledger and passive-rule count matches the first
capture. Final native report hash:
`63b2cb1476e2c157b43a51a7457e2ae3f93d4cc32d03a975c5cc1fdee853ad40`.
The refreshed unmodified production Chromium Worker again passes every case, exact
native parity and retirement check:

| Observed work | Count | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Flop preparation → first AI response | 200 | 32.4 ms | 37.0 ms | 40.0 ms |
| Actual turn request → playing policy | 107 | 115.4 ms | 2,441.9 ms | 3,134.9 ms |
| Actual river request → playing policy | 52 | 52.55 ms | 62.6 ms | 66.1 ms |

No native solve, full unit suite or independent grading batch overlapped this refreshed
primary timing run. These are desktop observations, not a clean-machine lower bound
or a promise for every browser/device. The 93 no-solve flop endings remain separate.

Complete turn grades (`/private/tmp/poker-p4-grades.42ezIb/capture`) pass for seeds
0, 50, 102 and 150: **0.2428190016%, 0.2996106715%, 0.0009884537%,
0.2145335402% pot**, respectively. Complete exports match the played first-street
policies exactly. Maximum engine/referee difference is **0.000025645004 chips**,
within the unchanged 0.0002-chip bound. Report SHA-256:
`07812f971088bf68809c301d54d944ad22163a0c84854a640b9d88d5c7ccfc46`.
This grades the specified complete games, not the safety of the composed strategy.

After the type correction, typecheck, lint and 17 targeted tests pass with zero skips.
Three-browser memory capture is now running at
`/private/tmp/poker-p4-memory.pSNLlf/capture`; no result is assumed before it finishes.

README has exactly one owned P4 hunk. Its unrelated trainer changes were backed up
to ignored `build/p4-safeguard-2026-10-01/README-before-p4.md` before editing.
All other protected trainer/session/flop-draft files still match the P3 safeguard hashes.

### Candidate regression checkpoint (not exact-commit verification)

The unchanged 18-audit batch passes: full flop play library, P1/P2/P3/wide/gadget,
bridge library, preflop reproduction, river v3/factorized/exchange, turn vector/v2/
explorer, flop source/library/explorer and equity matrix. No old artifact changed.
Native bridge and native/WASM parity pass with zero numerical deltas; the saved live
example also reproduces. The tiny complete flop reference passes in 43.33 s with
sampled combined RSS 1,187,217,408 bytes below its unchanged 2 GiB budget.

The first flop-reference invocation stopped at sandbox `spawn EPERM` in its memory
observer; the unchanged command passes with process-observation permission. The first
WASM Clippy invocation used the ambient toolchain, which lacked the target's `core`
crate. Repeating with the project's pinned `cargo +1.98.1` passes all **21 Rust tests**,
native/WASM formatting and Clippy. Neither issue changed code, data or a tolerance.

Both saved-only and prepared-asset production builds pass. The saved-only production
Playwright run passes **82 tests**, with four intentional asset-dependent skips,
**zero retries**, in 49.3 s. With `POKER_FACE_LIVE_REQUIRED=1`, the prepared three-browser
suite passes **34 tests**, with two intentional non-Chromium browser-zoom skips,
**zero retries**, in 26.5 s. An earlier invocation omitted that required flag and
therefore ran only 22 tests with 14 skips; it is not the prepared-WASM release gate.
The 320px setup and 1280px result screenshots were visually inspected; no overflow
or clipped controls were found. Existing three-browser Worker numerical-parity and
cancellation/admission/cleanup harnesses also pass.
The temporary saved-only asset move was confined to this development copy's ignored
generated `public/solver-live` directory and was restored; primary assets were untouched.

The primary Chromium timing run and the Chromium memory-observer pass finished before
these regression batches. Firefox/WebKit observer timings may overlap correctness
audits/build/browser tests; record them as loaded desktop observations, not isolated
speed measurements. The memory observer measures WASM linear memory, not total browser
RSS, JS heap or phone safety. Physical devices remain an explicit later checklist.

Raw frozen inputs and completed first/final native, first/final Chromium, full-turn and
1,000-hand captures are backed up in ignored
`build/p4-safeguard-2026-10-01/frozen-and-completed-captures.tar.gz`, SHA-256
`501726dfabe438f3d8a88fc90da9588b739850f7e8655bdc02f491a694d6eaaa`.
The still-running three-browser capture is not in this completed-captures archive.

### Complete browser evidence and checked bundle

All **600/600** three-browser observer cases pass exact native numerical/log parity
and Worker retirement. Every browser retains all 93 no-solve flop endings separately:

| Browser | Turn p50 / p95 / maximum | River p50 / p95 / maximum | Peak WASM linear memory |
| --- | --- | --- | ---: |
| Chromium | 116.7 / 2,432.5 / 3,137.8 ms | 52.5 / 62.1 / 64.2 ms | 22,937,600 B |
| Firefox | 1,039 / 29,931 / 37,665 ms | 101.5 / 152 / 167 ms | 22,937,600 B |
| WebKit | 108 / 2,508 / 3,251 ms | 41 / 50 / 51 ms | 22,937,600 B |

The peak is **21.875 MiB** of linear memory, not all browser memory. Chromium alone
is the prospectively specified latency gate; Firefox is explicitly not a 10-second
promise. The completed observer capture is separately backed up in ignored
`build/p4-safeguard-2026-10-01/complete-three-browser-capture.tar.gz`, SHA-256
`27fbc711f1b4b1c6ed773b07b68b3cb3400cdd2f361e9544cb2c02cb145f53d9`.

`capture-hu-play-p4.ts` independently replays every case, re-grades every reached
river and all complete turn samples, checks the frozen 1,000-hand log/ledger references,
and recomputes all browser gates before writing. Checked bundle:

- `tasks/artifacts/hu-play-p4-flop.json.gz`: **14,023,170 bytes**, SHA-256
  `d9663e3c4051d1f7536ef467f644c96ed9108cfc5ef16cd500fdf74e2ea0f3ec`.
- Uncompressed: **48,909,733 bytes**, SHA-256
  `b8beead2f7a94d5423cfa522e27dbc81ba77f5fbaff06461a214a57b5673d8c8`.
- Evidence hash: `4bea623ee731c9c58b2ec95edbb9f7ed3d1bd06661fca4a6b3a89a3d86304475`.
- Current source closure: `b06294b6ee1c21ff9f30384a377fe5e621ee1f692a8a048be6d119c41c165cc8`.

Generation used Node **24.10.0** in the isolated development copy; the primary shell's
ambient Node 16 rejected `--import` before doing any work. No environment setting was
changed. The three generated artifact files were then copied identically to primary.
The full unit suite and standalone evidence audit are now running. This is still a
candidate, not a commit/CI/deployment claim.

An additional real-reducer privacy test holds all public inputs fixed and changes
the human's hole cards or hidden runout. The translated AI decision stays byte-identical;
the production implementation did not need a change. Latest typecheck and lint pass.

### Candidate checks complete

The complete isolated-development suite passes **1,042/1,042 tests**, zero failures,
zero skips, in **522.948 s** (`/private/tmp/poker-p4-full-unit.log`). The standalone
`audit:hu-play:p4` also passes and exactly reproduces the checked-in summary, including
the negative source/hash/case-count protections exercised by the unit test. All candidate
type, lint, native, numerical, artifact, browser and build checks above are now complete.
Nothing was excluded from type-checking or relaxed to pass. Next: the explicit 35-file
commit below, fresh exact-commit isolation with copied dependencies, then push and all
eight hosted CI jobs green before P5. No P5 implementation has begun.

## Reproduction commands

Run in a clean checkout with dependencies copied or installed, not symlinked. Build
the native and source-complete WASM engine with the pinned toolchain first. The scripts
refuse existing output directories and retain every failed case. Separate primary
Chromium latency measurement from other expensive work; an observer pass is not a
total-browser-memory measurement.

```sh
cargo +1.98.1 build --release --locked --manifest-path native/solver-bridge/Cargo.toml
WASM_BINDGEN=/path/to/wasm-bindgen-0.2.104 npm run build:wasm
node --import tsx scripts/freeze-hu-play-p4.ts --out NEW_INPUTS_DIRECTORY
node --import tsx scripts/audit-hu-play-p4-playing.ts --inputs INPUTS_DIRECTORY --out NEW_NATIVE_DIRECTORY
node --import tsx scripts/profile-hu-play-p4-browser.ts --inputs INPUTS_DIRECTORY --native NATIVE_DIRECTORY --out NEW_BROWSER_DIRECTORY --browsers chromium --measured false
node --import tsx scripts/profile-hu-play-p4-browser.ts --inputs INPUTS_DIRECTORY --native NATIVE_DIRECTORY --out NEW_MEMORY_DIRECTORY --browsers chromium,firefox,webkit --measured true
node --import tsx scripts/audit-hu-play-p4-turn-grades.ts --native NATIVE_DIRECTORY --out NEW_GRADES_DIRECTORY
node --import tsx scripts/audit-hu-play-p4-hands.ts --native-p1 HASH_BOUND_P1_CAPTURE --out NEW_HANDS_DIRECTORY
node --import tsx scripts/capture-hu-play-p4.ts INPUTS_DIRECTORY NATIVE_DIRECTORY BROWSER_DIRECTORY MEMORY_DIRECTORY GRADES_DIRECTORY HANDS_DIRECTORY
npm run audit:hu-play:p4
npm run reproduce:hu-play:p4 -- --backend native --out NEW_NATIVE_REPRODUCTION
npm run reproduce:hu-play:p4 -- --backend wasm --out NEW_WASM_REPRODUCTION
```

The freeze/measurement commands create **new research inputs** that also bind binary
and build identities; they do not overwrite the checked-in frozen proof to accommodate
a new build. For a new clean release checkout, `reproduce:hu-play:p4` is the strict
numerical reproduction path for all 200 original cases and four complete references.
It permits path/commit-dependent build identities, never changed inputs, source,
policies, full logs or quality thresholds.

## Explicit P4 release ownership

Only the one P4 roadmap hunk in README is owned. The three P3 release annotations
carry forward the completed exact-commit/CI result; no unrelated planning is included.
The artifact paths below are reserved for the completed, independently checked bundle;
their absence is a failing release gate, not an optional skip.

```text
.github/workflows/ci.yml
package.json
README.md (P4 hunk only)
src/lib/hu-play/flop-projection.ts
src/lib/hu-play/flop-translation.ts
src/lib/hu-play/sources/flop-play.ts
src/lib/hu-play/sources/translated-heads-up.ts
scripts/audit-hu-play-p4-hands.ts
scripts/audit-hu-play-p4-playing.ts
scripts/audit-hu-play-p4-turn-grades.ts
scripts/audit-hu-play-p4.ts
scripts/capture-hu-play-p4.ts
scripts/freeze-hu-play-p4.ts
scripts/hu-play-p4-browser-gates.ts
scripts/hu-play-p4-corpus.ts
scripts/hu-play-p4-playing-case.ts
scripts/hu-play-p4-profile-page.ts
scripts/profile-hu-play-p4-browser.ts
scripts/reproduce-hu-play-p4.ts
test/hu-play-flop-projection.test.ts
test/hu-play-flop-translation.test.ts
test/hu-play-flop-source.test.ts
test/hu-play-translated-heads-up.test.ts
test/hu-play-p4-browser-gates.test.ts
test/hu-play-p4-corpus.test.ts
test/hu-play-p4-ci.test.ts
test/hu-play-p4-record.test.ts
test/hu-play-p4-reproduction.test.ts
tasks/heads-up-play-p4-flop.md
tasks/heads-up-play-p3-turn.md
tasks/heads-up-play-resolving-spec.md
tasks/cpu-ceiling-roadmap.md
tasks/artifacts/hu-play-p4-flop.json
tasks/artifacts/hu-play-p4-flop.json.gz
tasks/artifacts/hu-play-p4-flop-summary.json
```
