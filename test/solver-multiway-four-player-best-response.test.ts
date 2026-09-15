import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMultiwayStrategy } from "../src/lib/solver/multiway/best-response";
import { solveMultiwayCfr } from "../src/lib/solver/multiway/cfr";
import { fourPlayerRiverV1Game } from "../src/lib/solver/multiway/four-player-fixture";
import { auditFourPlayerIndependentChecks } from "../src/lib/solver/multiway/four-player-independent-node";

test("four-player scalable best responses match exhaustive information-set choices", () => {
  const audit = auditFourPlayerIndependentChecks();
  assert.equal(audit.reducedBestResponse.compatibleDeals, 1);
  assert.deepEqual(audit.reducedBestResponse.pureStrategiesChecked, [256, 256, 256, 256]);
  assert.ok(audit.reducedBestResponse.maximumValueDifference <= 1e-9);
});

test("the four-player best response cannot inspect six hidden opponent cards", () => {
  const boundary = auditFourPlayerIndependentChecks().hiddenInformationBoundary;
  assert.ok(boundary.cheatingStatewiseValue > boundary.honestBestResponseValue);
  assert.ok(boundary.cheatingAdvantage > 0.01);
});

test("renaming and moving seats cannot change four-player results", () => {
  const permutation = auditFourPlayerIndependentChecks().seatPermutation;
  assert.equal(permutation.dealsChecked, 174);
  assert.equal(permutation.terminalsChecked, 5_742);
  assert.ok(permutation.maximumProbabilityDifference <= 1e-9);
  assert.ok(permutation.maximumUtilityDifference <= 1e-9);
});

test("a folded fourth player's chips remain dead money in the pot", () => {
  const reduction = auditFourPlayerIndependentChecks().deadMoneyReduction;
  assert.equal(reduction.removedSeat, 3);
  assert.equal(reduction.terminalsChecked, 2_088);
  assert.equal(reduction.deadChipsPerTerminal, 30);
  assert.ok(reduction.maximumAwardDifference <= 1e-9);
  assert.ok(reduction.maximumUtilityDifference <= 1e-9);
});

test("the generic solver still reproduces the accepted heads-up result", () => {
  const adapter = auditFourPlayerIndependentChecks().headsUpAdapter;
  assert.equal(adapter.treeMatches, true);
  assert.ok(adapter.maximumValueDifference <= 1e-9);
  assert.ok(adapter.maximumBestResponseDifference <= 1e-9);
});

test("the four-player milestone leaves every earlier accepted artifact intact", () => {
  const prior = auditFourPlayerIndependentChecks().priorArtifacts;
  assert.equal(prior.noRaiseHashValid, true);
  assert.equal(prior.raisedHashValid, true);
  assert.equal(prior.twoSizeHashValid, true);
  assert.equal(prior.sidePotHashValid, true);
  assert.equal(prior.headsUpHashValid, true);
});

test("a short four-player solve is deterministic and zero-sum", () => {
  const options = { iterations: 64, checkpointIterations: [16, 64] } as const;
  const first = solveMultiwayCfr(fourPlayerRiverV1Game, options);
  const second = solveMultiwayCfr(fourPlayerRiverV1Game, options);
  assert.deepEqual([...first.averageStrategy], [...second.averageStrategy]);
  const value = evaluateMultiwayStrategy(fourPlayerRiverV1Game, first.averageStrategy, first.index);
  assert.ok(Math.abs(value.reduce((sum, playerValue) => sum + playerValue, 0)) <= 1e-9);
});
