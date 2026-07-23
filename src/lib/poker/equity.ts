// Monte Carlo equity estimation.
import type { CardObj, TableStyle } from "./types";
import { RANKS, ck, cv } from "./cards";
import { getCombos, handScore } from "./eval";
import { preflopHandTier } from "./ranges";

function fullDeck(): CardObj[] {
  const d: CardObj[] = [];
  for (const s of ["♠", "♥", "♦", "♣"]) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}
const maxTierFor = (style: TableStyle) => (style === "wild" ? 6 : style === "loose" ? 5 : 4);

// Standard error of a Monte Carlo win-rate estimate: SE = √(p(1−p)/n). At n=1000 and
// p≈0.5 this is ≈1.6% — the honest ± on every equity number the app reports.
export function equityStandardError(p: number, n: number): number {
  if (n <= 0) return 0;
  return Math.sqrt(Math.max(0, p * (1 - p)) / n);
}

// Exact equity by full enumeration against ONE opponent drawn from the same range-filtered
// pool the Monte Carlo samples. This is the ground truth the estimator is validated
// against (see test/equity.test.ts): MC must converge here as sims → ∞, which proves the
// sampler is unbiased. Only defined for a single opponent — multiway enumeration is
// combinatorially infeasible, which is exactly why the app samples instead.
export function exactEquity(heroHole: CardObj[], board: CardObj[], style: TableStyle = "gto"): number {
  const known = new Set([...heroHole, ...board].map(ck));
  const remaining = fullDeck().filter(c => !known.has(ck(c)));
  const maxTier = maxTierFor(style);
  const need = 5 - board.length;

  let total = 0, wins = 0;
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const c1 = remaining[i], c2 = remaining[j];
      const hi = Math.max(cv(c1), cv(c2)), lo = Math.min(cv(c1), cv(c2));
      if (preflopHandTier(hi, lo, c1.suit === c2.suit) > maxTier) continue;
      const oppHole = [c1, c2];
      const rest = remaining.filter((_, k) => k !== i && k !== j);
      const runouts = need === 0 ? [[]] : getCombos(rest, need);
      for (const runout of runouts) {
        const full = [...board, ...runout];
        const h = handScore(heroHole, full);
        const o = handScore(oppHole, full);
        total += 1;
        if (h > o) wins += 1;
        else if (h === o) wins += 0.5;
      }
    }
  }
  return total === 0 ? 0.5 : wins / total;
}

// Deterministic PRNG (see the determinism note below).
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Determinism seam. The whole hand is recomputed inside one React useMemo on every hero
// action. Equity here is seeded PURELY from the spot itself (hole, board, opponents,
// style) plus the deal's base seed — NOT from a shared, order-dependent RNG stream. That
// makes each equity a referentially-transparent function of its inputs: identical across
// re-runs no matter what the hero did earlier, and therefore safe to memoize. (The old
// design used one sequential RNG for the whole hand, so a spot's equity depended on how
// many draws happened before it — reproducible only if the exact same sequence of spots
// recurred. This is strictly more robust.)
function spotSeed(dealSeed: number, hole: CardObj[], board: CardObj[], numOpponents: number, style: TableStyle): number {
  let h = (dealSeed ^ 0x9e3779b9) >>> 0;
  const mix = (x: number) => { h = Math.imul(h ^ (x >>> 0), 2654435761) >>> 0; };
  mix(numOpponents);
  mix(style === "gto" ? 1 : style === "loose" ? 2 : 3);
  for (const c of [...hole, ...board]) mix(cv(c) * 4 + "♠♥♦♣".indexOf(c.suit) + 1);
  return h >>> 0;
}

// Memo of computed equities within a session. Keys embed the spot seed (which embeds the
// deal seed), so entries never collide across deals; cleared wholesale past a cap to bound
// memory. Because equity is pure per-spot, re-simulated earlier streets are free on
// subsequent hero choices.
const equityCache = new Map<string, number>();
const EQUITY_CACHE_CAP = 4000;
export function clearEquityCache() { equityCache.clear(); }

