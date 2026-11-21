import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import inputs from "../tasks/drills-equity-range-d2-inputs.json";
import { parseEquityInput, validateEquityDataset, MAX_DATA_BYTES, type EquityInput } from "../src/lib/drills/equity-range/model";
import { enumerateEquityCase } from "../src/lib/drills/equity-range/evaluate";
import { independentEquityCase } from "../scripts/equity-range-reference";
import { createEquityRangeSource } from "../src/lib/drills/equity-range/source";
import { parseEquityRangeKey } from "../src/lib/drills/equity-range/key";
import manifest from "../src/lib/drills/equity-range/manifest.json";
import { grade } from "../src/lib/drills/grade";
import { startSession, resolvePending, submit, changeMode, dropPending } from "../src/lib/drills/session";
import { initialState } from "../src/lib/drills/scheduler";
import { parseState } from "../src/lib/drills/storage";

const rawBytes=()=>readFileSync(`public/drill-data/equity-range-v1/${manifest.file}`);
const source=()=>createEquityRangeSource({fetcher:(async()=>new Response(rawBytes())) as typeof fetch});
const frozen=inputs.cases.map(c=>parseEquityInput(c));
const outcomeKey=(cards:readonly string[],river:string|null)=>`${[...cards].sort().join("")}|${river??"river"}`;

test("D2 frozen inputs retain the pre-answer checksum and promised coverage",()=>{
  assert.equal(createHash("sha256").update(readFileSync("tasks/drills-equity-range-d2-inputs.json")).digest("hex"),"58c6a5a980c677a293ce3faaeea7b6b1804d9b07406651d899da9c7b34827426");
  assert.equal(frozen.length,36); assert.equal(new Set(frozen.map(c=>c.id)).size,36);
  for(const level of [1,2,3])assert.equal(frozen.filter(c=>c.level===level).length,12);
  assert.equal(frozen.filter(c=>c.board.length===4).length,18);
  for(const c of frozen.filter(c=>c.level===3)){
    assert.ok(c.range.some(r=>r.cards.some(x=>c.hero.includes(x))));
    assert.ok(c.range.some(r=>r.cards.some(x=>c.board.includes(x))));
    assert.ok(new Set(c.range.map(r=>r.weight)).size>1);
  }
});

test("every frozen showdown, both seven-card scores, count and weighted fraction agrees with independent best-five enumeration",()=>{
  const data=validateEquityDataset(JSON.parse(rawBytes().toString()));
  assert.equal(data.cases.length,36);
  for(const input of frozen){
    const scores:Record<string,readonly number[]>={};
    const actual=enumerateEquityCase(input,o=>{const key=outcomeKey(o.cards,o.river);assert.equal(scores[key],undefined);scores[key]=[o.heroScore,o.opponentScore];});
    const oracle=independentEquityCase(input);
    assert.deepEqual(scores,oracle.scores,input.id);
    assert.deepEqual(actual,oracle.result,input.id);
    assert.deepEqual(data.cases.find(c=>c.input.id===input.id),oracle.result,input.id);
    assert.equal(actual.outcomeCount,actual.rows.filter(r=>!r.blockedBy.length).length*(input.board.length===4?44:1));
  }
});

const fixture=(overrides:Partial<EquityInput>={}):EquityInput=>parseEquityInput({id:"fixture",level:1,hero:["As","Kd"],board:["Ac","7d","5s","2h","9c"],range:[{cards:["Ah","Qh"],weight:1},{cards:["7h","7s"],weight:1}],...overrides});

test("river wins, losses and half-ties have analytic integer answers; weights are not extra outcomes",()=>{
  const half=enumerateEquityCase(fixture()); assert.equal(half.numerator/half.denominator,0.5);
  const weighted=enumerateEquityCase(fixture({range:[{cards:["Ah","Qh"],weight:3},{cards:["7h","7s"],weight:1}]}));
  assert.equal(weighted.numerator/weighted.denominator,0.75); assert.equal(weighted.outcomeCount,2);assert.equal(weighted.weightedOutcomes,4);
  const split=enumerateEquityCase(fixture({hero:["2c","3d"],board:["As","Ks","Qs","Js","Ts"],range:[{cards:["Ah","Ad"],weight:4},{cards:["9c","9d"],weight:2}]}));
  assert.equal(split.weightedTies,6);assert.equal(split.numerator,6);assert.equal(split.denominator,12);assert.equal(split.outcomeCount,2);
  const mixed=enumerateEquityCase(fixture({hero:["Kh","Kd"],board:["Ah","Ad","As","Ac","2d"],range:[{cards:["Kc","Qh"],weight:1},{cards:["9c","9d"],weight:1}]}));
  assert.equal(mixed.weightedTies,1);assert.equal(mixed.weightedWins,1);assert.equal(mixed.numerator/mixed.denominator,0.75);
});

