# Hold'em Trainer

A Texas Hold'em study tool that walks you through every decision in a hand — showing the math, GTO reasoning, and equity behind each action.

Live at **[pokerface.katswint.com](https://pokerface.katswint.com)**

---

## What it does

Deals a 4-player NLHE hand and steps through every decision — preflop through river — with full explanations at each stage.

**Observe mode** — watch the hand play out. Every player's decision shows:
- What they said (dialogue)
- Why they did it (reasoning)
- Inner thoughts (position, reads, hand strength)
- The math (equity, pot odds, EV, bet-sizing derivation)

**Train mode** — you're assigned a random seat ("hero"). Before seeing the AI's decision, pick your own action. Then compare. Your score tracks how often you match GTO.

In train mode, villain hands are hidden. You only see your own cards. After the hand, a "villain decisions" panel reveals every opponent's full reasoning for all their decisions.

---

## How decisions are made

**Preflop** — GTO hand tier system (6 tiers, premium → garbage) combined with position-based open/call thresholds:
- UTG opens ~top 18% of hands (Tiers 1–2)
- BTN opens ~top 45% (Tiers 1–4)
- SB plays ~top 30% (Tiers 1–3)
- BB defends ~40% vs a raise; checks free

**Postflop** — 1,000-simulation Monte Carlo equity calculation per decision. Each sim:
1. Deals hole cards to each opponent sampled from a range-filtered pool (hands in their preflop playing range, not random junk). This prevents equity inflation when opponents bet with strong holdings.
2. Completes the board randomly from the remaining deck
3. Evaluates all hands head-to-head
4. Records hero win/loss

Equity is compared to pot odds to determine call/fold. Value bet sizing is derived from equity (bet more when you're more ahead). Bluff sizing uses breakeven fold% math.

All ~12,000 simulations for a full hand run at deal time in a single `useMemo` — typically 20–50ms.

---

## The math shown

For every postflop decision the feed shows:
- **Monte Carlo equity** — `~X% equity vs N opponents (1,000 sims, opponents on semi-loose range)`
- **Pot odds** — `toCall ÷ (pot + toCall) = X% needed equity`
- **EV** — `equity × pot − (1−equity) × toCall`
- **Bet sizing** — why this fraction of the pot; what villain needs to call profitably
- **Bluff math** — `breakeven fold% = bet ÷ (pot + bet)`; proof that this equals the pot odds you give villain

For preflop decisions:
- Hand tier label and the position's range description
- Whether the hand is in the raise, call, or fold range

---

## Stack

- Next.js 16 App Router
- TypeScript
- All inline styles (no Tailwind, no CSS modules)
- JetBrains Mono font
- Deployed on Vercel

---

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Navigation

- `→` / `Space` — next step
- `←` — previous step
- Click any history entry — jump to full log at that step
