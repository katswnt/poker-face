import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { BRIDGE_BINARY, runBridgeSpot } from "../scripts/bridge-runner";
import { buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { BRIDGE_SLICE_PLAN_FORMAT, type BridgeSlicePlanV1 } from "../src/lib/solver/bridge/contract";
import { FORMATION_BUDGETS, FORMATION_INPUTS, formationSpot, buildFormationManifest } from "../src/lib/solver/bridge/formations/fixtures";
import { formationReservation, checkFormationResult, encodeFormationSpot, verifyDataFile } from "../src/lib/solver/bridge/formations/library";
import { replayAttemptStatus, validatePhaseReport } from "../scripts/build-formation-libraries";

test("phase evidence accounts for unknown outcomes, exact root identity and cumulative time", () => {
  const manifest = buildFormationManifest(), identityHash = "c".repeat(64), root = manifest.roots[0];
  const lost = replayAttemptStatus({ ...root, phase: "generate", identityHash, startedAt: "2026-11-22T00:00:00Z" }, null, identityHash);
  const report = { format: "poker-face-formation-experiment" as const, version: 1 as const, phase: "generate" as const,
    identityHash, preflightHash: "d".repeat(64), previousHash: null, chargedNativeMs: lost.budgetMs, payloadHash: "e".repeat(64),
    groups: FORMATION_INPUTS.formations.map((f, i) => ({ formation: f.id, status: "blocked" as const, error: "not publishable", rows: i === 0 ? [lost] : [] })) };
  validatePhaseReport(report, "generate", identityHash, manifest, 0);
  for (const mutate of [
    (r: typeof report) => { r.chargedNativeMs = 0; },
    (r: typeof report) => { r.groups[0].rows[0].identityHash = "0".repeat(64); },
    (r: typeof report) => { r.groups[0].rows[0].spotHash = "0".repeat(64); },
    (r: typeof report) => { r.groups[0].rows[0].resultHash = "f".repeat(64); },
    (r: typeof report) => { r.groups.reverse(); },
  ]) { const changed = structuredClone(report); mutate(changed); assert.throws(() => validatePhaseReport(changed, "generate", identityHash, manifest, 0)); }
});

test("resumable evidence cannot retry an unknown outcome or reuse another source identity", () => {
  const start = { phase: "generate" as const, id: "fixture", spotHash: "a".repeat(64), planHash: "b".repeat(64), identityHash: "c".repeat(64), startedAt: "2026-11-22T00:00:00Z" };
  const lost = replayAttemptStatus(start, null, start.identityHash);
  assert.equal(lost.status, "failed"); assert.equal(lost.elapsedMs, null); assert.equal(lost.budgetMs, FORMATION_BUDGETS.perSolveMs);
  assert.match(lost.error!, /unknown|interrupted/);
  const failed = { ...start, status: "failed" as const, elapsedMs: 123, budgetMs: 123, error: "quality missed", resultHash: null,
    dataHashes: null, peakRssBytes: null, iterations: null, pctPot: null, lastCheckpoint: null };
  assert.deepEqual(replayAttemptStatus(start, failed, start.identityHash), failed);
  assert.throws(() => replayAttemptStatus(start, failed, "d".repeat(64)));
  assert.throws(() => replayAttemptStatus(start, { ...failed, status: "passed" }, start.identityHash));
  assert.throws(() => replayAttemptStatus(start, { ...failed, spotHash: "e".repeat(64) }, start.identityHash));
});

test("formation admission includes slice working space and refuses compressed or wrong-identity estimates", () => {
  const spot = formationSpot(FORMATION_INPUTS.formations[0].id, FORMATION_INPUTS.flops[0].id);
  const raw = { type: "estimate", spotId: spot.id, spotHash: hashBridgeSpot(spot), memoryCapBytes: spot.solve.memoryCapBytes,
    hands: spot.ranges.map(r => r.combos.length), estimatedBytes: FORMATION_BUDGETS.reservationBytes - FORMATION_BUDGETS.sliceWorkingBytes - 32768,
    estimatedCompressedBytes: 1, estimateExport: { version: 1, basis: "public-tree-upper-bound", scope: "first-street", nodes: 1, cells: 0, edges: 0,
      jsonBytesUpperBound: 4096, workingBytesEstimate: 32768 } };
  assert.equal(formationReservation(spot, JSON.stringify(raw)).admitted, true);
  assert.equal(formationReservation(spot, JSON.stringify({ ...raw, estimatedBytes: raw.estimatedBytes + 1 })).admitted, false);
  assert.throws(() => formationReservation({ ...spot, solve: { ...spot.solve, compression: "on" } }, JSON.stringify(raw)));
  assert.throws(() => formationReservation(spot, JSON.stringify({ ...raw, spotHash: "0".repeat(64) })));
});

test("file identity rejects changed bytes, path escapes, another formation and oversized files", () => {
  const text = '{"example":1}', prefix = "/solver-data/bridge-formations-v1/sb-bb-srp-v1/";
  const ref = { url: prefix + "example.json", bytes: Buffer.byteLength(text), sha256: "4decc90ae9d223f31e98aaceb4c1c067f6f55cc9729a97e7052c2d613801e1ee" };
  // The valid digest is computed independently by the platform; the checker must consume exact bytes.
  const hash = createHash("sha256").update(text).digest("hex") as string;
  assert.equal(verifyDataFile(Buffer.from(text), { ...ref, sha256: hash }, prefix), text);
  for (const change of [{ sha256: "0".repeat(64) }, { bytes: 1 }, { url: prefix + "../example.json" },
    { url: "/solver-data/bridge-v1/example.json" }, { bytes: FORMATION_BUDGETS.fileBytes + 1 }])
    assert.throws(() => verifyDataFile(Buffer.from(text), { ...ref, sha256: hash, ...change }, prefix));
});

test("real native slices encode deterministically and cannot publish missed quality or wrong plans", { skip: !existsSync(BRIDGE_BINARY) && "build:bridge required" }, async () => {
  const spot = buildBridgeFixture("referee-flop-reference");
  const plan: BridgeSlicePlanV1 = { format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop: { maxDepth: null },
    turn: { cards: ["2c"], maxDepth: 2, maxPriorRaises: 0 }, river: { boards: [["2c", "3d"]], maxDepth: 2, maxPriorRaises: 0 }, subtrees: [], equity: true };
  const run = await runBridgeSpot(spot, { slices: plan, threads: 8 });
  checkFormationResult(spot, plan, run.result);
  const definition = { id: spot.id, flop: spot.board.flop, texture: "referee only", turnCards: ["2c"] as const, riverBoards: [["2c", "3d"]] as const };
  const built = encodeFormationSpot(FORMATION_INPUTS.formations[0].id, definition, spot, plan, run.result, run.elapsedMs, run.sampledPeakRssBytes);
  assert.ok(built.files.size > 3); assert.ok(built.invariants.reachChecked > 0 && built.invariants.opponentEvChecked > 0);
  assert.deepEqual([...built.files], [...encodeFormationSpot(FORMATION_INPUTS.formations[0].id, definition, spot, plan, run.result, 1, 1).files]);
  assert.throws(() => checkFormationResult(spot, plan, { ...run.result, exploitability: { ...run.result.exploitability, reached: false } }));
  assert.throws(() => checkFormationResult(spot, { ...plan, equity: false }, run.result));
});