test("blocked rows are removed before normalizing and never counted as runouts",()=>{
  const result=enumerateEquityCase(fixture({range:[{cards:["As","Qs"],weight:10},{cards:["Ac","Ad"],weight:5},{cards:["Ah","Qh"],weight:1},{cards:["7h","7s"],weight:3}]}));
  assert.deepEqual(result.rows.map(r=>r.blockedBy),[["As"],["Ac"],[],[]]);
  assert.equal(result.weightSum,4);assert.equal(result.outcomeCount,2);assert.equal(result.numerator/result.denominator,0.25);
  assert.ok(result.rows.slice(0,2).every(r=>r.runouts===0&&r.wins===0&&r.ties===0&&r.losses===0));
});

test("a turn enumerates 44 rivers per compatible hand and agrees with the independent oracle",()=>{
  const input=fixture({board:["Ac","7d","5s","2h"]});const result=enumerateEquityCase(input);
  assert.equal(result.outcomeCount,88);assert.ok(result.rows.every(r=>r.runouts===44));
  assert.deepEqual(result,independentEquityCase(input).result);
});

test("invalid cards, known overlaps, unordered duplicates, invalid weights, size and empty compatible ranges are refused",()=>{
  const bad:unknown[]=[null,{}, {...fixture(),id:"../escape"},{...fixture(),level:4},
    {...fixture(),hero:["As","As"]},{...fixture(),board:["As","7d","5s","2h"]},
    {...fixture(),hero:["10s","Kd"]},{...fixture(),board:["Ac","7d","5s"]},
    {...fixture(),board:["Ac","7d","5s","2h","9c","8s"]},
    {...fixture(),range:[]},{...fixture(),range:Array.from({length:13},()=>({cards:["Ah","Qh"],weight:1}))},
    {...fixture(),range:[{cards:["Ah","Qh"],weight:1},{cards:["Qh","Ah"],weight:2}]},
    {...fixture(),range:[{cards:["Ah","Ah"],weight:1}]},
    {...fixture(),range:[{cards:["As","Qh"],weight:1}]},
    ...[0,-1,0.5,11,NaN,Infinity,"1"].map(weight=>({...fixture(),range:[{cards:["Ah","Qh"],weight}]})),
  ];for(const value of bad)assert.throws(()=>parseEquityInput(value));
});

test("card order, range order, valid weight scaling and all suit permutations preserve equity",()=>{
  const input=fixture({board:["Ac","7d","5s","2h"]});const original=enumerateEquityCase(input);const ratio=(c:ReturnType<typeof enumerateEquityCase>)=>c.numerator/c.denominator;
  const reverse=enumerateEquityCase({...input,hero:[input.hero[1],input.hero[0]],board:[...input.board].reverse(),range:[...input.range].reverse().map(r=>({...r,cards:[r.cards[1],r.cards[0]]}))});
  assert.equal(ratio(reverse),ratio(original));
  const scaled=enumerateEquityCase({...input,range:input.range.map(r=>({...r,weight:r.weight*3}))});assert.equal(ratio(scaled),ratio(original));assert.equal(scaled.outcomeCount,original.outcomeCount);assert.equal(scaled.weightedOutcomes,original.weightedOutcomes*3);
  const permutations=(xs:string[]):string[][]=>xs.length?xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(p=>[x,...p])):[[]];
  for(const suits of permutations(["c","d","h","s"])){
    const card=(c:string)=>c[0]+suits["cdhs".indexOf(c[1])];
    for(const c of [input,frozen[24]]){
      const mapped=parseEquityInput({...c,hero:c.hero.map(card),board:c.board.map(card),range:c.range.map(r=>({...r,cards:r.cards.map(card)}))});
      const a=enumerateEquityCase(c),b=enumerateEquityCase(mapped);assert.equal(ratio(a),ratio(b));assert.equal(a.outcomeCount,b.outcomeCount);
    }
  }
});

test("schema validates every row, blockers, totals, fraction and 36 unique cases",()=>{
  const original=JSON.parse(rawBytes().toString());validateEquityDataset(original);
  const mutations:((x:typeof original)=>void)[]=[x=>x.version=2,x=>x.cases.pop(),x=>x.cases[1]=x.cases[0],
    x=>x.cases[0].rows[0].wins=-1,x=>x.cases[0].rows[0].runouts=44,x=>x.cases[0].numerator++,
    x=>x.cases[0].weightedOutcomes++,x=>x.cases[0].weightSum++,x=>x.cases[24].rows[4].blockedBy=[],
    x=>x.cases[0].rows[0].cards=["Ah","Jh"],x=>x.cases[0].rows[0].weight=7];
  for(const mutate of mutations){const data=structuredClone(original);mutate(data);assert.throws(()=>validateEquityDataset(data));}
});

