import { canonicalSolverJson } from "../../toy/artifact";
import { flopDigest } from "./artifact-node";
import { decodeFlopPolicyFile } from "./binary-node";
import { compileVectorFlop } from "./compiled";
import { validateFlopRequest, type FlopRequest } from "./rules";
import { gradeVectorFlop } from "./scorekeeper";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid flop source object");
  return value as Record<string, unknown>;
}
function same(actual: unknown, expected: unknown, label: string) {
  if (canonicalSolverJson(actual) !== canonicalSolverJson(expected)) throw new Error(`Flop source ${label} differs`);
}

/** Rebuild rules and independently regrade the complete serialized policy before publishing slices. */
export function verifyFlopSource(input: unknown, bytes: Uint8Array) {
  const artifact = record(input), { payloadHash, ...payload } = artifact;
  if (payloadHash !== flopDigest(payload)) throw new Error("Flop source payload hash differs");
  for (const [key, value] of Object.entries({ schemaVersion: 1, rulesVersion: 1, backend: "vector-flop", backendVersion: 1,
    precision: "float64", exploitabilityConvention: "half-nash-gap", exploitabilityUnits: "net-chips-per-hand" })) same(artifact[key], value, key);
  const request = validateFlopRequest(artifact.request as FlopRequest), game = compileVectorFlop(request);
  same(artifact.inputHash, flopDigest(request), "input hash"); same(artifact.gameHash, flopDigest(game.gameIdentity), "game hash");
  const counts = { ...game.preflight }; delete (counts as Partial<typeof counts>).memoryLimitBytes;
  same(artifact.counts, counts, "counts"); same(artifact.informationSets, game.informationSets, "information sets");
  const decoded = decodeFlopPolicyFile(game, bytes);
  same(artifact.policy, { format: "flop-float64-v1-gzip", contentHash: decoded.contentHash, rawBytes: decoded.rawBytes, actionSlots: decoded.policy.length }, "policy metadata");
  same(artifact.iterations, decoded.iterations, "iterations"); same(artifact.options, decoded.options, "options");
  const grade = gradeVectorFlop(game, decoded.policy), scale = request.committedPerPlayer + Math.min(...request.stackBehind);
  const close = (actual: unknown, expected: number) => {
    if (typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-10 * Math.max(1, scale)) throw new Error("Flop source grade differs");
  };
  for (const [key, expected] of Object.entries({ value: grade.value, bestResponseValues: grade.bestResponses.map(b => b.value),
    gains: grade.gains, equilibriumValueIntervalPlayer0: grade.equilibriumValueIntervalPlayer0 })) {
    const actual = artifact[key]; if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error("Flop source grade dimensions differ");
    expected.forEach((n, i) => close(actual[i], n));
  }
  close(artifact.exploitability, grade.exploitability); close(artifact.nashGap, grade.nashGap);
  const acceptance = record(artifact.acceptance), target = acceptance.maximumExploitability;
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0 || target > 0.0025 * request.committedPerPlayer * 2
    || acceptance.passed !== true || grade.exploitability > target) throw new Error("Flop source did not pass the catalog quality gate");
  const convergence = artifact.convergence;
  if (!Array.isArray(convergence) || !convergence.length) throw new Error("Flop source convergence is missing");
  let previous = 0;
  for (const point of convergence) {
    const entry = record(point);
    if (!Number.isSafeInteger(entry.iteration) || (entry.iteration as number) <= previous || (entry.iteration as number) > decoded.iterations) throw new Error("Invalid flop convergence iterations");
    previous = entry.iteration as number;
    for (const key of ["value", "gains"]) if (!Array.isArray(entry[key]) || entry[key].length !== 2
      || entry[key].some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))) throw new Error("Invalid flop convergence values");
    if (typeof entry.exploitability !== "number" || !Number.isFinite(entry.exploitability) || entry.exploitability < 0) throw new Error("Invalid flop convergence grade");
  }
  const last = record(convergence.at(-1)); same(last.iteration, decoded.iterations, "final convergence iteration");
  same(last.value, artifact.value, "final convergence value"); same(last.gains, artifact.gains, "final convergence gains");
  same(last.exploitability, artifact.exploitability, "final convergence grade");
  return { game, policy: decoded.policy, iterations: decoded.iterations, options: decoded.options, grade,
    payloadHash: payloadHash as string, policyHash: decoded.contentHash, maximumExploitability: target };
}
