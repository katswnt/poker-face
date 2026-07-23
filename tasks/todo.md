# Poker-face — "make the claims true" + honest README

Goal: turn the weaknesses a hiring manager's LLM would flag into either (a) fixed code
that makes the README's claims true, or (b) honestly-documented, deliberate scope.

## Phase 1 — Extract pure logic into testable modules (low risk)
- [ ] `src/lib/poker/types.ts` — CardObj, HandResult, Draw, etc.
- [ ] `src/lib/poker/cards.ts` — ranks/suits constants, makeDeck, shuffle, ck/cv/cardStr helpers
- [ ] `src/lib/poker/eval.ts` — getCombos, evalHand, checkStr, bestHand, cmpK, handScore
      **UNIFY** evalHand + handScore onto one `rankCards` core (kills the drift bug)
- [ ] `src/lib/poker/ranges.ts` — preflopHandTier, preflopThresholds
- [ ] `src/lib/poker/equity.ts` — mulberry32, setSimRng, monteCarloEquity (imports eval + ranges)
- [ ] `src/lib/poker/pots.ts` — NEW distributePots(): correct side pots + split pots
- [ ] Rewire PokerSim.tsx to import from lib; delete the in-component copies

## Phase 2 — Real tests that import the shipped source (kills false-confidence)
- [ ] Add `tsx` devDep; `npm test` runs `node --import tsx --test test/*.test.ts`
- [ ] eval.test.ts — every category, wheel, kickers; property test: evalHand order == handScore order
- [ ] ranges.test.ts — tier boundaries asserted against SHIPPED values (AA/KK/QQ/JJ=1, TT=2…)
- [ ] equity.test.ts — determinism (same seed→same equity), AA≈85% HU, monotonicity
- [ ] pots.test.ts — single winner, split even, short all-in side pot, odd chip
- [ ] Delete/replace the drifted debug/*.mjs copies

## Phase 3 — Make the behavioral claims true (higher risk → guarded by tests + browser)
- [ ] Side/split pots: replace `stacks[winner] += pot` with distributePots() using
      contribution = startingStacks[i] − stacks[i]; wire rankedResults + split display
- [ ] Random hero seat: `setHeroIdx(random)`; audit every hardcoded `players[0]`/heroIdx==0
- [ ] "GTO" honesty: rename table-style toggle GTO→Tight; badge "GTO play"→"Model line";
      make bluff rng-based + gated on real draws (semi-bluff), not `pot % 7`
- [ ] Fix README/code numeric drift (open %s vs actual tier thresholds)

## Phase 4 — Verify
- [ ] `npm test` green, `npm run build` clean, `npm run lint` clean
- [ ] Drive app in browser: train mode w/ random seat, play a hand, confirm split/side-pot
      payout + no console errors

## Phase 5 — README
- [ ] Rewrite README: "Conscious decisions (why)" + "Known limitations & roadmap (honest)"
      + "Is this GTO? — what it actually is" + updated stack/architecture map

## Review — done

All phases complete. Verified: `npm test` 20/20 green, `npx tsc --noEmit` clean,
`npm run build` succeeds, page serves 200 and renders the app shell with no error boundary.
(Live click-through in the browser was not possible this session — the Claude Chrome
extension was not connected — but the random-seat code is fully generic in `heroIdx` and
the pots path is covered by unit tests.)

What changed and why it matters to an evaluator:
- **`lib/poker/` pure core** (cards/eval/ranges/equity/pots/types) extracted from the
  2067-line component → the valuable logic is now unit-testable and can't drift from the UI.
- **Unified evaluator**: `evalHand` + `handScore` now share one `rankCards` core (killed a
  real drift bug), guarded by a property test.
- **Real tests import the shipped source** (20 assertions) — the old suite tested drifted
  copies and was green while asserting wrong behavior. Deleted `debug/*.mjs`.
- **Correct side pots + split pots** via `distributePots` (contribution = startingStack −
  currentStack); replaced `stacks[winner] += pot`. Showdown UI now shows chops honestly.
- **Random hero seat** (was hard-pinned to Alice despite the README claiming random).
- **"GTO" honesty**: badge "GTO play" → "Model line"; table style "GTO" → "Tight";
  "mathematically optimal" copy softened; `pot % 7` bluff → fixed-frequency semi-bluff
  gated on real equity, framed honestly as a heuristic.
- **README rewritten** around conscious decisions + honest limits, leading with
  "Is this GTO? No."

Lint: 24 problems remain, all pre-existing (HEAD had 40); none introduced here. Could be a
future cleanup pass but out of scope.

Not done (documented as roadmap in README, not silently dropped):
- Decision engine (prose + betting) still in the component; next split = `lib/poker/decide.ts`.
- Multiway equity still approximate; accessibility gaps remain.
