// Monte Carlo equity estimation.
import type { CardObj, TableStyle } from "./types";
import { RANKS, ck, cv } from "./cards";
import { handScore } from "./eval";
import { preflopHandTier } from "./ranges";

// Deterministic PRNG. The whole hand is recomputed inside a single React useMemo on
// every hero action; if the Monte Carlo used Math.random, each recompute would return
// different equities, the number of simulated stages would shift, and the hero's
// recorded choices would misalign with the streets they were made on. Seeding the RNG
// per deal makes every recompute bit-for-bit identical. This is the app's core
// correctness seam — see setSimRng below.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The RNG the simulation draws from. Defaults to Math.random for standalone/test use;
// the component calls setSimRng(mulberry32(seed)) at the top of each deal's useMemo so
// re-runs are reproducible. A module seam (rather than a threaded parameter) keeps the
// large decision-generation call chain from having to pass rng through every frame.
let simRng: () => number = Math.random;
export function setSimRng(fn: () => number) { simRng = fn; }

// Fraction of sims where hero beats all opponents. Opponents are dealt from a
// range-filtered pool (hands actually in a plausible playing range), not random junk —
// naive equity-vs-random overstates hero strength because real villains bet ranges.
export function monteCarloEquity(
  heroHole: CardObj[],
  board: CardObj[],
  numOpponents: number,
  numSims = 1000,
  style: TableStyle = "gto",
): number {
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
        const [i, j] = playablePairs[Math.floor(simRng() * playablePairs.length)];
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
    for (let i = boardPool.length - 1; i > 0; i--) { const j = Math.floor(simRng() * (i + 1)); [boardPool[i], boardPool[j]] = [boardPool[j], boardPool[i]]; }
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
