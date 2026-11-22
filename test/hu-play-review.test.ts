import assert from "node:assert/strict";
import test from "node:test";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import { gradePlayDecision } from "../src/lib/hu-play/decision-grade";
import { exactRangeEquity } from "../src/lib/hu-play/teaching";
import { handScore } from "../src/lib/poker/eval";
import { RIVER_DECK, parseRiverCombo, riverCardObject } from "../src/lib/solver/river/cards";
import type { PlayView, PlayDecisionView } from "../src/lib/hu-play/ui-controller";
import type { HuPublicEvent } from "../src/lib/hu-play/types";
import type { RangeEquityInput } from "../src/lib/hu-play/teaching";
import { captureCompletedReview, ReviewArchive, reviewDecision, serializeReview, REVIEW_LIMITS } from "../src/lib/hu-play/review";

const identity = { buildHash: "a".repeat(64), engineSourceHash: "b".repeat(64) };
export function fixture(humanSeat: 0 | 1 = 0, id = 1) {
  let s = initialPublicState({startingPot:550,startingStack:9750,minimumBet:100,flop:["Kd","8c","4h"]});
  const decisions: PlayDecisionView[] = [], inputs = new Map<string, RangeEquityInput>();
  const events: HuPublicEvent[] = [
    {kind:"action",player:0,action:{type:"check"}}, {kind:"action",player:1,action:{type:"check"}},
    {kind:"card",street:"turn",card:"2s"}, {kind:"action",player:0,action:{type:"bet",to:200}},
    {kind:"action",player:1,action:{type:"raise",to:600}}, {kind:"action",player:0,action:{type:"call"}},
    {kind:"card",street:"river",card:"9d"}, {kind:"action",player:0,action:{type:"check"}},
    {kind:"action",player:1,action:{type:"check"}},
  ];
  for (const event of events) {
    if (event.kind === "action") {
      const key=s.path.join(" ")||"root",live=s.street!=="flop",facing=Math.max(...s.streetPut)>s.streetPut[s.toAct!];
      const actions = facing ? [{type:"fold"},{type:"call"},...(event.action.type==="raise"?[event.action]:[])] as const
        : [{type:"check"},{type:"bet",to:200}] as const;
      decisions.push({key,actor:s.toAct===humanSeat?"human":"ai",public:s,
        provenance:live?{source:"resolve",kind:"street-root",spotHash:"c".repeat(64),iterations:10,
          exploitabilityPctPot:.1,precision:"float32",bridgeVersion:"test",engineCommit:"test",degradation:0}
          :{source:"library",spotHash:"d".repeat(64),librarySpotId:"test"},
        strategy:actions.map((action,i)=>({action,probability:Number(i===0)})),actionEvs:actions.map((_,i)=>facing?i*10:10+i*10),
        actionEvBasis:live?"local-solved-policy":"original-saved-policy",humanActionMode:null});
      inputs.set(key,{humanHand:"KsQs",board:[...s.board.flop,...(s.board.turn?[s.board.turn]:[]),...(s.board.river?[s.board.river]:[])],
        aiRange:{source:"original reaching model",entries:[{combo:"AsAh",weight:1},{combo:"QcQh",weight:3}]}});
    }
    s=applyPublicEvent(s,event);
  }
  const finalStacks: [number,number] = humanSeat===0?[9150,10900]:[10900,9150];
  const view: PlayView={phase:"complete",message:"complete",progress:null,
    hand:{seed:7,humanSeat,humanHand:"KsQs",aiHand:"AsAh",public:s,finalStacks},decisions,
    ledger:[{id,seed:7,humanSeat,humanNet:-850,aiNet:900,externalDeadBlind:50}]};
  const input=(key:string)=>structuredClone(inputs.get(key)!);
  return {view,inputs,input};
}

test("H1 only captures completed hands, preserves original inputs, and distinguishes repeated seeds",()=>{
  const f=fixture(), r=captureCompletedReview(f.view,identity,f.input);
  assert.equal(r.id,1); assert.equal(r.decisions.length,7); assert.equal(r.identity.buildHash,identity.buildHash);
  assert.equal(r.hand.aiHand,"AsAh"); assert.equal(r.decisions[0].equityInput.board.length,3);
  assert.throws(()=>captureCompletedReview({...f.view,phase:"human"},identity,f.input),/complete/i);
  assert.throws(()=>captureCompletedReview({...f.view,hand:{...f.view.hand!,aiHand:null}},identity,f.input),/complete|reveal/i);
  const a=new ReviewArchive(); a.add(r); a.add(r); assert.equal(a.getSnapshot().reviews.length,1);
  const second=fixture(0,2);a.add(captureCompletedReview(second.view,identity,second.input));
  assert.deepEqual(a.getSnapshot().reviews.map(x=>x.id),[1,2]);
  assert.equal(serializeReview(r),serializeReview(captureCompletedReview(f.view,identity,f.input)));
  assert.equal(JSON.parse(serializeReview(r)).format,"poker-face-completed-review");
});

