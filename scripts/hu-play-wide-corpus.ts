/** Frozen P1 inputs for offline feasibility only; no production admission override. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import frozen from "../tasks/artifacts/hu-play-p1-admission.json";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { checkBridgeResult, validateBridgeSpot, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { probeLibraryPrefixes } from "./hu-play-library-probe";
import type { BridgeRun } from "./bridge-runner";
import { mathProjection } from "./hu-play-wide-measurement";

export const P1_FROZEN_ADMISSION_HASH = "5708279f22c75c316a8d97dd4dfb1d857976127da11b3527f50e4c390cc807f9";
export const wideHash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
export interface P1WideRoot {
  corpusIndex: number; seed: number; street: "river" | "turn"; librarySpotId: string;
  path: readonly string[]; sourceSpotHash: string; spot: BridgeSpotV1;
}

export function loadP1WideRoots(): P1WideRoot[] {
  const { payloadHash, ...payload } = frozen;
  assert.equal(payloadHash, P1_FROZEN_ADMISSION_HASH, "Do not replace the frozen P1 cohort");
  assert.equal(wideHash(payload), payloadHash);
  assert.equal(wideHash(frozen.inputFiles), frozen.inputFilesHash);
  for (const ref of frozen.inputFiles) {
    assert.match(ref.url, /^\/solver-data\/bridge-v1\/[a-zA-Z0-9/._-]+$/);
    assert.ok(!ref.url.includes(".."));
    const bytes = readFileSync(`public${ref.url}`);
    assert.equal(bytes.length, ref.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256);
  }
  assert.equal(frozen.corpus.length, 64);
  const seeds = [...new Set(frozen.corpus.map(r => r.seed))].sort((a, b) => a - b);
  const probe = probeLibraryPrefixes(seeds);
  const roots = frozen.corpus.map((row, corpusIndex): P1WideRoot => {
    assert.ok(row.street === "turn" || row.street === "river");
    const matches = probe.roots.filter(r => r.seed === row.seed && r.publicState.path.join(" ") === row.path.join(" "));
    assert.equal(matches.length, 1, `Missing/duplicate frozen root ${corpusIndex}`);
    const r = matches[0];
    assert.equal(r.librarySpotId, row.librarySpotId);
    assert.equal(hashBridgeSpot(r.spot), row.spotHash, `Full-range spot changed at ${corpusIndex}`);
    assert.deepEqual(r.spot.ranges.map(p => p.combos.length), row.capacity.map(p => p.totalHands));
    assert.equal(r.spot.solve.compression, "off");
    assert.equal(r.spot.solve.targetExploitabilityPctPot, .3);
    return { corpusIndex, seed: row.seed, street: row.street, librarySpotId: row.librarySpotId,
      path: row.path, sourceSpotHash: row.spotHash, spot: r.spot };
  });
  for (const street of ["river", "turn"]) assert.equal(roots.filter(r => r.street === street).length, 32);
  return roots.sort((a, b) => (a.street === b.street ? a.corpusIndex - b.corpusIndex : a.street === "river" ? -1 : 1));
}

/** Research budgets only. No range pruning, menu change, precision loss or target relaxation. */
export function nativeMeasurementSpot(original: BridgeSpotV1): BridgeSpotV1 {
  assert.equal(original.solve.compression, "off", "Measurement requires the float32 input");
  return validateBridgeSpot({ ...original, solve: { ...original.solve, compression: "off", exportScope: "first-street",
    maxIterations: 10_000, timeoutMs: 30 * 60_000, memoryCapBytes: 4 * 1024 ** 3 } });
}

/** Matched longer timing job; separate from the frozen 0.3%-pot quality solves. */
export function ratioMeasurementSpot(original: BridgeSpotV1): BridgeSpotV1 {
  const spot = nativeMeasurementSpot(original);
  return validateBridgeSpot({ ...spot, solve: { ...spot.solve, maxIterations: spot.board.river ? 1000 : 100, targetExploitabilityPctPot: 1e-9 } });
}

export function selectRatioCases<T extends { corpusIndex: number; street: "river" | "turn"; estimatedBytes: number }>(rows: readonly T[]): T[] {
  assert.equal(new Set(rows.map(r => r.corpusIndex)).size, rows.length, "Duplicate corpus index");
  for (const r of rows) assert.ok(Number.isSafeInteger(r.estimatedBytes) && r.estimatedBytes > 0, "Invalid storage estimate");
  return (["river", "turn"] as const).flatMap(street => {
    const sorted = rows.filter(r => r.street === street).sort((a, b) => a.estimatedBytes - b.estimatedBytes || a.corpusIndex - b.corpusIndex);
    return [...new Set([0, Math.floor(sorted.length / 2), sorted.length - 1])].flatMap(i => sorted[i] ? [sorted[i]] : []);
  });
}

export function summarizeNativeRun(spot: BridgeSpotV1, run: BridgeRun) {
  assert.equal(run.result?.engine?.threads, 1, "Native timing must use one thread");
  assert.equal(run.result.engine.precision, "float32");
  assert.equal(run.spotHash, hashBridgeSpot(spot));
  const r = checkBridgeResult(run.result, spot, run.spotHash);
  // serde serializes an f32 to its shortest f32-roundtripping decimal. Reading that
  // decimal as JS f64 is not the engine's exact f32; reconstruct it before comparing
  // to pctPot, which Rust computes in f64. This is not a numerical-gate tolerance.
  const chips = Math.fround(r.exploitability.chips), pctPot = chips / spot.startingPot * 100;
  assert.equal(pctPot, r.exploitability.pctPot, "Reported percent disagrees with chip arithmetic");
  assert.equal(r.exploitability.reached, chips <= spot.startingPot * spot.solve.targetExploitabilityPctPot / 100);
  return { measurementSpotHash: run.spotHash, precision: r.engine.precision, threads: r.engine.threads,
    iterations: r.iterations, reached: r.exploitability.reached, exploitabilityChips: chips,
    exploitabilityPctPot: pctPot, targetPctPot: spot.solve.targetExploitabilityPctPot,
    wallMs: run.elapsedMs, timings: r.timings, memory: r.memory, sampledPeakRssBytes: run.sampledPeakRssBytes || null,
    exportedNodes: r.counts.exportedNodes, resultJsonBytes: Buffer.byteLength(JSON.stringify(r)),
    numericalHash: wideHash(mathProjection(r)), convergence: r.convergence };
}
