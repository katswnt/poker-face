// Heads-up preflop push/fold Nash equilibrium solver.
//
// The game: the Small Blind (button, on the button heads-up) is first to act with an
// effective stack of S big blinds. It may open-shove all-in for S, or fold. Facing a shove,
// the Big Blind may call (also all-in for S) or fold. Blinds are SB=0.5, BB=1.0.
//
// This is the classic "jam-or-fold" abstraction: with a short stack there is no room to play
// post-flop, so the entire game tree is two binary decisions and the equilibrium is a pair
// of ranges. It has an exact, computable Nash solution that matches published charts
// (Nash / HoldemResources / SnapShove) — the point of this module.
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
// Card removal between the two specific hands is not modeled (standard textbook simplification;
// ranges are weighted by unconditional combo counts). This keeps the model transparent and
// still reproduces published Nash ranges to within a hand or two at every depth.
//
// Solved by fictitious play: each player best-responds to the running time-average of the
// opponent's strategy. In a finite zero-sum game this is guaranteed to converge to the Nash
// equilibrium, and the time-averaged strategies naturally express mixed (fractional)
// frequencies for threshold hands.
import equityData from "./equity-matrix.json";
import { HANDS, TOTAL_COMBOS } from "./hands";

// Row = SB hand's equity vs. Col = BB hand. eq[k][h] = 1 − eq[h][k] (zero-sum, by construction).
const EQ: number[][] = equityData.equity;
const N = HANDS.length; // 169
const W: number[] = HANDS.map(h => h.weight);

export interface PushFoldSolution {
  stack: number;                 // effective stack S in BB
  sb: number;                    // small blind (0.5)
  bb: number;                    // big blind (1.0)
  rounds: number;                // fictitious-play iterations run
  sbShove: number[];             // per-hand SB shove frequency [0,1], indexed like HANDS
  bbCall: number[];              // per-hand BB call frequency  [0,1], indexed like HANDS
  sbShovePct: number;            // combo-weighted % of hands SB shoves
  bbCallPct: number;             // combo-weighted % of hands BB calls
}

// Combo-weighted fraction (0..1) of the range that a per-hand frequency vector covers.
function rangeWidth(freq: number[]): number {
  let num = 0;
  for (let i = 0; i < N; i++) num += W[i] * freq[i];
  return num / TOTAL_COMBOS;
}

export function solvePushFold(
  stack: number,
  { sb = 0.5, bb = 1.0, rounds = 1200 }: { sb?: number; bb?: number; rounds?: number } = {},
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
    // EV_shove(h) = Σ_k W_k[ c_k·2S·eq(h,k) + (1−c_k)·(S+bb) ] / TOTAL_COMBOS
    let wCalled = 0;              // Σ_k W_k·c_k
    for (let k = 0; k < N; k++) wCalled += W[k] * bbAvg[k];
    const wFolded = TOTAL_COMBOS - wCalled;
    const foldTerm = (S + bb) * wFolded; // BB folds → SB wins the big blind
    for (let h = 0; h < N; h++) {
      let calledTerm = 0;
      const row = EQ[h];
      for (let k = 0; k < N; k++) calledTerm += W[k] * bbAvg[k] * row[k];
      const evShove = (foldTerm + potShare * calledTerm) / TOTAL_COMBOS;
      sbBR[h] = evShove > evFold_SB ? 1 : 0;
    }

    // ── BB best-responds to SB's average shoving strategy ──
    // Given a shove, P(SB = h) ∝ W_h·s_h. EV_call(k) = 2S·Σ_h P(SB=h)·eq(k,h).
    let shoveMass = 0;           // Σ_h W_h·s_h
    for (let h = 0; h < N; h++) shoveMass += W[h] * sbAvg[h];
    for (let k = 0; k < N; k++) {
      if (shoveMass === 0) { bbBR[k] = 0; continue; } // nothing to call
      let eqSum = 0;
      for (let h = 0; h < N; h++) {
        if (sbAvg[h] === 0) continue;
        eqSum += W[h] * sbAvg[h] * (1 - EQ[h][k]); // eq(k,h) = 1 − eq(h,k)
      }
      const avgEq = eqSum / shoveMass;
      const evCall = potShare * avgEq;
      bbBR[k] = evCall > evFold_BB ? 1 : 0;
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

  return {
    stack: S, sb, bb, rounds,
    sbShove, bbCall,
    sbShovePct: rangeWidth(sbShove) * 100,
    bbCallPct: rangeWidth(bbCall) * 100,
  };
}
