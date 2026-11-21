import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import saved from "../src/lib/solver/pushfold-solutions.json";
import matrix from "../src/lib/solver/equity-matrix.json";
import { HANDS } from "../src/lib/solver/hands";
import { evaluateProfile } from "../src/lib/drills/push-fold/evaluate";
import { createPushFoldSource } from "../src/lib/drills/push-fold/source";
import { parsePushFoldKey } from "../src/lib/drills/push-fold/key";
import { grade } from "../src/lib/drills/grade";
import { changeMode, dropPending, resolvePending, startSession, submit } from "../src/lib/drills/session";
import { initialState } from "../src/lib/drills/scheduler";
import { parseState } from "../src/lib/drills/storage";
import { buildPushFoldQuestion, gradePushFoldAction } from "../src/lib/drills/push-fold/build";
import manifest from "../src/lib/drills/push-fold/manifest.json";
import { validateDepth } from "../src/lib/drills/push-fold/model";
import { execFileSync } from "node:child_process";

const near = (a: number, b: number, tolerance = 1e-11) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const ranks = "23456789TJQKA";
// Independent physical-card counting: no DISJOINT, classOfCards or solver payoff helpers.
const counts = HANDS.map(hand => {
  const hero = [(hand.hi - 2) * 4, (hand.lo - 2) * 4 + (hand.type === "suited" ? 0 : 1)];
  const n = Array<number>(169).fill(0);
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
    if (hero.includes(a) || hero.includes(b)) continue;
    const hi = Math.max(a >> 2, b >> 2), lo = Math.min(a >> 2, b >> 2);
    const label = ranks[hi] + ranks[lo] + (hi === lo ? "" : a % 4 === b % 4 ? "s" : "o");
    const i = HANDS.findIndex(h => h.label === label);
    assert.ok(i >= 0); n[i]++;
  }
  assert.equal(n.reduce((a,b) => a+b, 0), 1225);
  return n;
});

test("D1 independently grades all 12,506 stored decisions and 37 rounded profiles", () => {
  let total = 0, maxGap = 0;
  for (const p of Object.values(saved.solutions)) {
    const result = evaluateProfile(p);
    let sbGain = 0, bbGain = 0;
    for (let h = 0; h < 169; h++) {
      const n = counts[h]; let fold = 0, callMass = 0, sbEquityMass = 0, shoveMass = 0, bbEquityMass = 0;
      for (let k = 0; k < 169; k++) {
        fold += n[k] * (1 - p.bbCall[k]);
        callMass += n[k] * p.bbCall[k]; sbEquityMass += n[k] * p.bbCall[k] * matrix.equity[h][k];
        shoveMass += n[k] * p.sbShove[k]; bbEquityMass += n[k] * p.sbShove[k] * (1 - matrix.equity[k][h]);
      }
      const sbEv = (fold * 1.5 + 2 * p.stack * sbEquityMass - callMass * (p.stack - 0.5)) / 1225;
      const bbEv = 2 * p.stack * bbEquityMass / shoveMass - (p.stack - 1);
      const a = result.sb[h], b = result.bb[h]; assert.ok(b);
      near(a.evBb, sbEv); near(b.evBb, bbEv); near(a.foldProbability!, fold / 1225);
      near(a.equity!, sbEquityMass / callMass); near(b.equity!, bbEquityMass / shoveMass);
      near(b.reachProbability, shoveMass / 1225);
      assert.equal(a.frequency, p.sbShove[h]); assert.equal(b.frequency, p.bbCall[h]);
      const weight = HANDS[h].weight / 1326;
      sbGain += weight * (Math.max(0, sbEv) - p.sbShove[h] * sbEv);
      bbGain += weight * shoveMass / 1225 * (Math.max(0, bbEv) - p.bbCall[h] * bbEv);
      total += 2;
    }
    near(result.sbGainBb, sbGain); near(result.bbGainBb, bbGain); near(result.nashGapBb, sbGain+bbGain);
    assert.ok(result.nashGapBb <= 0.0005); maxGap = Math.max(maxGap, result.nashGapBb);
    for (const seat of ["sb", "bb"] as const) for (const margin of [0.05, 0.25]) {
      assert.ok(result[seat].some(row => row && Math.abs(row.evBb) >= margin));
    }
  }
  assert.equal(total, 12506); near(maxGap, 0.000046464518110411746);
});

