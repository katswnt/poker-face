// Heads-up preflop push/fold strategy solver for a simplified game.
//
// The game: the Small Blind (button, on the button heads-up) is first to act with an
// effective stack of S big blinds. It may open-shove all-in for S, or fold. Facing a shove,
// the Big Blind may call (also all-in for S) or fold. Blinds are SB=0.5, BB=1.0.
//
// This is the classic "jam-or-fold" abstraction: with a short stack there is no room to play
// post-flop, so the entire game tree is two binary decisions and the equilibrium is a pair
// of ranges. This module approximates a stable strategy for that simplified game.
//
// EV model (chip-EV, in big blinds), for SB hand h and BB hand k:
//   SB folds:                 SB stack → S − 0.5                    (loses the small blind)
//   SB shoves, BB folds:      SB stack → S + 1.0                    (wins the big blind)
//   SB shoves, BB calls:      pot = 2S, split by equity → SB gets 2S·eq(h,k), BB gets 2S·eq(k,h)
//   BB folds to a shove:      BB stack → S − 1.0
// So the best-response thresholds are:
//   SB shoves h  ⟺  EV_shove(h) > S − 0.5
//   BB calls  k  ⟺  2S·avgEq(k) > S − 1.0     (avgEq over SB's actual shoving distribution)
//
// Card removal: both hands come from one deck, so the joint probability of (SB class h,
// BB class k) is D[h][k] / 1,624,350, where D counts ORDERED card-disjoint combo pairs
// (comboCounts.ts). SB holding h therefore faces BB class k with probability
// D[h][k] / (weight_h · 1,225), and BB holding k faces SB class h with probability ∝ D[h][k]·s_h.
// eq(h,k) is the exact equity averaged over those same disjoint combo pairs
// (scripts/build-equity-matrix.ts), so the matrix and the weights use one measure.
// Remaining model limit: strategies are per canonical class, not per suited combo.
//
// Solved by fictitious play: each player best-responds to the running time-average of the
// opponent's strategy. In a finite zero-sum game this is guaranteed to converge to the Nash
// equilibrium, and the time-averaged strategies naturally express mixed (fractional)
// frequencies for threshold hands.
import equityData from "./equity-matrix.json";
import { HANDS, TOTAL_COMBOS } from "./hands";
import { DISJOINT, ORDERED_DISJOINT_PAIRS } from "./comboCounts";

// Row = SB hand's equity vs. Col = BB hand. eq[k][h] = 1 − eq[h][k] (zero-sum, by construction).
const EQ: number[][] = equityData.equity;
const N = HANDS.length; // 169
const W: number[] = HANDS.map(h => h.weight);
const D: number[][] = DISJOINT;
// Σ_k D[h][k] = weight_h · 1,225: the number of BB combos compatible with each SB combo.
const ROW_MASS: number[] = D.map(row => row.reduce((a, b) => a + b, 0));

export interface PushFoldSolution {
  stack: number;                 // effective stack S in BB
  sb: number;                    // small blind (0.5)
  bb: number;                    // big blind (1.0)
  rounds: number;                // fictitious-play iterations run
  sbShove: number[];             // per-hand SB shove frequency [0,1], indexed like HANDS
  bbCall: number[];              // per-hand BB call frequency  [0,1], indexed like HANDS
  sbShovePct: number;            // combo-weighted % of hands SB shoves
  bbCallPct: number;             // combo-weighted % of hands BB calls
  nashGap: number;               // total gain available from both players changing strategy, in BB
  sbImprovement: number;         // gain available to SB by changing alone, in BB
  bbImprovement: number;         // gain available to BB by changing alone, in BB
  tolerance: number;             // algorithmic convergence target for the fixed input matrix
  converged: boolean;
  matrixSamples: number;         // boards behind each matrix cell (all C(48,5) = 1,712,304: exact)
  cardRemoval: boolean;          // ranges weighted by card-disjoint combo pairs
}

// Combo-weighted fraction (0..1) of the range that a per-hand frequency vector covers.
function rangeWidth(freq: number[]): number {
  let num = 0;
  for (let i = 0; i < N; i++) num += W[i] * freq[i];
  return num / TOTAL_COMBOS;
}

// SB's expected final stack when shoving h against BB calling strategy c (card-removal weighted).
function shoveValue(h: number, bbStrategy: number[], stack: number, bigBlind: number): number {
  const row = D[h], eq = EQ[h];
  let value = 0;
  for (let k = 0; k < N; k++) {
    if (row[k] === 0) continue;
    value += row[k] * (bbStrategy[k] * 2 * stack * eq[k] + (1 - bbStrategy[k]) * (stack + bigBlind));
  }
  return value / ROW_MASS[h];
}

// SB's expected final stack for a full strategy profile, over the joint deal of both hands.
export function sbPayoff(
  sbStrategy: number[],
  bbStrategy: number[],
  stack: number,
  smallBlind: number,
  bigBlind: number,
): number {
  const foldValue = stack - smallBlind;
  let total = 0;
  for (let h = 0; h < N; h++) {
    const own = (1 - sbStrategy[h]) * foldValue + sbStrategy[h] * shoveValue(h, bbStrategy, stack, bigBlind);
    total += ROW_MASS[h] * own; // P(SB = h) = ROW_MASS[h] / ORDERED_DISJOINT_PAIRS = weight_h / 1326
  }
  return total / ORDERED_DISJOINT_PAIRS;
}

