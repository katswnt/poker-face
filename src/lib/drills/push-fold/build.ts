import { HANDS } from "../../solver/hands";
import type { Level, Question } from "../practice-types";
import { PRACTICE_TOLERANCE_BB, type PushFoldDepth, type PushFoldGrade, type Seat } from "./model";
import manifest from "./manifest.json";

export function gradePushFoldAction(evBb: number, bestBb: number, frequency: number): PushFoldGrade {
  const lossBb = Math.max(0,bestBb-evBb);
  return {evBb,lossBb,frequency,correct:lossBb <= PRACTICE_TOLERANCE_BB + 1e-9};
}
export function buildPushFoldQuestion(profile: PushFoldDepth, seat: Seat, hand: number, seed: number, level: Level): Question {
  const row = profile[seat][hand];
  if(!row)throw new Error("This push/fold decision cannot be reached.");
  const S = profile.stack, hero = HANDS[hand], active = seat === "sb" ? "shove" : "call";
  const best = Math.max(0,row.evBb), bestId = row.evBb > 0 ? active : "fold";
  const grades = {fold:gradePushFoldAction(0,best,1-row.frequency),[active]:gradePushFoldAction(row.evBb,best,row.frequency)};
  const options = [{id:"fold",label:"Fold"},{id:active,label:seat === "sb" ? "Shove all-in" : "Call all-in"}];
  const reviewKey = `${manifest.datasetId}|${S.toFixed(1)}|${seat}|${hand}`;
  return {
    id:`push-fold:${reviewKey}`,type:"push-fold",level,seed:seed>>>0,reviewKey,
    prompt:seat === "sb" ? `You act first with ${hero.label}. Fold or shove?` : `You face an all-in with ${hero.label}. Fold or call?`,
    facts:[{label:"Your hand",value:hero.label},{label:"Your seat",value:seat === "sb" ? "Small blind · acts first" : "Big blind · acts second"},
      {label:"Starting stacks",value:`${S} bb each, before blinds`},{label:"Blinds",value:"0.5 / 1 bb · no ante or rake"},
      {label:"Pot now",value:`${seat === "sb" ? 1.5 : S+1} bb`},{label:seat === "sb" ? "Chips left to shove" : "Price to call",value:`${seat === "sb" ? S-0.5 : S-1} bb`}],
    hole:hero.combo,answer:{kind:"push-fold",value:bestId,options,grades},speedTargetMs:20000,
    explanation:{
      formula:seat === "sb" ? "Shove value = fold chance × 1.5 bb + call chance × (final pot × equity if called − chips left to shove)" : "Call value = final pot × equity against the shoving range − price to call",
      plugged:seat === "sb" ? `${row.foldProbability!.toFixed(6)} × 1.5 + ${(1-row.foldProbability!).toFixed(6)} × (${2*S} × ${row.equity?.toFixed(6) ?? "unreached"} − ${S-0.5})` : `${2*S} × ${row.equity!.toFixed(6)} − ${S-1}`,
      result:`${row.evBb.toFixed(3)} bb relative to folding now (rounded)`,
      shortcut:seat === "sb" ? "A shove can win the blinds without a showdown. When called, compare your share of the final pot with the chips you still put in." : "Divide the call price by the final pot. Your equity against the opponent's shoving hands must beat that price.",
      shortcutApproximate:false,note:"Posted blinds are already spent. Folding is the zero baseline here; these values are not your profit from the start of the hand.",
    },params:{stack:S,seat,hand,datasetId:manifest.datasetId},
    pushFold:{datasetId:manifest.datasetId,stack:S,seat,hand:hero.label,equity:row.equity,foldProbability:row.foldProbability,
      requiredEquity:seat === "bb" ? (S-1)/(2*S) : null,nashGapBb:profile.nashGapBb,gapBb:Math.abs(row.evBb),
      actions:options.map(o=>({...o,grade:grades[o.id]}))},
  };
}
