/** P1 ladder gate: native full vs browser-admitted ranges, then independent full-game grades.
 * No pruning is enabled: both solves must retain every positive hand and be bit-identical.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { NativeResolveSource } from "../src/lib/hu-play/sources/native";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { gradeBridgeTurn } from "../src/lib/solver/bridge/turn-referee";
import { BRIDGE_BINARY, runBridgeSpot, type BridgeRun } from "./bridge-runner";
import { firstStreetProjection, gameProjection, loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { P1_FROZEN_ADMISSION_HASH, wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";

const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 && args[0] === "--out", "Use --out NEW_DIRECTORY (all 64 roots, rivers first)");
  const directory = resolve(args[1]); assert.ok(!existsSync(directory)); mkdirSync(directory);
  const rows = [], roots = loadP1ProductionRoots();
  for (const root of roots) {
    console.error(JSON.stringify({ type: "start", corpusIndex: root.corpusIndex, street: root.street }));
    const runs: BridgeRun[] = [];
    for (const label of ["full", "browser"] as const) {
      const source = new NativeResolveSource({ onEstimate(spot, estimate, verdict) {
        assert.deepEqual(gameProjection(spot), gameProjection(root.spot));
        assert.ok(verdict.ok, `${label} admission failed`); void estimate;
      }, onResult: (_spot, run) => { runs.push(run); } });
      await source.prepare(structuredClone(root.request));
      assert.deepEqual(source.policy(root.request).provenance.ladder?.prunedMass, [0, 0]);
    }
    assert.equal(runs.length, 2);
    const [full, browser] = runs, spot = root.playingSpot;
    assert.equal(full.spotHash, hashBridgeSpot(spot));
    assert.deepEqual(mathProjection(full.result), mathProjection(browser.result), "Full/browser numerical mismatch");
    write(join(directory, `root-${root.corpusIndex}.playing.json`), full.result);
    const completeSpot = { ...spot, solve: { ...spot.solve, exportScope: "full" as const } };
    // A separate FULL turn export is essential: a truncated first-street policy cannot
    // certify future decisions. Export scope changes, never the game/iterations/precision.
    const complete = root.street === "turn" ? await runBridgeSpot(completeSpot, { threads: 1 }) : full;
    if (root.street === "turn") {
      requirePlayingResult(complete.result, completeSpot, hashBridgeSpot(completeSpot));
      assert.deepEqual(firstStreetProjection(full.result), firstStreetProjection(complete.result));
      write(join(directory, `root-${root.corpusIndex}.complete.json`), complete.result);
    }
    const began = performance.now();
    const grade = root.street === "turn" ? gradeBridgeTurn(completeSpot, complete.result)
      : gradeRiverSubgame({ hands: complete.result.hands, startingPot: spot.startingPot,
        subtree: { path: [], nodes: complete.result.tree, ev: complete.result.root.engineEv,
          reach: [spot.ranges[0].combos.map(h => h.weight), spot.ranges[1].combos.map(h => h.weight)] } });
    const pct = "exploitabilityPctPot" in grade ? grade.exploitabilityPctPot : grade.localExploitabilityPctPot;
    assert.ok(Number.isFinite(pct) && pct >= 0);
    if (root.street === "river") assert.ok(pct <= .3, "Independent river target failed");
    const evDifference = full.result.root.ev[root.request.aiSeat].map((v, h) => browser.result.root.ev[root.request.aiSeat][h] - v);
    assert.ok(evDifference.every(v => v === 0));
    const row = { corpusIndex: root.corpusIndex, seed: root.seed, street: root.street, sourceSpotHash: root.sourceSpotHash,
      playingSpotHash: full.spotHash, numericalHash: wideHash(mathProjection(full.result)),
      completeNumericalHash: wideHash(mathProjection(complete.result)), firstStreetHash: wideHash(firstStreetProjection(full.result)),
      fullRangeHands: spot.ranges.map(r => r.combos.length), retainedReachMass: [1, 1], prunedMass: [0, 0], rung: "full",
      aiSeat: root.request.aiSeat, aiHands: full.result.hands[root.request.aiSeat], aiPerHandEvDifferenceChips: evDifference,
      iterations: full.result.iterations, enginePctPot: full.result.exploitability.pctPot,
      nativeWallMs: runs.map(r => r.elapsedMs), completeExportBytes: Buffer.byteLength(JSON.stringify(complete.result)),
      independentExploitabilityPctPot: pct, grade, gradeWallMs: performance.now() - began, passed: true };
    rows.push(row); write(join(directory, `root-${root.corpusIndex}.measurement.json`), row);
    console.log(JSON.stringify({ corpusIndex: row.corpusIndex, street: row.street, independentExploitabilityPctPot: pct, gradeWallMs: row.gradeWallMs }));
  }
  const sorted = rows.map(r => r.independentExploitabilityPctPot).sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  assert.ok(median <= 1, "Unchanged P1 median local-exploitability gate failed");
  const report = { format: "poker-face-p1-production-corpus", version: 1, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, sourceAdmissionHash: P1_FROZEN_ADMISSION_HASH,
    nativeBinarySha256: createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex"),
    interpretation: "Same frozen float32 finite games, complete ranges in both native runs; no pruning threshold enabled. Per-hand native EV difference is exactly zero by numerical identity. Independent complete-game grades hold arriving ranges fixed, not composed future re-solving or global safety. Physical phones unmeasured.",
    medianIndependentExploitabilityPctPot: median, rows };
  write(join(directory, "report.json"), { ...report, payloadHash: wideHash(report) });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
