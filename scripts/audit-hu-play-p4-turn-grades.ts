/** First reached turn in each prospectively frozen parent family, not selected by quality.
 * Full future policies must match their actually played first-street exports exactly.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { firstStreetProjection } from "./hu-play-p1-corpus";
import { gradeBridgeTurn } from "../src/lib/solver/bridge/turn-referee";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS } from "../src/lib/solver/bridge/referee";
import { checkBridgeResult, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

// First reached turn in each fixed 50-case family; selection never depends on a grade.
const families = [0, 1, 2, 3] as const;
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const write = (path: string, value: unknown) => writeFileSync(path, bytesOf(value), { flag: "wx" });
export function checkCompleteTurnReference(spot: BridgeSpotV1, result: BridgeResultV1, playing: BridgeResultV1) {
  assert.equal(spot.solve.exportScope, "full", "Independent turn grade requires a complete future strategy");
  checkBridgeResult(result, spot, hashBridgeSpot(spot));
  assert.deepEqual(firstStreetProjection(result), firstStreetProjection(playing), "Complete reference differs from actual first-street policy");
  const grade = gradeBridgeTurn(spot, result);
  assert.ok(Math.abs(grade.exploitability - result.exploitability.chips) <= BRIDGE_FLOAT32_TOLERANCE_CHIPS,
    "Engine and independent complete-turn grade disagree beyond the locked tolerance");
  assert.ok(grade.exploitabilityPctPot <= .3, "Independent complete-turn quality target failed");
  return grade;
}
async function main() {
  const [flag, inputPath, outFlag, outPath, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--native" && inputPath && outFlag === "--out" && outPath && !rest.length);
  const input = resolve(inputPath), directory = resolve(outPath); assert.ok(!existsSync(directory));
  const native = JSON.parse(readFileSync(join(input, "report.json"), "utf8")), { payloadHash, ...payload } = native;
  assert.equal(payloadHash, digest(bytesOf(payload))); assert.equal(native.format, "poker-face-p4-production-playing");
  assert.equal(native.rows.length, 200); assert.ok(native.rows.every((r: { status: string }) => r.status === "complete"));
  assert.equal(digest(readFileSync(BRIDGE_BINARY)), native.nativeBinarySha256);
  for (const ref of native.sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256, `Native source changed: ${ref.path}`);
  const sourcePaths = ["scripts/audit-hu-play-p4-turn-grades.ts", "src/lib/solver/bridge/turn-referee.ts",
    "src/lib/solver/postflop/vector/kernels.ts", "src/lib/solver/bridge/contract.ts", "src/lib/hu-play/public-state.ts"];
  const sourceFiles = sourcePaths.map(path => ({ path, sha256: digest(readFileSync(path)) }));
  mkdirSync(directory); const rows = [];
  const sampleSeeds = families.map(family => {
    const row = native.rows.find((r: { seed: number; solves: { street: string }[] }) =>
      r.seed >= 50 * family && r.seed < 50 * (family + 1) && r.solves.some(s => s.street === "turn"));
    assert.ok(row, "Each frozen family must reach at least one turn"); return row.seed as number;
  });
  for (const seed of sampleSeeds) {
    console.error(JSON.stringify({ type: "complete-turn-sample", seed }));
    const attempt = JSON.parse(readFileSync(join(input, `case-${seed}-attempt-0.json`), "utf8"));
    assert.equal(attempt.accepted, true); assert.equal(attempt.profile, "play-v1"); assert.equal(attempt.spot.board.river, null);
    const spot: BridgeSpotV1 = { ...attempt.spot, solve: { ...attempt.spot.solve, exportScope: "full" } };
    write(join(directory, `seed-${seed}.spot.json`), spot);
    try {
      const run = await runBridgeSpot(spot, { threads: 1 }); write(join(directory, `seed-${seed}.result.json`), run.result);
      const start = performance.now(), grade = checkCompleteTurnReference(spot, run.result, attempt.result);
      const row = { seed, passed: true, spotHash: run.spotHash, playingSpotHash: attempt.spotHash,
        iterations: run.result.iterations, enginePctPot: run.result.exploitability.pctPot, grade,
        firstStreetHash: digest(bytesOf(firstStreetProjection(attempt.result))),
        resultHash: digest(bytesOf(run.result)), gradeWallMs: performance.now() - start };
      rows.push(row); write(join(directory, `seed-${seed}.grade.json`), row);
    } catch (e) {
      const row = { seed, passed: false, error: e instanceof Error ? e.message : String(e) };
      rows.push(row); write(join(directory, `seed-${seed}.failure.json`), row);
    }
  }
  for (const ref of sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256);
  const report = { format: "poker-face-p4-complete-turn-grades", version: 1, measuredAt: new Date().toISOString(),
    nativeReportHash: payloadHash, inputsHash: native.inputsHash, sampleSeeds,
    sourceFiles, rows, passed: rows.every(r => r.passed),
    method: "First reached turn in each of four fixed families; original full ranges and solve settings; only export scope changes. Independently grades complete raw policies, not safety of composed re-solving or arbitrary future play." };
  write(join(directory, "report.json"), { ...report, payloadHash: digest(bytesOf(report)) });
  console.log(JSON.stringify({ directory, passed: report.passed, rows: rows.map(r => ({ seed: r.seed, passed: r.passed })) }));
  assert.equal(report.passed, true);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
