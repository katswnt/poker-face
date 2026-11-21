/** Deterministic value export, not a fresh strategy solve. --check reproduces every byte. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import saved from "../src/lib/solver/pushfold-solutions.json";
import { evaluateProfile } from "../src/lib/drills/push-fold/evaluate";
import { MAX_DEPTH_BYTES, PROFILE_GAP_LIMIT_BB, validateDepth } from "../src/lib/drills/push-fold/model";

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const encode = (data: unknown) => JSON.stringify(data) + "\n";
const paths = ["src/lib/solver/pushfold-solutions.json","src/lib/solver/equity-matrix.json","src/lib/solver/hands.ts","src/lib/solver/comboCounts.ts","src/lib/drills/push-fold/evaluate.ts","src/lib/drills/push-fold/model.ts","scripts/build-push-fold-drills.ts"];
const plan = readFileSync("tasks/drill-expansion-plan.md","utf8");
const contract = plan.slice(plan.indexOf("## Frozen D1 contract"),plan.indexOf("### D1 gates"));
assert.ok(contract.length > 2000);
const inputs = paths.map(path => ({path,sha256:sha(readFileSync(path))}));
const identity = {format:"poker-face-push-fold-drills",version:1,contractSha256:sha(contract),inputs};
const datasetId = sha(encode(identity));
const output = "public/drill-data/push-fold-v1";
const write = process.argv.includes("--write");
assert.equal(write || process.argv.includes("--check"),true,"Use --write or --check");
if(write)mkdirSync(output,{recursive:true});
const chunks = []; let maxNashGapBb = 0, totalBytes = 0, decisions = 0;
for (const [depth,p] of Object.entries(saved.solutions)) {
  const result = evaluateProfile(p); validateDepth(result,p.stack);
  assert.ok(result.nashGapBb <= PROFILE_GAP_LIMIT_BB, `Profile gap failed: ${depth}`);
  for (const seat of ["sb","bb"] as const) for (const margin of [0.05,0.25]) assert.ok(result[seat].some(row => row && Math.abs(row.evBb) >= margin));
  const bytes = Buffer.from(encode(result)); assert.ok(bytes.length <= MAX_DEPTH_BYTES);
  const file = `${depth}.json`;
  if(write)writeFileSync(`${output}/${file}`,bytes); else assert.deepEqual(readFileSync(`${output}/${file}`),bytes,`Reproduction: ${file}`);
  chunks.push({stack:p.stack,file,bytes:bytes.length,sha256:sha(bytes)});
  totalBytes += bytes.length; decisions += result.sb.length + result.bb.filter(Boolean).length;
  maxNashGapBb = Math.max(maxNashGapBb,result.nashGapBb);
}
assert.equal(chunks.length,37); assert.equal(decisions,12506); assert.ok(totalBytes <= 8*1024**2);
assert.deepEqual(readdirSync(output).sort(),chunks.map(c=>c.file).sort(),"Unexpected data files");
const manifest = {...identity,datasetId,chunks,decisions,totalBytes,maxNashGapBb};
const manifestPath = "src/lib/drills/push-fold/manifest.json";
if(write)writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
else assert.equal(readFileSync(manifestPath,"utf8"),JSON.stringify(manifest,null,2)+"\n","Manifest reproduction");
console.log(JSON.stringify({datasetId,profiles:chunks.length,decisions,totalBytes,maxChunkBytes:Math.max(...chunks.map(c=>c.bytes)),maxNashGapBb,passed:true}));
