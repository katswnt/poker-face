// Monte Carlo equity estimation.
import type { CardObj, TableStyle } from "./types";
import { RANKS, ck, cv } from "./cards";
import { getCombos, handScore } from "./eval";
import { preflopHandTier } from "./ranges";
import { score7 } from "./score7";

function fullDeck(): CardObj[] {
  const d: CardObj[] = [];
  for (const s of ["♠", "♥", "♦", "♣"]) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}
const maxTierFor = (style: TableStyle) => (style === "wild" ? 6 : style === "loose" ? 5 : 4);

// Bernoulli upper bound retained for independent tests and rough planning. The product
// reports `EquityEstimate.standardError`, measured from the actual samples instead.
export function equityStandardError(p: number, n: number): number {
  if (n <= 0) return 0;
  return Math.sqrt(Math.max(0, p * (1 - p)) / n);
}

export interface EquityEstimate {
  equity: number;
  standardError: number;
  samples: number;
}

export function standardErrorFromMoments(sum: number, sumSquares: number, samples: number): number {
  if (samples <= 1) return 0;
  const mean = sum / samples;
  const sampleVariance = Math.max(0, (sumSquares - samples * mean * mean) / (samples - 1));
  return Math.sqrt(sampleVariance / samples);
}

function standardErrorFromRunningVariance(m2: number, samples: number): number {
  if (samples <= 1) return 0;
  const sampleVariance = Math.max(0, m2 / (samples - 1));
  return Math.sqrt(sampleVariance / samples);
}

// Exact equity by full enumeration against ONE opponent drawn from the same range-filtered
// pool the Monte Carlo samples. This is the ground truth used to check the estimator
// (see test/equity.test.ts): the one-opponent samples must agree within their measured
// uncertainty. Only defined for a single opponent — multiway enumeration is
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

// Memo of computed equities within a session. Keys contain the complete raw spot identity;
// the 32-bit hash is used only as the PRNG seed, never as cache identity (different spots
// can legitimately hash to the same seed). Cleared wholesale past a cap to bound memory.
const equityCache = new Map<string, EquityEstimate>();
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
  return monteCarloEquityEstimate(heroHole, board, numOpponents, numSims, style, dealSeed).equity;
}

export function monteCarloEquityEstimate(
  heroHole: CardObj[],
  board: CardObj[],
  numOpponents: number,
  numSims = 1000,
  style: TableStyle = "gto",
  dealSeed = 0,
): EquityEstimate {
  const seed = spotSeed(dealSeed, heroHole, board, numOpponents, style);
  const key = [dealSeed >>> 0, numSims, numOpponents, style, heroHole.map(ck).join(","), board.map(ck).join(",")].join(":");
  const hit = equityCache.get(key);
  if (hit !== undefined) return hit;

  const result = simulate(heroHole, board, numOpponents, numSims, style, mulberry32(seed));
  if (equityCache.size >= EQUITY_CACHE_CAP) equityCache.clear();
  equityCache.set(key, result);
  return result;
}

// Each compatible ordered tuple must have the same chance. Sampling every pair first and
// rejecting the whole tuple on any collision guarantees that; choosing opponents one at a
// time would make later seats conditional on earlier seats and bias the joint range.
export function sampleRangeTupleIndices(
  playablePairs: Array<[number, number]>,
  numOpponents: number,
  rng: () => number,
): Array<[number, number]> {
  if (numOpponents <= 0) return [];
  while (true) {
    const tuple = Array.from({ length: numOpponents }, () => playablePairs[Math.floor(rng() * playablePairs.length)]);
    const used = new Set<number>();
    let compatible = true;
    for (const [first, second] of tuple) {
      if (used.has(first) || used.has(second)) { compatible = false; break; }
      used.add(first);
      used.add(second);
    }
    if (compatible) return tuple;
  }
}

function hasCompatibleTuple(playablePairs: Array<[number, number]>, needed: number, chosen: Set<number> = new Set(), start = 0): boolean {
  if (needed === 0) return true;
  for (let pairIndex = start; pairIndex < playablePairs.length; pairIndex++) {
    const [first, second] = playablePairs[pairIndex];
    if (chosen.has(first) || chosen.has(second)) continue;
    chosen.add(first); chosen.add(second);
    if (hasCompatibleTuple(playablePairs, needed - 1, chosen, pairIndex + 1)) return true;
    chosen.delete(first); chosen.delete(second);
  }
  return false;
}

function simulate(heroHole: CardObj[], board: CardObj[], numOpponents: number, numSims: number, style: TableStyle, rng: () => number): EquityEstimate {
  const allCards: CardObj[] = [];
  for (const s of ["♠", "♥", "♦", "♣"]) for (const r of RANKS) allCards.push({ rank: r, suit: s });
  const knownKeys = new Set([...heroHole, ...board].map(ck));
  const remaining = allCards.filter(c => !knownKeys.has(ck(c)));
  const boardNeeded = 5 - board.length;
  if (numSims <= 0) return { equity: 0.5, standardError: 0, samples: 0 };
  if (remaining.length < numOpponents * 2 + boardNeeded) return { equity: 0.5, standardError: 0, samples: 0 };

  // Tight = tier ≤ 4, Loose = tier ≤ 5, Wild = anything.
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
  if (!hasCompatibleTuple(playablePairs, numOpponents)) {
    return { equity: 0.5, standardError: 0, samples: 0 };
  }

  // Welford's running method avoids subtracting two nearly equal totals.
  // That matters in forced chops: every trial has the same share, so the
  // sampling uncertainty should be exactly zero.
  let meanShare = 0;
  let m2 = 0;
  for (let sim = 0; sim < numSims; sim++) {
    const usedIdx = new Set<number>();
    const tuple = sampleRangeTupleIndices(playablePairs, numOpponents, rng);
    const oppHoles = tuple.map(([first, second]) => {
      usedIdx.add(first); usedIdx.add(second);
      return [remaining[first], remaining[second]];
    });

    // Complete the board from the unused remaining cards.
    const boardPool = remaining.filter((_, i) => !usedIdx.has(i));
    for (let i = boardPool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [boardPool[i], boardPool[j]] = [boardPool[j], boardPool[i]]; }
    const simBoard = [...board];
    let bi = 0;
    while (simBoard.length < 5) simBoard.push(boardPool[bi++]);

    const heroSc = score7([...heroHole, ...simBoard]);
    const oppScores = oppHoles.map(opp => score7([...opp, ...simBoard]));
    const bestOpp = Math.max(...oppScores);
    let share = 0;
    if (heroSc > bestOpp) share = 1;
    else if (heroSc === bestOpp) {
      const tiedOpponents = oppScores.filter(score => score === heroSc).length;
      share = 1 / (tiedOpponents + 1);
    }
    const sampleNumber = sim + 1;
    const delta = share - meanShare;
    meanShare += delta / sampleNumber;
    m2 += delta * (share - meanShare);
  }
  return {
    equity: meanShare,
    standardError: standardErrorFromRunningVariance(m2, numSims),
    samples: numSims,
  };
}
