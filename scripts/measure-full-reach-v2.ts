/** First v2 gate: reuse six identified native exports; no new solve or publication. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";
import { buildFormationManifest, formationSpot, formationPlan, FORMATION_BUDGETS as B } from "../src/lib/solver/bridge/formations/fixtures";
import { checkFormationResult, formationReservation } from "../src/lib/solver/bridge/formations/library";
import { encodeFullReachNode, splitFullReachChunks, validateFullReachParts, auditFullReachChunks } from "../src/lib/solver/bridge/formations/full-reach-v2";
import { portableFileTotals } from "../src/lib/solver/bridge/formations/portable-compression";
import { diagnosticContext, hashes, readHashed, type DiagnosticObservation } from "./capture-formation-export-diagnostic";
import { auditExportObservation } from "./audit-formation-export-diagnostic";

export const FULL_REACH_EVIDENCE = "tasks/artifacts/formation-full-reach-v2";
export const FULL_REACH_SOURCES = [
  `${FULL_REACH_EVIDENCE}/contract.md`, "src/lib/solver/bridge/formations/full-reach-v2.ts", "scripts/measure-full-reach-v2.ts",
  "src/lib/solver/bridge/formations/portable-compression.ts", "src/lib/solver/toy/artifact.ts", "src/lib/solver/preflop-v2/corpus.ts",
] as const;
const CACHE = "build/cpu-finish-2026-11-22/step13-full-work/formation-libraries-v1/cache";
const RAW = "build/co-export-diagnostic-2026-11-24/native-monitored/0.native.json";
const WORK = "build/formation-full-reach-v2";
const withHash = <T extends object>(payload: T) => ({ ...payload, payloadHash: hashJson(payload) });
function writeNew(path: string, value: unknown) { writeFileSync(path, prettyJson(value), { flag: "wx" }); }
interface OriginalRow { id: string; status: string; resultHash: string; elapsedMs: number; peakRssBytes: number; iterations: number }
interface Cache { payloadHash: string; identityHash: string; spotHash: string; planHash: string; resultHash: string; result: BridgeResultV1; elapsedMs: number; peakRssBytes: number }

export function fullReachScanContext() {
  const original = diagnosticContext(), observation = readHashed<DiagnosticObservation>("tasks/artifacts/formation-export-diagnostic-v1/observation.json");
  auditExportObservation(observation);
  const generation = readHashed<{ payloadHash: string; groups: { formation: string; rows: OriginalRow[] }[] }>("tasks/artifacts/formation-libraries-v1/generate.json");
  assert.equal(generation.payloadHash, "f3ce16febc3894af832190f6366412632c3a3399c668ffa48f6e665be98454ad");
  return { original, observation, generation, identity: {
    diagnosticHash: observation.payloadHash, originalEnvironmentHash: original.identity.originalEnvironmentHash,
    corpusHash: buildFormationManifest().payloadHash, generationHash: generation.payloadHash,
    sourceHashes: hashes(FULL_REACH_SOURCES), priorChargedNativeMs: observation.chargedNativeMs,
  } };
}

function measure() {
  const c = fullReachScanContext(), roots = buildFormationManifest().roots.filter(r => r.formation === "co-btn-srp-v1").slice(0, 6);
  const preflight = readHashed<{ payloadHash: string; rows: { id: string; rawEstimate: string; rawHash: string }[] }>("tasks/artifacts/formation-libraries-v1/preflight.json");
  mkdirSync(FULL_REACH_EVIDENCE, { recursive: true }); mkdirSync(WORK, { recursive: true });
  writeNew(`${FULL_REACH_EVIDENCE}/scan-start.json`, withHash({ identity: c.identity, startedAt: new Date().toISOString(), roots: roots.map(r => r.id) }));
  const rows = []; let inputBytes = 0;
  for (const [ordinal, root] of roots.entries()) {
    const spot = formationSpot(root.formation, root.boardId), plan = formationPlan(root.formation, root.boardId);
    const estimate = preflight.rows.find(r => r.id === root.id)!; assert.equal(sha256(estimate.rawEstimate), estimate.rawHash);
    assert.ok(formationReservation(spot, estimate.rawEstimate).admitted);
    let result: BridgeResultV1, sourceHash: string, elapsedMs: number, peakRssBytes: number;
    const source = ordinal < 5 ? `${CACHE}/${root.spotHash}.json` : RAW, bytes = readFileSync(source);
    inputBytes += bytes.length; assert.ok(inputBytes <= B.cacheBytes);
    if (ordinal < 5) {
      const cached = readHashed<Cache>(source), original = c.generation.groups.find(g => g.formation === root.formation)!.rows.find(r => r.id === root.id)!;
      assert.equal(original.status, "passed"); assert.equal(cached.identityHash, c.original.identity.originalIdentityHash);
      assert.equal(cached.spotHash, root.spotHash); assert.equal(cached.planHash, root.planHash);
      assert.equal(cached.resultHash, original.resultHash); assert.equal(hashJson(cached.result), original.resultHash);
      assert.equal(cached.elapsedMs, original.elapsedMs); assert.equal(cached.peakRssBytes, original.peakRssBytes);
      result = cached.result; sourceHash = cached.payloadHash; elapsedMs = cached.elapsedMs; peakRssBytes = cached.peakRssBytes;
    } else {
      const previous = c.observation.runs[0]; assert.equal(sha256(bytes), previous.resultHash); assert.equal(bytes.length, previous.resultBytes);
      result = JSON.parse(bytes.toString("utf8")); sourceHash = previous.resultHash; elapsedMs = previous.elapsedMs; peakRssBytes = previous.peakRssBytes;
    }
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= B.rawResultBytes); checkFormationResult(spot, plan, result);
    assert.ok(elapsedMs <= B.perSolveMs && peakRssBytes <= B.rssBytes);
    const context = { id: root.id, spotHash: root.spotHash, flop: spot.board.flop, effectiveStack: spot.effectiveStack,
      ranges: { hands: result.hands, weights: [spot.ranges[0].combos.map(h => h.weight), spot.ranges[1].combos.map(h => h.weight)] as const } };
    const chunks = splitFullReachChunks(result.slices!.nodes.map(encodeFullReachNode), context);
    validateFullReachParts(chunks, context);
    for (const key of ["flop", ...plan.turn!.cards.map(t => `turn-${t}`)]) assert.ok(chunks.some(c => c.key === key));
    for (const pair of plan.river!.boards) assert.ok(chunks.some(c => c.key.startsWith(`river-${pair.join("")}-`)));
    const invariants = auditFullReachChunks(chunks, context.ranges, spot), files = new Map(chunks.map(c => [`${c.key}.part-${String(c.part).padStart(3, "0")}.json`, canonicalSolverJson(c)]));
    const totals = portableFileTotals(files), status = invariants.failures.length ? "failed" : "passed";
    const failures = new Set(invariants.failures.map(f => f.split(": ")[0]).map(p => p === "(root)" ? "" : p));
    const witnessPaths = new Set(failures);
    for (const n of result.slices!.nodes) if (failures.has(n.path.join(" "))) {
      n.actions.forEach(a => witnessPaths.add([...n.path, a.token].join(" ")));
      for (let i = 0; i < n.path.length; i++) witnessPaths.add(n.path.slice(0, i).join(" "));
    }
    const witnesses = result.slices!.nodes.filter(n => witnessPaths.has(n.path.join(" ")));
    const row = { id: root.id, spotHash: root.spotHash, planHash: root.planHash, provenance: ordinal < 5 ? "original-accepted-cache" : "diagnostic-run-zero",
      source, sourceHash, sourceBytesHash: sha256(bytes), resultHash: hashJson(result), status, iterations: result.iterations,
      pctPot: result.exploitability.pctPot, elapsedMs, peakRssBytes, invariants, totals,
      encodedHashes: Object.fromEntries([...files].map(([p, s]) => [p, sha256(s)])), witnesses };
    writeNew(`${WORK}/${root.id}.json`, row); rows.push(row);
    console.log(JSON.stringify({ id: root.id, status, invariants, totals }));
    if (status === "failed") break;
  }
  assert.deepEqual(fullReachScanContext().identity, c.identity);
  const payload = { format: "poker-face-full-reach-scan", version: 2, identity: c.identity, rows, selectedInputBytes: inputBytes,
    passed: rows.length === 6 && rows.every(r => r.status === "passed"), newNativeSolves: 0, chargedNativeMs: c.observation.chargedNativeMs, published: false };
  writeNew(`${FULL_REACH_EVIDENCE}/scan.json`, withHash(payload));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--measure"]); measure();
}
