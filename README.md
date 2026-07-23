# Hold'em Trainer

A Texas Hold'em study tool that walks you through every decision in a hand — showing the
math, the reasoning, and the equity behind each action.

Live at **[pokerface.katswint.com](https://pokerface.katswint.com)**

> **Reading this as an evaluator?** Jump to [Is this "GTO"?](#is-this-gto) and
> [Conscious decisions & honest limits](#conscious-decisions--honest-limits). This README
> is deliberately candid about what the engine is, what it isn't, and where the scope
> lines are drawn — because the interesting part of a project like this is the judgment,
> not the marketing.

---

## What it does

Deals a 4-player NLHE hand and steps through every decision — preflop through river — with
a full explanation at each stage.

**Observe mode** — watch the hand play out. Every player's decision shows:
- What they said (dialogue)
- Why they did it (reasoning)
- Inner thoughts (position, reads, hand strength)
- The math (equity, pot odds, EV, bet-sizing derivation)

**Train mode** — you're assigned a **random seat** ("hero"). Before seeing the model's
decision, you pick your own action, then compare. A running score tracks how often you
match the model's line, and the app surfaces behavioral patterns across a session
("folding too often," "missing thin value"). Villain hole cards are hidden until showdown;
afterward a recap panel reveals every opponent's full reasoning.

---

## Is this "GTO"?

**No — and the UI no longer claims it is.** This is the single most important thing to be
honest about, so it goes first.

The engine plays **heuristic, equity-driven poker**, not
[game-theory-optimal](https://en.wikipedia.org/wiki/Solved_game) poker. Concretely:

| Real GTO has… | This engine has… |
|---|---|
| Range-vs-range equilibria | Hero equity vs a *static* opponent range |
| Mixed strategies / indifference | Hard equity thresholds (bet ≥65%, thin value ≥52%) |
| Solver-derived bet-to-bluff ratios | A fixed semi-bluff frequency (30%), gated on real equity |
| Card-removal / blocker effects | None |
| Bet/fold, check-raise, range construction | A single decision per spot |

So the model is better described as **a disciplined, exploitative baseline you can measure
yourself against** — closer to "a solid regular's default line" than to a solver output.
That's genuinely useful for learning fundamentals (pot odds, equity, position, sizing), and
it's honest about its ceiling.

Earlier versions labeled the model's move "GTO play" and the tight table style "GTO." Those
were overclaims and have been renamed ("Model line" and "Tight"). The internal style key is
still `"gto"` for historical reasons; it's never shown to the user.

---

## How decisions are made

**Preflop** — a 6-tier hand-strength chart (`src/lib/poker/ranges.ts`) crossed with
position- and pressure-based thresholds. A hand is raised if its tier ≤ the position's
raise threshold, called if ≤ the call threshold (and the price is right), else folded.
Thresholds tighten as raises stack up (open → 3-bet → 4-bet) and widen with looser table
styles. In the tight style the model roughly opens UTG ~top 27%, BTN/SB ~top 45%, and
defends the BB ~55% vs a raise. *(These are the model's stated ranges, not solver outputs —
see the note above.)*

**Postflop** — a **1,000-simulation Monte Carlo** equity estimate per decision
(`src/lib/poker/equity.ts`). Each sim:
1. Deals opponents from a **range-filtered pool** — hands actually in a plausible playing
   range, not random junk. (Naive equity-vs-random overstates hero strength because real
   villains bet ranges.)
2. Completes the board from the remaining deck.
3. Scores all hands head-to-head, crediting split pots at half.

Equity is compared to pot odds for call/fold. Value-bet sizing scales with equity; the
semi-bluff fires at a fixed frequency only when the hand still has equity to improve
(a draw / overcards), never on pure air. All ~12,000 simulations for a full hand run at
deal time inside a single `useMemo`.

**The math shown** — for each postflop decision the feed derives Monte Carlo equity, pot
odds (`toCall ÷ (pot + toCall)`), EV, bet sizing, and the semi-bluff breakeven
(`bet ÷ (pot + bet)`, with the proof that it mirrors the pot odds the villain faces).

---

## Architecture & why

```
src/
  app/                     Next.js App Router shell + SEO/OG metadata
  components/PokerSim.tsx   UI, game loop, and decision prose (one component, by design*)
  lib/poker/                pure, UI-free, unit-tested domain core
    cards.ts                deck, rank/suit constants, formatting helpers
    eval.ts                 hand evaluation — evalHand + handScore on one shared core
    ranges.ts               preflop tiers & position thresholds
    equity.ts               Monte Carlo + the determinism seam (see below)
    pots.ts                 side-pot & split-pot distribution
    types.ts                shared domain types
test/                       node:test suites that import the REAL lib/ (not copies)
```

**The determinism seam** (`equity.ts`) is the core correctness insight. The whole hand is
recomputed inside one `useMemo` on every hero action. If the Monte Carlo used
`Math.random`, each recompute would return different equities → the number of simulated
stages would shift → the hero's recorded choices would misalign with the streets they were
made on. Seeding a `mulberry32` PRNG per deal (`setSimRng`) makes every recompute
bit-for-bit identical. A test asserts same-seed → identical equity.

**Pure core extracted to `lib/poker/`** so the valuable logic (evaluator, equity, ranges,
pots) is testable in isolation and can't drift from the UI. `evalHand` and `handScore` were
previously two separate encodings of the same ranking that had silently disagreed; they now
share one `rankCards` core, guarded by a property test that asserts they induce the
identical ordering on random hands.

\* **Why one big component?** `PokerSim.tsx` is intentionally left as a single file: the
game loop, decision prose, and rendering are tightly coupled and change together, and
splitting them would add indirection without adding testability (the *pure* logic, which is
what benefits from isolation, already lives in `lib/`). It's a conscious trade-off, not an
oversight — see the roadmap for where I'd split it next.

---

## Correctness & testing

`npm test` runs `node --import tsx --test test/*.test.ts` against the **shipped** `lib/`
modules (an earlier suite re-implemented copies that drifted from production — that's now
fixed). Coverage:

- **eval** — every hand category, the wheel, kicker tiebreaks, and the property test that
  `evalHand` and `handScore` never disagree.
- **ranges** — exact tier boundaries (AA/KK/QQ/JJ = tier 1, TT = tier 2, …) asserted
  against the real function.
- **equity** — determinism (same seed → identical result), AA ≈ 85% heads-up, monotonicity,
  and equity falling as opponents are added.
- **pots** — single winner, even chop, odd-chip splitting, a short all-in main-pot/side-pot
  split, and uncalled-excess return.

**Money handling is now correct.** Showdown distribution used to award the entire pot to the
single best hand — no side pots, and ties weren't actually split despite the UI announcing
"Split pot." Because every committed chip is deducted from a player's stack, each player's
contribution this hand is simply `startingStack − currentStack`; `distributePots` uses that
to build proper side pots and split ties evenly (odd chip to the lower seat). This matters
because stacks carry across hands.

---

## Conscious decisions & honest limits

**Decisions made on purpose:**

| Decision | Why |
|---|---|
| No poker libraries — evaluator, equity, ranges from scratch | The point of the project is to demonstrate the math, not import it |
| Monte Carlo (not exact enumeration) for equity | 1,000 sims is fast enough (`useMemo` at deal time) and the teaching value is in the method, not the 3rd decimal |
| Range-filtered opponents in the sim | Equity-vs-random is a real modeling trap; filtering to plausible ranges is more honest |
| Seeded PRNG for the sim | Required for the `useMemo`-recompute model to stay consistent (the determinism seam) |
| Pure logic in `lib/`, UI in one component | Isolate and test what benefits from it; don't over-split coupled UI |
| Inline styles, no CSS framework | A single self-contained terminal aesthetic; Tailwind would be dead weight here |
| Heuristic engine, labeled honestly | A real solver is out of scope; the value is a measurable baseline + transparent math |

**Known limitations (honest scope, candidate roadmap):**

- **Not a solver.** No range-vs-range, mixed strategies, blockers, or bet/fold. (See above.)
- **Fixed 4-handed, 5/10 blinds, ~200bb.** No table-size or stake variation yet.
- **Multiway equity is approximate.** Hero equity-to-win-the-whole-pot is compared to
  heads-up pot odds; the model doesn't fully account for multiway dynamics.
- **The decision engine (prose + betting) still lives in the component.** The next split
  I'd make is `lib/poker/decide.ts` so the full decision — not just its primitives — is
  unit-tested.
- **Accessibility gaps.** History rows are click-only `<div>`s and tooltips are
  hover-first; keyboard/SR support needs work.

---

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Inline styles, JetBrains Mono, terminal aesthetic
- `node:test` + `tsx` for the domain test suite
- Deployed on Vercel

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # domain test suite (lib/poker)
npm run build    # production build
```

## Navigation

- `→` / `Space` — next step
- `←` — previous step
- Click any history entry — jump to the full log at that step
