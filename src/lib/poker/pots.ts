// Pot distribution — correct side pots and split (chopped) pots.
//
// Replaces the old `stacks[winner] += pot`, which gave the entire pot to the single
// best hand: it ignored side pots (a short all-in could win chips it never matched) and
// never actually split ties even though the UI announced "Split pot". The betting engine
// now passes an explicit contribution ledger into this module for every chip.
import type { CardObj, PotAward, PotLayer, RankedResult } from "./types";
import { bestHand, cmpK } from "./eval";

export interface PotDistribution { payouts: number[]; rankedResults: RankedResult[]; pots: PotLayer[]; }

// contributions[i] = total chips seat i put in this hand (folded players included).
// folded[i], hands[i] = hole cards, board = 5 community cards.
export function distributePots(
  contributions: number[],
  folded: boolean[],
  hands: CardObj[][],
  board: CardObj[],
  awardOrder: number[] = contributions.map((_, i) => i),
): PotDistribution {
  const n = contributions.length;
  const payouts = new Array(n).fill(0);

  // Best-hand score per non-folded seat, precomputed once.
  const evals = hands.map((h, i) => (folded[i] ? null : bestHand(h, board)));
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

    // A layer only one seat reached is an uncalled excess: nobody matched it, so it goes
    // back to its owner even if that seat folded (e.g. a SB above a short all-in BB).
    if (contributors.length === 1) {
      const [owner] = contributors;
      payouts[owner] += amount;
      pots.push({ amount, contributors, eligible: folded[owner] ? [] : [owner], winners: [owner], awards: [{ idx: owner, amount }] });
      continue;
    }

    // Eligible = contributors still in the hand. Fallback to any non-folded seat so chips
    // are never lost (only reachable if every contributor at this layer folded).
    let eligible = contributors.filter(i => !folded[i]);
    if (eligible.length === 0) eligible = contributions.map((_, i) => i).filter(i => !folded[i]);
    if (eligible.length === 0) { // no showdown players at all — return to contributors
      const refund = Math.floor(amount / contributors.length);
      const orderedContributors = orderSeats(contributors, awardOrder);
      const awards = orderedContributors.map(idx => ({ idx, amount: refund }));
      awards.forEach(({ idx, amount: award }) => { payouts[idx] += award; });
      pots.push({ amount, contributors, eligible: [], winners: orderedContributors, awards });
      continue;
    }

    // Winners = best hand(s) among eligible.
    let winners = [eligible[0]];
    for (let k = 1; k < eligible.length; k++) {
      const cmp = beats(eligible[k], winners[0]);
      if (cmp > 0) winners = [eligible[k]];
      else if (cmp === 0) winners.push(eligible[k]);
    }

    // Split evenly; distribute odd chips one at a time in the caller's table order.
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    const ordered = orderSeats(winners, awardOrder);
    const awards: PotAward[] = [];
    for (const w of ordered) {
      const award = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      payouts[w] += award;
      awards.push({ idx: w, amount: award });
    }
    pots.push({ amount, contributors, eligible, winners: ordered, awards });
  }

  const rankedResults: RankedResult[] = contributions
    .map((_, i) => ({ idx: i, folded: !!folded[i], hand: evals[i] }))
    .filter(r => !r.folded)
    .sort((a, b) => (a.hand!.rank !== b.hand!.rank ? b.hand!.rank - a.hand!.rank : cmpK(b.hand!.kickers, a.hand!.kickers)));

  return { payouts, rankedResults, pots };
}

function orderSeats(seats: number[], awardOrder: number[]): number[] {
  const priority = new Map(awardOrder.map((seat, index) => [seat, index]));
  return [...seats].sort((a, b) => (priority.get(a) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b) ?? Number.MAX_SAFE_INTEGER) || a - b);
}
