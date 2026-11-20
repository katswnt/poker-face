import assert from "node:assert/strict";
import test from "node:test";
import { startHand, type HumanModelRequest } from "../src/lib/hu-play/hand";
import { PlayController } from "../src/lib/hu-play/ui-controller";
import { nodePolicy, preparationKey, PreparedPolicySource } from "../src/lib/hu-play/sources/policy";
import { actionToken } from "../src/lib/hu-play/public-state";
import { gradePlayDecision } from "../src/lib/hu-play/decision-grade";
import { POSTFLOP_SOLVER_COMMIT, type BridgeAction } from "../src/lib/solver/bridge/contract";

class ReplacingModel extends PreparedPolicySource {
  readonly replacements = new Map<string, BridgeAction>();
  wait: ((signal?: AbortSignal) => Promise<void>) | null = null;
  constructor(public values: boolean) { super(); }
  async prepare(q: HumanModelRequest, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const p = q.publicState, human = p.toAct !== q.aiSeat, action = this.replacements.get(p.path.join(" "));
    const facing = p.streetPut[p.toAct!] < Math.max(...p.streetPut);
    const actions: BridgeAction[] = facing ? [{ type: "fold" }, { type: "call" }] : [{ type: "check" }, { type: "bet", to: 200 }];
    if (action && !actions.some(a => actionToken(a) === actionToken(action))) actions.push(action);
    const selected = action ? actions.findIndex(a => actionToken(a) === actionToken(action)) : facing ? 1 : 0;
    const hands = (human ? q.ranges.human : q.ranges.ai).entries.map(h => h.combo);
    const live = this.values && p.street !== "flop";
    const provenance = p.street === "flop" ? { source: "library" as const, spotHash: "a".repeat(64), librarySpotId: "synthetic snapshot test" }
      : { source: "resolve" as const, kind: action ? "nested" as const : "street-root" as const, spotHash: (action ? "b" : "a").repeat(64),
        iterations: 100, exploitabilityPctPot: .2, precision: "float32" as const, bridgeVersion: "test", engineCommit: POSTFLOP_SOLVER_COMMIT, degradation: 0 };
    this.prepared = { key: preparationKey(q), policy: nodePolicy(q, { player: p.toAct!, actions, hands,
      rows: actions.map((_, a) => hands.map(() => Number(a === selected))), encoding: "float32", provenance,
      ...(live ? { actionEvBasis: "local-solved-policy" as const,
        actionEvRows: actions.map((_, a) => hands.map(() => action ? a === 0 ? 500 : 1 : a === 0 ? 10 : 20)) } : {}) }) };
  }
  async prepareHumanAction(q: HumanModelRequest, action: BridgeAction, signal?: AbortSignal) {
    if (q.publicState.street !== "flop") this.replacements.set(q.publicState.path.join(" "), action);
    if (this.wait) await this.wait(signal);
    signal?.throwIfAborted(); await this.prepare(q, signal); return "nested";
  }
}

function controller(values: boolean) {
  const source = new ReplacingModel(values);
  const c = new PlayController(async (seed, humanSeat) => ({ source, state: startHand({ handSeed: seed,
    aiSeat: humanSeat === 0 ? 1 : 0, startingPot: 550, startingStack: 9750, minimumBet: 100, flop: ["Kd", "8c", "4h"] },
  { humanHand: "KsQs", aiHand: "AsAh", runout: ["2s", "9d"] }, {
    human: { source: "test", entries: [{ combo: "KsQs", weight: 1 }] },
    ai: { source: "test", entries: [{ combo: "AsAh", weight: 1 }] },
  }) }));
  return { c, source };
}
async function reachTurn(c: PlayController, human: 0 | 1) {
  await c.start(0, human); await c.act({ type: "check" });
  assert.equal(c.getSnapshot().phase, "human", c.getSnapshot().message);
  assert.equal(c.getSnapshot().hand!.public.street, "turn");
  return c.getSnapshot().decisions.filter(d => d.actor === "human").at(-1)!;
}
async function finish(c: PlayController) {
  for (let i = 0; i < 6 && c.getSnapshot().phase === "human"; i++) await c.act({ type: "check" });
  assert.equal(c.getSnapshot().phase, "complete", c.getSnapshot().message);
}