test("D1 sunk blinds, no-call and unreachable-shove limits; malformed profiles fail", () => {
  const p = structuredClone(saved.solutions["10.0"]);
  p.bbCall.fill(0); p.sbShove.fill(0);
  const none = evaluateProfile(p);
  for (const r of none.sb) { near(r.evBb, 1.5); assert.equal(r.equity, null); assert.equal(r.foldProbability, 1); }
  assert.ok(none.bb.every(r => r === null));
  p.bbCall.fill(1); p.sbShove.fill(1);
  const all = evaluateProfile(p);
  near(all.sb[0].evBb, 20 * all.sb[0].equity! - 9.5);
  near(all.bb[0]!.evBb, 20 * all.bb[0]!.equity! - 9);
  assert.throws(() => evaluateProfile({...p, sb: 0.25}));
  assert.throws(() => evaluateProfile({...p, stack: 10.1}));
  assert.throws(() => evaluateProfile({...p, bbCall: [NaN]}));
});

test("D1 uses a 0.01 bb practice band, never the postflop frequency exemption", () => {
  assert.equal(gradePushFoldAction(0, 0.01, 0).correct, true);
  assert.equal(gradePushFoldAction(0, 0.01001, 0.99).correct, false);
  assert.equal(gradePushFoldAction(-2, 0, 1).correct, false);
});

test("D1 every published byte reproduces; schema rejects invalid conditional numbers", () => {
  execFileSync(process.execPath,["--import","tsx","scripts/build-push-fold-drills.ts","--check"]);
  const data=evaluateProfile(saved.solutions["10.0"]);
  assert.equal(validateDepth(data,10),data);
  const change=(patch:Record<string,unknown>)=>({...data,sb:data.sb.map((r,i)=>i===0?{...r,...patch}:r)});
  for(const patch of [{frequency:1.01},{hand:2},{evBb:NaN},{foldProbability:NaN},{equity:null}]) {
    assert.throws(()=>validateDepth(change(patch),10));
  }
  assert.throws(()=>validateDepth({...data,nashGapBb:0.001},10));
  assert.throws(()=>validateDepth(data,10.5));
});

test("D1 every question's prices, EV grades and equity condition match the declared game", () => {
  for(const p of Object.values(saved.solutions)){
    const d=evaluateProfile(p);
    for(const seat of ["sb","bb"] as const)for(let hand=0;hand<169;hand++){
      const q=buildPushFoldQuestion(d,seat,hand,42,3), detail=q.pushFold!;
      assert.equal(q.answer.kind,"push-fold"); if(q.answer.kind!=="push-fold")throw new Error("kind");
      const call=seat==="sb"?"shove":"call", ev=d[seat][hand]!.evBb;
      assert.equal(q.answer.grades.fold.evBb,0); near(q.answer.grades[call].evBb,ev);
      near(detail.gapBb,Math.abs(ev));
      assert.equal(q.facts.find(f=>f.label==="Pot now")!.value,`${seat==="sb"?1.5:p.stack+1} bb`);
      assert.equal(detail.requiredEquity,seat==="bb"?(p.stack-1)/(2*p.stack):null);
      near(q.answer.grades.fold.frequency+q.answer.grades[call].frequency,1);
      assert.equal(q.answer.grades.fold.correct,Math.max(0,ev)<=0.01+1e-9);
      assert.equal(q.answer.grades[call].correct,Math.max(0,-ev)<=0.01+1e-9);
    }
  }
});