test("loader validates bounded bytes, SHA, availability and retry; successful data is cached",async()=>{
  assert.ok(rawBytes().length<=MAX_DATA_BYTES);let mode="404",calls=0;
  const loader=createEquityRangeSource({fetcher:(async()=>{calls++;if(mode==="404")return new Response("missing",{status:404});if(mode==="short")return new Response(rawBytes().subarray(1));if(mode==="large")return new Response(new Uint8Array(MAX_DATA_BYTES+1));if(mode==="hash"){const changed=JSON.parse(rawBytes().toString());changed.cases[24].input.range[4].weight=4;changed.cases[24].rows[4].weight=4;validateEquityDataset(changed);const bytes=Buffer.from(JSON.stringify(changed)+"\n");assert.equal(bytes.length,rawBytes().length);return new Response(bytes);}return new Response(rawBytes());}) as typeof fetch});
  for(const [value,message] of [["404",/load/i],["short",/length/i],["large",/large/i],["hash",/integrity/i]] as const){mode=value;await assert.rejects(loader.generate(1,1),message);}
  mode="ok";await loader.generate(1,1);const loaded=calls;await loader.generate(2,3);assert.equal(calls,loaded);
});

test("seeds choose all cases at the right level; review keys replay exactly and refuse unavailable versions or levels",async()=>{
  const loader=source();
  for(const level of [1,2,3] as const){const ids=new Set();for(let seed=0;seed<180;seed++){const q=await loader.generate(seed,level);assert.equal(q.level,level);assert.equal(q.equityRange!.result.input.level,level);ids.add(q.reviewKey);assert.deepEqual(q,await loader.generate(seed,level));assert.deepEqual(q,await loader.fromKey(q.reviewKey!,seed,level));}assert.equal(ids.size,12);}
  const q=await loader.generate(7,1);assert.ok(parseEquityRangeKey(q.reviewKey!));
  for(const key of ["bad",q.reviewKey!.replace(manifest.datasetId,"0".repeat(64)),`${manifest.datasetId}|missing`])await assert.rejects(loader.fromKey(key,7,1),{name:"DrillKeyError"});
  await assert.rejects(loader.fromKey(q.reviewKey!,7,3),{name:"DrillKeyError"});
});

test("all question numbers derive from exact counts; ±2 points is inclusive and guesses outside 0–100 stay invalid",async()=>{
  const loader=source();
  for(const input of frozen){const q=await loader.fromKey(`${manifest.datasetId}|${input.id}`,0,input.level);const reference=independentEquityCase(input).result;
    assert.equal(q.answer.kind,"percent");assert.equal(q.answer.value,100*reference.numerator/reference.denominator);assert.equal(q.speedTargetMs,30000);
    assert.match(q.explanation.note!,/not.*call/i);assert.match(q.explanation.result,/rounded/);assert.deepEqual(q.equityRange!.result,reference);
    const value=q.answer.value as number;assert.equal(grade(q,String(value),1)?.correct,true);
    for(const delta of [-2,2])if(value+delta>=0&&value+delta<=100)assert.equal(grade(q,String(value+delta),1)?.correct,true);
    const outside=value<50?value+2.001:value-2.001;assert.equal(grade(q,String(outside),1)?.correct,false);
    for(const invalid of ["", "hello", "-0.1", "100.001", "101", "2/1"])assert.equal(grade(q,invalid,1),null);
  }
});

test("equity async boundary starts the timer on resolution, rejects stale/wrong responses and persists exact reviews",async()=>{
  const loader=source(),s=startSession(initialState(),42,{kind:"type",type:"equity-range"},1,0),pending=s.pending!;
  assert.equal(pending.type,"equity-range");assert.equal(s.question,null);const q=await loader.generate(pending.seed,pending.level);
  const ready=resolvePending(s,pending,q,5000);assert.equal(ready.shownAt,5000);
  assert.equal(resolvePending(s,{...pending},q,50),s);assert.equal(resolvePending(s,pending,{...q,seed:q.seed+1},50),s);
  assert.equal(resolvePending(s,pending,{...q,type:"push-fold"},50),s);
  const changed=changeMode(s,{kind:"type",type:"pot-odds"},100);assert.equal(resolvePending(changed,pending,q,5000),changed);
  const invalid=submit(ready,"101",5100);assert.equal(invalid.result,null);assert.equal(invalid.shownAt,5000);assert.equal(invalid.state.tick,0);
  const answered=submit(ready,String(q.answer.value),70000);assert.equal(answered.result!.elapsedMs,65000);
  const restored=parseState(JSON.stringify(answered.state));assert.equal(restored.review[0].key,q.reviewKey);
  const due={...restored,tick:restored.review[0].dueAt};const review=startSession(due,9,{kind:"review"},"auto",80000);assert.equal(review.pending!.key,q.reviewKey);
  assert.equal(resolvePending(review,review.pending!,{...q,reviewKey:"wrong"},81000),review);
  const wrongVersion={...restored.review[0],key:q.reviewKey!.replace(manifest.datasetId,"0".repeat(64))};const kept=parseState(JSON.stringify({...due,review:[wrongVersion]}));assert.equal(kept.review.length,1);
  const drop=startSession(kept,9,{kind:"review"},"auto",80000);assert.equal(dropPending(drop,81000).state.review.length,0);
});
