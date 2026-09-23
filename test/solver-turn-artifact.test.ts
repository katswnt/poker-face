import assert from "node:assert/strict";
import { test } from "node:test";
import artifactJson from "../src/lib/solver/turn/artifacts/heads-up-turn-v1.json";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { turnDemoGame, TURN_DEMO_REQUEST } from "../src/lib/solver/turn/fixture";
import { createTurnGame } from "../src/lib/solver/turn/game";
import { auditTurnRules } from "../src/lib/solver/turn/oracle";
import { fingerprintTurnGame, verifyTurnArtifactHash, type TurnArtifact } from "../src/lib/solver/turn/artifact-node";

const artifact = artifactJson as unknown as TurnArtifact;
test("turn artifact pins rules, complete policy, independent grade, and acceptance", () => {
  assert.equal(verifyTurnArtifactHash(artifact), true);
  assert.equal(artifact.rulesFingerprint, "b7aca81487749ed21b51478400da52352d3fc433b1b1925971938b134cb413c1");
  assert.equal(artifact.payloadHash, "bd98eacacfb5de375cc8c485dfde8c44e890e41a151afa0d15caebcb7019995e");
  const strategy = deserializeBehavioralStrategy(buildGameTreeIndex(turnDemoGame), artifact.strategy);
  const grade = gradeStrategy(turnDemoGame, strategy);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(grade.gains, artifact.gains);
  assert.equal(grade.exploitability, artifact.exploitability);
  assert.equal(artifact.acceptance.passed, true);
  assert.ok(grade.exploitability <= 0.10);
  assert.ok(Math.abs(grade.value[0] - 50.01255964562273) < 1e-10);
  assert.ok(Math.abs(grade.exploitability - 0.014643152343495558) < 1e-10);
  assert.deepEqual(artifact.rulesAudit, auditTurnRules(turnDemoGame));
  assert.deepEqual(artifact.convergence.map(point => point.iteration), [256, 1024, 4096, 16384]);
  assert.deepEqual(artifact.convergence.at(-1)?.value, artifact.value);
  assert.equal(artifact.exploitabilityConvention, "half-nash-gap");
  assert.equal(artifact.exploitabilityUnits, "net-chips-per-hand");
  assert.deepEqual(artifact.equilibriumValueIntervalPlayer0, [-grade.bestResponses[1].value, grade.bestResponses[0].value]);
});

test("turn fingerprints bind both hidden-information grouping and numerical rules", () => {
  assert.equal(verifyTurnArtifactHash({ ...artifact, exploitability: 0 }), false);
  assert.notEqual(fingerprintTurnGame(createTurnGame({ ...TURN_DEMO_REQUEST, betSizes: [40, 100] })), artifact.rulesFingerprint);
  const cheating = { ...turnDemoGame, informationSet: (state: Parameters<typeof turnDemoGame.informationSet>[0], player: 0 | 1) =>
    `${turnDemoGame.informationSet(state, player)}:opponent=${state.hands![1 - player].join("")}` };
  assert.notEqual(fingerprintTurnGame(cheating), artifact.rulesFingerprint);
});

test("independent turn oracle detects changed payouts and chance weights", () => {
  const badMoney = { ...turnDemoGame, node: (state: Parameters<typeof turnDemoGame.node>[0]) => {
    const node = turnDemoGame.node(state);
    return node.kind === "terminal" ? { ...node, utility: [node.utility[0] + 1, node.utility[1] - 1] as const } : node;
  } };
  assert.throws(() => auditTurnRules(badMoney), /differ/);
  const badChance = { ...turnDemoGame, node: (state: Parameters<typeof turnDemoGame.node>[0]) => {
    const node = turnDemoGame.node(state);
    return state.phase === "river-card" && node.kind === "chance"
      ? { ...node, outcomes: node.outcomes.map(child => ({ ...child, probability: 1 / 43 })) } : node;
  } };
  assert.throws(() => auditTurnRules(badChance), /differ/);
  const badPrivateChance = { ...turnDemoGame, node: (state: Parameters<typeof turnDemoGame.node>[0]) => {
    const node = turnDemoGame.node(state);
    return state.phase === "deal" && node.kind === "chance"
      ? { ...node, outcomes: node.outcomes.map(child => ({ ...child, probability: 1 / 3 })) } : node;
  } };
  assert.throws(() => auditTurnRules(badPrivateChance), /differ/);
  const nanMoney = { ...turnDemoGame, node: (state: Parameters<typeof turnDemoGame.node>[0]) => {
    const node = turnDemoGame.node(state);
    return node.kind === "terminal" ? { ...node, utility: [NaN, NaN] as const } : node;
  } };
  assert.throws(() => auditTurnRules(nanMoney), /non-finite/);
  for (const phase of ["deal", "river-card"]) {
    for (const probability of [NaN, Infinity, -0.5, 0]) {
      const invalidChance = { ...turnDemoGame, node: (state: Parameters<typeof turnDemoGame.node>[0]) => {
        const node = turnDemoGame.node(state);
        return state.phase === phase && node.kind === "chance"
          ? { ...node, outcomes: node.outcomes.map(child => ({ ...child, probability })) } : node;
      } };
      assert.throws(() => auditTurnRules(invalidChance), /non-finite or invalid/);
    }
  }
});