test("H1 deep copies and freezes decisions, ranges, cards, identity and ledger",()=>{
  const f=fixture(),r=captureCompletedReview(f.view,identity,f.input),original=serializeReview(r);
  (f.view.decisions[0].actionEvs as number[])[0]=999;
  (f.inputs.get("root")!.aiRange.entries as {combo:string;weight:number}[])[0].weight=999;
  assert.equal(serializeReview(r),original);assert.ok(Object.isFrozen(r.decisions[0].equityInput.aiRange.entries[0]));
  assert.throws(()=>{(r.decisions[0].decision.actionEvs as number[])[0]=999;},TypeError);
});

test("H1 rejects mismatched, missing or duplicate snapshots and invalid settlement/identity",()=>{
  const f=fixture(),bad=structuredClone(f.view);
  (bad.decisions[0].public.flop as unknown as string[])[0]="Ac";
  assert.throws(()=>captureCompletedReview(bad,identity,f.input),/history|public|prefix|derived|flop|board/i);
  assert.throws(()=>captureCompletedReview({...f.view,decisions:f.view.decisions.slice(1)},identity,f.input),/missing|cover/i);
  assert.throws(()=>captureCompletedReview({...f.view,decisions:[...f.view.decisions,f.view.decisions[0]]},identity,f.input),/duplicate/i);
  assert.throws(()=>captureCompletedReview({...f.view,hand:{...f.view.hand!,finalStacks:[0,0]}},identity,f.input),/settlement|conserv|stack/i);
  assert.throws(()=>captureCompletedReview(f.view,{...identity,buildHash:"bad"},f.input),/identity|hash/i);
});

test("H1 rejects hindsight cards or hidden-card inputs; range inputs are the original recorded model",()=>{
  const f=fixture();
  assert.throws(()=>captureCompletedReview(f.view,identity,k=>({...f.input(k),board:["Kd","8c","4h","2s","9d"]})),/board|decision/i);
  assert.throws(()=>captureCompletedReview(f.view,identity,k=>({...f.input(k),aiHand:"AsAh"})),/fields|hidden/i);
  assert.throws(()=>captureCompletedReview(f.view,identity,k=>({...f.input(k),humanHand:"AsAh"})),/human|hand/i);
  const r=captureCompletedReview(f.view,identity,f.input);
  for(const row of r.decisions)assert.deepEqual(row.equityInput,f.input(row.decision.key));
});

test("H1 price and grades match independent arithmetic, both seats, raises and each original model",()=>{
  for(const seat of [0,1] as const){
    const f=fixture(seat),r=captureCompletedReview(f.view,identity,f.input);
    for(let i=0;i<r.decisions.length;i++){
      const row=r.decisions[i],d=row.decision,v=reviewDecision(r,i),event=r.hand.public.events[row.eventIndex];
      assert.equal(event.kind,"action");assert.deepEqual(v.action,event.kind==="action"?event.action:null);
      const call=Math.max(...d.public.streetPut)-d.public.streetPut[d.public.toAct!];
      if(!call)assert.equal(v.price,null);
      else{
        assert.equal(v.price!.requiredEquity,call/(d.public.pot+call));assert.equal(v.price!.polarBluffShare,call/(d.public.pot+call));
        // The two faced bets in this fixture: first 200 into 550, then a 600 raise into 750.
        const risk=d.public.streetPut[1-d.public.toAct!]===200?200:600;
        assert.equal(v.price!.minimumDefence,(d.public.pot-risk)/d.public.pot);
      }
      if(d.actor==="human"){
        assert.equal(v.grade.status,"ready");if(v.grade.status!=="ready"||event.kind!=="action")throw Error("grade");
        const j=d.strategy!.findIndex(a=>JSON.stringify(a.action)===JSON.stringify(event.action));
        const expected=Math.max(...d.actionEvs! as number[])-d.actionEvs![j]!;
        assert.equal(v.grade.gapChips,expected);assert.equal(v.grade.basis,d.actionEvBasis);
      }else assert.equal(v.grade.status,"unavailable");
      assert.deepEqual(v.grade,gradePlayDecision(d,r.hand.public));
    }
    assert.throws(()=>reviewDecision(r,-1),/decision/i);assert.throws(()=>reviewDecision(r,7),/decision/i);
  }
});

