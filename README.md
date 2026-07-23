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

**Where there IS a real equilibrium.** For the one game that's actually tractable — heads-up
preflop push/fold — there's a standalone **Nash solver** at [`/solver`](https://pokerface.katswint.com/solver):
a true equilibrium computed by fictitious play over a precomputed 169×169 equity matrix,
verifiable against published charts (at 10bb it shoves the SB 58% / calls the BB 37.5%). It's
deliberately separate from the 4-handed heuristic trainer — see [METHODOLOGY.md](METHODOLOGY.md).

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
  app/                     Next.js App Router shell + SEO/OG metadata + /solver demo
  components/PokerSim.tsx   UI + rendering (one component, by design*)
  lib/poker/                pure, UI-free, unit-tested domain core
    cards.ts                deck, rank/suit constants, formatting helpers
    eval.ts                 hand evaluation — evalHand + handScore on one shared core
    ranges.ts               preflop tiers & position thresholds
    equity.ts               Monte Carlo, exact-equity validation, the determinism seam
    pots.ts                 side-pot & split-pot distribution
    engine.ts               one betting round, shared by preflop & postflop
    decide.ts               the full decision engine (board/holding analysis + choice)
    types.ts                shared domain types
  lib/solver/               heads-up push/fold Nash solver + precomputed equity matrix
test/                       node:test suites that import the REAL lib/ (not copies)
bench/                      equity throughput + memoization benchmark (npm run bench)
.github/workflows/ci.yml    lint + type-check + tests + build on every push
```

**The determinism seam** (`equity.ts`) is the core correctness insight. The whole hand is
recomputed inside one `useMemo` on every hero action. If the Monte Carlo used
`Math.random`, each recompute would return different equities → the number of simulated
stages would shift → the hero's recorded choices would misalign with the streets they were
made on. So each equity is seeded **purely from the spot itself** (hole, board, opponents,
style, plus the deal's base seed): it's a referentially-transparent function of its inputs,
identical across re-runs regardless of what the hero did earlier — and therefore safe to
**memoize**, so re-simulated earlier streets are free on later decisions. A test asserts
same-inputs → identical equity. (The earlier version used one sequential RNG for the whole
hand, so a spot's equity depended on how many draws preceded it — reproducible only if the
exact same sequence of spots recurred. The per-spot seed is strictly more robust.)

**Pure core extracted to `lib/poker/`** so the valuable logic (evaluator, equity, ranges,
pots, betting) is testable in isolation and can't drift from the UI. Two examples of drift
this killed: `evalHand`/`handScore` were separate encodings of the same ranking that had
silently disagreed (now one `rankCards` core, guarded by a property test); and the betting
loop existed **twice** — inline for preflop and a near-duplicate for postflop — now a single
`engine.runBettingRound` with the decision function injected, so the tests drive it with
scripted actions (blinds, raises re-opening action, all-in caps, hero-index accounting).

\* **Why is the component still one file?** After extracting `decide.ts`, `PokerSim.tsx` is
now essentially UI: the per-deal `useMemo` game loop and rendering. The entire decision
engine — board/holding/threat analysis and the full per-spot choice — lives in
`lib/poker/decide.ts` and is unit-tested directly. What remains in the component is
genuinely view-layer and changes together with the markup; splitting the presentational
sub-components into their own files is cosmetic, not a testability win.

---

## Correctness & testing

`npm test` runs `node --import tsx --test test/*.test.ts` against the **shipped** `lib/`
modules (an earlier suite re-implemented copies that drifted from production — that's now
fixed). Coverage:

- **eval** — every hand category, the wheel, kicker tiebreaks, and the property test that
  `evalHand` and `handScore` never disagree.
- **ranges** — exact tier boundaries (AA/KK/QQ/JJ = tier 1, TT = tier 2, …) asserted
  against the real function.
- **equity** — purity, memoization consistency, monotonicity, and — the load-bearing one —
  **Monte Carlo converges to exact enumerated equity** (river & turn) within its own
  confidence interval, proving the sampler is unbiased.
- **ranges** — exact tier boundaries (AA/KK/QQ/JJ = tier 1, TT = tier 2, …) asserted
  against the real function.
- **pots** — single winner, even chop, odd-chip splitting, a short all-in main-pot/side-pot
  split, and uncalled-excess return.
- **engine** — a betting round driven by scripted decisions: checks move no chips, a bet
  re-opens action, folds drop seats, over-bets cap at all-in, raise counter + hero index.
- **decide** — the full decision engine: premiums raise / trash folds preflop, value bets
  and folds-to-price postflop, and board/holding/threat analysis.
- **invariants** (`fast-check` fuzzing) — **chip conservation** (Σ payouts = Σ contributions,
  no chips created/destroyed) across 1,000 random pots, side-pot eligibility, betting-round
  conservation, evaluator-ordering consistency. Found no bugs — after thousands of inputs,
  that's the point.
- **solver** — Nash push/fold: equity symmetry, AA always in, monotone shove range vs depth,
  and `score7` proven byte-identical to `handScore` over 100k hands.

CI (`.github/workflows/ci.yml`) runs lint + type-check + tests + build on every push.
See [METHODOLOGY.md](METHODOLOGY.md) for the simulation design, validation, and error bounds.

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
| Per-spot-seeded, memoized equity | Keeps the `useMemo`-recompute model consistent (the determinism seam) and makes re-simulated streets free |
| Pure logic in `lib/`, UI + prose in one component | Isolate and test what benefits from it; don't over-split coupled UI/prose |
| Inline styles, no CSS framework | A single self-contained terminal aesthetic; Tailwind would be dead weight here |
| Heuristic 4-handed trainer + a real HU push/fold solver | The trainer teaches fundamentals with transparent math; the solver shows a genuine equilibrium where one is tractable |

**Known limitations (honest scope):**

- **The 4-handed trainer is heuristic, not a solver.** No range-vs-range, mixed strategies,
  blockers, or bet/fold. (Real GTO for 4-max is a research problem — see "Is this GTO?".
  Where it *is* tractable, heads-up push/fold, there's a real Nash solver at `/solver`.)
- **Fixed 4-handed, 5/10 blinds, ~200bb.** No table-size/stake variation — the tier ranges
  are calibrated for 4-handed and would need re-tuning per table size, which is its own
  correctness project; kept scoped deliberately rather than shipped wrong.
- **Multiway equity is a defensible approximation.** The equity itself (P(win vs N)) is
  multiway-correct and value-bet **sizing is now scaled by opponent count**; the residual
  approximation is comparing to heads-up-style pot odds and ignoring equity realization.

---

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Inline styles, JetBrains Mono, terminal aesthetic
- `node:test` + `tsx` for the domain suite; `fast-check` for property/fuzz tests
- GitHub Actions CI (lint + types + tests + build)
- Deployed on Vercel

## Local development

```bash
npm install
npm run dev      # http://localhost:3000  (and /solver for the Nash solver)
npm test         # domain + property test suite (58 assertions)
npm run bench    # equity throughput + memoization benchmark
npm run build    # production build
```

## Accessibility

Interactive controls are real buttons; history rows are keyboard-operable (`role="button"`,
Enter/Space); cards carry text alternatives (`aria-label`); a polite live region announces
each step; focus is visible; and step auto-advance respects `prefers-reduced-motion`.

## Navigation

- `→` / `Space` — next step
- `←` — previous step
- Click any history entry — jump to the full log at that step
