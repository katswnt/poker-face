import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { initialPublicState, illegalActionReason } from "../src/lib/hu-play/public-state";
import type { PlayView } from "../src/lib/hu-play/ui-controller";
test("P5 freezes 200 consecutive seeds, both seats and the scripted-human rule before measurement", async () => {
  assert.ok(existsSync("scripts/hu-play-p5-human.ts"), "P5 needs a frozen UI-layer corpus contract");
  const { P5_UI_CORPUS, p5HumanAction } = await import("../scripts/hu-play-p5-human");
  assert.equal(P5_UI_CORPUS.cases.length, 200);
  assert.deepEqual(P5_UI_CORPUS.cases.map(c => c.seed), Array.from({length: 200}, (_, i) => i));
  assert.equal(P5_UI_CORPUS.cases.filter(c => c.humanSeat === 0).length, 100);
  const p = initialPublicState({startingPot: 550, startingStack: 9750, minimumBet: 100, flop: ["Ks", "7h", "2d"]});
  const view: PlayView = {phase: "human", message: "Your turn", progress: null, ledger: [],
    hand: {seed: 0, humanSeat: 0, humanHand: "AsAd", aiHand: null, public: p, finalStacks: null},
    decisions: [{key:"root", actor:"human", public:p, strategy:[{action:{type:"check"}, probability:1}, {action:{type:"bet",to:363},probability:0}],
      provenance:{source:"library",librarySpotId:"test",spotHash:"0".repeat(64)},actionEvs:null,actionEvBasis:"not-exported",humanActionMode:null}]};
  assert.deepEqual(p5HumanAction(view), {type:"bet",to:9750});
  const off = p5HumanAction({...view,hand:{...view.hand!,seed:1}});
  assert.deepEqual(off,{type:"bet",to:237}); assert.equal(illegalActionReason(p, off), null);
  for (const seed of [2,3,4]) assert.deepEqual(p5HumanAction({...view,hand:{...view.hand!,seed}}),{type:"check"});
});