test("human grading retains the model shown before preparation; both seats and off-menu choices preserve actual play", async () => {
  for (const human of [0, 1] as const) for (const action of [{ type: "check" }, { type: "bet", to: 200 }, { type: "bet", to: 201 }] as const) {
    const { c } = controller(true), before = await reachTurn(c, human), equity = c.equityInput(before.key);
    assert.equal(before.provenance.spotHash, "a".repeat(64)); assert.deepEqual(before.actionEvs, [10, 20]);
    assert.ok(c.getSnapshot().decisions.every(d => d.actor !== "ai" || (d.strategy === null && d.actionEvs === null)));
    await c.act(action); assert.notEqual(c.getSnapshot().phase, "error", c.getSnapshot().message);
    const retained = c.getSnapshot().decisions.find(d => d.key === before.key)!;
    assert.equal(retained.provenance.spotHash, before.provenance.spotHash, "A later solve must not replace the model being graded");
    assert.deepEqual(retained.actionEvs, before.actionEvs); assert.deepEqual(retained.strategy, before.strategy);
    assert.equal(retained.humanActionMode, "nested"); assert.deepEqual(c.equityInput(before.key), equity);
    const grade = gradePlayDecision(retained, c.getSnapshot().hand!.public);
    if (action.type === "bet" && action.to === 201) assert.deepEqual(grade, { status: "unavailable", reason: "off-menu" });
    else assert.ok(grade.status === "ready" && grade.basis === "local-solved-policy" && grade.gapChips === (action.type === "check" ? 10 : 0));
    await finish(c);
    const plain = controller(false).c; await reachTurn(plain, human); await plain.act(action); await finish(plain);
    assert.deepEqual(c.completedLog(), plain.completedLog(), "Teaching changes no RNG, policy choice or poker log");
    assert.deepEqual(c.getSnapshot().ledger, plain.getSnapshot().ledger);
    assert.ok(c.getSnapshot().decisions.some(d => d.actor === "ai" && d.actionEvBasis === "local-solved-policy" && d.actionEvs));
    c.dispose(); plain.dispose();
  }
});

test("cancel and retry after a model replacement preserve the original human snapshot and spend no chips", async () => {
  const { c, source } = controller(true), before = await reachTurn(c, 0);
  let release!: () => void;
  source.wait = () => new Promise<void>(r => { release = r; });
  const pending = c.act({ type: "check" }); c.cancel(); release(); await pending;
  assert.equal(c.getSnapshot().phase, "cancelled"); assert.deepEqual(c.getSnapshot().hand!.public, before.public);
  source.wait = null; await c.resume(); assert.equal(c.getSnapshot().phase, "human");
  const retained = c.getSnapshot().decisions.find(d => d.key === before.key)!;
  assert.equal(retained.provenance.spotHash, before.provenance.spotHash); assert.deepEqual(retained.actionEvs, before.actionEvs);
  await c.act({ type: "check" });
  const grade = gradePlayDecision(c.getSnapshot().decisions.find(d => d.key === before.key)!, c.getSnapshot().hand!.public);
  assert.ok(grade.status === "ready" && grade.gapChips === 10); c.dispose();
});

test("values added by a later model cannot retroactively grade an unavailable original decision", async () => {
  const { c, source } = controller(false), before = await reachTurn(c, 0);
  assert.deepEqual(before.actionEvs, [null, null]); source.values = true;
  await c.act({ type: "check" });
  const retained = c.getSnapshot().decisions.find(d => d.key === before.key)!;
  assert.equal(retained.provenance.spotHash, before.provenance.spotHash); assert.deepEqual(retained.actionEvs, before.actionEvs);
  assert.equal(gradePlayDecision(retained, c.getSnapshot().hand!.public).status, "unavailable");
  c.dispose();
});
