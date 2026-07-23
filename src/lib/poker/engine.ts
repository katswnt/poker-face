// One betting round — shared by preflop and postflop.
//
// This used to exist twice: an inline loop for preflop (with blinds pre-posted and a
// raise counter) and a near-identical `runBettingRound` for postflop. Two copies of the
// same chip-accounting logic is exactly how subtle money bugs creep in, so it's unified
// here. Decision-making is INJECTED (`decide`) rather than imported, which keeps this
// module pure and lets the tests drive it with scripted actions.
import type { CardObj, Decision, PlayerInfo, Stage } from "./types";

export interface DecideArgs {
  pi: number; pot: number; currentBet: number; playerBet: number;
  stack: number; numActive: number; raiseCount: number;
}

export interface BettingParams {
  order: number[];              // seats to act, in order
  hands: CardObj[][];           // hole cards per seat (for stage snapshots)
  board: CardObj[];
  street: string;
  players: PlayerInfo[];        // for the safety-cap diagnostic only
  pot: number;
  folded: boolean[];
  stacks: number[];
  bets: number[];               // chips already in front per seat this street (blinds preflop)
  currentBet: number;           // highest bet to match (BB preflop, 0 postflop)
  raiseCount: number;           // raises so far this street (preflop feeds numRaisesAhead)
  countRaises: boolean;         // whether a new bet/raise increments raiseCount
  heroIdx: number | null;
  heroChoices: Decision[];      // hero's recorded choices, consumed by index
  heroActionStart: number;      // index into heroChoices where this round begins
  decide: (a: DecideArgs) => Decision;
}

export interface BettingResult {
  stages: Stage[]; pot: number; folded: boolean[]; stacks: number[];
  bets: number[]; currentBet: number; heroActionsConsumed: number; raiseCount: number;
}

export function runBettingRound(params: BettingParams): BettingResult {
  const { order, hands, board, street, players, heroIdx, heroChoices, heroActionStart, decide, countRaises } = params;
  const stages: Stage[] = [];
  const f = [...params.folded];
  const s = [...params.stacks];
  const bets = [...params.bets];
  let p = params.pot;
  let currentBet = params.currentBet;
  let raiseCount = params.raiseCount;

  const needsAction = [false, false, false, false];
  order.forEach(i => { if (!f[i]) needsAction[i] = true; });
  let safety = 0, orderIdx = 0;
  let heroCount = heroActionStart;

  while (needsAction.some(Boolean) && safety < 40) {
    if (safety === 39) console.error("[runBettingRound] safety cap hit — betting loop truncated", { street, seats: order.map(i => players[i]?.posShort), bets, currentBet });
    safety++;
    const pi = order[orderIdx % order.length];
    orderIdx++;
    if (!needsAction[pi] || f[pi]) { needsAction[pi] = false; continue; }
    if (s[pi] <= 0) { needsAction[pi] = false; continue; }   // already all-in
    if (f.filter(x => !x).length <= 1) break;                // everyone else folded

    const isHero = heroIdx !== null && pi === heroIdx;
    const aiDec = decide({ pi, pot: p, currentBet, playerBet: bets[pi], stack: s[pi], numActive: f.filter(x => !x).length, raiseCount });
    const decision = isHero && heroChoices[heroCount] ? heroChoices[heroCount] : aiDec;
    if (isHero) heroCount++;
    needsAction[pi] = false;

    const preBets = [...bets];
    const preCurrentBet = currentBet;
    const prePot = p;
    const preStacks = [...s];

    if (decision.action === "fold") {
      f[pi] = true;
    } else if (decision.action === "call" || decision.action === "check") {
      const cost = Math.min(currentBet - bets[pi], s[pi]);
      p += cost; s[pi] -= cost; bets[pi] += cost;
    } else if (decision.action === "bet" || decision.action === "raise") {
      const desired = Math.round(decision.amount != null ? decision.amount : currentBet * 2);
      const maxCommit = s[pi] + bets[pi];
      const newBet = Math.min(desired, maxCommit);
      const additional = newBet - bets[pi];
      if (additional > 0 && newBet > currentBet) {
        p += additional; s[pi] -= additional; bets[pi] = newBet; currentBet = newBet;
        order.forEach(j => { if (j !== pi && !f[j]) needsAction[j] = true; }); // raise re-opens action
        if (countRaises) raiseCount++;
      } else {
        // Can't legally raise (short stack / not enough) — treat as a call.
        const cost = Math.min(currentBet - bets[pi], s[pi]);
        if (cost > 0) { p += cost; s[pi] -= cost; bets[pi] += cost; }
      }
    }

    stages.push({ type: "action", street, playerIdx: pi, board: [...board], pot: prePot, bets: preBets, folded: [...f], decision, aiDecision: isHero ? aiDec : undefined, currentBet: preCurrentBet, stacks: preStacks, holeCards: hands[pi] });
  }

  return { stages, pot: p, folded: f, stacks: s, bets, currentBet, heroActionsConsumed: heroCount - heroActionStart, raiseCount };
}
