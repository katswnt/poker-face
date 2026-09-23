// Exact inexpensive river enumeration and fixed-budget Monte Carlo estimates.
import type { CallEstimate, CallQuote, CardObj, ShowdownOutcomeRates, TableStyle } from "./types";
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
  method: "enumerated" | "sampled";
  equity: number;
  standardError: number;
  samples: number; // Accepted random deals, or the full deal count when enumerated.
  outcomes: ShowdownOutcomeRates;
}

export const TRAINER_EQUITY_SAMPLES = 10_000;

function validateEstimateInput(hole: CardObj[], board: CardObj[], opponents: number, samples: number, style: TableStyle): void {
  const all = [...hole, ...board];
  if (hole.length !== 2 || board.length > 5 || all.some(card => !RANKS.includes(card.rank) || !["♠", "♥", "♦", "♣"].includes(card.suit)) || new Set(all.map(ck)).size !== all.length) {
    throw new Error("Equity needs two distinct hole cards and up to five distinct board cards.");
  }
  if (!Number.isSafeInteger(opponents) || opponents < 0 || opponents > 5) throw new Error("The trainer supports zero through five opponents.");
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 100_000) throw new Error("Use a fixed sample budget from 2 through 100,000.");
  if (!["gto", "loose", "wild"].includes(style)) throw new Error("Unknown opponent style.");
}

// This is a normal approximation for a fixed sample budget, not a guaranteed
// interval or a bound on the range/model error. Ties use the measured variance.
export function samplingUncertaintyCopy(standardError: number): string {
  const points = standardError * 100;
  return `Sampling standard error (one SE): ${points.toFixed(2)} percentage points. Approximate 95% sampling margin: ±${(1.96 * points).toFixed(2)} points, not a guaranteed bound. This does not cover wrong opponent ranges or later betting; zero measured variation does not prove zero sampling error.`;
}

export function estimateEquity(
  heroHole: CardObj[], board: CardObj[], numOpponents: number,
  numSims = TRAINER_EQUITY_SAMPLES, style: TableStyle = "gto", dealSeed = 0,
): EquityEstimate {
  validateEstimateInput(heroHole, board, numOpponents, numSims, style);
  if (board.length === 5 && numOpponents === 1) {
    return simulate(heroHole, board, numOpponents, numSims, style, mulberry32(0), true);
  }
  return monteCarloEquityEstimate(heroHole, board, numOpponents, numSims, style, dealSeed);
}

