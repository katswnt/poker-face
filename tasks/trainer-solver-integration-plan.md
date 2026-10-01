# Bringing the solver work into the trainer — plan (2026-10-01)

Goal (north star): turn every trainer hand into a precise math lesson. The trainer is a
4-player game against rule-based opponents; the solver work is heads-up. Integrate in tiers,
from pure reuse to exact opponent-aware evaluation, without overstating what any number means.

## Prerequisites

- **P5 (`/play`) shipped** per `tasks/cpu-ceiling-roadmap.md` (its live re-solve source and
  per-decision math panel are reused here).
- **The trainer/session work in progress is landed first** (`src/components/PokerSim.tsx`,
  `src/lib/poker/session.ts`, `test/session.test.ts`, related README/METHODOLOGY/e2e hunks).
  This plan edits the trainer; it must not be built on top of uncommitted trainer changes.
- Working rules from the roadmap apply: tests first, isolated exact-commit verification,
  explicit file lists, no loosened gates, honest copy.

## Tier 1 — reuse what exists (small)

### T1a: post-hand math quiz from your own decisions
- After a hand, offer "Quiz me on this hand": one question per decision you faced, generated
  from the actual numbers (break-even equity for a call, MDF for a bet you faced, bluff share
  for a bet you made, outs/equity on draws, combo counts with the visible board).
- Reuse `src/lib/drills` generators' formulas and explanations; questions are built from the
  hand log, not random seeds. Missed items go to the existing review queue (source: trainer).
- Gate: every quiz answer independently recomputed in tests from the logged chips/cards;
  formulas identical to `/drills` (shared code, not copies).

### T1b: push/fold reference badge
- When action folds to SB/BB with an effective stack ≤ 20bb, show what the exact heads-up
  push/fold chart says for the hand, labelled "heads-up shove/fold chart; this table has
  more players and other options, so treat it as a reference, not the answer".
- Gate: lookup matches `getPushFoldSolution` for the stack depth; copy test for the label.

## Tier 2 — exact evaluation against the known opponents (the big upgrade)

The trainer's opponents are deterministic rules we wrote, so their strategy is known, not
estimated. That enables exact answers to "what beats *this* opponent", which equilibrium
solving does not give.

### T2a: exact opponent ranges from their rules
- Expose the opponent policy as a **distribution**: for each possible hole-card combo at a
  public node, the probability of each action. Where the rules use random mixing (seeded
  bluffs), return the mixing probabilities instead of sampling.
- An opponent's range at a node = the prior combos weighted by the product of their action
  probabilities along the public history (card removal from board and the hero's cards).
- **Technical risk to measure first:** the rules call equity estimates. Evaluating ~1,000
  combos per node with 10,000-sample Monte Carlo each may be too slow; use exact river
  enumeration, exact or cached turn equity, and measure the per-node cost before committing to
  a design. If the rules themselves depend on sampled equity, define the "exact" policy as the
  rule applied to exact equity, and say so.
- Gate: for random nodes, the computed range matches a brute-force simulation of the rules
  within sampling error; hero's hole cards never influence the opponent's range.

### T2b: exact EV of your options once a pot is heads-up (turn and river)
- With the opponent's policy fixed and known, compute the exact expected value of each of
  your legal actions: enumerate the opponent's weighted range, remaining cards and the
  opponent's responses at every later node, and take your best continuation (a best
  response, no CFR). River first, then turn (enumerate river cards).
- Gate: matches an independent brute-force evaluator on small constructed spots; chip
  conservation; measured latency in the worker (set budgets from data).

### T2c: grading becomes measured
- In heads-up turn/river spots, replace "different legal choice" with the measured EV gap
  in bb and % of pot ("calling loses 0.8 bb vs this opponent"), using drills-style bands.
  Multiway or earlier-street spots keep the current honest labels.
- Copy must say "against this table's rule-based opponent", never "GTO" or "correct".

### T2d: optional equilibrium comparison
- Next to the exact best-response answer, optionally show the live solver's equilibrium
  answer for the same heads-up spot (WASM, admitted spots only), labelled "against a
  perfect opponent". Teaching point: exploitative vs balanced play, side by side.

## Tier 3 — later

- **T3a: solver-backed opponents in heads-up pots.** When a trainer pot goes heads-up and the
  spot fits the library formation, let the opponent play from `/play`'s engine (library on the
  flop, live turn/river re-solves). Requires mapping trainer stacks/sizes to the solved game,
  or live solving the actual spot; carry `/play`'s exploitability caveat.
- **T3b: multiway pots** stay rule-based until roadmap step 14 produces audited multiway play.

## Order

After P5: T1a → T1b → T2a (measure first) → T2b (river, then turn) → T2c → T2d → T3a.
