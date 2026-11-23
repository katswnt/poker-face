import { compileRiverFixture, digest, sequentialWitness, verifyProfile, type CompiledFixture } from "./contract";

export interface NativeObservation {
  version: number; id: string; fixtureHash: string; upstreamCommit: string; crateVersion: string;
  mode: string; fullNodeCount: number; profile: number[][]; values: number[];
  bestResponses: number[]; score: number; elapsedMs: number; peakRssBytes: number;
}
export function assessObservation(fixture: CompiledFixture, observation: NativeObservation) {
  const canonical = fixture.id === "three-player-river-v1" ? compileRiverFixture() : sequentialWitness().fixture;
  if (digest(fixture) !== digest(canonical) || observation.version !== 1 || observation.id !== fixture.id
    || observation.fixtureHash !== fixture.fixtureHash || observation.crateVersion !== "1.2.0"
    || observation.upstreamCommit !== "72360adc7fbc6afa4119be3aefcc0e990d3789a7"
    || observation.mode !== "uniform-full-tree-prerequisite") throw new Error("R0 identity mismatch");
  const count = (id: number): number => 1 + fixture.nodes[id].children.reduce((sum, child) => sum + count(child), 0);
  if (observation.fullNodeCount !== count(0)) throw new Error("R0 incomplete full tree");
  if (observation.profile.length !== fixture.informationSets.length || observation.profile.some((row, i) =>
    row.length !== fixture.informationSets[i].actions.length || row.some(p => p !== 1 / row.length))) {
    throw new Error("R0 prerequisite must export the complete uniform profile");
  }
  if (observation.values.length !== 3 || observation.bestResponses.length !== 3
    || [...observation.values, ...observation.bestResponses, observation.score, observation.elapsedMs, observation.peakRssBytes]
      .some(value => !Number.isFinite(value)) || observation.elapsedMs <= 0 || observation.peakRssBytes <= 0) {
    throw new Error("R0 requires finite measured observations");
  }
  const grade = fixture.id === "three-player-river-v1" ? verifyProfile(fixture, observation.profile) : sequentialWitness().grade;
  const independent = {
    values: [...grade.value], bestResponses: grade.bestResponses.map(response => response.value),
    unilateralGains: [...grade.unilateralGains], nashConvPerPlayer: grade.sumUnilateralGains / 3,
  };
  const scoreDifference = Math.abs(observation.score - independent.nashConvPerPlayer);
  const bestResponseDifferences = independent.bestResponses.map((value, i) => Math.abs(value - observation.bestResponses[i]));
  const maximumValueDifference = Math.max(...independent.values.map((value, i) => Math.abs(value - observation.values[i])));
  return {
    independent, scoreDifference, bestResponseDifferences, maximumValueDifference,
    fullTreeAgreementPassed: scoreDifference <= 1e-6,
    runtimePassed: observation.elapsedMs < 60_000, memoryPassed: observation.peakRssBytes < 1_000_000_000,
    passed: scoreDifference <= 1e-6 && maximumValueDifference <= 1e-6
      && observation.elapsedMs < 60_000 && observation.peakRssBytes < 1_000_000_000,
  };
}
