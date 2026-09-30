# CPU-ceiling roadmap: every step to "as far as it goes without a GPU"

Written 2026-09-30 for Codex (and any later agent). Steps 1–9 are the execution target of the
current run; steps 10–14 are specified here so their contracts are not re-invented later.

## What "the CPU ceiling" means

- **Achievable on a laptop CPU:** heads-up postflop solved without abstraction (postflop-solver
  via the bridge, already shipped), bounded turn/river solving in the browser, heads-up play
  with live street-root and off-tree re-solving, a validated preflop model, and broad
  formation coverage. None of this needs a GPU; Pio and postflop-solver are CPU engines.
- **Where GPUs actually enter:** learned value networks for depth-limited search (DeepStack,
  ReBeL, GTO Wizard AI). Out of scope.
- **Where the laptop runs out:** full 6-max blueprints (Pluribus used a 64-core, 512 GB server).
  Multiway here means small abstracted games and turn/river subgames with audited per-player gains.

## Read before starting (in this order)

1. `AGENTS.md` — Next 16.3.3 has breaking changes; read `node_modules/next/dist/docs/` guides
   before route, worker, header or config code.
2. `tasks/lessons.md` — mandatory rules learned the hard way (write-after-read truncation,
   isolated commit testing).
3. `tasks/claude-handoff-2026-09-29.md` and `tasks/preflop-model-diagnosis.md` — preflop is
   research-only; PF4 is gated.
4. `tasks/postflop-solver-wasm-spec.md` plus the W1/W2/W4 records:
   `tasks/postflop-solver-w1-st.md`, `tasks/postflop-solver-w2-worker.md`,
   `tasks/postflop-solver-w4-ui.md`.
5. `tasks/heads-up-play-resolving-spec.md` (theory, design and P0–P5 checklists).
6. `tasks/postflop-solver-bridge-spec.md` (contract, B2 referee tolerance, B3/B4 results,
   library slice policy) and `tasks/drills-spec.md` (solver-drill grading conventions to reuse).

## Status at the start of this run (2026-09-30)

| Step | Milestone | State |
|---|---|---|
| 1 | W1 single-thread WASM build + native parity | Implemented, **uncommitted** (Codex) |
| 2 | W2 bounded Worker, admission, cancel | Implemented, **uncommitted** (Codex) |
| 3 | W3 verification | Node/local-browser ST parity done; CI hosted run + physical devices open |
| 4 | W4 `/solver/live` | **Started** 2026-09-30 (Codex), see w4 record |
| 5–9 | P1–P5 heads-up play | P0 committed (`src/lib/hu-play/`); P1+ not started |
| 10–12 | Preflop validation → v2 → PF4 | PF0–PF3 + diagnosis committed; model not validated |
| 13 | More formations | Not started |
| 14 | Multiway on a laptop | Research docs only (`tasks/robopoker-evaluation.md`) |

Committed baseline: `8866180`.

### Release progress (2026-09-30)