test("H1 never substitutes frequency, equity or a later model for unavailable action EVs",()=>{
  for(const mode of ["missing","translated","off-menu","zero","tie"]){
    const f=fixture();const d=f.view.decisions[0];
    const changed:PlayDecisionView=mode==="missing"?{...d,actionEvs:[null,20]}:mode==="translated"?{...d,actionEvBasis:"not-exported"}
      :mode==="off-menu"?{...d,strategy:[{action:{type:"bet",to:200},probability:1}],actionEvs:[20]}
      :{...d,actionEvs:mode==="zero"?[0,10]:[0,0]};
    const r=captureCompletedReview({...f.view,decisions:[changed,...f.view.decisions.slice(1)]},identity,f.input),g=reviewDecision(r,0).grade;
    if(mode==="zero"||mode==="tie"){assert.equal(g.status,"ready");if(g.status==="ready")assert.equal(g.gapChips,mode==="zero"?10:0);}
    else assert.equal(g.status,"unavailable");
  }
});

test("H1 earlier turn equity matches independent best-five enumeration, never the realized river",()=>{
  const f=fixture(),r=captureCompletedReview(f.view,identity,f.input),q=r.decisions[2].equityInput;
  let won=0,total=0;
  for(const h of q.aiRange.entries){
    const a=parseRiverCombo(q.humanHand),b=parseRiverCombo(h.combo),known=[...q.board,...a,...b];
    for(const c of RIVER_DECK.filter(c=>!known.includes(c))){
      const board=[...q.board,c].map(riverCardObject),x=handScore(a.map(riverCardObject),board),y=handScore(b.map(riverCardObject),board);
      won+=h.weight*(x>y?1:x===y?.5:0);total+=h.weight;
    }
  }
  assert.equal(q.board.length,4);assert.equal(exactRangeEquity(q).outcomes,88);
  assert.ok(Math.abs(exactRangeEquity(q).equity!-won/total)<1e-12);
  assert.notEqual(exactRangeEquity(q).equity,exactRangeEquity({...q,board:[...q.board,"9d"]}).equity);
});

test("H1 count and byte limits evict oldest, reject oversized records, and report actual serialized bytes",()=>{
  const a=new ReviewArchive();
  for(let id=1;id<=21;id++){const f=fixture(0,id);a.add(captureCompletedReview(f.view,identity,f.input));}
  const s=a.getSnapshot();assert.equal(s.reviews.length,20);assert.equal(s.reviews[0].id,2);assert.equal(s.evicted,1);
  assert.equal(s.bytes,s.reviews.reduce((n,r)=>n+new TextEncoder().encode(serializeReview(r)).byteLength,0));
  const f=fixture(),r=captureCompletedReview(f.view,identity,f.input);
  const huge={...r,identity:{...r.identity,note:"x".repeat(REVIEW_LIMITS.perHandBytes)}};
  assert.throws(()=>a.add(huge),/size|large|bytes/i);assert.deepEqual(a.getSnapshot(),s);
  assert.equal(new ReviewArchive().getSnapshot().reviews.length,0,"A new tab/controller does not load persisted reviews");
});


test("H1 serialized byte budget evicts before the count budget",()=>{
  const a=new ReviewArchive();
  for(let id=1;id<=6;id++){
    const f=fixture(0,id),r=captureCompletedReview(f.view,identity,f.input);
    // Exercise the storage byte bound independently of the number of decisions.
    const padded={...r,extra:"x".repeat(1700000)};a.add(padded);
  }
  const s=a.getSnapshot();assert.ok(s.reviews.length<6&&s.reviews.length<REVIEW_LIMITS.hands);
  assert.equal(s.evicted,6-s.reviews.length);assert.ok(s.bytes<=REVIEW_LIMITS.bytes);
});

test("H1 prospective frozen-corpus audit exists and independently checks all 200 original hands",async()=>{
  const {auditReviewCorpus}=await import("../scripts/audit-hu-play-review");
  const r=await auditReviewCorpus();
  assert.equal(r.hands,200);assert.equal(r.logMismatches,0);assert.equal(r.missingDecisions,0);
  assert.ok(r.decisions>200);assert.ok(r.maxBytes<=REVIEW_LIMITS.perHandBytes);
  assert.ok(r.captureMs.max<=100);assert.ok(r.grades.ready>0&&r.grades.unavailable>0);
});

test("H1 completion observer ignores duplicate publications after the next deal has cleared the controller",()=>{
  const f=fixture(),a=new ReviewArchive();
  a.capture(f.view,identity,f.input);const saved=a.getSnapshot();
  a.capture(f.view,identity,()=>{throw Error("Old controller observations were cleared");});
  a.capture({...f.view,phase:"thinking"},identity,()=>{throw Error("Never read private data before completion");});
  assert.equal(a.getSnapshot(),saved);assert.equal(saved.reviews.length,1);
});
