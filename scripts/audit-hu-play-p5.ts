/** Recheck P5's frozen UI corpus using preserved policies. This is replay, not a fresh solve. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { build } from "esbuild";
import type { BridgeSpotV1, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { PlayController, loadPlayHand, type PlayLedgerRow } from "../src/lib/hu-play/ui-controller";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { validatePublicState } from "../src/lib/hu-play/public-state";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { requireTurnPlayingResult } from "../src/lib/solver/bridge/live/turn-quality";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { P5_UI_CORPUS, p5HumanAction } from "./hu-play-p5-human";

interface Frozen {corpus:typeof P5_UI_CORPUS;corpusHash:string;sourceFiles:{path:string;sha256:string}[];sourceHash:string}
interface Row {seed:number;humanSeat:0|1;passed:true;log:ReturnType<PlayController["completedLog"]>;
  logHash:string;decisionsHash:string;ledger:PlayLedgerRow;streets:string[]}
interface Report {format:string;version:number;payloadHash:string;frozen:Frozen;passed:boolean;rows:Row[];
  replayRows:{seed:number;passed:boolean}[];attempts:{seed:number;spotHash:string;accepted:boolean;error?:string}[];ledger:PlayLedgerRow[]}
export interface P5Evidence {format:"poker-face-p5-ui-evidence";version:1;report:Report;solves:{spot:BridgeSpotV1;result:BridgeResultV1}[]}
export const P5_STEM="tasks/artifacts/hu-play-p5-ui";
const digest=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
export const p5Hash=(value:unknown)=>digest(canonicalSolverJson(value));

export function readP5Evidence():P5Evidence {
  const meta=JSON.parse(readFileSync(`${P5_STEM}.json`,"utf8"));
  assert.equal(meta.format,"poker-face-p5-ui-evidence-bundle");assert.equal(meta.version,1);
  const compressed=readFileSync(`${P5_STEM}.json.gz`);assert.equal(compressed.length,meta.bytes);
  assert.equal(digest(compressed),meta.sha256,"P5 compressed evidence hash");
  const plain=gunzipSync(compressed,{maxOutputLength:128*1024**2});
  assert.equal(plain.length,meta.uncompressedBytes);assert.equal(digest(plain),meta.uncompressedSha256);
  return JSON.parse(plain.toString("utf8"));
}

export async function checkP5Evidence(e:P5Evidence) {
  assert.equal(e.format,"poker-face-p5-ui-evidence");assert.equal(e.version,1);
  const {payloadHash,...payload}=e.report, r=e.report;
  assert.equal(p5Hash(payload),payloadHash,"P5 measured report hash");
  assert.equal(r.format,"poker-face-p5-ui-hands");assert.equal(r.version,1);assert.equal(r.passed,true);
  assert.deepEqual(r.frozen.corpus,P5_UI_CORPUS,"All 200 frozen seeds and the human rule must remain");
  assert.equal(r.frozen.corpusHash,p5Hash(P5_UI_CORPUS));assert.equal(r.frozen.sourceHash,p5Hash(r.frozen.sourceFiles));
  const bundle=await build({entryPoints:["scripts/audit-hu-play-p5-playing.ts"],bundle:true,platform:"node",format:"esm",packages:"external",write:false,metafile:true});
  const sources=Object.keys(bundle.metafile.inputs).sort().map(path=>({path,sha256:digest(readFileSync(path))}));
  assert.deepEqual(sources,r.frozen.sourceFiles,"P5 capture pipeline changed: new evidence required");
  assert.equal(r.rows.length,200);assert.equal(r.replayRows.length,200);assert.equal(r.ledger.length,200);
  assert.ok(r.attempts.every(a=>a.accepted&&!a.error),"Every retained solve attempt must succeed");
  const policies=new Map<string,BridgeResultV1>();
  for (const {spot,result} of e.solves) {
    const key=hashBridgeSpot(spot);assert.ok(!policies.has(key),"Duplicate solve policy");
    if(spot.tree.mode==="turn-subgame-v1")requireTurnPlayingResult(result,spot,key);
    else if(spot.tree.mode==="river-subgame-v1")requireRiverPlayingResult(result,spot,key);
    else requirePlayingResult(result,spot,key);
    policies.set(key,result);
  }
  assert.deepEqual([...policies.keys()].sort(),[...new Set(r.attempts.map(a=>a.spotHash))].sort(),"Missing or extra solve policy");
  const fetcher:typeof fetch=async path=>{
    assert.match(String(path),/^\/solver-data\/[a-zA-Z0-9/_.-]+$/);assert.ok(!String(path).includes(".."));
    return new Response(readFileSync(`public${path}`));
  };
  let seed=0;const seen:{seed:number;spotHash:string;accepted:true}[]=[];
  const c=new PlayController((s,h,signal)=>loadPlayHand(s,h,async spot=>{
    const key=hashBridgeSpot(spot);assert.doesNotMatch(JSON.stringify(spot),/"(aiHand|humanHand|runout)":/);
    seen.push({seed,spotHash:key,accepted:true});assert.ok(policies.has(key),"Missing replay policy");return policies.get(key)!;
  },signal,fetcher));
  try {
    for (const item of P5_UI_CORPUS.cases) {
      seed=item.seed;const row=r.rows[seed];assert.equal(row.seed,seed);assert.equal(row.humanSeat,item.humanSeat);assert.equal(row.passed,true);
      assert.deepEqual(r.replayRows[seed],{seed,passed:true});await c.start(seed,item.humanSeat);
      for(let guard=0;guard<200;guard++) {
        const v=c.getSnapshot();assert.ok(v.hand);validatePublicState(v.hand.public);
        assert.equal(v.hand.public.pot+v.hand.public.stacks[0]+v.hand.public.stacks[1],20050);
        if(v.phase==="complete")break;
        assert.equal(v.phase,"human",`seed ${seed}: ${v.message}`);assert.equal(v.hand.aiHand,null);
        assert.ok(v.decisions.every(d=>d.actor!=="ai"||(d.strategy===null&&d.actionEvs===null)));
        await c.act(p5HumanAction(v));
      }
      const v=c.getSnapshot();assert.equal(v.phase,"complete");assert.ok(v.hand?.finalStacks);
      assert.equal(v.hand.finalStacks[0]+v.hand.finalStacks[1],20050);
      // P0's deterministic-action CDF distance is Infinity in memory and null in
      // JSON. Compare the actual exported representation as well as its hash.
      assert.equal(hashHandLog(c.completedLog()),row.logHash);assert.equal(canonicalSolverJson(c.completedLog()),canonicalSolverJson(row.log));
      assert.equal(p5Hash(v.decisions),row.decisionsHash);assert.deepEqual([...new Set(v.decisions.map(d=>d.public.street))],row.streets);
      assert.deepEqual(v.ledger.at(-1),row.ledger);assert.equal(row.ledger.humanNet+row.ledger.aiNet,50);
      await c.resume();assert.deepEqual(c.getSnapshot().ledger,v.ledger);
    }
    assert.deepEqual(seen,r.attempts);assert.deepEqual(c.getSnapshot().ledger,r.ledger);
    return {format:"poker-face-p5-ui-summary",version:1,reportHash:payloadHash,sourceHash:r.frozen.sourceHash,
      hands:r.rows.length,replayed:r.replayRows.length,solveAttempts:seen.length,uniquePolicies:policies.size,
      turnHands:r.rows.filter(row=>row.streets.includes("turn")).length,riverHands:r.rows.filter(row=>row.streets.includes("river")).length,
      humanNet:r.ledger.reduce((s,row)=>s+row.humanNet,0),aiNet:r.ledger.reduce((s,row)=>s+row.aiNet,0),
      method:"200 real UI-controller hands, exact hash-bound policy replay. Original capture used one-thread native solves; not a browser performance or global-safety claim."};
  }finally{c.dispose();}
}

async function main() {
  const args=process.argv.slice(2);
  if(args[0]==="--pack"&&args.length===2) {
    const dir=resolve(args[1]),report=JSON.parse(readFileSync(`${dir}/report.json`,"utf8"));
    assert.deepEqual(JSON.parse(readFileSync(`${dir}/inputs.json`,"utf8")),report.frozen);
    for(const row of report.rows)assert.deepEqual(JSON.parse(readFileSync(`${dir}/hand-${row.seed}.json`,"utf8")),row);
    const solves=readdirSync(`${dir}/solves`).sort().map(name=>{
      assert.match(name,/^[a-f0-9]{64}\.json$/);const value=JSON.parse(readFileSync(`${dir}/solves/${name}`,"utf8"));
      assert.equal(`${hashBridgeSpot(value.spot)}.json`,name);return value;
    });
    const e:P5Evidence={format:"poker-face-p5-ui-evidence",version:1,report,solves};
    const summary=await checkP5Evidence(e),plain=Buffer.from(canonicalSolverJson(e)+"\n"),compressed=gzipSync(plain,{level:9});
    writeFileSync(`${P5_STEM}.json.gz`,compressed,{flag:"wx"});
    writeFileSync(`${P5_STEM}.json`,canonicalSolverJson({format:"poker-face-p5-ui-evidence-bundle",version:1,
      bytes:compressed.length,sha256:digest(compressed),uncompressedBytes:plain.length,uncompressedSha256:digest(plain)})+"\n",{flag:"wx"});
    writeFileSync(`${P5_STEM}-summary.json`,canonicalSolverJson(summary)+"\n",{flag:"wx"});console.log(summary);
  }else {
    assert.deepEqual(args,["--check"]);const summary=await checkP5Evidence(readP5Evidence());
    assert.equal(canonicalSolverJson(summary)+"\n",readFileSync(`${P5_STEM}-summary.json`,"utf8"));console.log(summary);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
