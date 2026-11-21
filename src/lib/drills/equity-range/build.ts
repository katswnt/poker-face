import {riverCardObject} from "../../solver/river/cards";
import type {Question} from "../practice-types";
import type {EquityCase} from "./model";
import manifest from "./manifest.json";
export function buildEquityRangeQuestion(result:EquityCase,seed:number):Question {
  const {input,numerator,denominator,weightedWins,weightedTies,weightedOutcomes}=result;
  const percent=100*numerator/denominator,reviewKey=`${manifest.datasetId}|${input.id}`;
  return {
    id:`equity-range:${reviewKey}`,type:"equity-range",level:input.level,seed:seed>>>0,reviewKey,
    prompt:"What is your equity against these possible hands?",
    facts:[{label:"Your hand",value:input.hero.join(" ")},{label:"Board",value:input.board.join(" ")},
      {label:"Cards still to come",value:input.board.length===4?"One river card":"None · river"}],
    hole:input.hero.map(riverCardObject),board:input.board.map(riverCardObject),
    answer:{kind:"percent",value:percent,tolerance:2},speedTargetMs:30000,
    explanation:{formula:"Equity = (weighted wins + half of weighted splits) ÷ weighted outcomes",
      plugged:`(${weightedWins} + ${weightedTies} ÷ 2) ÷ ${weightedOutcomes} = ${numerator} ÷ ${denominator}`,
      result:`${percent.toFixed(2)}% (rounded); exact pot-share fraction ${numerator}/${denominator}`,
      shortcut:input.board.length===5?"On the river, compare your best five cards with each possible hand. Count a split pot as half a win, then average using the remaining weights.":"On the turn, a card that improves you can also improve the opponent. Compare both completed hands on every possible river; counting your own outs alone can miss this.",
      shortcutApproximate:false,note:"This is your average share of the pot if no more bets are made. It is not a call value, a recommendation to call, or a prediction of an opponent's strategy. The hand-written range is a practice assumption.",
    },params:{caseId:input.id,datasetId:manifest.datasetId},equityRange:{datasetId:manifest.datasetId,result},
  };
}
