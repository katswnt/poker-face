import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/toy/artifacts/kuhn-v1.json" with { type: "json" };
import brownData from "./fixtures/solver/kuhn-brown-6a104428.json" with { type: "json" };
import {
  deserializeKuhnStrategy,
  stringifyKuhnArtifact,
  type KuhnSolveArtifact,
} from "../src/lib/solver/toy/artifact";
import { verifyKuhnArtifactHash } from "../src/lib/solver/toy/artifact-node";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { kuhnDecisionFacts } from "../src/lib/solver/toy/explain";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";
import { KUHN_RANKS, kuhnGame, kuhnState } from "../src/lib/solver/toy/kuhn";

const artifact = artifactData as unknown as KuhnSolveArtifact;

test("committed Kuhn artifact has a valid hash and canonical formatting", () => {
  assert.equal(verifyKuhnArtifactHash(artifact), true);
  const disk = readFileSync(
    join(process.cwd(), "src/lib/solver/toy/artifacts/kuhn-v1.json"),
    "utf8",
  );
  assert.equal(stringifyKuhnArtifact(artifact), disk);
  assert.equal(artifact.acceptance.passed, true);
});

test("committed Kuhn strategy independently reproduces its grade", () => {
  const strategy = deserializeKuhnStrategy(artifact.strategy);
  const grade = gradeStrategy(kuhnGame, strategy, buildGameTreeIndex(kuhnGame));
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(
    grade.bestResponses.map(response => response.value),
    artifact.bestResponseValue,
  );
  assert.deepEqual(grade.gains, artifact.gains);
  assert.equal(grade.nashGap, artifact.nashGap);
  assert.equal(grade.exploitability, artifact.exploitability);
});

test("our Kuhn result agrees with the pinned Brown result on value and quality", () => {
  assert.equal(brownData.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.ok(Math.abs(artifact.value[0] - brownData.value[0]) <= 0.001);
  assert.ok(artifact.exploitability <= 0.001);
  assert.ok(brownData.exploitability <= 0.001);
});

test("Kuhn teaching facts are derived reproducibly from the saved strategy", () => {
  const strategy = deserializeKuhnStrategy(artifact.strategy);
  const decisions = kuhnDecisionFacts(strategy);
  assert.deepEqual(decisions, artifact.decisions);
  assert.equal(decisions.length, 12);

  for (const decision of decisions) {
    assert.ok(decision.reachProbability > 0);
    assert.equal(decision.offPath, false);
    assert.ok(Math.abs(decision.actions.reduce((sum, action) => sum + action.frequency, 0) - 1) < 1e-12);
    assert.ok(
      Math.abs(decision.opponentCards.reduce(
        (sum, card) => sum + (card.probability ?? 0),
        0,
      ) - 1) < 1e-12,
    );
    assert.equal(Math.min(...decision.actions.map(action => action.differenceFromBest ?? Infinity)), 0);
  }

  const jackOpen = decisions.find(decision =>
    decision.player === 0 && decision.card === "J" && decision.history.length === 0
  );
  assert.ok(jackOpen);
  assert.ok(jackOpen.actions.every(action => action.frequency > 0.1));
  assert.ok(Math.max(...jackOpen.actions.map(action => action.differenceFromBest ?? Infinity)) < 0.001);

  const queenOpen = decisions.find(decision =>
    decision.player === 0 && decision.card === "Q" && decision.history.length === 0
  );
  assert.ok(queenOpen);
  const queenCheck = queenOpen.actions.find(action => action.action === "check");
  const queenBet = queenOpen.actions.find(action => action.action === "bet");
  if (!queenCheck || queenCheck.expectedValue === null || !queenBet || queenBet.expectedValue === null) {
    throw new Error("Expected reached check and bet values for player 0's queen");
  }
  assert.ok(queenCheck.expectedValue > queenBet.expectedValue + 0.1);
});

test("Kuhn teaching facts refuse to invent values for off-path decisions", () => {
  const index = buildGameTreeIndex(kuhnGame);
  const strategy = new Map(uniformStrategy(index));
  for (const card of KUHN_RANKS) {
    const opponentCard = KUHN_RANKS.find(rank => rank !== card)!;
    const state = kuhnState([card, opponentCard]);
    const key = kuhnGame.informationSet(state, 0);
    strategy.set(key, { actions: ["check", "bet"], probabilities: [0, 1] });
  }

  const decisions = kuhnDecisionFacts(strategy);
  const afterAPlayer0Check = decisions.filter(decision => decision.history[0] === "check");
  assert.equal(afterAPlayer0Check.length, 6);
  for (const decision of afterAPlayer0Check) {
    assert.equal(decision.reachProbability, 0);
    assert.equal(decision.offPath, true);
    assert.ok(decision.actions.every(action =>
      action.expectedValue === null && action.differenceFromBest === null
    ));
    assert.ok(decision.opponentCards.every(card => card.probability === null));
  }
});