const fetcher = (async (url: string) => new Response(readFileSync(`public${url}`))) as unknown as typeof fetch;
test("D1 loads lazily, deterministic generation and exact versioned review; both close actions count", async () => {
  const paths: string[] = [];
  const source = createPushFoldSource({fetcher: async (url, init) => {paths.push(String(url)); return fetcher(url, init);}});
  assert.equal(paths.length, 0);
  for (const level of [1,2,3] as const) {
    const q = await source.generate(42, level);
    assert.deepEqual(await source.generate(42, level), q);
    const reviewed = await source.fromKey(q.reviewKey!, 999, level);
    assert.deepEqual(reviewed.pushFold, q.pushFold); assert.deepEqual(reviewed.answer, q.answer);
    assert.equal(q.answer.kind, "push-fold");
    assert.equal(grade(q, q.answer.value.toString(), 100)?.correct, true);
  }
  assert.ok(paths.length <= 3); assert.ok(paths.every(p => p.startsWith("/drill-data/push-fold-v1/")));
  const p = evaluateProfile(saved.solutions["10.0"]);
  const h = p.sb.findIndex(r => Math.abs(r.evBb) <= 0.01); assert.ok(h >= 0);
  const close = buildPushFoldQuestion(p, "sb", h, 0, 3);
  assert.equal(grade(close, "fold", 100)?.correct, true); assert.equal(grade(close, "shove", 100)?.correct, true);
  const q = await source.generate(0, 3);
  for (const bad of [q.reviewKey!.replace(manifest.datasetId, "0".repeat(64)), "../../bad", q.reviewKey!.replace(/\|(?:\d+\.\d)\|/, "|10.1|")]) {
    await assert.rejects(source.fromKey(bad, 0, 3), {name: "DrillKeyError"});
  }
  assert.equal(parsePushFoldKey("a".repeat(64)+"|20.5|sb|0"), null);
});

test("D1 rejects corrupt/oversized/404 data and retries without caching failures", async () => {
  for (const corrupt of [() => new Response("{}"), () => new Response("x".repeat(204801)), () => new Response("missing", {status:404})]) {
    let fail = true, requests = 0;
    const source = createPushFoldSource({fetcher: async (url, init) => { requests++; return fail ? corrupt() : fetcher(url, init); }});
    await assert.rejects(source.generate(3, 1)); fail = false;
    const q = await source.generate(3, 1); assert.equal(q.type, "push-fold");
    assert.ok(requests >= 2);
  }
});

test("D1 rejects a same-length, valid-schema change specifically at the SHA-256 check", async () => {
  const source=createPushFoldSource({fetcher:async url=>{
    const raw=readFileSync(`public${String(url)}`,"utf8");
    const changed=raw.replace(/"equity":0\.(\d)/,(_,digit:string)=>`"equity":0.${(Number(digit)+1)%10}`);
    assert.notEqual(changed,raw); assert.equal(Buffer.byteLength(changed),Buffer.byteLength(raw));
    const parsed=JSON.parse(changed); validateDepth(parsed,parsed.stack);
    return new Response(changed);
  }});
  await assert.rejects(source.generate(3,1),/failed its integrity check/);
});

test("D1 session waits for data, ignores stale/wrong replies, and preserves versioned reviews", async () => {
  const source = createPushFoldSource({fetcher});
  const s = startSession(initialState(), 42, {kind:"type",type:"push-fold"}, 1, 0);
  assert.equal(s.question, null); assert.equal(s.pending?.type,"push-fold");
  const pending = s.pending!, q = await source.generate(pending.seed, pending.level);
  const loaded = resolvePending(s, pending, q, 5000); assert.equal(loaded.shownAt, 5000);
  const stale = changeMode(s,{kind:"type",type:"pot-odds"},100);
  assert.equal(resolvePending(stale,pending,q,5000),stale);
  const wrong = {...q, seed: q.seed+1};
  assert.equal(resolvePending(s,pending,wrong,5000),s);
  const answered = submit(loaded,q.answer.value.toString(),5001);
  assert.equal(answered.result?.elapsedMs,1);
  const slow = submit(loaded,q.answer.value.toString(),50000);
  const restored = parseState(JSON.stringify(slow.state));
  assert.equal(restored.review[0].key,q.reviewKey); assert.equal(restored.review[0].id,q.id);
  const reviewed = startSession({...restored,tick:restored.review[0].dueAt},99,{kind:"review"},"auto",0);
  assert.equal(reviewed.pending?.key,q.reviewKey);
  const other = {...restored.review[0],type:"solver" as const,id:"solver:other"};
  const dropped = dropPending({...reviewed,state:{...restored,review:[...restored.review,other]}},0);
  assert.deepEqual(dropped.state.review,[other]);
});
