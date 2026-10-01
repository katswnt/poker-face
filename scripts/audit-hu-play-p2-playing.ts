/** Native production-adapter/reducer gate on the SAME frozen 200 public inputs. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus, release } from "node:os";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { buildNestedRiverSpot } from "../src/lib/hu-play/river-tree";
import { loadP1ProductionRoots } from "./hu-play-p1-corpus";
import { makeRiverOffTreeCase } from "./hu-play-p2-corpus";
import { playRiverCase, type RiverOffTreeCase } from "./hu-play-p2-playing-case";
import { wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { BRIDGE_BINARY } from "./bridge-runner";

interface FrozenCase extends RiverOffTreeCase {
  rootCorpusIndex: number; baselineHash: string; spot: BridgeSpotV1; spotHash: string;
}
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 4 && args[0] === "--inputs" && args[2] === "--out", "Use --inputs FROZEN_PILOT_DIRECTORY --out NEW_DIRECTORY");
  const input = resolve(args[1]), out = resolve(args[3]); assert.ok(!existsSync(out)); mkdirSync(out);
  const frozen = JSON.parse(readFileSync(join(input, "inputs.json"), "utf8")), { payloadHash, ...payload } = frozen;
  assert.equal(payloadHash, wideHash(payload));
  assert.equal(payloadHash, "4f2a1442b882460371645954ce69ae700324d7427a3271d013d505a156f6325c", "Do not replace the frozen 200 cases");
  const cases: FrozenCase[] = frozen.cases; assert.equal(cases.length, 200);
  const roots = loadP1ProductionRoots().filter(r => r.street === "river");
  const sourcePaths = ["scripts/audit-hu-play-p2-playing.ts", "scripts/hu-play-p2-corpus.ts", "scripts/hu-play-p2-playing-case.ts",
    "native/solver-bridge/src/lib.rs", "native/solver-bridge/src/spot.rs", "native/solver-bridge/Cargo.lock",
    "src/lib/solver/bridge/referee.ts", "src/lib/solver/river/cards.ts", "src/lib/solver/postflop/vector/kernels.ts",
    "src/lib/solver/bridge/contract.ts", "src/lib/solver/bridge/river-hand-values.ts",
    ...["hand", "async-hand", "play-hand", "types", "public-state", "reach", "rng", "resolve-spot", "river-tree", "river-menu", "river-translation"].map(n => `src/lib/hu-play/${n}.ts`),
    ...["policy", "resolved", "native", "browser", "nested-river", "river-play"].map(n => `src/lib/hu-play/sources/${n}.ts`),
    ...["admission", "play-profile", "river-profile", "river-quality", "runtime", "client"].map(n => `src/lib/solver/bridge/live/${n}.ts`)];
  const sourceFiles = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const nativeBinarySha256 = createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex");
  const rows = [];
  for (const c of cases) {
    console.error(JSON.stringify({ type: "playing-case", seed: c.seed }));
    assert.ok(Number.isSafeInteger(c.seed) && c.seed >= 0 && c.seed < 200);
    const root = roots[c.seed % 32]; assert.equal(root.corpusIndex, c.rootCorpusIndex);
    const baseline: { spot: BridgeSpotV1; result: BridgeResultV1 } = JSON.parse(readFileSync(join(input, `baseline-${root.corpusIndex}.json`), "utf8"));
    assert.equal(hashBridgeSpot(baseline.spot), c.baselineHash);
    const regenerated = makeRiverOffTreeCase(c.seed, root.request, baseline.result);
    const { rootCorpusIndex, baselineHash, spot, spotHash, ...originalCase } = c; void rootCorpusIndex; void baselineHash;
    assert.deepEqual(regenerated, originalCase); assert.deepEqual(buildNestedRiverSpot(c.request, c.actual), spot);
    assert.equal(hashBridgeSpot(spot), spotHash);
    const cache = new Map<string, BridgeResultV1>(), solves: unknown[] = [], keys: string[] = [];
    const estimates = new Map<string, unknown>();
    try {
      const completed = await playRiverCase(c, root.request, baseline.result, async s => {
        const hash = hashBridgeSpot(s); keys.push(hash);
        const result = await solveNativePlay(s, { onEstimate: (inputSpot, estimate, verdict) => {
          estimates.set(hashBridgeSpot(inputSpot), { estimate, verdict }); assert.ok(verdict.ok);
        } }, undefined, "play-river-v1");
        requireRiverPlayingResult(result, s, hash);
        const grade = gradeRiverHands(s, result); assert.ok(grade.exploitabilityPctPot <= .3, "Independent per-solve river target failed");
        cache.set(hash, result);
        write(join(out, `case-${c.seed}-solve-${solves.length}.json`), { spot: s, result });
        solves.push({ spotHash: hash, numericalHash: wideHash(mathProjection(result)), iterations: result.iterations,
          enginePctPot: result.exploitability.pctPot, grade, reservation: estimates.get(hash) });
        return result;
      });
      const replayKeys: string[] = [];
      const replay = await playRiverCase(c, root.request, baseline.result, async s => {
        const hash = hashBridgeSpot(s); replayKeys.push(hash);
        const result = cache.get(hash); assert.ok(result, "Replay requested a different public solve"); return result;
      });
      assert.deepEqual(replayKeys, keys); assert.equal(replay.logHash, completed.logHash);
      write(join(out, `case-${c.seed}.playing.json`), completed);
      rows.push({ seed: c.seed, status: "complete", logHash: completed.logHash, deterministicReplay: true, conserved: true,
        provenance: completed.provenance, publicSolveKeys: keys, solves, elapsedMs: completed.elapsedMs });
    } catch (e) {
      const row = { seed: c.seed, status: "failed", reason: String(e), publicSolveKeys: keys, solves };
      rows.push(row); console.error(JSON.stringify(row));
    }
  }
  for (const ref of sourceFiles) assert.equal(createHash("sha256").update(readFileSync(ref.path)).digest("hex"), ref.sha256,
    "Source changed during the measurement; preserve this attempt and repeat");
  assert.equal(createHash("sha256").update(readFileSync(BRIDGE_BINARY)).digest("hex"), nativeBinarySha256);
  const report = { format: "poker-face-p2-production-playing", version: 1, measuredAt: new Date().toISOString(),
    nativeBinarySha256,
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, inputsHash: payloadHash,
    sourceFiles, sourceHash: wideHash(sourceFiles), interpretation: "Real public adapters and river-parent reducer continuations, not full preflop-to-river replays. Native clocks are not browser promises. Re-solving is local and approximate, not a global guarantee.", rows };
  write(join(out, "report.json"), { ...report, payloadHash: wideHash(report) });
  const complete = rows.filter(r => r.status === "complete").length;
  console.log(JSON.stringify({ out, complete, failed: 200 - complete,
    translated: rows.filter(r => "provenance" in r && r.provenance?.source === "translation").length }));
  assert.equal(complete, 200, "Do not drop failed cases or soften the P2 completion gate");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
