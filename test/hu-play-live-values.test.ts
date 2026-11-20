import assert from "node:assert/strict";
import test from "node:test";
import { initialPublicState, applyPublicEvent } from "../src/lib/hu-play/public-state";
import { nodePolicy } from "../src/lib/hu-play/sources/policy";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import type { PlayDecisionView } from "../src/lib/hu-play/ui-controller";
import { POSTFLOP_SOLVER_COMMIT } from "../src/lib/solver/bridge/contract";
import type { DecisionProvenance } from "../src/lib/hu-play/types";

function request(): HumanModelRequest {
  let p = initialPublicState({ startingPot: 100, startingStack: 1000, minimumBet: 1, flop: ["Kd", "8c", "4h"] });
  p = applyPublicEvent(p, { kind: "action", player: 0, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "action", player: 1, action: { type: "check" } });
  p = applyPublicEvent(p, { kind: "card", street: "turn", card: "2s" });
  return { publicState: p, aiSeat: 1, ranges: {
    human: { source: "test", entries: [{ combo: "KsQs", weight: 1 }] },
    ai: { source: "test", entries: [{ combo: "AsAh", weight: 1 }] },
  } };
}
const provenance: DecisionProvenance = { source: "resolve", kind: "street-root", spotHash: "a".repeat(64),
  iterations: 100, exploitabilityPctPot: .2, precision: "float32", bridgeVersion: "test", engineCommit: POSTFLOP_SOLVER_COMMIT, degradation: 0 };
const input = () => ({ player: 0 as const, actions: [{ type: "check" as const }, { type: "bet" as const, to: 50 }],
  hands: ["KsQs"], rows: [[.9], [.1]], encoding: "float32" as const, provenance, actionEvRows: [[-5.2], [1.4]] });

test("policy values require an explicit saved or local basis; encoding never chooses that basis", () => {
  const q = request();
  assert.throws(() => nodePolicy(q, input()), /basis/i);
  const live = nodePolicy(q, { ...input(), actionEvBasis: "local-solved-policy" });
  assert.equal(live.actionEvBasis, "local-solved-policy");
  assert.deepEqual(live.actionEvs("KsQs"), [-5.2, 1.4]);
  const saved = nodePolicy(q, { ...input(), actionEvBasis: "original-saved-policy",
    provenance: { source: "library", spotHash: "b".repeat(64), librarySpotId: "test" } });
  assert.equal(saved.actionEvBasis, "original-saved-policy", "Float32 can also encode a saved policy");
  assert.throws(() => nodePolicy(q, { ...input(), actionEvBasis: "local-solved-policy", provenance: saved.provenance }), /basis|provenance/i);
});

test("policy teaching rows are complete, finite or whole-hand null, and detached from mutable inputs", () => {
  const q = request();
  for (const rows of [[[1]], [[1], []], [[1], [NaN]], [[null], [1]]]) {
    assert.throws(() => nodePolicy(q, { ...input(), actionEvBasis: "local-solved-policy", actionEvRows: rows }), /value|EV|mask|row/i);
  }
  const data = input(), p = nodePolicy(q, { ...data, actionEvBasis: "local-solved-policy" });
  data.actionEvRows[0][0] = 123;
  assert.deepEqual(p.actionEvs("KsQs"), [-5.2, 1.4]);
  assert.deepEqual(p.actionEvs("7s6s"), [null, null]);
  const missing = nodePolicy(q, { ...input(), actionEvBasis: "local-solved-policy", actionEvRows: [[null], [null]] });
  assert.deepEqual(missing.actionEvs("KsQs"), [null, null]);
});

function decision(): PlayDecisionView {
  const q = request();
  return { key: q.publicState.path.join(" "), actor: "human", public: q.publicState, provenance,
    strategy: [{ action: { type: "check" }, probability: .9 }, { action: { type: "bet", to: 50 }, probability: .1 }],
    actionEvs: [-5.2, 1.4], actionEvBasis: "local-solved-policy", humanActionMode: null };
}

test("live grade uses best EV after hidden-hand averaging and names its original local model", async () => {
  const api = await import("../src/lib/hu-play/decision-grade");
  assert.equal(typeof api.gradePlayDecision, "function", "Model-relative live grade required");
  const d = decision(), played = applyPublicEvent(d.public, { kind: "action", player: 0, action: { type: "check" } });
  const grade = api.gradePlayDecision(d, played);
  assert.equal(grade.status, "ready");
  if (grade.status !== "ready" || grade.basis !== "local-solved-policy") throw new Error("Local grade required");
  assert.equal(grade.modelSpotHash, provenance.spotHash);
  assert.equal(grade.selectedEvChips, -5.2); assert.equal(grade.bestEvChips, 1.4);
  assert.ok(Math.abs(grade.gapChips - 6.6) < 1e-12);
  assert.deepEqual(grade.bestActions, [{ type: "bet", to: 50 }]);
  assert.equal(api.gradePlayDecision(d, d.public).status, "pending");
  const tie = api.gradePlayDecision({ ...d, actionEvs: [-5.2, -5.2] }, played);
  assert.ok(tie.status === "ready" && tie.gapChips === 0 && tie.bestActions.length === 2);
  assert.equal(api.gradeSavedDecision(d, played).status, "unavailable", "Old saved-only API keeps its meaning");
});

test("live grade rejects off-menu, partial, translated, hidden-AI and unrelated-history decisions", async () => {
  const api = await import("../src/lib/hu-play/decision-grade");
  assert.equal(typeof api.gradePlayDecision, "function");
  const d = decision(), played = applyPublicEvent(d.public, { kind: "action", player: 0, action: { type: "check" } });
  for (const ev of [null, [1, null], [1], [NaN, 1], [Infinity, 1]]) {
    assert.equal(api.gradePlayDecision({ ...d, actionEvs: ev }, played).status, "unavailable");
  }
  assert.equal(api.gradePlayDecision({ ...d, actor: "ai" }, played).status, "unavailable");
  assert.equal(api.gradePlayDecision({ ...d, provenance: { source: "translation", spotHash: provenance.spotHash,
    x: 1, a: .5, b: 2, probabilityA: .5, mappedTo: "a" } }, played).status, "unavailable");
  assert.deepEqual(api.gradePlayDecision(d, applyPublicEvent(d.public, { kind: "action", player: 0, action: { type: "bet", to: 51 } })),
    { status: "unavailable", reason: "off-menu" });
  assert.deepEqual(api.gradePlayDecision(d, initialPublicState({ startingPot: 100, startingStack: 1000, minimumBet: 1, flop: ["Ac", "8c", "4h"] })),
    { status: "unavailable", reason: "history-mismatch" });
});