// Fraction of sims where hero beats all opponents. Opponents are dealt from a
// range-filtered pool (hands actually in a plausible playing range), not random junk —
// naive equity-vs-random overstates hero strength because real villains bet ranges.
export function monteCarloEquity(
  heroHole: CardObj[],
  board: CardObj[],
  numOpponents: number,
  numSims = 1000,
  style: TableStyle = "gto",
  dealSeed = 0,
): number {
  const seed = spotSeed(dealSeed, heroHole, board, numOpponents, style);
  const key = seed + ":" + numSims;
  const hit = equityCache.get(key);
  if (hit !== undefined) return hit;

  const result = simulate(heroHole, board, numOpponents, numSims, style, mulberry32(seed));
  if (equityCache.size >= EQUITY_CACHE_CAP) equityCache.clear();
  equityCache.set(key, result);
  return result;
}

function simulate(heroHole: CardObj[], board: CardObj[], numOpponents: number, numSims: number, style: TableStyle, rng: () => number): number {
  const allCards: CardObj[] = [];
  for (const s of ["♠", "♥", "♦", "♣"]) for (const r of RANKS) allCards.push({ rank: r, suit: s });
  const knownKeys = new Set([...heroHole, ...board].map(ck));
  const remaining = allCards.filter(c => !knownKeys.has(ck(c)));
  const boardNeeded = 5 - board.length;
  if (remaining.length < numOpponents * 2 + boardNeeded) return 0.5;

  // GTO = tight (tier ≤ 4), Loose = semi-loose (tier ≤ 5), Wild = anything.
  const maxTier = style === "wild" ? 6 : style === "loose" ? 5 : 4;

  // Pre-compute all playable index-pair combos once — C(47,2) = 1081 iterations.
  const playablePairs: [number, number][] = [];
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const c1 = remaining[i], c2 = remaining[j];
      const hi = Math.max(cv(c1), cv(c2)), lo = Math.min(cv(c1), cv(c2));
      if (preflopHandTier(hi, lo, c1.suit === c2.suit) <= maxTier) playablePairs.push([i, j]);
    }
  }

  let wins = 0;
  for (let sim = 0; sim < numSims; sim++) {
    const usedIdx = new Set<number>();
    const oppHoles: CardObj[][] = [];

    for (let op = 0; op < numOpponents; op++) {
      let hand: CardObj[] | null = null;
      for (let attempt = 0; attempt < 40 && !hand; attempt++) {
        const [i, j] = playablePairs[Math.floor(rng() * playablePairs.length)];
        if (!usedIdx.has(i) && !usedIdx.has(j)) {
          hand = [remaining[i], remaining[j]];
          usedIdx.add(i); usedIdx.add(j);
        }
      }
      if (!hand) {
        // Fallback: first two unused cards (rare — keeps the sim going).
        for (let i = 0; i < remaining.length && !hand; i++) {
          if (usedIdx.has(i)) continue;
          for (let j = i + 1; j < remaining.length && !hand; j++) {
            if (usedIdx.has(j)) continue;
            hand = [remaining[i], remaining[j]];
            usedIdx.add(i); usedIdx.add(j);
          }
        }
      }
      if (hand) oppHoles.push(hand);
    }

    if (oppHoles.length < numOpponents) { wins += 0.5; continue; }

    // Complete the board from the unused remaining cards.
    const boardPool = remaining.filter((_, i) => !usedIdx.has(i));
    for (let i = boardPool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [boardPool[i], boardPool[j]] = [boardPool[j], boardPool[i]]; }
    const simBoard = [...board];
    let bi = 0;
    while (simBoard.length < 5) simBoard.push(boardPool[bi++]);

    const heroSc = handScore(heroHole, simBoard);
    const bestOpp = Math.max(...oppHoles.map(opp => handScore(opp, simBoard)));
    if (heroSc > bestOpp) wins += 1;
    else if (heroSc === bestOpp) wins += 0.5; // split pot
  }
  return wins / numSims;
}
