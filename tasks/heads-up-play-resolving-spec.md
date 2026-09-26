# Heads-up play vs a solver-backed AI with live subgame re-solving — spec (draft, 2026-09-25)

Status: P0 (contract, no solving) built in `src/lib/hu-play/`, tests `test/hu-play-*.test.ts`; P1+ not started. Depends on the postflop-solver bridge
(`tasks/postflop-solver-bridge-plan.md`, `-spec.md`, `src/lib/solver/bridge/*`) and the lean
BTN-vs-BB SRP flop library being generated from `leanSrpSpot` / `LEAN_SRP_TREE`
(`src/lib/solver/bridge/fixtures.ts`). The WASM bridge (plan B5) has no spec file yet.

## Goal and non-goals

The human plays heads-up hands against an AI whose postflop strategy comes from solver
output. When the human does something the saved solution didn't plan for (a bet size that
isn't in the tree), the AI **responds to the actual action** by re-solving the rest of the hand
from the current public state. A fixed solver line doesn't. Every AI decision is logged with its
provenance and the exact numbers, so the hand history doubles as a poker-math lesson (north
star: pot odds / MDF / equity become instant).

Non-goals: preflop solving, multiway, depth-limited flop re-solving with value functions,
real-money play, any claim that the AI is "unexploitable" (see Safety caveat).

## 1. Theory in plain language (with the math we rely on)

**Notation.** Public state `s` (board, action history, pot, stacks). Private hands `h` (AI) and
`g` (human). Prior range weights `w_AI(h)`, `w_H(g)` at the flop root. A strategy `σ(a | h, s)`.

**Ranges are Bayes posteriors of strategies.** The AI's range at `s` is exact. The AI knows its
own strategy, so its reach is `π_AI(h | s) = w_AI(h) · Π_{AI decisions (s',a') on the path} σ_AI(a' | h, s')`,
and `P(h | s) ∝ π_AI(h | s)` over hands that don't conflict with the board. What must be
**held fixed** is the strategy the AI *actually used* at each past node: library, re-solve, or
translated node, including the randomisation it drew. The human's range is only a *model*:
`π_H(g | s) = w_H(g) · Π σ*_H(a' | g, s')`, where `σ*_H` is the solver's own strategy for the human's seat
(it assumes the human played equilibrium so far). For an off-tree action `a*`,
`σ*_H(a* | g, s) = 0` for every `g`. The posterior is 0/0, undefined. That is why off-tree actions
need either translation or a re-solve that includes `a*`.

**Action translation** (Ganzfried & Sandholm 2013). Map an off-tree bet `x` (as a fraction of
the pot) onto the neighbouring tree sizes `A < x < B`. The randomised pseudo-harmonic mapping
picks `A` with probability `f(x) = (B − x)(1 + A) / ((B − A)(1 + x))` and `B` otherwise (e.g.
A = 0.5, B = 1, x = 0.75 → A with 43%). It meets their axioms (monotone, scale-invariant,
boundary-correct) and was far less exploitable than earlier mappings. It is still exploitable:
the tree's pot and odds are wrong after the mapped node, and a human can pick sizes that sit where
the mapping misprices them.

**Unsafe subgame solving** (endgame solving; Ganzfried & Sandholm 2015). Solve the subgame at
`s` with both ranges held fixed at `(π_AI, π_H)`, as if they were a common-knowledge deal.
It's cheap and often strong in practice, but it has **no guarantee**. The re-solved AI strategy is only
an equilibrium against the *assumed* human range. A human who plays differently earlier (e.g.
checks back the nuts where the model says "never") can land in a subgame whose re-solve
overbluffs or bets too thin into hands the model gave zero weight. Burch et al. and Brown &
Sandholm give small games where unsafe re-solving makes the full-game strategy *more*
exploitable than the blueprint it replaced.