W1 `ebcd248` (CI `36753561883`), W2 `bf44ef2` (`36757906224`) and W3 `0accb63`
(`36763545452`) are landed in order, each exact commit verified in isolation before push
and every hosted CI job observed green before the next step. The
[W4 release record](postflop-solver-w4-ui.md#milestone-release-verification--2026-09-30)
documents the learner page, now landed as `a87b34a` with all eight CI jobs green in run
`36768099422` after exact-commit isolation checks. P1's
[frozen admission audit](heads-up-play-p1-admission.md) found an unsatisfied necessary
range-capacity/board-coverage gate. P1 is not shipped; dependent P2/P3/P5 work cannot proceed
under the current ladder. P1 diagnostic `f394fb7` also passed exact-commit verification and
all eight jobs in CI `36773596576`. P4's independent [small-game gadget study](heads-up-play-p4-study.md)
landed as `0fae3ed`: 899/899 isolated exact-commit tests, unchanged per-hand and whole-game
gates passed, and all eight jobs in CI `36779205846` green. This does not complete P4's
blocked production flop-translation part. The [closing handoff](codex-handoff-2026-09-30.md)
records measurements, release identities, open gates and all untouched work.
The original status table above is historical, not current completion.

## Working rules for every step (non-negotiable)

- **Preserve unrelated work.** The trainer/session edits (`METHODOLOGY.md`, trainer hunks in
  `README.md`, `e2e/keyboard.spec.ts`, `src/app/globals.css`, `src/components/PokerSim.tsx`,
  `test/copy.test.ts`, `src/lib/poker/session.ts`, `test/session.test.ts`) and the paused
  `src/lib/solver/postflop/configurable-flop/` draft stay untouched unless a step explicitly
  says otherwise. Never exclude the draft from type-checking to make a build pass; verify in
  isolation instead.
- **One milestone per commit, explicit file lists.** Never `git add -A`. For README, stage only
  the milestone's hunks (build the staged blob from `git show HEAD:README.md` plus that
  milestone's edits, or a 3-way `git merge-file`).
- **Test the exact commit in isolation before pushing:** `git archive`/`checkout-index` the
  staged tree into a scratch directory, **copy** `node_modules` (Turbopack rejects a symlink for
  builds), then run the full unit suite, `tsc --noEmit`, lint, the milestone's audits, and
  `next build` when app code changed. Push only after that passes. Pushing verified milestone
  commits to `origin/main` is approved; keep CI green, and if CI fails, fix forward or revert
  within the same working session.
- **Never loosen a quality gate to pass.** Tolerances come from measurement (see B2's 2e-4 chip
  float32 bound). If a gate cannot be met, stop that milestone, record the measured numbers and
  the reason in its task doc, and continue with independent work.
- **Honesty in copy and docs.** The README is read by hiring managers' LLMs. Label hand-written
  ranges as approximations, never say "GTO" unqualified, state that local re-solving is not a
  global unexploitability guarantee, and keep the AGPL source link on pages that serve the
  WASM engine. Do not use or promote preflop model ranges (PF4 gated).
- **Tests before fixes, fail-then-pass.** Every behavior change gets an assertion-based test
  that fails first. Every user-visible number gets an independent recomputation in tests.
- **Record each milestone** in its task doc: what shipped, measured numbers, exact commands,
  owned paths, known limits, next step. Tick the checklist boxes in the source spec.

## Architecture decision for steps 5–9: where play re-solves run

The deployed app is a static/serverless Next site, so live play solves **in the browser via the
W2 Worker**. The current W2 limits (single-thread, float32, 64 hands/player, 256 MiB
reservation, 120 s, 10,000 iterations) are far narrower than library ranges on the turn
(often 150–600 combos). The policy source therefore uses a **measured admission ladder**:

1. **Full ranges** if admission passes (typical on rivers after betting narrows ranges).
2. **Reach pruning:** drop each player's lowest-reach combos until admission passes, keeping
   at least the top 99% of each player's reach mass; record the pruned mass per player.
3. **Library lookup:** if the exact node exists in a saved B4 slice (flop always; 8 turn cards
   and 2 river boards per flop), sample from the slice.
4. **Action translation:** map to the nearest saved or solvable node (pseudo-harmonic, P0's
   `translation.ts`), settle real chips, re-solve at the next street root.

Every AI decision's provenance records which rung was used, the pruned mass, the iterations,
and the spot hash. **Gate for the ladder (P1):** on a frozen corpus of at least 50 turn and
river street-root spots drawn from seeded hands, the native bridge solves each spot twice, on
full ranges and on the pruned ranges the browser would use. Report the AI's per-hand EV
difference and the local exploitability of the pruned strategy graded against **full** ranges
by our own grader. Set the pruning threshold from those measurements, and document it as a
measured trade-off, not a guarantee. A native `PolicySource` using `bridge-runner` stays
available for tests, referee checks and local development; it is not the production path.

If measurements show the ladder cannot keep median local exploitability ≤ 1% of the subgame pot
on the corpus, stop before P2, record the data, and propose (in the doc) either raising W2 limits
after physical-device measurement or a precomputed turn cache (P3's warm-up). Do not ship an
unmeasured ladder.

---

## Steps 1–4: browser solving (finish W1–W4)

These already have detailed records; this section adds the done-definition.

### Step 1 — W1 single-thread WASM build (commit it)
- Land W1 exactly as owned in `tasks/postflop-solver-w1-st.md` ("Owned W1 files"), no `target/`.
- **Done when:** the isolated commit passes the unit suite, `audit:bridge`, the W1 native↔WASM
  parity audit and the Chromium harness; CI's `bridge`/`bridge-wasm` jobs pass on the pushed
  commit (hosted run observed, not just configured).

### Step 2 — W2 bounded Worker (commit it)
- Land W2's owned paths per `tasks/postflop-solver-w2-worker.md` (export estimate, `live/*`,
  tests, harness scripts, lockfile change).
- **Done when:** isolated commit passes; stale-message rejection, cooperative cancel, hard
  termination during build/solve/export, and trapped-instance destruction each have a passing
  test; CI green.

### Step 3 — W3 verification
- Hosted CI run of the WASM/browser jobs observed green (record the run id).
- Record measured wall time and peak memory for the admitted fixture grid on this M1 Pro in
  Chromium, Firefox and WebKit (single-thread). Physical iOS/Android measurements are recorded
  if Kat provides devices; otherwise they are listed as open, and admission stays conservative.
- **Done when:** the WASM spec's W3 boxes are ticked or explicitly marked "open (device)" with
  reasons; numerical tolerance stays the locked 2e-4 chips, unchanged.

### Step 4 — W4 `/solver/live`
- Complete per `tasks/postflop-solver-w4-ui.md` (asset preparation command, saved example that
  works without assets, preflight/admission display, progress, cancel, root inspector, AGPL
  source link, full-load `<a>` entry from the Leduc lab and solver navs).
- **Done when:** e2e covers keyboard use, 320/390/1280px with no horizontal overflow, 200% zoom,
  refusal, cancel, asset-failure and retry; `next build` passes on the isolated commit, both with
  and without prepared assets; README gets one accurate hunk for `/solver/live`.

---

## Steps 5–9: heads-up play against the solver-backed AI

Game for v1 (all of P1–P5): heads-up, 100bb, **BTN opens 2.5bb and BB calls** (scripted,
labelled "scripted preflop, not a solved preflop strategy"). The flop is drawn uniformly from the
**12 saved B4 flops** ("flops limited to 12 saved textures" in the UI), then hole cards from the
library's BTN and BB ranges conditioned on the flop, with card removal. The human's seat is
chosen by the user or alternates. Turn and river cards are dealt uniformly from the remaining
deck. Chips are integers at the bridge's scale (1bb = 100 chips); display is in bb.

### Step 5 — P1: on-tree play (human restricted to tree sizes)
Deliverables:
- `src/lib/hu-play/sources/`: `LibraryPolicySource` (flop, plus saved turn/river slices),
  `BrowserResolveSource` (W2 Worker, admission ladder above), `NativeResolveSource` (tests
  only), all behind P0's decision-source interface. Seeded draws only.
- Street-root re-solves at turn and river with the lean menu, AI exact reach from its played
  strategy, human modelled reach (library strategy for the human's seat), using P0's
  `buildResolveSpot` (hole cards unreachable by construction; keep the leak tests passing).
- Pruning-ladder measurement corpus and report (Architecture section gate).
- Bot-vs-bot simulator: the AI plays both seats for N seeded hands through the real reducer.

Gates:
- 1,000 seeded bot-vs-bot hands: zero illegal states, exact chip conservation, 100% replay
  determinism (same seed and actions → byte-identical log hash).
- The leak property test still passes with real sources wired in.
- Referee: at least 20 sampled river street-root re-solves, graded by our factorized grader,
  local exploitability ≤ 0.3% of the subgame pot (float32 only; int16 never used for grading).
- Latency recorded (p50/p95 per street, Chromium, M1 Pro); budgets written into the spec.

### Step 6 — P2: off-tree river bets
Deliverables:
- Explicit-tree builder: the lean menu at the current node plus the human's actual bet size
  `a*`; solve and play the AI's strategy below `a*`. The human's range after `a*` comes from
  the re-solve (spec §2.4).
- Admission ladder and translation fallback applied, with the provenance rung shown.
Gates:
- Seeded corpus of at least 200 off-tree river bets at non-menu sizes (including tiny, huge
  and all-in); every one completes within budget or falls back with a recorded reason.
- Safety-margin audit (spec §2.7 #2): report, per corpus spot, the AI's re-solved value versus
  the value of translating to the nearest menu size, and the local exploitability of the
  re-solved strategy. Document that this is local, not a global guarantee.

### Step 7 — P3: turn re-solves
Deliverables:
- Turn nested re-solve (turn+river tree, first-street export; river re-solved at its root).
- Offline cache warm-up for common turn lines from the library flops (hash-bound chunks, same
  pattern as B4), plus the hit-rate and latency report.
Gates: P1's determinism, conservation and leak gates hold; turn latency p95 is recorded and
within the budget set in P1, or the step records why not and what the ladder does instead.

### Step 8 — P4: flop off-tree translation and the safe re-solve study
Deliverables:
- Flop off-tree bets via pseudo-harmonic translation, real-chip settlement, next-street re-solve.
- **Gadget ("safe") re-solve** implemented in our TypeScript river engine for referee-scale
  spots (Resolve, then Max-margin; Burch 2014, Brown & Sandholm 2017).
- Toy-scale study (spec §2.7 #3) comparing policies (a) unsafe street-root re-solve,
  (b) translation only, (c) gadget re-solve, on games small enough to grade whole.
Gates: the gadget re-solve's property test (the opponent cannot gain versus the blueprint at the
subgame root, within tolerance) passes; the study table is recorded. Do not claim gadget safety
for the postflop-solver path unless it is actually implemented there (it is not today).

### Step 9 — P5: the `/play` UI (the north-star payoff)
Deliverables:
- `/play`: heads-up table, seat choice, bet slider in chips with typed input (off-tree allowed),
  "AI thinking" state with cancel, deal-again, and the hand history.
- **"Why the AI did that" math panel at every decision:** pot odds and break-even equity for
  any call, MDF for any bet faced, polar bluff share, the user's all-in equity against the AI's
  current range, the AI's action frequencies with that hand, and provenance (library, re-solve
  or translation; rung; pruned mass). Reuse the drills' formulas and conventions
  (`src/lib/drills`) so numbers match across the app.
- Session ledger using `src/lib/poker/session.ts`. That file is currently untracked WIP; commit it
  as part of this step only after confirming its tests pass and it is ready, otherwise keep a
  local ledger and note it.
- Honest-copy tests in the `copy.test.ts` style: scripted preflop, hand-written ranges, 12 flops,
  not exact GTO, local re-solving is not a global guarantee, AGPL source link.
Gates:
- e2e: play a full hand by keyboard; off-tree bet; cancel during thinking; 320/390/1280px with
  no overflow; the math panel's numbers independently recomputed in unit tests.
- A 200-hand seeded bot-vs-scripted-human run through the real UI state layer: no errors,
  conservation holds, ledger matches.
- README: one accurate `/play` hunk and roadmap status updates.

**Definition of done for this run:** steps 1–9 committed and pushed as separate verified
commits, CI green on the final commit, each milestone's doc updated, and a closing handoff
(`tasks/codex-handoff-<date>.md`) listing what shipped, measured numbers, open gates, and the
remaining untouched trainer/session work and configurable-flop draft.

---

## Steps 10–14 (specified, not part of this run)

### Step 10 — Preflop continuation-value validation contract
Write `tasks/preflop-validation-v2-spec.md` **before any model change**: frozen held-out boards
and ranges (multiple boards per texture, missing weak classes, premium hands, 3BP/4BP), compute
and error budgets set in advance, a verified joint hand/board measure, per-class from-now EV
error bounds where decisions are close, and exact tiny joint games as ground truth. It includes
no gate based on aggregate defence percentages.

### Step 11 — Preflop payoff model v2
A payoff representation that allows future-chip transfers (not bounded pot shares) and conserves
value, validated first against the exact tiny games, then against the frozen held-out solves.
It gets a new version; the v1 artifacts are preserved. Research risk is high; if no model passes,
record that as the result.

### Step 12 — PF4: library regeneration from validated ranges
Only if step 11 passes: a new library version (`bridge-v2`) generated from validated ranges,
with the same per-spot ≤ 0.3%-of-pot gate, B4-style audit, and drills and play switched by
explicit version.

### Step 13 — More formations
SB vs BB, CO vs BTN and BTN vs BB 3-bet pots, each with its own locked benchmark, library
version and audit, and bet menus informed by the B3 "extra sizes" experiment. Overnight solves
are expected.

### Step 14 — Multiway on a laptop
Start with `tasks/robopoker-evaluation.md` R0 (robopoker MCCFR on our locked 3-player river game,
graded by `gradeMultiwayStrategy`; pass bars recorded there). Then 3-player turn/river subgame
re-solving with audited per-player maximum unilateral gains. Never claim Nash for 3+ players;
report per-player gains. Full 6-max blueprints exceed a laptop; stop at audited small games
and subgames unless server compute is provided.
