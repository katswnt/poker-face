/** Freeze inputs before invoking. --check independently re-enumerates and reproduces all bytes. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from "node:fs";
import {enumerateEquityCase} from "../src/lib/drills/equity-range/evaluate";
import {parseEquityInput,validateEquityDataset,MAX_DATA_BYTES} from "../src/lib/drills/equity-range/model";
import {independentEquityCase} from "./equity-range-reference";
const sha=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const inputPath="tasks/drills-equity-range-d2-inputs.json",frozen=readFileSync(inputPath);
assert.equal(sha(frozen),"58c6a5a980c677a293ce3faaeea7b6b1804d9b07406651d899da9c7b34827426","Inputs changed after their prospective freeze");
const write=process.argv.includes("--write");assert.ok(write||process.argv.includes("--check"),"Use --write or --check");
const cases=JSON.parse(frozen.toString()).cases.map((value:unknown)=>{
  const input=parseEquityInput(value),scores:Record<string,readonly number[]>={};
  const result=enumerateEquityCase(input,o=>{scores[`${[...o.cards].sort().join("")}|${o.river??"river"}`]=[o.heroScore,o.opponentScore];});
  const reference=independentEquityCase(input);assert.deepEqual(scores,reference.scores,input.id);assert.deepEqual(result,reference.result,input.id);
  return result;
});
const data=validateEquityDataset({format:"poker-face-equity-range",version:1,cases});
const bytes=Buffer.from(JSON.stringify(data)+"\n");assert.ok(bytes.length<=MAX_DATA_BYTES);
const paths=[inputPath,"src/lib/drills/equity-range/model.ts","src/lib/drills/equity-range/evaluate.ts","scripts/equity-range-reference.ts","scripts/build-equity-range-drills.ts","src/lib/poker/score7.ts","src/lib/poker/eval.ts","src/lib/poker/cards.ts","src/lib/solver/river/cards.ts"];
const plan=readFileSync("tasks/drill-expansion-plan.md","utf8");const contract=plan.slice(plan.indexOf("## Frozen D2 contract"),plan.indexOf("### D2 gates"));assert.ok(contract.length>1000);
const identity={format:data.format,version:1,contractSha256:sha(contract),inputs:paths.map(path=>({path,sha256:sha(readFileSync(path))}))};
const datasetId=sha(JSON.stringify(identity)+"\n"),file="cases.json",output="public/drill-data/equity-range-v1";
const manifest={...identity,datasetId,file,bytes:bytes.length,sha256:sha(bytes),cases:data.cases.map(c=>({id:c.input.id,level:c.input.level}))};
const encoded=JSON.stringify(manifest,null,2)+"\n",manifestPath="src/lib/drills/equity-range/manifest.json";
if(write){mkdirSync(output,{recursive:true});writeFileSync(`${output}/${file}`,bytes);writeFileSync(manifestPath,encoded);}else{assert.deepEqual(readFileSync(`${output}/${file}`),bytes);assert.equal(readFileSync(manifestPath,"utf8"),encoded);}
assert.deepEqual(readdirSync(output),[file]);
console.log(JSON.stringify({datasetId,cases:data.cases.length,bytes:bytes.length,outcomes:data.cases.reduce((n,c)=>n+c.outcomeCount,0),weightedOutcomes:data.cases.reduce((n,c)=>n+c.weightedOutcomes,0),blockedRows:data.cases.reduce((n,c)=>n+c.rows.filter(r=>r.blockedBy.length).length,0),passed:true}));
