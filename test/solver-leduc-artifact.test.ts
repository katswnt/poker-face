import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/toy/artifacts/leduc-v1.json" with { type: "json" };
import referenceData from "./fixtures/solver/leduc-brown-6a104428.json" with { type: "json" };
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import {
  buildGameTreeIndex,
  uniformStrategy,
  validateStrategy,
} from "../src/lib/solver/toy/game";
import { leducDecisionFacts } from "../src/lib/solver/toy/leduc-explain";
import {
  deserializeLeducStrategy,
  stringifyLeducArtifact,
  type LeducReferenceResult,
  type LeducSolveArtifact,
} from "../src/lib/solver/toy/leduc-artifact";
import {
  fingerprintLeducGame,
  verifyLeducArtifactHash,
} from "../src/lib/solver/toy/leduc-artifact-node";
import { LEDUC_RANKS, leducGame, leducState } from "../src/lib/solver/toy/leduc";

const artifact = artifactData as unknown as LeducSolveArtifact;
const reference = referenceData as unknown as LeducReferenceResult;

test("committed Leduc artifact has a valid hash and canonical formatting", () => {
  assert.equal(verifyLeducArtifactHash(artifact), true);
  const disk = readFileSync(
    join(process.cwd(), "src/lib/solver/toy/artifacts/leduc-v1.json"),
    "utf8",
  );
  assert.equal(stringifyLeducArtifact(artifact), disk);
  assert.equal(artifact.acceptance.passed, true);
  assert.equal(artifact.schemaVersion, 3);
  assert.equal(artifact.rulesFingerprint, fingerprintLeducGame());
  assert.equal(artifact.iterations, 102_400);
  assert.deepEqual(artifact.tree, {
    totalStates: 9_451,
    chanceNodes: 151,
    decisionNodes: 3_780,
    terminalNodes: 5_520,
    informationSets: 288,
  });
});

test("Leduc teaching facts are exact, reproducible, and hide physical card copies", () => {
  const strategy = deserializeLeducStrategy(artifact.strategy);
  const decisions = leducDecisionFacts(strategy);
  assert.deepEqual(decisions, artifact.decisions);
  assert.equal(decisions.length, 288);

  for (const decision of decisions) {
    assert.ok(decision.reachProbability > 0);
    assert.equal(decision.offPath, false);
    assert.ok(Math.abs(
      decision.actions.reduce((sum, action) => sum + action.frequency, 0) - 1,
    ) < 1e-12);
    assert.ok(Math.abs(
      decision.opponentRanks.reduce(
        (sum, rank) => sum + (rank.probability ?? 0),
        0,
      ) - 1,
    ) < 1e-12);
    assert.equal(
      Math.min(...decision.actions.map(action => action.differenceFromBest ?? Infinity)),
      0,
    );
    assert.equal(decision.pot, decision.contributions[0] + decision.contributions[1]);
    assert.equal(
      decision.toCall,
      Math.max(...decision.contributions) - decision.contributions[decision.player],
    );

    for (const action of decision.actions) {
      assert.notEqual(action.expectedValue, null);
      assert.notEqual(action.expectedAdditionalValue, null);
      assert.ok(Math.abs(
        action.expectedAdditionalValue! - action.expectedValue! -
        decision.contributions[decision.player]
      ) < 1e-10);
      const outcomeSum = Object.values(action.outcomes)
        .reduce<number>((sum, probability) => sum + (probability ?? 0), 0);
      assert.ok(Math.abs(outcomeSum - 1) < 1e-10);
      if (action.showdownEquity !== null) {
        assert.ok(action.showdownEquity >= 0 && action.showdownEquity <= 1);
      }
      if (action.action === "bet" || action.action === "raise") {
        assert.notEqual(action.immediateOpponentFoldProbability, null);
        assert.ok(
          action.immediateOpponentFoldProbability! <= action.outcomes.opponentFolds! + 1e-10,
        );
      } else {
        assert.equal(action.immediateOpponentFoldProbability, null);
      }
      if (action.action === "fold") {
        assert.ok(Math.abs(action.expectedAdditionalValue!) < 1e-10);
        assert.ok(Math.abs(action.outcomes.playerFolds! - 1) < 1e-10);
      }
    }
  }

  const jackOpen = decisions.find(decision =>
    decision.player === 0 && decision.privateRank === "J" &&
    decision.firstRoundHistory.length === 0
  );
  assert.ok(jackOpen);
  assert.deepEqual(jackOpen.contributions, [1, 1]);
  assert.equal(jackOpen.pot, 2);
  assert.equal(jackOpen.toCall, 0);
  assert.deepEqual(
    jackOpen.opponentRanks.map(({ rank, probability }) => [rank, probability]),
    [["J", 0.2], ["Q", 0.4], ["K", 0.4]],
  );

  const pairedJack = decisions.find(decision =>
    decision.privateRank === "J" && decision.boardRank === "J"
  );
  assert.ok(pairedJack);
  assert.equal(pairedJack.handState, "pair");
  assert.equal(
    pairedJack.opponentRanks.find(({ rank }) => rank === "J")?.probability,
    0,
  );
});

