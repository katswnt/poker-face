import assert from "node:assert/strict";
import { digest, verifyProfile } from "../robopoker/contract";
import { fixtures, gradeTiny, type Fixture } from "./fixtures";

export interface Observation {
  version: number; id: string; fixtureHash: string; upstreamCommit: string; crateVersion: string;
  mode: string; epochs: number; treeSeed: number; workers: number; fullNodeCount: number;
  rawProfile: number[][]; profile: number[][]; values: number[]; bestResponses: number[]; score: number;
  rawValues: number[]; rawBestResponses: number[]; rawScore: number; elapsedMs: number; peakRssBytes: number;
}
const canonical = new Map(fixtures().map(f => [f.id, digest(f)]));
export function assess(f: Fixture, o: Observation, mode: string) {
  const trained = mode === "external" || mode === "pluribus";
  assert.ok(canonical.get(f.id) === digest(f) && o.version === 2 && o.id === f.id && o.fixtureHash === f.fixtureHash
    && o.crateVersion === "1.2.0-poker-face.1" && o.upstreamCommit === "72360adc7fbc6afa4119be3aefcc0e990d3789a7"
    && o.mode === mode && o.epochs === (trained ? 100_000 : 0) && o.treeSeed === 20261122 && o.workers === 1, "R0 v2 identity mismatch");
  const count = (id: number): number => 1 + f.nodes[id].children.reduce((sum, child) => sum + count(child), 0);
  assert.equal(o.fullNodeCount, count(0), "R0 v2 incomplete full tree");
  for (const profile of [o.rawProfile, o.profile]) {
    assert.equal(profile.length, f.informationSets.length, "R0 v2 profile count");
    profile.forEach((row, i) => {
      assert.equal(row.length, f.informationSets[i].actions.length, "R0 v2 profile action count");
      assert.ok(row.every(p => Number.isFinite(p) && p >= 0 && p <= 1), "R0 v2 finite probabilities");
    });
  }
  o.rawProfile.forEach((row, i) => {
    assert.ok(row.every(p => Math.fround(p) === p), "R0 v2 must preserve raw f32 probabilities");
    if (!trained) assert.deepEqual(row, f.profile?.[i] ?? row.map(() => Math.fround(1 / row.length)), "R0 v2 uniform/supplied profile");
    const sum = row.reduce((a, b) => a + b, 0);
    assert.ok(sum > 0 && Math.abs(sum - 1) <= 1e-6, "R0 v2 raw probability sum");
    assert.deepEqual(o.profile[i], row.map(p => p / sum), "R0 v2 explicit normalization");
  });
  for (const values of [o.values, o.bestResponses, o.rawValues, o.rawBestResponses]) {
    assert.equal(values.length, 3, "R0 v2 player count");
    assert.ok(values.every(Number.isFinite), "R0 v2 finite values");
  }
  assert.ok([o.score, o.rawScore, o.elapsedMs, o.peakRssBytes].every(Number.isFinite)
    && o.elapsedMs > 0 && o.peakRssBytes > 0, "R0 v2 finite measurements");
  const grade = f.id === "three-player-river-v1" ? verifyProfile(f, o.profile) : gradeTiny(f, o.profile);
  if (f.id !== "three-player-river-v1") {
    const exhaustive = gradeTiny(f, o.profile, true);
    assert.deepEqual(grade.bestResponses.map(r => r.value), exhaustive.bestResponses.map(r => r.value));
  }
  // Independent direct tree evaluation also checks the unnormalized raw measure.
  const rawValue = (id: number, p: number): number => {
    const n = f.nodes[id];
    if (n.kind === "terminal") return n.utility[p];
    if (n.kind === "chance") return f.deals.reduce((sum, d) => sum + d.probability * rawValue(d.node, p), 0);
    return n.children.reduce((sum, c, a) => sum + o.rawProfile[n.info][a] * rawValue(c, p), 0);
  };
  const independent = { values: [...grade.value], bestResponses: grade.bestResponses.map(r => r.value),
    unilateralGains: [...grade.unilateralGains], nashConvPerPlayer: grade.sumUnilateralGains / 3 };
  const scoreDifference = Math.abs(o.score - independent.nashConvPerPlayer);
  const maximumValueDifference = Math.max(...o.values.map((v, p) => Math.abs(v - grade.value[p])));
  const maximumResponseDifference = Math.max(...o.bestResponses.map((v, p) => Math.abs(v - independent.bestResponses[p])));
  const maximumRawValueDifference = Math.max(...o.rawValues.map((v, p) => Math.abs(v - rawValue(0, p))));
  const scoreArithmeticDifference = Math.abs(o.score - o.bestResponses.reduce((a, b) => a + b, 0) / 3);
  const rawScoreArithmeticDifference = Math.abs(o.rawScore - o.rawBestResponses.reduce((a, b) => a + b, 0) / 3);
  const fullTreeAgreementPassed = Math.max(scoreDifference, maximumValueDifference, maximumResponseDifference,
    maximumRawValueDifference, scoreArithmeticDifference, rawScoreArithmeticDifference) <= 1e-6;
  const runtimePassed = o.elapsedMs < 60_000;
  const memoryPassed = o.peakRssBytes < 1_000_000_000;
  const maximumUnilateralGain = Math.max(...grade.unilateralGains);
  const convergencePassed = !trained || maximumUnilateralGain <= 0.45;
  return { independent, scoreDifference, maximumValueDifference, maximumResponseDifference, maximumRawValueDifference,
    scoreArithmeticDifference, rawScoreArithmeticDifference,
    normalizationValueDelta: Math.max(...o.rawValues.map((v, p) => Math.abs(v - o.values[p]))),
    normalizationResponseDelta: Math.max(...o.rawBestResponses.map((v, p) => Math.abs(v - o.bestResponses[p]))),
    maximumUnilateralGain, fullTreeAgreementPassed, runtimePassed, memoryPassed, convergencePassed,
    passed: fullTreeAgreementPassed && runtimePassed && memoryPassed && convergencePassed };
}