**Safe re-solving with a gadget** (Burch, Johanson & Bowling 2014 "Re-solve"; Moravčík et
al. 2016 "Max-margin"; Brown & Sandholm 2017 "Reach-Maxmargin"). Hold fixed the AI's range
`π_AI` and the **human's counterfactual best-response values** under the blueprint,
`CBV_H(g)`: what hand `g` could already win from `s` by best-responding to the AI's blueprint.
The human's range is *not* held fixed. The gadget adds a root where each human hand either
takes `CBV_H(g)` and leaves, or enters the new subgame. Solving the gadget game gives
`BR_new(g) ≤ CBV_H(g)` for every `g` (up to solve error). No human hand gains by reaching this
subgame, so full-game exploitability can't rise above the blueprint's. Max-margin
maximises `min_g (CBV_H(g) − BR_new(g))` to improve on the blueprint rather than just matching it.
Reach-Maxmargin can loosen each hand's constraint by the "gifts" the human already gave up with
earlier suboptimal actions and still keeps the guarantee.

**Nested solving for off-tree actions** (Brown & Sandholm 2017; used in Libratus, Brown &
Sandholm 2018). When the human takes `a*` at node `s`, root a new subgame at `s`, *before*
`a*`, where the human's range is still defined. Add `a*` to the tree and constrain the human with
`CBV_H` at `s`, so the new size can't be better for any hand than what the blueprint already conceded.
Libratus used blueprint values as estimates ("Estimated-Maxmargin"), so the guarantee is approximate.
**DeepStack continual re-solving** (Moravčík et al. 2017) needs no blueprint below the root.
It carries the AI's range plus the human's counterfactual-value vector from the previous re-solve.
Each re-solve includes the action actually taken, so it never translates. The re-solved human
strategy at `a*` then *defines* the human posterior after `a*`.

**Depth-limited solving** (Brown, Sandholm & Amos 2018). At a depth limit, the opponent chooses
among several continuation strategies, which keeps the solve safe without searching to the end of
the game. postflop-solver always solves to showdown and has no leaf-value hook. We use it only
from the turn onward, where solving to showdown is affordable, so depth-limiting is out of scope.
It is noted as the way to live flop re-solving later.

**What postflop-solver can and can't do.** It solves a two-range game from a root to showdown
(DCFR, Brown & Sandholm 2019). It has **no gadget / opt-out terminal**, so it can do unsafe and
"unsafe-at-parent" re-solves but not safe ones without a fork (see P4).

## 2. Design for this codebase

### 2.1 Preflop (v1: scripted, labelled)
- One formation: 100bb BTN vs BB SRP, BTN opens 2.5bb, BB calls, SB folds. 1bb = 100 chips,
  pot 550, stacks 9,750 (`SRP_STARTING_POT`, `SRP_EFFECTIVE_STACK`). Human picks a seat.
- Deal a flop from the library, then deal the pair `(h, g)` jointly with probability
  `∝ w_AI(h) · w_H(g)` over non-conflicting combos (seeded shuffle, `cards.ts shuffle(rng)`).
  The human only ever holds hands in their seat's range, so every hand is one the solve covered.
- UI label, always visible: "Preflop is scripted. Ranges are hand-written approximations
  (`BENCHMARK_RANGE_SOURCE`), not solved." No preflop decisions in v1.
- Chip accounting reuses `engine.ts`'s unified betting round with an injected `decide` (2 seats).
  A test asserts its min-raise/all-in rules equal the bridge contract's (they already match
  heads-up with equal stacks, per the bridge spec).

### 2.2 Policy interface (P0)
`aiDecide(publicState, aiHand, rng) → { action, provenance }`, where
`provenance ∈ {library, streetResolve, nestedResolve, translated}` and carries the spot hash, the
node path, `σ(·|aiHand)`, the action EVs, the draw `u`, and the translation (A, B, f(x)) if used.
**Invariant (tested):** the human's hole cards never enter a spot, a cache key or a log line
before showdown. The AI's own hand never enters a spot either. Every solve is over the whole
AI range, which is what makes the human's responses correct *and* makes solve time independent of
the AI's hand (no timing tell).

### 2.3 On-tree play: sample from the saved/solved strategy
- Flop: library slice node at the current path (`BridgeSliceNode.strategy[a][h]`, `reach`,
  `actionEv`). Draw `a ~ σ(· | h)` with the seeded `u`.
