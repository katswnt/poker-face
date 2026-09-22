import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/river/configurable-v3/artifacts/configurable-river-v3.json" with { type: "json" };
import {
  fingerprintConfigurableRiverV3Game,
  hashConfigurableRiverV3Decisions,
  verifyConfigurableRiverV3ArtifactHash,
} from "../src/lib/solver/river/configurable-v3/artifact-node";
import {
  deserializeConfigurableRiverV3Strategy,
  stringifyConfigurableRiverV3Artifact,
  type ConfigurableRiverV3Artifact,
} from "../src/lib/solver/river/configurable-v3/artifact";
import { configurableRiverV3DemoGame } from "../src/lib/solver/river/configurable-v3/fixture";
import { auditConfigurableRiverV3Rules } from "../src/lib/solver/river/configurable-v3/oracle";
import { configurableRiverDecisionFacts } from "../src/lib/solver/river/configurable/explain";
import { compileFactorizedRiverGame } from "../src/lib/solver/river/factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
} from "../src/lib/solver/river/factorized/scorekeeper";

const artifact = artifactData as unknown as ConfigurableRiverV3Artifact;

test("the river v3 artifact is bound to its exact richer game and payload", () => {
  assert.equal(verifyConfigurableRiverV3ArtifactHash(artifact), true);
  assert.equal(artifact.rulesFingerprint, fingerprintConfigurableRiverV3Game());
  assert.match(artifact.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(artifact.acceptance.passed, true);
  assert.equal(artifact.rules.maximumRaisesAfterOpeningBet, 2);
  assert.equal(artifact.factorizedTree.publicStates, 63);
  assert.equal(artifact.factorizedTree.equivalentRepeatedStates, 11_089);
  assert.equal(artifact.factorizedTree.compatiblePrivateDeals, 176);
  assert.equal(artifact.teaching.decisionCount, artifact.factorizedTree.informationSets);
  assert.equal(artifact.teaching.bulkExportStateLimit, 100_000);
});

test("the river v3 saved strategy independently reproduces its grade", () => {
  const strategy = deserializeConfigurableRiverV3Strategy(artifact.strategy);
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  const grade = gradeFactorizedRiverStrategy(
    compileFactorizedRiverScorekeeper(compiled),
    strategy,
  );
  assert.ok(Math.abs(grade.value[0] - artifact.value[0]) < 1e-9);
  assert.ok(Math.abs(grade.value[1] - artifact.value[1]) < 1e-9);
  assert.ok(Math.abs(grade.gains[0] - artifact.gains[0]) < 1e-9);
  assert.ok(Math.abs(grade.gains[1] - artifact.gains[1]) < 1e-9);
  assert.ok(Math.abs(grade.exploitability - artifact.exploitability) < 1e-9);
  assert.ok(artifact.exploitability <= artifact.acceptance.maximumExploitability);
});

test("the river v3 teaching facts rederive from the committed strategy", () => {
  const strategy = deserializeConfigurableRiverV3Strategy(artifact.strategy);
  const decisions = configurableRiverDecisionFacts(configurableRiverV3DemoGame, strategy);
  assert.equal(decisions.length, artifact.teaching.decisionCount);
  assert.equal(
    hashConfigurableRiverV3Decisions(decisions),
    artifact.teaching.decisionsSha256,
  );
});

test("the river v3 slow oracle still checks all 7,216 terminals", () => {
  assert.deepEqual(auditConfigurableRiverV3Rules(configurableRiverV3DemoGame), artifact.rulesAudit);
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 176,
    publicTerminals: 41,
    terminalsChecked: 7_216,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("river v3 records its independent reductions and differential checks", () => {
  assert.deepEqual(artifact.independentChecks, {
    exactV2OneRaiseReduction: true,
    ordinaryCfrMaximumDifference: 0,
    factorizedGradeMaximumDifference: 0,
    hiddenOpponentCardsExcluded: true,
  });
});

test("river v3 convergence improves without claiming exact GTO", () => {
  assert.equal(artifact.algorithm, "factorized-river-alternating-cfr-plus");
  assert.equal(artifact.convergence[0].iteration, 100);
  assert.equal(artifact.convergence.at(-1)?.iteration, artifact.iterations);
  assert.ok(artifact.convergence.at(-1)!.exploitability < artifact.convergence[0].exploitability / 10);
  assert.equal(artifact.exploitabilityConvention, "half-nash-gap");
  assert.equal(artifact.exploitabilityUnits, "net-chips-per-hand");
});

test("river v3 artifact hashing rejects changed math, rules, or saved bytes", () => {
  const changedValue = {
    ...artifact,
    value: [artifact.value[0] + 1, artifact.value[1] - 1] as const,
  };
  const changedRules = { ...artifact, rulesFingerprint: "0".repeat(64) };
  assert.equal(verifyConfigurableRiverV3ArtifactHash(changedValue), false);
  assert.equal(verifyConfigurableRiverV3ArtifactHash(changedRules), false);
  assert.equal(stringifyConfigurableRiverV3Artifact(artifact).endsWith("\n"), true);
});
