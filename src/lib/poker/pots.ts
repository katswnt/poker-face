// Pot distribution — correct side pots and split (chopped) pots.
//
// Replaces the old `stacks[winner] += pot`, which gave the entire pot to the single
// best hand: it ignored side pots (a short all-in could win chips it never matched) and
// never actually split ties even though the UI announced "Split pot". Because every chip
// a player commits is deducted from their stack, a player's total contribution this hand
// is simply startingStack − currentStack; that's all this needs.
import type { CardObj } from "./types";
import { evalHand, cmpK } from "./eval";

export interface RankedResult { idx: number; folded: boolean; hand: ReturnType<typeof evalHand> | null; }
export interface PotLayer { amount: number; eligible: number[]; winners: number[]; }
export interface PotDistribution { payouts: number[]; rankedResults: RankedResult[]; pots: PotLayer[]; }

// contributions[i] = total chips seat i put in this hand (folded players included).
// folded[i], hands[i] = hole cards, board = 5 community cards.
export function distributePots(
  contributions: number[],
  folded: boolean[],
  hands: CardObj[][],
  board: CardObj[],
): PotDistribution {
  const n = contributions.length;
  const payouts = new Array(n).fill(0);

  // Best-hand score per non-folded seat, precomputed once.
  const evals = hands.map((h, i) => (folded[i] ? null : evalHand([...h, ...board])));
  const beats = (a: number, b: number) => {
    const ea = evals[a]!, eb = evals[b]!;
    if (ea.rank !== eb.rank) return ea.rank - eb.rank;
    return cmpK(ea.kickers, eb.kickers);
  };

  // Distinct positive contribution levels, ascending — each defines one side-pot layer.
  const levels = [...new Set(contributions.filter(c => c > 0))].sort((a, b) => a - b);
  const pots: PotLayer[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    prev = level;
    const contributors = contributions.map((c, i) => (c >= level ? i : -1)).filter(i => i >= 0);
    const amount = layer * contributors.length;
    if (amount === 0) continue;

    // Eligible = contributors still in the hand. Fallback to any non-folded seat so chips
    // are never lost (only reachable if every contributor at this layer folded).
    let eligible = contributors.filter(i => !folded[i]);
    if (eligible.length === 0) eligible = contributions.map((_, i) => i).filter(i => !folded[i]);
    if (eligible.length === 0) { // no showdown players at all — return to contributors
      contributors.forEach(i => { payouts[i] += Math.floor(amount / contributors.length); });
      pots.push({ amount, eligible: [], winners: contributors });
      continue;
    }

    // Winners = best hand(s) among eligible.
    let winners = [eligible[0]];
    for (let k = 1; k < eligible.length; k++) {
      const cmp = beats(eligible[k], winners[0]);
      if (cmp > 0) winners = [eligible[k]];
      else if (cmp === 0) winners.push(eligible[k]);
    }

    // Split evenly; distribute odd chips one at a time in seat order (deterministic).
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    const ordered = [...winners].sort((a, b) => a - b);
    for (const w of ordered) { payouts[w] += share; if (odd > 0) { payouts[w] += 1; odd--; } }
    pots.push({ amount, eligible, winners: ordered });
  }

  const rankedResults: RankedResult[] = contributions
    .map((_, i) => ({ idx: i, folded: !!folded[i], hand: evals[i] }))
    .filter(r => !r.folded)
    .sort((a, b) => (a.hand!.rank !== b.hand!.rank ? b.hand!.rank - a.hand!.rank : cmpK(b.hand!.kickers, a.hand!.kickers)));

  return { payouts, rankedResults, pots };
}
