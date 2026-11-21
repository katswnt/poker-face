// Independent audit path: its own deck/card conversion and 21-subset best-five evaluator.
// No fast evaluator, enumeration helper, blocker helper or aggregation helper is imported.
import { handScore } from "../src/lib/poker/eval";
import type { EquityInput, EquityCase, EquityRow } from "../src/lib/drills/equity-range/model";
import type { CardObj } from "../src/lib/poker/types";
const card = (text:string):CardObj => ({rank:text[0]==="T"?"10":text[0],suit:({c:"♣",d:"♦",h:"♥",s:"♠"} as Record<string,string>)[text[1]]});
export function independentEquityCase(input:EquityInput):{result:EquityCase;scores:Record<string,readonly number[]>} {
  const deck:string[]=[];for(const rank of "23456789TJQKA")for(const suit of "cdhs")deck.push(rank+suit);
  const rows:EquityRow[]=[],scores:Record<string,readonly number[]>={};
  let weightSum=0,outcomeCount=0,weightedWins=0,weightedTies=0,weightedLosses=0;
  for(const entry of input.range){
    const blockedBy=entry.cards.filter(c=>[...input.hero,...input.board].includes(c));
    let wins=0,ties=0,losses=0;
    if(!blockedBy.length){
      weightSum+=entry.weight;
      const rivers:(string|null)[]=input.board.length===5?[null]:deck.filter(c=>![...input.hero,...input.board,...entry.cards].some(dead=>dead===c));
      for(const river of rivers){
        const board=river?[...input.board,river]:[...input.board];
        const hero=handScore(input.hero.map(card),board.map(card)),other=handScore(entry.cards.map(card),board.map(card));
        scores[`${[...entry.cards].sort().join("")}|${river??"river"}`]=[hero,other];
        outcomeCount++;
        if(hero===other){ties++;weightedTies+=entry.weight;}else if(hero>other){wins++;weightedWins+=entry.weight;}else{losses++;weightedLosses+=entry.weight;}
      }
    }
    rows.push({...entry,blockedBy,wins,ties,losses,runouts:wins+ties+losses});
  }
  const weightedOutcomes=weightedWins+weightedTies+weightedLosses;
  return {result:{input,rows,weightSum,outcomeCount,weightedWins,weightedTies,weightedLosses,weightedOutcomes,numerator:weightedWins*2+weightedTies,denominator:weightedOutcomes*2},scores};
}