export function estimateCall(
  heroHole: CardObj[], board: CardObj[], quote: CallQuote, fallbackNumOpponents: number,
  numSims = TRAINER_EQUITY_SAMPLES, style: TableStyle = "gto", dealSeed = 0,
): CallEstimate {
  validateEstimateInput(heroHole, board, fallbackNumOpponents, numSims, style);
  if (!Number.isFinite(quote.callCost) || quote.callCost < 0 || !Number.isFinite(quote.contestablePot) || quote.contestablePot < 0) throw new Error("The call quote must have finite, nonnegative chip amounts.");
  const seats = new Set(quote.layers.flatMap(layer => layer.eligibleOpponents));
  if (seats.size > 5 || quote.layers.some(layer => !Number.isFinite(layer.amount) || layer.amount < 0 || new Set(layer.eligibleOpponents).size !== layer.eligibleOpponents.length || layer.eligibleOpponents.some(seat => !Number.isSafeInteger(seat) || seat < 0))) throw new Error("Invalid opponents or amounts in the call quote.");
  if (quote.layers.length && Math.abs(quote.layers.reduce((sum, layer) => sum + layer.amount, 0) - quote.contestablePot) > 1e-9) throw new Error("Call layers must add to the reachable pot.");
  return callEstimate(heroHole, board, quote, fallbackNumOpponents, numSims, style, dealSeed, true);
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

// Determinism seam. The pure hand is replayed in a worker after every hero
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
const callEstimateCache = new Map<string, CallEstimate>();
const EQUITY_CACHE_CAP = 4000;
export function clearEquityCache() {
  equityCache.clear();
  callEstimateCache.clear();
}

// Average pot share across the simulations. Opponents are dealt from a
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

export function monteCarloCallEstimate(
  heroHole: CardObj[],
  board: CardObj[],
  quote: CallQuote,
  fallbackNumOpponents: number,
  numSims = 1000,
  style: TableStyle = "gto",
  dealSeed = 0,
): CallEstimate {
  return callEstimate(heroHole, board, quote, fallbackNumOpponents, numSims, style, dealSeed, false);
}

function callEstimate(
  heroHole: CardObj[], board: CardObj[], quote: CallQuote, fallbackNumOpponents: number,
  numSims: number, style: TableStyle, dealSeed: number, allowEnumeration: boolean,
): CallEstimate {
  const quotedSeats = [...new Set(quote.layers.flatMap(layer => layer.eligibleOpponents))].sort((a, b) => a - b);
  const opponentSeats = quote.layers.length > 0
    ? quotedSeats
    : Array.from({ length: Math.max(0, fallbackNumOpponents) }, (_, index) => index);
  const layers = quote.layers.length > 0
    ? quote.layers.map(layer => ({ amount: layer.amount, eligibleOpponents: [...layer.eligibleOpponents] }))
    : [{ amount: quote.contestablePot, eligibleOpponents: [...opponentSeats] }];
  const enumerate = allowEnumeration && board.length === 5 && opponentSeats.length <= 1;
  const layerKey = layers.map(layer => `${layer.amount}@${layer.eligibleOpponents.join(",")}`).join("|");
  const key = [
    enumerate ? "exact-call" : "call",
    dealSeed >>> 0,
    numSims,
    style,
    quote.callCost,
    quote.contestablePot,
    opponentSeats.join(","),
    layerKey,
    heroHole.map(ck).join(","),
    board.map(ck).join(","),
  ].join(":");
  const hit = callEstimateCache.get(key);
  if (hit !== undefined) return hit;

  let seed = spotSeed(dealSeed, heroHole, board, opponentSeats.length, style);
  for (const char of layerKey) seed = Math.imul(seed ^ char.charCodeAt(0), 2654435761) >>> 0;
  const result = simulateLayeredCall(heroHole, board, opponentSeats, layers, quote, numSims, style, mulberry32(seed), enumerate);
  if (callEstimateCache.size >= EQUITY_CACHE_CAP) callEstimateCache.clear();
  callEstimateCache.set(key, result);
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

function visitSimulationScores(
  heroHole: CardObj[],
  board: CardObj[],
  numOpponents: number,
  numSims: number,
  style: TableStyle,
  rng: () => number,
  visit: (heroScore: number, opponentScores: number[]) => void,
  enumerate = false,
): number {
  const allCards: CardObj[] = [];
  for (const s of ["♠", "♥", "♦", "♣"]) for (const r of RANKS) allCards.push({ rank: r, suit: s });
  const knownKeys = new Set([...heroHole, ...board].map(ck));
  const remaining = allCards.filter(c => !knownKeys.has(ck(c)));
  const boardNeeded = 5 - board.length;
  if (numSims <= 0 || remaining.length < numOpponents * 2 + boardNeeded) return 0;

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
    return 0;
  }

  if (enumerate) {
    if (board.length !== 5 || numOpponents > 1) throw new Error("Exact trainer enumeration requires a river and at most one opponent.");
    const heroScore = score7([...heroHole, ...board]);
    if (numOpponents === 0) { visit(heroScore, []); return 1; }
    for (const [first, second] of playablePairs) {
      visit(heroScore, [score7([remaining[first], remaining[second], ...board])]);
    }
    return playablePairs.length;
  }

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
    visit(heroSc, oppScores);
  }
  return numSims;
}

function shareAgainst(heroScore: number, opponentScores: number[]): number {
  if (opponentScores.length === 0) return 1;
  const bestOpponent = Math.max(...opponentScores);
  if (heroScore > bestOpponent) return 1;
  if (heroScore < bestOpponent) return 0;
  const tiedOpponents = opponentScores.filter(score => score === heroScore).length;
  return 1 / (tiedOpponents + 1);
}