export function sbBestResponse(bbStrategy: number[], stack: number, smallBlind: number, bigBlind: number): number[] {
  return HANDS.map((_, h) => (shoveValue(h, bbStrategy, stack, bigBlind) > stack - smallBlind ? 1 : 0));
}

export function bbBestResponse(sbStrategy: number[], stack: number, bigBlind: number): number[] {
  const calledPot = 2 * stack;
  return HANDS.map((_, k) => {
    let shoveMass = 0, equityWhenCalled = 0;
    for (let h = 0; h < N; h++) {
      const m = D[h][k] * sbStrategy[h];
      shoveMass += m;
      equityWhenCalled += m * (1 - EQ[h][k]);
    }
    if (shoveMass === 0) return 0;
    return calledPot * (equityWhenCalled / shoveMass) > stack - bigBlind ? 1 : 0;
  });
}

export function solvePushFold(
  stack: number,
  { sb = 0.5, bb = 1.0, rounds = 20_000, tolerance = 0.0005 }: { sb?: number; bb?: number; rounds?: number; tolerance?: number } = {},
): PushFoldSolution {
  const S = stack;
  const evFold_SB = S - sb;   // SB's stack if it folds
  const evFold_BB = S - bb;   // BB's stack if it folds to a shove
  const potShare = 2 * S;     // total pot when both are all-in

  // Time-averaged strategies (what each player best-responds to).
  const sbAvg = new Array(N).fill(0);
  const bbAvg = new Array(N).fill(0);
  // Best-response buffers (pure 0/1 each round).
  const sbBR = new Array(N).fill(0);
  const bbBR = new Array(N).fill(0);

  for (let t = 0; t < rounds; t++) {
    // ── SB best-responds to BB's average calling strategy ──
    // EV_shove(h) = Σ_k D[h][k]·[ c_k·2S·eq(h,k) + (1−c_k)·(S+bb) ] / Σ_k D[h][k]
    for (let h = 0; h < N; h++) {
      const row = D[h], eq = EQ[h];
      let calledTerm = 0, foldedMass = 0;
      for (let k = 0; k < N; k++) {
        const m = row[k] * bbAvg[k];
        calledTerm += m * eq[k];
        foldedMass += row[k] - m;
      }
      const evShove = (potShare * calledTerm + (S + bb) * foldedMass) / ROW_MASS[h];
      sbBR[h] = evShove > evFold_SB ? 1 : 0;
    }

    // ── BB best-responds to SB's average shoving strategy ──
    // Given a shove and BB holding k, P(SB = h) ∝ D[h][k]·s_h. EV_call(k) = 2S·Σ_h P(h|k)·eq(k,h).
    for (let k = 0; k < N; k++) {
      let shoveMass = 0, eqSum = 0;
      for (let h = 0; h < N; h++) {
        if (sbAvg[h] === 0) continue;
        const m = D[h][k] * sbAvg[h];
        shoveMass += m;
        eqSum += m * (1 - EQ[h][k]); // eq(k,h) = 1 − eq(h,k)
      }
      bbBR[k] = shoveMass > 0 && potShare * (eqSum / shoveMass) > evFold_BB ? 1 : 0;
    }

    // Fold the pure best responses into the running time-averages.
    const w = 1 / (t + 1);
    for (let i = 0; i < N; i++) {
      sbAvg[i] += (sbBR[i] - sbAvg[i]) * w;
      bbAvg[i] += (bbBR[i] - bbAvg[i]) * w;
    }
  }

  // Snap tiny numerical dust to clean 0/1 so displayed ranges are crisp.
  const clean = (x: number) => (x < 1e-3 ? 0 : x > 1 - 1e-3 ? 1 : x);
  const sbShove = sbAvg.map(clean);
  const bbCall = bbAvg.map(clean);
  const profileValue = sbPayoff(sbShove, bbCall, S, sb, bb);
  const bestSbValue = sbPayoff(sbBestResponse(bbCall, S, sb, bb), bbCall, S, sb, bb);
  const worstBbValue = sbPayoff(sbShove, bbBestResponse(sbShove, S, bb), S, sb, bb);
  const sbImprovement = Math.max(0, bestSbValue - profileValue);
  const bbImprovement = Math.max(0, profileValue - worstBbValue);
  const nashGap = sbImprovement + bbImprovement;

  return {
    stack: S, sb, bb, rounds,
    sbShove, bbCall,
    sbShovePct: rangeWidth(sbShove) * 100,
    bbCallPct: rangeWidth(bbCall) * 100,
    nashGap,
    sbImprovement,
    bbImprovement,
    tolerance,
    converged: nashGap <= tolerance,
    matrixSamples: equityData.meta.boardsPerMatchup,
    cardRemoval: true,
  };
}
