// Regression tests for audit findings in the toy (Kuhn/Leduc) solver and its lessons.
import { test } from "node:test";
import assert from "node:assert/strict";
import artifactData from "../src/lib/solver/toy/artifacts/leduc-v1.json" with { type: "json" };
import brownData from "./fixtures/solver/leduc-brown-6a104428.json" with { type: "json" };
import convergedData from "./fixtures/solver/leduc-cfr-plus-20k-reference.json" with { type: "json" };
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import {
  LEDUC_ACCEPTANCE,
  LEDUC_CONVERGED_REFERENCE,
  deserializeLeducStrategy,
  evaluateLeducAcceptance,
  type LeducReferenceResult,
  type LeducSolveArtifact,
  type SerializedLeducStrategy,
} from "../src/lib/solver/toy/leduc-artifact";
import type { LeducDecisionFacts } from "../src/lib/solver/toy/leduc-explain";
import { leducGame } from "../src/lib/solver/toy/leduc";
import { buildLeducLabData } from "../src/lib/solver/toy/teaching";

const artifact = artifactData as unknown as LeducSolveArtifact;
const brown = brownData as unknown as LeducReferenceResult;
const converged = convergedData as unknown as {
  iterations: number;
  strategy: SerializedLeducStrategy;
};

// ---------- Finding 1: the Leduc gate must use a converged, certified reference ----------

test("the converged Leduc reference value is certified by this repo's exact best response", () => {
  const grade = gradeStrategy(leducGame, deserializeLeducStrategy(converged.strategy));
  assert.equal(converged.iterations, LEDUC_CONVERGED_REFERENCE.iterations);
  assert.ok(Math.abs(grade.value[0] - LEDUC_CONVERGED_REFERENCE.value) < 1e-12);
  assert.ok(Math.abs(grade.exploitability - LEDUC_CONVERGED_REFERENCE.exploitability) < 1e-12);
  // True game value v* satisfies v0 - gain1 <= v* <= v0 + gain0.
  const [low, high] = LEDUC_CONVERGED_REFERENCE.certifiedInterval;
  assert.ok(Math.abs(low - (grade.value[0] - grade.gains[1])) < 1e-12);
  assert.ok(Math.abs(high - (grade.value[0] + grade.gains[0])) < 1e-12);
  // The reference is at least 50x tighter than the tolerance it is used to enforce.
  assert.ok(high - low < LEDUC_ACCEPTANCE.player0ValueTolerance / 50);
});

test("the Brown 1,600-iteration value is not converged and is not the gate", () => {
  const [low, high] = LEDUC_CONVERGED_REFERENCE.certifiedInterval;
  assert.ok(brown.value[0] < low - LEDUC_ACCEPTANCE.player0ValueTolerance);
  assert.ok(high >= LEDUC_CONVERGED_REFERENCE.value && LEDUC_CONVERGED_REFERENCE.value >= low);
  // A value that agrees with Brown but misses the converged value must fail.
  const nearBrown = evaluateLeducAcceptance(
    { value: [-0.0536, 0.0536], gains: [0.004, 0.004], exploitability: 0.004 },
    brown,
  );
  assert.ok(nearBrown.brownReferenceValueDifference < 0.001);
  assert.equal(nearBrown.passed, false);
});

test("the Leduc gate rejects a value whose own certificate excludes the converged value", () => {
  const overconfident = evaluateLeducAcceptance(
    { value: [-0.0525, 0.0525], gains: [0, 0], exploitability: 0 },
    brown,
  );
  assert.ok(overconfident.convergedReferenceValueDifference < 0.001);
  assert.equal(overconfident.certificateContainsConvergedReference, false);
  assert.equal(overconfident.passed, false);
});

test("the committed Leduc artifact passes the converged-reference gate", () => {
  const a = artifact.acceptance;
  assert.equal(a.convergedReferenceValue, LEDUC_CONVERGED_REFERENCE.value);
  assert.ok(Math.abs(
    a.convergedReferenceValueDifference - Math.abs(artifact.value[0] - LEDUC_CONVERGED_REFERENCE.value),
  ) < 1e-15);
  assert.ok(a.convergedReferenceValueDifference <= LEDUC_ACCEPTANCE.player0ValueTolerance);
  assert.deepEqual(a.certifiedValueInterval, [
    artifact.value[0] - artifact.gains[1],
    artifact.value[0] + artifact.gains[0],
  ]);
  assert.equal(a.certificateContainsConvergedReference, true);
  assert.equal(a.passed, true);
});