test("Leduc teaching facts label unreachable decisions instead of inventing advice", () => {
  const index = buildGameTreeIndex(leducGame);
  const strategy = new Map(uniformStrategy(index));
  const cardsByRank = {
    J: ["J0", "Q0"],
    Q: ["Q0", "J0"],
    K: ["K0", "J0"],
  } as const;
  for (const rank of LEDUC_RANKS) {
    const state = leducState({ privateCards: cardsByRank[rank] });
    const key = leducGame.informationSet(state, 0);
    strategy.set(key, { actions: ["check", "bet"], probabilities: [0, 1] });
  }

  const decisions = leducDecisionFacts(strategy);
  const afterAPlayer0Check = decisions.filter(decision =>
    decision.firstRoundHistory[0] === "check"
  );
  assert.ok(afterAPlayer0Check.length > 0);
  for (const decision of afterAPlayer0Check) {
    assert.equal(decision.reachProbability, 0);
    assert.equal(decision.offPath, true);
    assert.ok(decision.opponentRanks.every(rank => rank.probability === null));
    assert.ok(decision.actions.every(action =>
      action.expectedValue === null &&
      action.expectedAdditionalValue === null &&
      action.differenceFromBest === null &&
      action.immediateOpponentFoldProbability === null &&
      action.showdownEquity === null &&
      Object.values(action.outcomes).every(probability => probability === null)
    ));
  }
});

test("committed Leduc strategy independently reproduces its exact grade", () => {
  const index = buildGameTreeIndex(leducGame);
  const strategy = deserializeLeducStrategy(artifact.strategy);
  validateStrategy(index, strategy);
  assert.equal(strategy.size, 288);

  const grade = gradeStrategy(leducGame, strategy, index);
  assert.deepEqual(grade.value, artifact.value);
  assert.deepEqual(
    grade.bestResponses.map(response => response.value),
    artifact.bestResponseValue,
  );
  assert.deepEqual(grade.gains, artifact.gains);
  assert.equal(grade.nashGap, artifact.nashGap);
  assert.equal(grade.exploitability, artifact.exploitability);
});

test("our Leduc result agrees with the independently generated pinned reference", () => {
  assert.equal(reference.source, "noambrown/poker_solver");
  assert.equal(reference.commit, "6a10442877ffc8fd28af93e16e279b9bbdd97b2a");
  assert.deepEqual(artifact.reference, reference);
  assert.ok(artifact.acceptance.brownReferenceValueDifference <= 0.002, "Brown comparison is informational");
  assert.ok(artifact.exploitability <= 0.01);
  assert.ok(reference.exploitability <= 0.01);
});

test("the Leduc convergence record improves without claiming every checkpoint is monotone", () => {
  assert.deepEqual(
    artifact.convergence.map(checkpoint => checkpoint.iteration),
    [100, 400, 1_600, 6_400, 25_600, 102_400],
  );
  assert.ok(
    artifact.convergence.at(-1)!.exploitability < artifact.convergence[0].exploitability,
  );
  for (const checkpoint of artifact.convergence) {
    assert.ok(checkpoint.value.every(Number.isFinite));
    assert.ok(Math.abs(checkpoint.value[0] + checkpoint.value[1]) < 1e-12);
    assert.equal(checkpoint.exploitability, checkpoint.nashGap / 2);
  }
});