function simulate(heroHole: CardObj[], board: CardObj[], numOpponents: number, numSims: number, style: TableStyle, rng: () => number, enumerate = false): EquityEstimate {
  // Welford's running method avoids subtracting two nearly equal totals.
  // That matters in forced chops: every trial has the same share, so the
  // sampling uncertainty should be exactly zero.
  let meanShare = 0;
  let m2 = 0;
  let visited = 0;
  const outcomeCounts = { all: 0, some: 0, none: 0 };
  const samples = visitSimulationScores(heroHole, board, numOpponents, numSims, style, rng, (heroScore, opponentScores) => {
    const share = shareAgainst(heroScore, opponentScores);
    if (share === 1) outcomeCounts.all += 1;
    else if (share > 0) outcomeCounts.some += 1;
    else outcomeCounts.none += 1;
    const sampleNumber = visited + 1;
    const delta = share - meanShare;
    meanShare += delta / sampleNumber;
    m2 += delta * (share - meanShare);
    visited = sampleNumber;
  }, enumerate);
  if (samples === 0) return {
    method: "sampled",
    equity: 0.5,
    standardError: 0,
    samples: 0,
    outcomes: { all: 0, some: 1, none: 0 },
  };
  return {
    method: enumerate ? "enumerated" : "sampled",
    equity: meanShare,
    standardError: enumerate ? 0 : standardErrorFromRunningVariance(m2, samples),
    samples,
    outcomes: {
      all: outcomeCounts.all / samples,
      some: outcomeCounts.some / samples,
      none: outcomeCounts.none / samples,
    },
  };
}

function simulateLayeredCall(
  heroHole: CardObj[],
  board: CardObj[],
  opponentSeats: number[],
  layers: Array<{ amount: number; eligibleOpponents: number[] }>,
  quote: CallQuote,
  numSims: number,
  style: TableStyle,
  rng: () => number,
  enumerate = false,
): CallEstimate {
  const opponentIndex = new Map(opponentSeats.map((seat, index) => [seat, index]));
  const layerMeans = layers.map(() => 0);
  let meanReturn = 0;
  let returnM2 = 0;
  let visited = 0;
  const outcomeCounts = { all: 0, some: 0, none: 0 };

  const samples = visitSimulationScores(heroHole, board, opponentSeats.length, numSims, style, rng, (heroScore, opponentScores) => {
    const layerShares = layers.map(layer => shareAgainst(
      heroScore,
      layer.eligibleOpponents.map(seat => opponentScores[opponentIndex.get(seat)!]),
    ));
    const totalReturn = layerShares.reduce((total, share, index) => total + share * layers[index].amount, 0);
    if (totalReturn === quote.contestablePot) outcomeCounts.all += 1;
    else if (totalReturn > 0) outcomeCounts.some += 1;
    else outcomeCounts.none += 1;
    const sampleNumber = visited + 1;
    layerShares.forEach((share, index) => {
      layerMeans[index] += (share - layerMeans[index]) / sampleNumber;
    });
    const delta = totalReturn - meanReturn;
    meanReturn += delta / sampleNumber;
    returnM2 += delta * (totalReturn - meanReturn);
    visited = sampleNumber;
  }, enumerate);

  if (samples === 0) {
    layerMeans.forEach((_, index) => {
      layerMeans[index] = layers[index].eligibleOpponents.length === 0 ? 1 : 0.5;
    });
    meanReturn = layerMeans.reduce((total, share, index) => total + share * layers[index].amount, 0);
  }
  const returnStandardError = enumerate ? 0 : standardErrorFromRunningVariance(returnM2, samples);
  const combinedShare = quote.contestablePot > 0 ? meanReturn / quote.contestablePot : 0;
  const expectedValue = meanReturn - quote.callCost;
  // Full enumeration has no sampling error, but accumulated chip means still
  // have floating-point roundoff. This tolerance is numerical, not statistical;
  // keep the raw EV unchanged so callers can inspect it.
  const closeTolerance = enumerate
    ? 64 * Number.EPSILON * Math.max(1, quote.contestablePot, quote.callCost)
    : 2 * returnStandardError;
  return {
    method: enumerate ? "enumerated" : "sampled",
    callCost: quote.callCost,
    contestablePot: quote.contestablePot,
    combinedShare,
    shareStandardError: quote.contestablePot > 0 ? returnStandardError / quote.contestablePot : 0,
    expectedReturn: meanReturn,
    returnStandardError,
    expectedValue,
    samples,
    isClose: Math.abs(expectedValue) <= closeTolerance,
    outcomes: samples > 0
      ? {
          all: outcomeCounts.all / samples,
          some: outcomeCounts.some / samples,
          none: outcomeCounts.none / samples,
        }
      : { all: 0, some: 1, none: 0 },
    layers: layers.map((layer, index) => ({
      amount: layer.amount,
      eligibleOpponents: [...layer.eligibleOpponents],
      meanShare: layerMeans[index],
      expectedReturn: layer.amount * layerMeans[index],
    })),
  };
}
