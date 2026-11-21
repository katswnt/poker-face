// Offline enumeration only. Relative range weights are conditioned on the known cards.
import { score7 } from "../../poker/score7";
import { RIVER_DECK, riverCardObject, type RiverCard, type RiverCombo } from "../../solver/river/cards";
import { parseEquityInput, type EquityCase } from "./model";
export interface EquityOutcome { readonly cards: RiverCombo; readonly river: RiverCard | null; readonly heroScore: number; readonly opponentScore: number; }
export function enumerateEquityCase(value: unknown, visit?: (outcome: EquityOutcome)=>void): EquityCase {
  const input = parseEquityInput(value), known = new Set([...input.hero,...input.board]);
  const rows = input.range.map(({cards,weight}) => {
    const blockedBy = cards.filter(c=>known.has(c));
    let wins=0,ties=0,losses=0;
    if (!blockedBy.length) {
      const rivers = input.board.length===5 ? [null] : RIVER_DECK.filter(c=>!known.has(c)&&!cards.includes(c));
      for (const river of rivers) {
        const board = river ? [...input.board,river] : input.board;
        const heroScore = score7([...input.hero,...board].map(riverCardObject));
        const opponentScore = score7([...cards,...board].map(riverCardObject));
        if (heroScore>opponentScore) wins++; else if (heroScore===opponentScore) ties++; else losses++;
        visit?.({cards,river,heroScore,opponentScore});
      }
    }
    return {cards,weight,blockedBy,wins,ties,losses,runouts:wins+ties+losses};
  });
  const weightSum=rows.reduce((n,r)=>n+(r.runouts?r.weight:0),0), outcomeCount=rows.reduce((n,r)=>n+r.runouts,0);
  const weightedWins=rows.reduce((n,r)=>n+r.weight*r.wins,0),weightedTies=rows.reduce((n,r)=>n+r.weight*r.ties,0),weightedLosses=rows.reduce((n,r)=>n+r.weight*r.losses,0);
  const weightedOutcomes=weightedWins+weightedTies+weightedLosses;
  return {input,rows,weightSum,outcomeCount,weightedWins,weightedTies,weightedLosses,weightedOutcomes,numerator:2*weightedWins+weightedTies,denominator:2*weightedOutcomes};
}
