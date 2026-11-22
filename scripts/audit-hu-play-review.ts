/** H1 preservation audit: hash-checked P5/E1 policies, no fresh solve or changed evidence. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { readP5Evidence, p5Hash } from "./audit-hu-play-p5";
import { P5_UI_CORPUS, p5HumanAction } from "./hu-play-p5-human";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { PlayController, loadPlayHand } from "../src/lib/hu-play/ui-controller";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { reviewDecision, ReviewArchive, serializeReview, REVIEW_LIMITS } from "../src/lib/hu-play/review";
import { actionToken, derivePublicState } from "../src/lib/hu-play/public-state";

const summarize=(xs:number[])=>{const sorted=[...xs].sort((a,b)=>a-b);return {p50:sorted[Math.ceil(xs.length*.5)-1],p95:sorted[Math.ceil(xs.length*.95)-1],max:sorted.at(-1)!};};
export async function auditReviewCorpus() {
  const e=readP5Evidence(),policies=new Map(e.solves.map(s=>[hashBridgeSpot(s.spot),s.result]));
  const identity={buildHash:e.report.frozen.e1!.wasmBuildHash,engineSourceHash:e.report.frozen.e1!.engineSourceHash};
  const fetcher:typeof fetch=async path=>{
    assert.match(String(path),/^\/solver-data\/[a-zA-Z0-9/_.-]+$/);assert.ok(!String(path).includes(".."));
    return new Response(readFileSync(`public${path}`));
  };
  let seed=0,decisions=0,prices=0;const attempts:unknown[]=[],times:number[]=[],sizes:number[]=[],archive=new ReviewArchive();
  const grades={ready:0,unavailable:0,ai:0};
  const c=new PlayController((s,h,signal)=>loadPlayHand(s,h,async spot=>{
    const spotHash=hashBridgeSpot(spot);attempts.push({seed,spotHash,accepted:true});
    assert.ok(policies.has(spotHash),"Only the original preserved policies may be used");return policies.get(spotHash)!;
  },signal,fetcher));
  c.subscribe(()=>{
    const v=c.getSnapshot(),before=archive.getSnapshot(),start=performance.now();
    archive.capture(v,identity,k=>c.equityInput(k));
    if(archive.getSnapshot()!==before)times.push(performance.now()-start);
  });
  try {
    for(const item of P5_UI_CORPUS.cases){
      seed=item.seed;await c.start(seed,item.humanSeat);
      for(let guard=0;guard<200&&c.getSnapshot().phase!=="complete";guard++){
        const v=c.getSnapshot();assert.equal(v.phase,"human",`seed ${seed}: ${v.message}`);
        await c.act(p5HumanAction(v));
      }
      const v=c.getSnapshot(),expected=e.report.rows[seed];assert.equal(v.phase,"complete");
      assert.equal(hashHandLog(c.completedLog()),expected.logHash);assert.equal(p5Hash(v.decisions),expected.decisionsHash);
      const r=archive.getSnapshot().reviews.at(-1)!;assert.equal(r.id,v.ledger.at(-1)!.id);
      sizes.push(Buffer.byteLength(serializeReview(r)));
      assert.equal(r.decisions.length,v.hand!.public.events.filter(x=>x.kind==="action").length);
      for(let i=0;i<r.decisions.length;i++){
        const x=reviewDecision(r,i),d=x.decision;decisions++;
        assert.deepEqual(d,v.decisions.find(d=>d.key===x.decision.key));
        assert.deepEqual(x.equityInput,c.equityInput(d.key));
        const call=Math.max(...d.public.streetPut)-d.public.streetPut[d.public.toAct!];
        if(!call)assert.equal(x.price,null);
        else{
          prices++;const prior=derivePublicState(d.public,d.public.events.slice(0,-1));
          const event=d.public.events.at(-1)!;assert.ok(event.kind==="action"&&(event.action.type==="bet"||event.action.type==="raise"));
          const risk=event.action.to-prior.streetPut[event.player];
          assert.equal(x.price!.call,call);assert.equal(x.price!.requiredEquity,call/(d.public.pot+call));
          assert.equal(x.price!.minimumDefence,prior.pot/(prior.pot+risk));
          assert.equal(x.price!.polarBluffShare,call/(d.public.pot+call));
        }
        const j=d.strategy?.findIndex(a=>actionToken(a.action)===actionToken(x.action))??-1;
        const complete=d.actionEvs?.length===d.strategy?.length&&!!d.actionEvs?.length&&d.actionEvs.every(n=>n!==null&&Number.isFinite(n));
        const supported=(d.actionEvBasis==="original-saved-policy"&&d.provenance.source==="library")
          ||(d.actionEvBasis==="local-solved-policy"&&d.provenance.source==="resolve"&&d.public.street!=="flop"&&d.provenance.precision==="float32");
        if(d.actor!=="human"){grades.ai++;assert.equal(x.grade.status,"unavailable");}
        else if(complete&&supported&&j>=0){
          grades.ready++;assert.equal(x.grade.status,"ready");if(x.grade.status!=="ready")throw Error("grade");
          const values=d.actionEvs as number[];assert.equal(x.grade.selectedEvChips,values[j]);
          assert.equal(x.grade.bestEvChips,Math.max(...values));assert.equal(x.grade.gapChips,Math.max(...values)-values[j]);
          assert.equal(x.grade.basis,d.actionEvBasis);
        }else{grades.unavailable++;assert.equal(x.grade.status,"unavailable");}
      }
      // Capturing, browsing every decision and serializing must be observational only.
      assert.equal(hashHandLog(c.completedLog()),expected.logHash);assert.equal(p5Hash(c.getSnapshot().decisions),expected.decisionsHash);
      assert.deepEqual(c.getSnapshot().ledger.at(-1),expected.ledger);
    }
    assert.deepEqual(attempts,e.report.attempts);assert.deepEqual(c.getSnapshot().ledger,e.report.ledger);
    assert.equal(times.length,200);const storage=archive.getSnapshot();assert.ok(sizes.every(n=>n<=REVIEW_LIMITS.perHandBytes));
    assert.ok(storage.bytes<=REVIEW_LIMITS.bytes&&storage.reviews.length<=REVIEW_LIMITS.hands);
    return {format:"poker-face-h1-preservation-audit",version:1,parentReportHash:e.report.payloadHash,
      hands:200,decisions,prices,grades,logMismatches:0,missingDecisions:0,solveRequests:attempts.length,
      bytes:summarize(sizes),maxBytes:Math.max(...sizes),captureMs:summarize(times),
      retained:storage.reviews.length,retainedBytes:storage.bytes,evicted:storage.evicted,
      method:"Original hash-checked P5/E1 policies; no fresh solve, no new accuracy or browser-performance claim."};
  }finally{c.dispose();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  auditReviewCorpus().then(r=>{console.log(JSON.stringify(r,null,2));assert.ok(r.captureMs.max<=100,"H1 100 ms capture gate");})
    .catch(e=>{console.error(e);process.exitCode=1;});
}
