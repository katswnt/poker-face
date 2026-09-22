import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareConfigurableRiver,
  solveConfigurableRiver,
  type ConfigurableRiverRequest,
} from "../src/lib/solver/river/configurable/solve";

const REQUEST: ConfigurableRiverRequest = {
  id: "configurable-river-api-test",
  board: ["Ks", "8s", "4s", "2c", "9d"],
  rangeText: ["AA AQs", "JJ ATs"],
  committed: [50, 50],
  stackBehind: [100, 100],
  openingBetSizes: [50, 100],
  raiseToSizes: [100],
};

test("the public v2 API exposes exact expanded inputs and preflight before solving", () => {
  const prepared = prepareConfigurableRiver(REQUEST);
  assert.deepEqual(prepared.game.preflight.rangeEntries, [10, 10]);
  assert.ok(prepared.game.preflight.compatibleDeals > 0);
  assert.equal(
    prepared.game.preflight.projectedFullStates,
    1 + prepared.game.preflight.compatibleDeals * prepared.game.preflight.publicStatesPerDeal,
  );
  assert.equal(prepared.parsedRanges[0].tokens.join(" "), "AA AQs");
});

test("the public v2 API returns solver, independent grade, and optional teaching data", () => {
  const solved = solveConfigurableRiver(REQUEST, {
    iterations: 25,
    checkpointIterations: [1, 25],
  });
  assert.equal(solved.result.iterations, 25);
  assert.ok(solved.grade.value.every(Number.isFinite));
  assert.equal(solved.grade.exploitability, solved.grade.nashGap / 2);
  assert.equal(solved.decisions?.length, solved.result.index.informationSets.length);

  const withoutFacts = solveConfigurableRiver(REQUEST, {
    iterations: 1,
    includeDecisionFacts: false,
  });
  assert.equal(withoutFacts.decisions, null);
});

test("the public v2 API rejects work beyond an explicitly lowered budget", () => {
  assert.throws(
    () => prepareConfigurableRiver(REQUEST, { maxCompatibleDeals: 1 }),
    /compatible deals; exact limit is 1/,
  );
});
