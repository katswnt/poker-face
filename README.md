# Hold'em Trainer

A Texas Hold'em study tool that walks through every decision in a hand and explains the
reasoning, the estimated share of the pot, and the price of continuing.

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
- The numbers (estimated pot share, call price, average result, and bet sizing)

**Train mode** — you're assigned a **random seat** ("hero"). Before seeing the model's
decision, you pick your own action, then compare. Feedback separates choices that match
the trainer, different legal choices, and postflop call/fold errors whose cost follows
directly from the displayed call-price math. Preflop differences are never presented as
proven losses because that part of the trainer uses hand-group rules rather than measured profit. The app
also surfaces behavioral patterns across a session
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
were overclaims and have been renamed ("Trainer's choice" and "Tight"). The internal style key is
still `"gto"` for historical reasons; it's never shown to the user.

**A smaller game can be measured more directly.** The standalone
[`/solver`](https://pokerface.katswint.com/solver) explorer searches for stable play in a
heads-up shove-or-fold model. It reports the remaining strategy gap, uses precomputed charts
so the slider is instant, and shows its two important limits: an estimated equity matrix and
no card-removal weighting between ranges. It is deliberately separate from the 4-handed
trainer. Its 20,000-round solutions make the broad range widths useful, but noisy edge hands
are labeled as such instead of being presented as exact recommendations. See
[METHODOLOGY.md](METHODOLOGY.md).

---

## How decisions are made

**Preflop** — a 6-tier hand-strength chart (`src/lib/poker/ranges.ts`) crossed with
position- and pressure-based thresholds. A hand is raised if its tier ≤ the position's
raise threshold, called if ≤ the call threshold (and the price is right), else folded.
Thresholds tighten as raises stack up (open → 3-bet → 4-bet) and widen with looser table
styles. Every percentage shown in the app is counted directly from all 1,326 starting-card
combinations, so the explanation cannot drift away from the shipped hand groups. These are
model rules, not solver outputs or promises that a play will make money.

**Postflop** — a **1,000-simulation Monte Carlo** equity estimate per decision
(`src/lib/poker/equity.ts`). Each sim:
1. Samples the whole set of opponent hands from the app's **range-filtered pool**, rather
   than assuming every player holds two random cards. This is a modeling choice, not a
   claim to know a real opponent's range. Incompatible sets are rejected as a whole, so no opponent seat
   gets a sampling advantage from being chosen first.
2. Completes the board from the remaining deck.
3. Scores all hands head-to-head, crediting ties by exact pot share (`1 ÷ tied winners`).

The full-precision estimate is compared directly with the real price of calling. The engine
caps short all-ins and excludes unmatched chips the caller cannot win. Table personality
changes the sampled opponent range, never the break-even equation. Value-bet sizing scales with equity and
shrinks as the pot goes multiway, but the trainer does not model a separate range of hands
that will call those bets. The semi-bluff fires at a fixed frequency only when the hand can
still improve (a draw / overcards), never on pure air. Because the trainer does not model
which hands call, it shows a pure-bluff fold-rate reference rather than claiming an exact
semi-bluff result. All ~12,000 simulations for a full hand run at deal time inside a single
`useMemo`.

**The numbers shown** — for each postflop decision the feed shows a random-deal estimate
and the sampling error measured from the actual win, loss, and split-pot results. It also
shows the call price, average result, and bet sizing. For a semi-bluff, it labels
`bet ÷ (pot + bet)` as the fold rate a hand with no chance when called would need. A real
semi-bluff needs fewer folds because it can still win, but an exact number would require a
separate model of the opponent's calling hands.

---

## Architecture & why

```
src/
  app/                     Next.js App Router shell + SEO/OG metadata + /solver demo
  components/PokerSim.tsx   UI + rendering (one component, by design*)
  lib/poker/                pure, UI-free, unit-tested domain core
    cards.ts                deck, rank/suit constants, formatting helpers
    eval.ts                 readable reference hand evaluator
    score7.ts               fast seven-card evaluator used in simulations
    ranges.ts               preflop tiers & position thresholds
    equity.ts               Monte Carlo, exact-equity validation, the determinism seam
    pots.ts                 side-pot & split-pot distribution
    engine.ts               one betting round, shared by preflop & postflop
    decide.ts               the full decision engine (board/holding analysis + choice)
    types.ts                shared domain types
  lib/solver/               heads-up push/fold model + precomputed equity and strategy data
test/                       node:test suites that import the REAL lib/ (not copies)
e2e/                        Playwright keyboard and training-flow smoke tests
bench/                      equity throughput + memoization benchmark (npm run bench)
.github/workflows/ci.yml    lint + types + domain tests + build + browser tests
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
scripted actions (short blinds, minimum raises, cumulative short-all-in reopening, dry side
pots, all-in caps, and hero-index accounting). The engine exposes structured legal actions
to the UI and records requested decisions separately from applied actions, so the interface
cannot offer or announce a move the engine did not execute.

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
- **equity** — purity, memoization consistency, multiway split shares, equal-weight whole-table
  sampling, measured sampling error, monotonicity, and — the load-bearing one —
  **the random-deal estimate agrees with full enumeration** on pinned river and turn cases
  within the measured sampling error. This catches important sampling bias without claiming
  that two examples prove every possible case.
- **pots** — single winner, even chop, button-relative odd-chip splitting, exact per-layer
  awards, a short all-in main-pot/side-pot split, uncalled-excess return, and a property that
  every layer goes to the strongest eligible hand.
- **engine** — a betting round driven by scripted decisions: checks move no chips, full and
  cumulative short raises reopen action correctly, dry side pots cannot be bet, illegal
  undersized raises normalize to calls, short blinds never negative a stack, and over-bets cap all-in.
- **decide** — the full decision engine: stronger starting groups raise and weaker groups fold preflop, value bets
  and folds-to-price postflop, exact call-EV classification, and street-aware board analysis.
- **invariants** (`fast-check` fuzzing) — **chip conservation** (Σ payouts = Σ contributions,
  no chips created/destroyed) across 1,000 random pots, side-pot eligibility, betting-round
  conservation, evaluator-ordering consistency, and call-profitability equivalence.
- **solver** — push/fold model sanity checks, an explicit strategy-gap target at every shown
  depth, and `score7` proven byte-identical to `handScore` over 100,000 hands.
- **browser smoke tests** — native Space activation for Deal and training-choice buttons,
  run against a production build in Chromium.

CI (`.github/workflows/ci.yml`) runs lint + type-check + domain tests + build + browser smoke tests on every push.
See [METHODOLOGY.md](METHODOLOGY.md) for the simulation design, validation, and error bounds.

**Money handling now has direct safeguards.** Showdown distribution used to award the entire pot to the
single best hand — no side pots, and ties weren't actually split despite the UI announcing
"Split pot." Because every committed chip is deducted from a player's stack, each player's
contribution is now tracked explicitly by the betting engine; `distributePots` uses that
ledger to build proper side pots and split ties evenly (odd chip to the first winner clockwise
from the button). Every pot layer exposes exact per-seat awards for the showdown UI. This
matters because stacks carry across hands.

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
| Heuristic 4-handed trainer + a measured HU push/fold model | The trainer teaches fundamentals; the smaller model can report how close its saved strategy is to stable play |

**Known limitations (honest scope):**

- **The 4-handed trainer is heuristic, not a solver.** No range-vs-range, mixed strategies,
  blockers, or bet/fold. (Real GTO for 4-max is a research problem — see "Is this GTO?".)
- **Fixed 4-handed, 5/10 blinds, 20bb starting stacks.** No table-size/stake variation — the tier ranges
  are calibrated for 4-handed and would need re-tuning per table size, which is its own
  correctness project; kept scoped deliberately rather than shipped wrong.
- **Multiway equity is still a model.** Complete opponent-hand sets are sampled without seat
  order bias, ties use the exact share, and value-bet sizing changes with player count. The
  remaining limits are static opponent ranges, no separate calling range for bets and raises,
  and no model of how often equity is realized.

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
npm run dev      # http://localhost:3000  (and /solver for the push/fold explorer)
npm test         # domain + property test suite
npm run test:e2e # production-build browser smoke tests
npm run bench    # equity throughput + memoization benchmark
npm run build    # production build
```

## Accessibility

Interactive controls preserve native keyboard behavior; history rows are keyboard-operable
(`role="button"`, Enter/Space); cards carry text alternatives (`aria-label`); a polite live
region announces each step; focus is visible; and step auto-advance respects
`prefers-reduced-motion`. Plain language is the saved default; Poker terms mode adds
keyboard-, touch-, and hover-accessible term explanations.

## Navigation

- `→` — next step when focus is outside an interactive control
- `←` — previous step
- `Enter` / `Space` — activate the focused native control
- Click any history entry — jump to the full log at that step