- The B4 library (`public/solver-data/bridge-v1/`) saves every flop decision but only
  **sampled** turn/river slices (8 turn cards and 2 river boards per flop, shallow lines,
  unraised flop lines only; quantized values). When the live path is covered by a saved
  slice the AI may sample it; otherwise, and always for exact values, at each street root the
  AI runs a **street-root re-solve**: a spot with the actual board, pot
  and stacks, ranges = the current reach vectors (AI exact, human modelled), and the lean menu tree.
  Turn solve: first-street export. River solve: at the river card. This is Libratus's structure
  (blueprint early, re-solve later streets), done *unsafely* for now.
- The human's action is on-tree iff its `{type, to}` equals an exported action at that node.

### 2.4 Off-tree human bet: nested re-solve, with a fallback
- **Turn/river (affordable):** re-solve rooted at the human's decision node `s` (one node before
  `a*`). The tree is the lean menu at `s` with `a*` added (explicit-tree mode can represent it).
  Ranges come from reach at `s`, which is on-tree and well-defined. Use only the AI's strategy
  below `a*`. The human's posterior after `a*` is the re-solved `σ_H(a* | g)`. This is "unsafe-at-parent":
  it doesn't need the undefined posterior, but it still assumes `π_H` at `s`.
- **Flop (too big to re-solve live: lean flop solves are minutes and GBs):** pseudo-harmonic
  translation between the flop node's sizes (check counts as 0 when `x` is below the smallest
  size; map to the largest size/all-in when above). The AI plays the mapped node's strategy but pays
  and receives **real chips**. The next street-root re-solve is built from the actual pot/stacks,
  so the tree-vs-reality mismatch lasts at most one street. Reach updates use the mapped node's σ,
  which is what the AI actually played.
- **Admission.** Before each solve: (1) `solver-bridge estimate` memory ≤ cap; (2) predicted time
  from a measured cost model (hands × public nodes × iterations, calibrated in P1 per target:
  native, later WASM) ≤ budget. Draft budgets: river 2 s, turn 10 s native, to be tuned from
  measurements. If it doesn't fit, degrade in order: drop hands with reach < 1e-4 of the max
  (as `minimumReach` in `subgame-referee.ts`), then drop the AI's larger sizes, then **translate**.
  The provenance records which rung was used.
- **Deterministic budgets.** A solve stops on an iteration count or target exploitability, never on
  wall time, so a replay reproduces it. Wall time is only an admission prediction plus a hard kill
  (kill → fallback, never a partial result, as in `bridge-runner.ts`).

### 2.5 Which solve runs where
| Street | Source | Where | When |
| --- | --- | --- | --- |
| Flop | saved library (offline bridge solves, 0.3% pot bar) | static JSON, lazy-loaded | always |
| Flop off-tree | pseudo-harmonic translation | browser, pure TS | P4 |
| Turn root / off-tree | bridge re-solve (turn + river tree) | native Node route now; WASM worker later | P1 / P3 |
| River root / off-tree | bridge re-solve (river only, small) | same | P1 / P2 |

Native runs only where a Node process can spawn the binary: `next dev`/local first. A deployed
Vercel function is an open question (binary size, time limit). The deployed site gets live
re-solving with WASM (B5). The AGPL network clause is satisfied because the repo is public.
Cache every result by spot hash (content-addressed), and warm it offline for common lines
(check-check / bet-call × every turn card of the library flops).

### 2.6 Randomness, seeding, replay
- `handSeed` per hand. The deal comes from `shuffle(deck, mulberry32(handSeed))`. The draw for the
  k-th AI decision is `u_k = mulberry32(hash(handSeed, k, nodePath))()`, so it doesn't depend on
  the order solves finish.
- A hand-history record holds the seed, both hands (revealed at the end), every public action in
  chips, and per AI decision: provenance, spot hash, bridge version + engine commit, precision,
  `σ(·|h)`, `u_k` and the chosen action.
- Replay re-derives each decision from the cache or by re-solving the same spot hash and
  **asserts** the same action. B2 found 1-thread vs 10-thread results bit-identical, but
  native vs WASM (SIMD/FMA) may differ in float bits. If `u_k` falls within 1e-6 of a CDF
  boundary, replay reports "boundary divergence" rather than failing silently.

