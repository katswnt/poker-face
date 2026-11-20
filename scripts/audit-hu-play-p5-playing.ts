/** 200 frozen full hands through the controller used by React. Native compute, exact
 * cached numerical replay, no browser latency claim. Retains every failure and raw solve.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { PlayController, loadPlayHand, type PlayLedgerRow, type PlayView } from "../src/lib/hu-play/ui-controller";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { validatePublicState } from "../src/lib/hu-play/public-state";
import { P5_UI_CORPUS, p5HumanAction } from "./hu-play-p5-human";
import { mathProjection } from "./hu-play-wide-measurement";
import { p5PipelineSources } from "./audit-hu-play-p5";
import { wasmBuild } from "./bridge-wasm-runner";
import { BRIDGE_BINARY } from "./bridge-runner";

interface PassedHand {
  seed: number; humanSeat: 0 | 1; log: ReturnType<PlayController["completedLog"]>;
  logHash: string; ledger: PlayLedgerRow; decisionsHash: string; streets: string[]; passed: true;
}

const hash = (x: unknown) => createHash("sha256").update(canonicalSolverJson(x)).digest("hex");
const fetcher: typeof fetch = async url => {
  assert.match(String(url), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(url).includes(".."));
  return new Response(readFileSync(`public${url}`));
};
async function main() {
  const raw=process.argv.slice(2),decisionValues=raw.at(-2)==="--decision-values"&&raw.at(-1)==="true";
  const [flag, out, ...rest] = decisionValues?raw.slice(0,-2):raw; assert.ok(flag === "--out" && out && !rest.length);
  const dir = resolve(out); assert.ok(!existsSync(dir), "Keep previous captures, including failures");
  mkdirSync(dir); mkdirSync(join(dir, "solves"));
  const write = (name: string, x: unknown) => writeFileSync(join(dir, name), canonicalSolverJson(x) + "\n", {flag:"wx"});
  const bundle = await build({entryPoints:["scripts/audit-hu-play-p5-playing.ts"],bundle:true,platform:"node",format:"esm",packages:"external",write:false,metafile:true});
  const sourceFiles = Object.keys(bundle.metafile.inputs).sort().map(path => ({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}));
  const engine=decisionValues?wasmBuild().manifest:null;
  const e1=engine?{decisionValues:true as const,sourceFiles:await p5PipelineSources(),engineSourceHash:engine.sourceHash,
    wasmBuildHash:engine.buildHash,nativeBinarySha256:createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex")}:undefined;
  const frozen = {corpus:P5_UI_CORPUS,corpusHash:hash(P5_UI_CORPUS),sourceFiles,sourceHash:hash(sourceFiles),...(e1?{e1}:{})};
  write("inputs.json", frozen); // Written before any hand or solve.
  const policies = new Map<string, BridgeResultV1>(), failures = new Map<string, string>();
  const attempts: {seed:number; spotHash:string; accepted:boolean; error?:string}[] = [];
  let seed = 0, replay = false;
  const controller = () => new PlayController((s,h,signal) => loadPlayHand(s,h,async (spot, abort) => {
    assert.ok(!/"(aiHand|humanHand|runout)"/.test(JSON.stringify(spot)), "Private cards entered solving");
    const key = hashBridgeSpot(spot);
    if (replay) {
      if (failures.has(key)) throw new Error(failures.get(key));
      assert.ok(policies.has(key), "Replay requested an unseen public game"); return policies.get(key)!;
    }
    const attempt = {seed,spotHash:key,accepted:false} as (typeof attempts)[number]; attempts.push(attempt);
    try {
      const profile = spot.tree.mode === "turn-subgame-v1" ? "play-turn-v1" : spot.tree.mode === "river-subgame-v1" ? "play-river-v1" : "play-v1";
      const result = await solveNativePlay(spot, {decisionValues}, abort, profile);
      if (policies.has(key)) assert.deepEqual(mathProjection(policies.get(key)!), mathProjection(result));
      else { policies.set(key,result); write(`solves/${key}.json`,{spot,result}); }
      attempt.accepted = true; return result;
    } catch (error) {
      attempt.error = error instanceof Error ? error.message : String(error);
      failures.set(key,attempt.error); throw error;
    }
  },signal,fetcher));
  const rows: (PassedHand | {seed:number;passed:false;error:string;view:PlayView})[] = [], c = controller();
  async function hand(instance: PlayController, item: (typeof P5_UI_CORPUS.cases)[number]): Promise<Omit<PassedHand,"passed">> {
    await instance.start(item.seed,item.humanSeat);
    for (let guard=0; guard<200; guard++) {
      const v = instance.getSnapshot();
      if (v.hand) {
        validatePublicState(v.hand.public);
        assert.equal(v.hand.public.pot + v.hand.public.stacks[0] + v.hand.public.stacks[1],20050);
      }
      if (v.phase === "complete") {
        assert.ok(v.hand?.finalStacks); assert.equal(v.hand.finalStacks[0]+v.hand.finalStacks[1],20050);
        const row = v.ledger.at(-1)!; assert.equal(row.humanNet+row.aiNet,50);
        const log = instance.completedLog(); await instance.resume(); assert.deepEqual(instance.getSnapshot().ledger,v.ledger);
        return {seed:item.seed,humanSeat:item.humanSeat,log,logHash:hashHandLog(log),ledger:row,
          decisionsHash:hash(v.decisions),streets:[...new Set(v.decisions.map(d => d.public.street))]};
      }
      assert.equal(v.phase,"human",`seed ${item.seed}: ${v.message}`);
      await instance.act(p5HumanAction(v));
    }
    throw new Error("UI hand exceeded the reducer action bound");
  }
  for (const item of P5_UI_CORPUS.cases) {
    seed=item.seed; console.error(JSON.stringify({stage:"p5-ui-hand",seed}));
    try {const row={...await hand(c,item),passed:true as const}; rows.push(row);write(`hand-${seed}.json`,row);}
    catch(error){const row={seed,passed:false as const,error:String(error),view:c.getSnapshot()};rows.push(row);write(`hand-${seed}.json`,row);}
  }
  const firstLedger=c.getSnapshot().ledger;c.dispose();replay=true;
  const second=controller(), replayRows=[];
  for (const item of P5_UI_CORPUS.cases) {
    seed=item.seed;
    try {const again=await hand(second,item),expected=rows[seed];assert.ok(expected.passed && "logHash" in expected);
      assert.equal(again.logHash,expected.logHash);assert.equal(again.decisionsHash,expected.decisionsHash);assert.deepEqual(again.ledger,expected.ledger);
      replayRows.push({seed,passed:true});}
    catch(error){replayRows.push({seed,passed:false,error:String(error)});}
  }
  const ledger=second.getSnapshot().ledger;second.dispose();
  for (const source of sourceFiles) assert.equal(createHash("sha256").update(readFileSync(source.path)).digest("hex"),source.sha256,"Source changed during measurement");
  if(e1){assert.deepEqual(await p5PipelineSources(),e1.sourceFiles,"Full E1 pipeline changed during capture");
    assert.equal(createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex"),e1.nativeBinarySha256,"Native binary changed during capture");}
  const passed=rows.every(r=>r.passed) && replayRows.every(r=>r.passed) && ledger.length===200;
  assert.deepEqual(firstLedger,ledger);
  const report={format:"poker-face-p5-ui-hands",version:1,measuredAt:new Date().toISOString(),frozen,rows,replayRows,attempts,ledger,passed,
    method:"All 200 frozen seeds through the actual React-independent UI controller and P4/P3/P2 sources. One-thread fresh native solves, then exact hash-bound policy replay. No browser timing or global-safety claim."};
  write("report.json",{...report,payloadHash:hash(report)});
  console.log(JSON.stringify({dir,passed,hands:rows.length,solves:attempts.length,failures:rows.filter(r=>!r.passed).map(r=>({seed:r.seed,error:"error" in r?r.error:null}))}));
  assert.ok(passed,"P5 UI cohort failed; preserve all failures and stop the gate");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
