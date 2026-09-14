import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/toy/artifacts/leduc-v1.json" with { type: "json" };
import type { LeducSolveArtifact } from "../src/lib/solver/toy/leduc-artifact";
import { buildLeducLabData } from "../src/lib/solver/toy/teaching";

const artifact = artifactData as unknown as LeducSolveArtifact;
const lab = buildLeducLabData(artifact);

test("the Leduc lab is built from four audited on-path decisions", () => {
  assert.deepEqual(lab.lessons.map(lesson => lesson.id), [
    "mix",
    "value",
    "bluff",
    "bluff-catch",
  ]);
  assert.equal(lab.quality.maximumBestResponseGain, Math.max(...artifact.gains));
  assert.equal(lab.provenance.payloadHash, artifact.payloadHash);
  for (const lesson of lab.lessons) {
    assert.ok(lesson.answer.length > 0);
    assert.equal(lesson.teachingPoints.length, 3);
    assert.ok(lesson.actions.some(action => action.action === lesson.featuredAction));
    assert.ok(Math.abs(
      lesson.opponentRanks.reduce(
        (sum, rank) => sum + (rank.probability ?? 0),
        0,
      ) - 1,
    ) < 1e-12);
  }
});

test("the mixing lesson calls a near-tie a mix instead of inventing one right answer", () => {
  const lesson = lab.lessons.find(candidate => candidate.id === "mix")!;
  const check = lesson.actions.find(action => action.action === "check")!;
  const bet = lesson.actions.find(action => action.action === "bet")!;
  assert.ok(check.frequency > 0.4 && bet.frequency > 0.5);
  assert.ok(bet.differenceFromBest! < 0.002);
  assert.match(lesson.answer, /almost even/);
  assert.match(lesson.teachingPoints.join(" "), /approximate/);
});

test("value, bluff, and bluff-catch labels each require matching evidence", () => {
  const value = lab.lessons.find(candidate => candidate.id === "value")!;
  const valueBet = value.actions.find(action => action.action === "bet")!;
  assert.equal(value.situation.privateRank, "K");
  assert.equal(value.situation.boardRank, "K");
  assert.equal(valueBet.showdownEquity, 1);
  assert.ok(valueBet.immediateOpponentFoldProbability! < 1);

  const bluff = lab.lessons.find(candidate => candidate.id === "bluff")!;
  const bluffBet = bluff.actions.find(action => action.action === "bet")!;
  assert.ok(bluffBet.immediateOpponentFoldProbability! > 0.39);
  assert.ok(bluffBet.showdownEquity! < 0.001);
  assert.equal(bluffBet.outcomes.showdownWin, 0);

  const bluffCatch = lab.lessons.find(candidate => candidate.id === "bluff-catch")!;
  const call = bluffCatch.actions.find(action => action.action === "call")!;
  assert.ok(bluffCatch.price);
  assert.equal(bluffCatch.price.callCost, 2);
  assert.equal(bluffCatch.price.finalPot, 8);
  assert.equal(bluffCatch.price.minimumShare, 0.25);
  assert.ok(bluffCatch.price.estimatedShare < bluffCatch.price.minimumShare);
  assert.ok(call.differenceFromBest! > 0 && call.differenceFromBest! < 0.007);
  assert.match(bluffCatch.teachingPoints.join(" "), /honest label is “close.”/);
});

test("teaching copy keeps the toy game's limits plain", () => {
  const copy = JSON.stringify(lab.lessons);
  assert.doesNotMatch(copy, /\bGTO\b/i);
  assert.doesNotMatch(copy, /always correct|perfect strategy/i);
  assert.match(copy, /saved strategy/i);
  assert.match(copy, /approximate/i);
});
