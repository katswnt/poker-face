import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import type { PlayDecisionView } from "../src/lib/hu-play/ui-controller";

async function api() {
  assert.ok(existsSync("src/lib/hu-play/decision-grade.ts"), "P5 needs a saved-policy action grade, not a live EV guess");
  return import("../src/lib/hu-play/decision-grade");
}
const root = () => initialPublicState({startingPot:550, startingStack:9750, minimumBet:100, flop:["Ks","7h","2d"]});
function decision(): PlayDecisionView {
  return {key:"root",actor:"human",public:root(),provenance:{source:"library",spotHash:"test",librarySpotId:"test"},
    strategy:[{action:{type:"check"},probability:0.9},{action:{type:"bet",to:200},probability:0.1}],
    actionEvs:[-5.2, 1.4],actionEvBasis:"original-saved-policy",humanActionMode:null};
}
const played = () => applyPublicEvent(root(), {kind:"action",player:0,action:{type:"check"}});

test("P5 saved grade uses the highest action EV, not the most frequent action or equity", async () => {
  const { gradeSavedDecision } = await api(), d = decision();
  const g = gradeSavedDecision(d, played());
  assert.equal(g.status,"ready"); if(g.status!=="ready") return;
  assert.deepEqual(g.action,{type:"check"}); assert.equal(g.selectedEvChips,-5.2); assert.equal(g.bestEvChips,1.4);
  assert.deepEqual(g.bestActions,[{type:"bet",to:200}]); assert.ok(Math.abs(g.gapChips-6.6)<1e-12);
  assert.equal(g.roundingBoundChips,0.1); assert.equal(g.basis,"original-saved-policy");
  const best = gradeSavedDecision(d,applyPublicEvent(root(),{kind:"action",player:0,action:{type:"bet",to:200}}));
  assert.equal(best.status,"ready"); if(best.status==="ready") assert.equal(best.gapChips,0);
  const tied = gradeSavedDecision({...d,actionEvs:[1.4,1.4]},played());
  assert.equal(tied.status,"ready"); if(tied.status==="ready") assert.equal(tied.bestActions.length,2);
});
test("P5 saved grade waits for an action and never grades unrelated or off-menu history", async () => {
  const { gradeSavedDecision } = await api(), d = decision();
  assert.equal(gradeSavedDecision(d,root()).status,"pending");
  const offMenu = applyPublicEvent(root(),{kind:"action",player:0,action:{type:"bet",to:201}});
  assert.deepEqual(gradeSavedDecision(d,offMenu),{status:"unavailable",reason:"off-menu"});
  const other = initialPublicState({...root(),flop:["As","7h","2d"]});
  assert.deepEqual(gradeSavedDecision(d,other),{status:"unavailable",reason:"history-mismatch"});
  const later = {...d,public:played()};
  assert.deepEqual(gradeSavedDecision(later,offMenu),{status:"unavailable",reason:"history-mismatch"});
});
test("P5 saved grade refuses missing or partial EVs, live solves, translation and AI-private grades", async () => {
  const { gradeSavedDecision } = await api(), d = decision();
  for(const actionEvs of [null, [-5.2,null],[-5.2],[-5.2,NaN],[-5.2,Infinity]]) {
    assert.equal(gradeSavedDecision({...d,actionEvs},played()).status,"unavailable");
  }
  assert.equal(gradeSavedDecision({...d,strategy:null},played()).status,"unavailable");
  assert.equal(gradeSavedDecision({...d,actor:"ai"},played()).status,"unavailable");
  assert.equal(gradeSavedDecision({...d,actionEvBasis:"not-exported"},played()).status,"unavailable");
  assert.equal(gradeSavedDecision({...d,provenance:{source:"translation",spotHash:"test",x:1,a:0.5,b:2,probabilityA:0.5,mappedTo:"a"}},played()).status,"unavailable");
});