### 2.7 Evaluation (numbers we can actually certify)
1. **Local exploitability of every re-solve** with our own grader: river via
   `gradeRiverSubgame` (factorized river scorekeeper) holding arriving ranges fixed. Gate:
   ≤ 0.3% of the subgame pot, same bar as the library. Turn re-solves: sampled offline with turn
   v2 where scale allows. This grades the solve, **not** safety.
2. **Safety margin audit** (the metric Brown & Sandholm report): for each re-solve at `s`,
   compute per-hand human best-response values `BR_new(g)` and the blueprint/previous-solve
   `CBV_H(g)` with our BR code. Report `max_g (BR_new(g) − CBV_H(g))`. Positive means the
   re-solve opened a hole the previous strategy didn't have.
3. **Toy-scale full-game study** (exact, our TS engines): take the river v3 demo game and the
   turn v2 referee game, remove one size from the AI's blueprint, and let a best-responding
   "human" use it. Measure exact full-game exploitability of the *combined* strategy under
   (a) pseudo-harmonic translation, (b) unsafe re-solve, (c) unsafe-at-parent, (d) gadget
   re-solve (P4). This reproduces the papers' comparison where we can grade it exactly, and it
   decides the default policy by measurement, not citation.
4. **Invariant and self-play tests:** human cards never reach a spot (property test over seeds);
   chip conservation and zero-sum over 10k seeded AI-vs-AI hands with random off-tree sizes;
   replay determinism.

### 2.8 Teaching view: "hand history + why the AI did that"
Per decision, with the drills' conventions (`tasks/drills-spec.md`: P = pot before the bet,
B = bet, C = call):
- **Human facing a bet:** pot odds `C/(P+B+C)`, MDF `P/(P+B)`, the human's exact equity vs the
  AI's *Bayes range at that node* (enumerated; the AI range is exact, so this number is honest),
  and the EV of call vs fold under the solve. Shown only after the human acts, or behind a
  "hint" toggle. Instant math first, solver second.