// ---------- Findings 2-4: lesson text must follow the computed numbers ----------

const BLUFF = "leduc-v1:p0:card=Q:board=J:r0=check-bet-call:r1=start";
const CATCH = "leduc-v1:p1:card=K:board=J:r0=check-bet-call:r1=bet";
const MIX = "leduc-v1:p0:card=Q:board=-:r0=start:r1=start";

function withDecision(
  key: string,
  edit: (decision: LeducDecisionFacts) => LeducDecisionFacts,
): LeducSolveArtifact {
  return {
    ...artifact,
    decisions: artifact.decisions.map(decision => decision.informationSet === key ? edit(decision) : decision),
  };
}

/** Re-rank two actions so `winner` becomes best by `gap` chips. */
function makeBest(
  decision: LeducDecisionFacts,
  winner: string,
  loser: string,
  gap: number,
): LeducDecisionFacts {
  const base = decision.actions.find(action => action.action === loser)!.expectedValue!;
  return {
    ...decision,
    actions: decision.actions.map(action => {
      if (action.action === winner) return { ...action, expectedValue: base + gap, differenceFromBest: 0 };
      if (action.action === loser) return { ...action, expectedValue: base, differenceFromBest: gap };
      return action;
    }),
  };
}

function lesson(source: LeducSolveArtifact, id: string) {
  return buildLeducLabData(source).lessons.find(candidate => candidate.id === id)!;
}

test("bluff lesson does not claim that better hands fold", () => {
  const bluff = lesson(artifact, "bluff");
  assert.doesNotMatch(bluff.title, /better hands? fold/i);
  assert.doesNotMatch(bluff.teachingPoints.join(" "), /better hands? fold/i);
});

test("bluff lesson names the leading action from the computed values", () => {
  const committed = lesson(artifact, "bluff");
  const check = committed.actions.find(action => action.action === "check")!;
  const bet = committed.actions.find(action => action.action === "bet")!;
  const expected = bet.differenceFromBest === 0 ? /Betting leads checking/ : /Checking leads betting/;
  assert.match(committed.teachingPoints.join(" "), expected);
  assert.ok(check.differenceFromBest! > 0 || bet.differenceFromBest! > 0);

  const flipped = lesson(withDecision(BLUFF, d => makeBest(d, "check", "bet", 0.002)), "bluff");
  const text = flipped.teachingPoints.join(" ");
  assert.match(text, /Checking leads betting by only 0\.0020 chips/);
  assert.doesNotMatch(text, /Betting leads/);

  const wide = lesson(withDecision(BLUFF, d => makeBest(d, "bet", "check", 0.5)), "bluff");
  assert.doesNotMatch(wide.teachingPoints.join(" "), /only|close/);
});

test("bluff-catch lesson names the leading action from the computed values", () => {
  const committed = lesson(artifact, "bluff-catch");
  const call = committed.actions.find(action => action.action === "call")!;
  const expected = call.differenceFromBest === 0 ? /Calling is ahead/ : /Folding is ahead/;
  assert.match(committed.teachingPoints.join(" "), expected);

  const flipped = lesson(withDecision(CATCH, d => makeBest(d, "call", "fold", 0.003)), "bluff-catch");
  const text = flipped.teachingPoints.join(" ");
  assert.match(text, /Calling is ahead by 0\.0030 chips/);
  assert.doesNotMatch(text, /Folding is ahead/);
});

test("bluff-catch copy lists every opponent holding with nonzero weight and its showdown result", () => {
  const catchLesson = lesson(artifact, "bluff-catch");
  const text = catchLesson.teachingPoints.join(" ");
  const names = { J: "jack", Q: "queen", K: "king" } as const;
  const nonzero = catchLesson.opponentRanks.filter(rank => (rank.probability ?? 0) > 0);
  assert.equal(nonzero.length, 3, "committed data has J, Q, and K weight");
  for (const rank of nonzero) {
    assert.match(text, new RegExp(`an? ${names[rank.rank]} about`), `missing ${rank.rank}`);
  }
  assert.match(text, /splits with the king|ties the king/);
});

test("mixing lesson reports the real gap even when betting is the better plan", () => {
  const flipped = lesson(withDecision(MIX, d => makeBest(d, "bet", "check", 0.0015)), "mix");
  assert.match(flipped.teachingPoints.join(" "), /only 0\.0015 chips apart/);
});
