// P1 research measurements. Never changes browser limits or the frozen full-range game.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { POSTFLOP_SOLVER_COMMIT, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { loadP1WideRoots, nativeMeasurementSpot, ratioMeasurementSpot, P1_FROZEN_ADMISSION_HASH, selectRatioCases, summarizeNativeRun, wideHash } from "./hu-play-wide-corpus";

const execute = promisify(execFile);
const binaryHash = () => createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex");
const machine = () => ({ cpu: cpus()[0].model, ramBytes: totalmem(), platform: platform(), osRelease: release(), node: process.version });
const writeNew = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });

/** CLI estimate builds tables only; it never calls allocate, step or finish. */
export async function estimateWideSpot(spot: BridgeSpotV1) {
  const directory = mkdtempSync(join(tmpdir(), "poker-p1-wide-estimate-")), path = join(directory, "spot.json");
  writeFileSync(path, canonicalBridgeSpotJson(spot));
  const started = performance.now();
  try {
    const result = await execute(BRIDGE_BINARY, ["estimate", path], { timeout: 60_000, maxBuffer: 1024 ** 2,
      env: { ...process.env, RAYON_NUM_THREADS: "1" } });
    const estimate = parseLiveEstimate(result.stdout, spot, hashBridgeSpot(spot));
    return { estimate, wallMs: performance.now() - started, command: ["estimate"], strategyStorageAllocated: false as const, iterations: 0 as const };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2), mode = args.shift();
  assert.ok(mode === "--estimate" || mode === "--solve" || mode === "--ratio", "Usage: --estimate --out file | --solve|--ratio --estimates file --out directory [--street river|turn|all]");
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--out", "--estimates", "--street"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--") && !values.has(args[i]), "Unknown/duplicate/incomplete option");
    values.set(args[i], args[i + 1]);
  }
  assert.ok(values.has("--out"));
  const out = resolve(values.get("--out")!); assert.ok(!existsSync(out), `Refusing to overwrite ${out}`);
  const roots = loadP1WideRoots();
  const metadata = { version: 1, measuredAt: new Date().toISOString(), machine: machine(), engineCommit: POSTFLOP_SOLVER_COMMIT,
    nativeBinarySha256: binaryHash(), sourceAdmissionHash: P1_FROZEN_ADMISSION_HASH };
  if (mode === "--estimate") {
    assert.equal(values.size, 1, "Estimate mode measures all 64 roots, rivers first");
    const rows = [];
    for (const root of roots) {
      const { spot, ...identity } = root;
      const measured = await estimateWideSpot(spot);
      const row = { ...identity, stackPotRatio: spot.effectiveStack / spot.startingPot, ...measured };
      rows.push(row); console.log(JSON.stringify(row));
    }
    const report = { format: "poker-face-p1-full-range-estimates", ...metadata,
      interpretation: "Native preflight storage/export estimates, not allocated strategy memory, solving, browser admission or measured peak RSS.",
      ratioCaseIndexes: selectRatioCases(rows.map(r => ({ ...r, estimatedBytes: r.estimate.estimatedBytes }))).map(r => r.corpusIndex), rows };
    writeNew(out, { ...report, payloadHash: wideHash(report) });
    return;
  }
  assert.ok(values.has("--estimates"), "All native estimates must precede solving");
  const estimates = JSON.parse(readFileSync(values.get("--estimates")!, "utf8"));
  const { payloadHash, ...payload } = estimates;
  assert.equal(wideHash(payload), payloadHash);
  assert.equal(estimates.format, "poker-face-p1-full-range-estimates");
  assert.equal(estimates.sourceAdmissionHash, P1_FROZEN_ADMISSION_HASH);
  assert.equal(estimates.nativeBinarySha256, metadata.nativeBinarySha256, "Estimate with this native binary before solving");
  assert.equal(estimates.rows.length, 64);
  const street = values.get("--street") ?? "all"; assert.ok(["river", "turn", "all"].includes(street));
  mkdirSync(out);
  const rows = [];
  const selected = mode === "--ratio" ? new Set<number>(estimates.ratioCaseIndexes) : null;
  for (const root of roots.filter(r => (street === "all" || r.street === street) && (!selected || selected.has(r.corpusIndex)))) {
    const { spot: original, ...identity } = root, spot = mode === "--ratio" ? ratioMeasurementSpot(original) : nativeMeasurementSpot(original);
    const estimateRow = estimates.rows.find((r: { corpusIndex: number }) => r.corpusIndex === root.corpusIndex);
    assert.equal(estimateRow?.sourceSpotHash, root.sourceSpotHash);
    assert.ok(estimateRow.estimate.estimatedBytes <= spot.solve.memoryCapBytes, "Research storage ceiling exceeded; do not attempt allocation");
    const resultName = `root-${root.corpusIndex}.result.json`;
    console.error(JSON.stringify({ type: "start", ...identity, hands: spot.ranges.map(r => r.combos.length) }));
    try {
      const run = await runBridgeSpot(spot, { threads: 1, onProgress: p => {
        if (p.iteration === undefined || p.iteration % 100 === 0) console.error(JSON.stringify({ corpusIndex: root.corpusIndex, ...p }));
      } });
      writeNew(join(out, resultName), run.result);
      const summary = summarizeNativeRun(spot, run);
      const referee = root.street === "river" && mode !== "--ratio" ? gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot,
        subtree: { path: [], nodes: run.result.tree, reach: [spot.ranges[0].combos.map(c => c.weight), spot.ranges[1].combos.map(c => c.weight)],
          ev: run.result.root.engineEv } }) : null;
      const row = { ...identity, status: mode === "--ratio" ? "measured" : summary.reached && (!referee || referee.localExploitabilityPctPot <= .3) ? "passed" : "target-missed",
        ...summary, referee, resultFile: resultName };
      rows.push(row); writeNew(join(out, `root-${root.corpusIndex}.measurement.json`), row);
      console.log(JSON.stringify(row));
    } catch (error) {
      const row = { ...identity, status: "failed", error: error instanceof Error ? error.message : String(error) };
      rows.push(row); writeNew(join(out, `root-${root.corpusIndex}.failure.json`), row); console.error(JSON.stringify(row));
    }
  }
  const report = { format: "poker-face-p1-full-range-native-observations", ...metadata, mode, sourceEstimateHash: payloadHash,
    interpretation: "Sequential 1-thread full-range float32 research solves; native engine self-grades except independently graded complete rivers. Not production play or browser latency.", rows };
  writeNew(join(out, "report.json"), { ...report, payloadHash: wideHash(report) });
  if (rows.some(r => r.status !== "passed" && r.status !== "measured")) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
