import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { BridgeSliceNode } from "../src/lib/solver/bridge/contract";
import { diagnoseExport, type ExportSample } from "../src/lib/solver/bridge/formations/export-diagnostic";
import { auditExportObservation } from "../scripts/audit-formation-export-diagnostic";
import type { DiagnosticObservation } from "../scripts/capture-formation-export-diagnostic";
import { hashJson } from "../src/lib/solver/preflop-v2/corpus";

function example(): ExportSample {
  const parent: BridgeSliceNode = {
    path: [], street: "river", board: ["Ts", "7h", "6s", "5h", "4s"], player: 0, committed: [0, 0],
    actions: [{ token: "x", engineAction: "Check", action: { type: "check" } },
      { token: "b100", engineAction: "Bet(100)", action: { type: "bet", to: 100 } }],
    reach: [[1, .000051, .000049], [1]], strategy: [[1, 1, 0], [0, 0, 1]],
    ev: [[0, 0, 0], [49]], actionEv: [[0, 0, 0], [0, 0, 0]], equity: [[.5, .5, .5], [.5]],
  };
  const children = [0, 1].map(a => ({ ...parent, path: [parent.actions[a].token], player: 1 as const,
    committed: [a * 100, 0] as const, reach: [parent.reach[0].map((r, h) => r * parent.strategy[a][h]!), [1]] as const,
    ev: [[0, 0, 0], [a * 100]] as const, strategy: [[1], [0]], actionEv: [[a * 100], [0]],
  }));
  return { hands: [["AdKd", "2c2d", "3c3d"], ["AdQc"]], parent, children };
}

test("blocker-conditioned rounding diagnosis isolates reach loss with independently known values", () => {
  const report = diagnoseExport(example()), row = report.hands[0];
  assert.equal(row.combo, "AdQc");
  assert.ok(Math.abs(row.raw.compatibleMass - .0001) < 1e-15);
  assert.ok(Math.abs(row.raw.responseValue! - 49) < 1e-12);
  assert.ok(row.raw.error! < 1e-12);
  assert.ok(Math.abs(row.omittedCompatibleMass - .000049) < 1e-15);
  assert.equal(row.reachOnly.responseValue, 0);
  assert.equal(row.saved.error, 49);
  assert.ok(row.strategyOnly.error! < 1e-12);
  assert.ok(row.evOnly.error! < 1e-12);
  assert.equal(report.savedFailures, 1);
});

test("unavailable child values and zero compatible reach are not reported as agreement", () => {
  const sample = example();
  const missing = { ...sample, children: sample.children.map(c => ({ ...c, ev: [c.ev[0], [null]] as const })) };
  const row = diagnoseExport(missing).hands[0];
  assert.equal(row.raw.responseValue, null); assert.equal(row.raw.error, null);
  assert.equal(row.saved.error, null);
  const blocked = { ...sample, parent: { ...sample.parent, reach: [[1, 0, 0], [1]] as const } };
  assert.equal(diagnoseExport(blocked).hands[0].raw.error, null);
});

test("value identity refuses missing, reordered or incompatible child nodes and malformed rows", () => {
  const s = example();
  assert.throws(() => diagnoseExport({ ...s, children: [] }));
  assert.throws(() => diagnoseExport({ ...s, children: [...s.children].reverse() }));
  assert.throws(() => diagnoseExport({ ...s, children: s.children.map(c => ({ ...c, committed: [0, 1] })) }));
  assert.throws(() => diagnoseExport({ ...s, parent: { ...s.parent, reach: [[NaN, 1, 1], [1]] } }));
  assert.throws(() => diagnoseExport({ ...s, parent: { ...s.parent, strategy: [[1], [0]] } }));
});

const observation = (): DiagnosticObservation => JSON.parse(readFileSync("tasks/artifacts/formation-export-diagnostic-v1/observation.json", "utf8"));
test("two frozen native exports reproduce all fourteen failures and isolate reach quantization", () => {
  const saved = observation(), report = auditExportObservation(saved);
  assert.equal(saved.runs[0].sampleHash, saved.runs[1].sampleHash);
  assert.equal(report.rawScreenFailures, 0); assert.equal(report.savedFailures, 14);
  assert.equal(report.summary.raw.checked, 179); assert.equal(report.summary.saved.unavailable, 22);
  assert.ok(report.summary.raw.maxError! < .001);
  assert.ok(report.summary.strategyOnly.maxError! < .001);
  assert.ok(report.summary.evOnly.maxError! < .1);
  assert.ok(Math.abs(report.summary.reachOnly.maxError! - 258.1978720703098) < 1e-9);
  assert.equal(report.summary.saved.maxError, 258.25);
  const hand = report.hands.find(r => r.combo === "Ad5d")!;
  assert.ok(Math.abs(hand.raw.compatibleMass - 7.15603716e-8) < 1e-18);
  assert.ok(Math.abs(hand.raw.actionProbabilities[0]! - .4187581108987629) < 1e-12);
  assert.deepEqual(hand.saved.actionProbabilities, [.5, 0, .5]);
  assert.equal(hand.saved.parentValue, 1847.3); assert.equal(hand.saved.responseValue, 1589.05);
});

test("diagnostic evidence rejects corruption, false resource charges and incomplete repeats", () => {
  const saved = observation(), corrupted = structuredClone(saved);
  corrupted.runs[0].sampleHash = "0".repeat(64);
  assert.throws(() => auditExportObservation(corrupted));
  const rehash = (v: DiagnosticObservation) => {
    const { payloadHash: _, ...payload } = v; void _;
    return { ...payload, payloadHash: hashJson(payload) };
  };
  assert.throws(() => auditExportObservation(rehash(corrupted)));
  assert.throws(() => auditExportObservation(rehash({ ...saved, chargedNativeMs: saved.chargedNativeMs - 1_800_000 })));
  assert.throws(() => auditExportObservation(rehash({ ...saved, runs: saved.runs.slice(0, 1) })));
  assert.throws(() => auditExportObservation(rehash({ ...saved, identity: { ...saved.identity, binaryHash: "0".repeat(64) } })));
  const malformed = structuredClone(saved); malformed.runs[0].elapsedMs = -1;
  assert.throws(() => auditExportObservation(rehash(malformed)));
});
