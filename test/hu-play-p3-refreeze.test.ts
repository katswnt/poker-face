import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("P3 source successor preserves every frozen case, order and baseline; numerical changes cannot be relabelled", async () => {
  assert.ok(existsSync("scripts/refreeze-hu-play-p3.ts"), "Explicit input/source successor required");
  const { sourceSuccessor } = await import("../scripts/refreeze-hu-play-p3");
  const cases = Array.from({ length: 200 }, (_, seed) => ({ seed, actual: { type: "bet", to: seed + 1 } }));
  const before = { format: "poker-face-p3-turn-inputs", version: 1, cases,
    baselineNumericalHashes: ["unchanged"], selectionSources: [{ path: "old.ts", sha256: "a" }] };
  const successor = sourceSuccessor(before, structuredClone(cases), [{ path: "new.ts", sha256: "b" }]);
  assert.equal(successor.version, 2); assert.deepEqual(successor.cases, cases);
  assert.deepEqual(successor.baselineNumericalHashes, before.baselineNumericalHashes);
  assert.deepEqual(successor.derivedFrom.selectionSources, before.selectionSources);
  assert.match(successor.derivedFrom.inputsHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(before.selectionSources, [{ path: "old.ts", sha256: "a" }]);
  assert.throws(() => sourceSuccessor(before, cases.slice(1), []), /unchanged|200/i);
  assert.throws(() => sourceSuccessor(before, [...cases].reverse(), []), /unchanged/i);
  assert.throws(() => sourceSuccessor(before, cases.map((c, i) => i ? c : { ...c, actual: { type: "bet", to: 100 } }), []), /unchanged/i);
});
