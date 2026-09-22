import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/river/configurable/artifacts/configurable-river-v2.json" with { type: "json" };
import referenceData from "./fixtures/solver/configurable-river-brown-6a104428.json" with { type: "json" };
import {
  fingerprintConfigurableRiverGame,
  verifyConfigurableRiverArtifactHash,
} from "../src/lib/solver/river/configurable/artifact-node";
import {
  deserializeConfigurableRiverStrategy,
  stringifyConfigurableRiverArtifact,
  type ConfigurableRiverReferenceFixture,
  type ConfigurableRiverSolveArtifact,
} from "../src/lib/solver/river/configurable/artifact";
import { configurableRiverDecisionFacts } from "../src/lib/solver/river/configurable/explain";
import { configurableRiverV2DemoGame } from "../src/lib/solver/river/configurable/fixture";
import { auditConfigurableRiverRules } from "../src/lib/solver/river/configurable/oracle";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";

const artifact = artifactData as unknown as ConfigurableRiverSolveArtifact;
const reference = referenceData as unknown as ConfigurableRiverReferenceFixture;

test("the configurable river artifact is bound to its exact game and payload", () => {
  assert.equal(verifyConfigurableRiverArtifactHash(artifact), true);
  assert.equal(artifact.rulesFingerprint, fingerprintConfigurableRiverGame());
  assert.match(artifact.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(artifact.acceptance.passed, true);
  assert.equal(artifact.preflight.projectedFullStates, artifact.tree.totalStates);
  assert.equal(artifact.preflight.projectedTerminalStates, artifact.tree.terminalNodes);
  assert.equal(artifact.tree.compatiblePrivateDeals, configurableRiverV2DemoGame.deals.length);
  assert.equal(artifact.decisions.length, artifact.tree.informationSets);
});

test("the committed strategy independently reproduces its value and exploitability", () => {
  const strategy = deserializeConfigurableRiverStrategy(artifact.strategy);
  const grade = gradeStrategy(configurableRiverV2DemoGame, strategy);
  assert.ok(Math.abs(grade.value[0] - artifact.value[0]) < 1e-9);
  assert.ok(Math.abs(grade.value[1] - artifact.value[1]) < 1e-9);
  assert.ok(Math.abs(grade.gains[0] - artifact.gains[0]) < 1e-9);
  assert.ok(Math.abs(grade.gains[1] - artifact.gains[1]) < 1e-9);
  assert.ok(Math.abs(grade.exploitability - artifact.exploitability) < 1e-9);
  assert.ok(artifact.exploitability <= artifact.acceptance.maximumExploitability);
});

test("the committed numerical teaching facts rederive from the saved strategy", () => {
  const strategy = deserializeConfigurableRiverStrategy(artifact.strategy);
  assert.deepEqual(
    configurableRiverDecisionFacts(configurableRiverV2DemoGame, strategy),
    artifact.decisions,
  );
});

test("the committed slow rules audit still checks all 2,288 terminals", () => {
  assert.deepEqual(auditConfigurableRiverRules(configurableRiverV2DemoGame), artifact.rulesAudit);
  assert.deepEqual(artifact.rulesAudit, {
    dealsChecked: 176,
    publicTerminals: 13,
    terminalsChecked: 2_288,
    maximumProbabilityDifference: 0,
    maximumUtilityDifference: 0,
    maximumZeroSumError: 0,
  });
});

test("the MIT referee is pinned, exactly rule-matched, and inside both gates", () => {
  assert.equal(reference.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.equal(reference.license, "MIT");
  assert.equal(reference.comparison.exactSharedTree, true);
  assert.equal(reference.sourceStrategySha256, artifact.reference.sourceStrategySha256);
  assert.ok(reference.exploitability <= artifact.acceptance.referenceMaximumExploitability);
  assert.ok(
    Math.abs(reference.value[0] - artifact.value[0]) <= artifact.acceptance.referenceValueTolerance,
  );
});

test("convergence evidence improves materially without claiming every step must improve", () => {
  assert.equal(artifact.convergence[0].iteration, 100);
  assert.equal(artifact.convergence.at(-1)?.iteration, artifact.iterations);
  assert.ok(
    artifact.convergence.at(-1)!.exploitability < artifact.convergence[0].exploitability / 10,
  );
});

test("artifact hashing rejects changed math, inputs, or saved bytes", () => {
  const changedValue = {
    ...artifact,
    value: [artifact.value[0] + 1, artifact.value[1] - 1] as const,
  };
  const changedRules = {
    ...artifact,
    rulesFingerprint: "0".repeat(64),
  };
  assert.equal(verifyConfigurableRiverArtifactHash(changedValue), false);
  assert.equal(verifyConfigurableRiverArtifactHash(changedRules), false);
  assert.equal(stringifyConfigurableRiverArtifact(artifact).endsWith("\n"), true);
});