- **AI decision, after the hand:** the AI's hand, `σ(·|h)` as bars, the action it drew, the
  action EVs, a small AI-range histogram (value / draws / air), and the provenance in plain words
  ("You bet 45% — not in the tree; the AI re-solved the river including your size, 0.8 s,
  exploitability 0.12% pot" / "mapped your 45% to 33% with probability 61%").
- **Human grade:** EV loss of the human's action vs the solve's best action for their hand,
  labelled "vs this solver model of the AI's range" and never called "GTO-correct".

## 3. Milestones

### P0 — contract (no solving)
- [x] `HeadsUpHandState` + `AiDecisionRecord` + hand-history schema (versioned, hashed like other artifacts).
- [x] Policy interface and provenance union; the no-leak invariant test (human cards ∉ any spot/cache key).
- [x] Reach-vector bookkeeping (AI exact, human modelled) as a pure module with unit tests on the
      referee river game: reach at a node equals the product of σ along the path.
- [x] Pseudo-harmonic `f(A, B, x)` with property tests (monotone, f(A)=1, f(B)=0, scale-invariant).
- [x] Seeded deal/draw helpers; replay harness skeleton.
- Note (P0): contract v1 spots start at a street root, so `buildResolveSpot` builds street-root
      re-solves and refuses mid-street roots; nested (P2) roots need an explicit-tree builder with the
      actual prefix. The leak test is serialization + non-interference: outside the range lists no human
      card appears, and swapping the human's hand on the same public line leaves every spot byte-identical.

### P1 — on-tree play from the library (human limited to tree sizes)
- [ ] Scripted preflop + joint deal from library ranges; honest-label copy (test in `copy.test.ts` style).
- [ ] Flop: sample from library slices. Turn/river: street-root re-solves with the lean menu (native).
- [ ] Measure the turn/river cost model on the M1 Pro. Set budgets from the data, record them here.
- [ ] Referee gate (2.7 #1) on sampled river re-solves; replay determinism test.

### P2 — live re-solve for off-tree river bets
- [ ] Explicit-tree builder: lean menu at `s` plus the human's actual `a*`. Solve, use the AI's σ below `a*`.
- [ ] Admission + degradation ladder + translation fallback; provenance shows the rung.
- [ ] Safety-margin audit (2.7 #2) on a seeded corpus of off-tree river bets.

### P3 — same for the turn
- [ ] Turn nested re-solve (turn+river tree, first-street export; river re-solved at the river root).
- [ ] Offline cache warm-up for common turn lines; hit-rate and latency report.

### P4 — flop translation + safe re-solve study
- [ ] Flop off-tree via pseudo-harmonic translation, real-chip settlement, next-street re-solve.
- [ ] Toy-scale full-game study (2.7 #3) for policies a–c.
- [ ] Gadget re-solve (Resolve, then Max-margin) in our TS river engine for referee-scale spots.
      Measure policy d. Decide with Kat whether to fork postflop-solver to add a per-hand
      opt-out terminal (the fork would live under `native/`, still behind contract v1).

### P5 — UI
- [ ] `/play` heads-up table: seat choice, size slider in chips (off-tree allowed from P2), "AI thinking" state.
- [ ] Hand history + "why the AI did that" (2.8), keyboard-accessible, e2e test.
- [ ] Session ledger reusing `session.ts` `settleChipResult`.

## 4. Safety caveat (headline)

Every re-solve this design can run on postflop-solver today is **unsafe** in the technical sense:
it holds the human's range fixed at the solver's model of how the human "should" have played.
A human who deviates earlier can push the AI into re-solves that are locally near-equilibrium
(our referee grade passes) and still exploitable in the full game. Our river grader measures
local exploitability *given the ranges*. It can't certify full-game safety. Only the gadget
(P4) comes with a guarantee, and even Libratus's version used estimated values. The UI and README
must say "re-solves the rest of the hand from your actual action; not guaranteed unexploitable".

## 5. Risks
- Turn re-solve latency native vs WASM is unmeasured. The degradation ladder hides it, but frequent
  translation fallbacks would make "responds to what you did" hollow. Report the fallback rate.
- The lean tree is narrow (IP flop: one 66% size), so many human flop bets are off-tree and translated.
  That's the weakest link and the most exploitable (min-bet probing).
- Human range model = equilibrium. Against real humans the modelled posterior is wrong by design.
- Synthetic ranges: the AI is only as good as the hand-written BTN/BB ranges.
- Upstream is unmaintained; a gadget fork increases maintenance and pins us further.
- int16-compressed solves have larger value error (bridge spec). Live re-solves should be float32 only.

## 6. Open questions for Kat
1. Where does native re-solving run for the deployed site before WASM: a Vercel function, or local-only?
2. Default off-tree policy before P4 data: unsafe-at-parent re-solve (recommended) or translation?
3. Is it worth forking postflop-solver to add a gadget, or should safe re-solving stay a TS-only research track?
4. Should the human ever be dealt hands outside their seat's range (needs a preflop policy/fold)?
5. Latency tolerance: how long can "AI thinking" take before it hurts the practice loop?

## References
- Ganzfried & Sandholm, "Action Translation in Extensive-Form Games with Large Action Spaces:
  Axioms, Paradoxes, and the Pseudo-Harmonic Mapping", IJCAI 2013 — https://www.ijcai.org/proceedings/2013
- Ganzfried & Sandholm, "Endgame Solving in Large Imperfect-Information Games", AAMAS 2015.
- Burch, Johanson & Bowling, "Solving Imperfect Information Games Using Decomposition" (CFR-D, re-solve gadget), AAAI 2014.
- Moravčík, Schmid, Ha, Hladík & Gaukrodger, "Refining Subgames in Large Imperfect Information Games" (max-margin), AAAI 2016.
- Brown & Sandholm, "Safe and Nested Subgame Solving for Imperfect-Information Games", NeurIPS 2017 — https://arxiv.org/abs/1705.02955
- Moravčík et al., "DeepStack: Expert-Level Artificial Intelligence in Heads-Up No-Limit Poker", Science 2017 — https://arxiv.org/abs/1701.01724
- Brown & Sandholm, "Superhuman AI for heads-up no-limit poker: Libratus beats top professionals", Science 2018.
- Brown, Sandholm & Amos, "Depth-Limited Solving for Imperfect-Information Games", NeurIPS 2018 — https://arxiv.org/abs/1805.08195
- Brown & Sandholm, "Solving Imperfect-Information Games via Discounted Regret Minimization", AAAI 2019 (DCFR, postflop-solver's algorithm).
