import assert from "node:assert/strict";
import test from "node:test";
import { compileRiverFixture, sequentialWitness, verifyProfile } from "../src/lib/solver/multiway/robopoker/contract";
import { assessObservation } from "../src/lib/solver/multiway/robopoker/audit";
import { auditR0Evidence } from "../scripts/audit-robopoker-r0";

test("R0 preserves every weighted deal, information set and legal action", () => {
  const fixture = compileRiverFixture();
  assert.equal(fixture.nodes.length, 4301);
  assert.equal(fixture.deals.length, 172);
  const tickets = fixture.deals.reduce((sum, deal) => sum + deal.tickets, 0);
  assert.equal(fixture.nodes[0].children.length, tickets);
  for (const deal of fixture.deals) assert.equal(deal.tickets / tickets, deal.probability);
  const grade = verifyProfile(fixture, fixture.informationSets.map(info => info.actions.map(() => 0.5)));
  assert.equal(grade.unilateralGains.length, 3);
  assert.throws(() => verifyProfile(fixture, []), /information/);
  const corrupt = fixture.informationSets.map(info => info.actions.map(() => 0.5));
  corrupt[0] = [1];
  assert.throws(() => verifyProfile(fixture, corrupt), /action/);
});

test("R0 sequential witness is checked by exhaustive pure strategies", () => {
  const { grade, exhaustive } = sequentialWitness();
  assert.deepEqual(grade.value, [0.5, -0.25, -0.25]);
  assert.deepEqual(grade.unilateralGains, [9.5, 0, 0]);
  assert.deepEqual(exhaustive.bestResponses.map(response => response.value), [10, -0.25, -0.25]);
  assert.equal(grade.sumUnilateralGains, exhaustive.sumUnilateralGains);
});

test("R0 refuses a false full-tree certificate and invalid evidence", () => {
  const witness = sequentialWitness();
  const observation = {
    version: 1, id: witness.fixture.id, fixtureHash: witness.fixture.fixtureHash,
    upstreamCommit: "72360adc7fbc6afa4119be3aefcc0e990d3789a7", crateVersion: "1.2.0",
    mode: "uniform-full-tree-prerequisite", fullNodeCount: 5,
    profile: [[0.5, 0.5], [0.5, 0.5]], values: [0.5, -0.25, -0.25],
    bestResponses: [1, -0.25, -0.25], score: Math.fround(0.5 / 3), elapsedMs: 1, peakRssBytes: 1024,
  };
  const result = assessObservation(witness.fixture, observation);
  assert.equal(result.passed, false);
  assert.ok(result.scoreDifference > 2.99);
  assert.deepEqual(result.bestResponseDifferences, [9, 0, 0]);
  assert.throws(() => assessObservation(witness.fixture, { ...observation, fullNodeCount: 4 }), /tree/);
  assert.throws(() => assessObservation(witness.fixture, { ...observation, fixtureHash: "bad" }), /identity/);
  assert.throws(() => assessObservation(witness.fixture, { ...observation, profile: [[1, 0], [1, 0]] }), /uniform/);
  assert.throws(() => assessObservation(witness.fixture, { ...observation, score: NaN }), /finite/);
});

test("R0 saved failure remains source-bound and independently reproducible", () => {
  const record = auditR0Evidence();
  assert.equal(record.trainingAttempted, false);
  assert.equal(record.attempts[0].repeats[0].observation.fullNodeCount, 58726);
  assert.ok(record.attempts[0].repeats[0].assessment.scoreDifference > 0.4);
  assert.equal(record.attempts[1].repeats[0].observation.bestResponses[0], 1);
  assert.equal(record.attempts[1].repeats[0].assessment.independent.bestResponses[0], 10);
});
