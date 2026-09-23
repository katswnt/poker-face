import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../../toy/artifact";
import type { VectorTurnGame } from "./game";
import { gradeVectorTurn } from "./scorekeeper";
import type { createVectorTurnSession, VectorCheckpoint } from "./session";

export const vectorDigest = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
export interface VectorConvergence {
  readonly iteration: number;
  readonly value: readonly [number, number];
  readonly gains: readonly [number, number];
  readonly exploitability: number;
}
export function createVectorArtifact(game: VectorTurnGame, snapshot: ReturnType<ReturnType<typeof createVectorTurnSession>["snapshot"]>,
  maximumExploitability: number, convergence: readonly VectorConvergence[]) {
  if (!Number.isFinite(maximumExploitability) || maximumExploitability < 0) throw new Error("Invalid artifact quality target");
  const grade = gradeVectorTurn(game, snapshot.averageStrategy);
  const strategy = serializeBehavioralStrategy(snapshot.averageStrategy);
  const passed = grade.exploitability <= maximumExploitability;
  const payload = { schemaVersion: 1 as const, backend: snapshot.backend, backendVersion: snapshot.backendVersion,
    request: game.request, requestHash: vectorDigest(game.request), gameHash: vectorDigest(game.gameIdentity),
    algorithm: snapshot.options.algorithm, averagingDelay: snapshot.options.averagingDelay, kernel: snapshot.options.kernel,
    iterations: snapshot.iterations, requestedIterations: snapshot.options.iterations,
    counts: { compatibleDeals: game.preflight.compatibleDeals, publicStates: game.preflight.publicStates,
      equivalentStates: game.index.totalStates, informationSets: game.index.informationSets.length,
      terminalStates: game.index.terminalNodes, legalRiversPerDeal: 44, dealRiverPairs: game.preflight.dealRiverPairs },
    strategy, policyHash: vectorDigest(strategy), value: grade.value,
    bestResponseValues: bestValues(grade), gains: grade.gains, exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap", exploitabilityUnits: "net-chips-per-hand",
    exploitabilityPercentOfPot: 100 * grade.exploitability / (2 * game.request.committedPerPlayer),
    equilibriumValueIntervalPlayer0: grade.equilibriumValueIntervalPlayer0, convergence,
    acceptance: { maximumExploitability, passed }, status: passed ? "quality-target-met" : "iteration-budget-exhausted",
    limitations: ["Approximate strategy for this finite heads-up turn/river game, not exact or universal GTO",
      "At most 64 combinations per player, one capped opening size per street, no raises or rake",
      "Exact card enumeration; floating-point arithmetic; no external turn-solver validation",
      "Synthetic benchmark ranges are not recommended preflop strategies"] };
  return { ...payload, payloadHash: vectorDigest(payload) };
}
const bestValues = (grade: ReturnType<typeof gradeVectorTurn>) => grade.bestResponses.map(response => response.value);
export type VectorArtifact = ReturnType<typeof createVectorArtifact>;

export function encodeVectorCheckpoint(checkpoint: VectorCheckpoint): string {
  return `${canonicalSolverJson({ checkpoint, payloadHash: vectorDigest(checkpoint) })}\n`;
}
export function decodeVectorCheckpoint(json: string): VectorCheckpoint {
  if (Buffer.byteLength(json) > 32 * 1024 * 1024) throw new Error("Checkpoint exceeds 32 MiB");
  const parsed = JSON.parse(json);
  if (!parsed || !parsed.checkpoint || parsed.payloadHash !== vectorDigest(parsed.checkpoint)) throw new Error("Checkpoint checksum mismatch");
  return parsed.checkpoint; // Full semantic/dimension validation happens against the compiled game on restore.
}
export function readVectorCheckpoint(path: string) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error("Checkpoint must be a regular file of at most 32 MiB");
  return decodeVectorCheckpoint(readFileSync(path, "utf8"));
}

/** Own one fresh target. Subsequent atomic replacement is restricted to our own inode. */
export function createVectorCheckpointWriter(path: string) {
  if (existsSync(path)) throw new Error("Checkpoint output already exists; choose a fresh path");
  let owned: { ino: number; dev: number } | undefined;
  return (json: string) => {
    decodeVectorCheckpoint(json);
    if (owned) {
      const current = lstatSync(path);
      if (current.ino !== owned.ino || current.dev !== owned.dev) throw new Error("Checkpoint output was replaced externally");
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, json); fsyncSync(fd); closeSync(fd); fd = undefined;
      if (owned) renameSync(temporary, path);
      else { linkSync(temporary, path); unlinkSync(temporary); } // Link cannot overwrite an existing target.
      const current = lstatSync(path); owned = { ino: current.ino, dev: current.dev };
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary); // Only this call's uniquely named temporary file.
    }
  };
}
