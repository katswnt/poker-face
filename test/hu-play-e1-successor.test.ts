import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";

test("E1 migration preserves archived source bytes and every non-build frozen input", async () => {
  assert.ok(existsSync("scripts/hu-play-e1-successor.ts"), "E1 needs an explicit parent and frozen-input checker");
  const { checkE1ParentSources, checkE1InputSuccessor } = await import("../scripts/hu-play-e1-successor");
  const text = "original measured source\n";
  const ref = { path: "src/example.ts", sha256: createHash("sha256").update(text).digest("hex") };
  const archive = [{ ...ref, text }];
  checkE1ParentSources(archive, [ref]);
  assert.throws(() => checkE1ParentSources([], [ref]), /source/i);
  assert.throws(() => checkE1ParentSources([{ ...ref, text: text + "changed" }], [ref]), /hash/i);
  assert.throws(() => checkE1ParentSources([...archive, ...archive], [ref]), /source/i);
  const old = { format: "frozen-games", version: 2, engineSourceHash: "a".repeat(64), wasmBuildHash: "b".repeat(64),
    nativeBinarySha256: "c".repeat(64), selectionSources: [ref], cases: [{ seed: 0, pot: 200, ranges: [[1, .01]] }],
    rootsSha256: "d".repeat(64), baselineNumericalHashes: ["e".repeat(64)], derivedFrom: { inputsHash: "f".repeat(64) } };
  const fresh = { ...old, version: 3, engineSourceHash: "1".repeat(64), wasmBuildHash: "2".repeat(64),
    nativeBinarySha256: "3".repeat(64), selectionSources: [{ ...ref, sha256: "4".repeat(64) }] };
  checkE1InputSuccessor(fresh, old);
  for (const field of ["cases", "rootsSha256", "baselineNumericalHashes", "derivedFrom", "format"] as const) {
    assert.throws(() => checkE1InputSuccessor({ ...fresh, [field]: "changed" }, old), /frozen/i);
  }
  assert.throws(() => checkE1InputSuccessor({ ...fresh, unknown: true }, old), /frozen/i);
  assert.throws(() => checkE1InputSuccessor({ ...fresh, selectionSources: [] }, old), /source/i);
  assert.throws(() => checkE1InputSuccessor({ ...fresh, engineSourceHash: "invalid" }, old), /hash/i);
});

test("E1 evidence source closure includes the preparation and capture tools", async () => {
  const { p1PipelineSources } = await import("../scripts/hu-play-p1-successor");
  const paths = p1PipelineSources().map(s => s.path);
  for (const path of ["scripts/prepare-hu-play-e1-inputs.ts", "scripts/capture-hu-play-e1.ts"]) {
    assert.ok(paths.includes(path), `Evidence generator must be hash-bound: ${path}`);
  }
});

test("E1 keeps independent readers for every pre-E1 evidence generation", async () => {
  const p1 = await import("../scripts/hu-play-p1-successor");
  const p2 = await import("../scripts/audit-hu-play-p2");
  const p3 = await import("../scripts/audit-hu-play-p3");
  const p4 = await import("../scripts/audit-hu-play-p4");
  const p5 = await import("../scripts/audit-hu-play-p5");
  assert.equal(typeof p1.readPreE1P1Successor, "function", "P1 parent must remain readable");
  assert.equal(typeof p2.readPreE1P2Evidence, "function", "P2 parent must remain readable");
  assert.equal(typeof p3.readPreE1P3Evidence, "function", "P3 parent must remain readable");
  assert.equal(typeof p4.readPreE1P4Evidence, "function", "P4 parent must remain readable");
  assert.equal(typeof p5.readPreE1P5Evidence, "function", "P5 parent must remain readable");
  assert.equal(p1.readPreE1P1Successor().version, 2);
  assert.equal(p2.readPreE1P2Evidence().version, 2);
  assert.equal(p3.readPreE1P3Evidence().version, 1);
  assert.equal(p4.readPreE1P4Evidence().version, 1);
  assert.equal(p5.readPreE1P5Evidence().version, 1);
});

test("E1 playing successors reject changed attempts, policies, full references and hand logs", async () => {
  const tools = await import("../scripts/hu-play-e1-successor");
  assert.equal(typeof tools.checkE1PlayingIdentity, "function", "Full frozen playing identity checker required");
  const { readPreE1P3Evidence } = await import("../scripts/audit-hu-play-p3");
  const parent = readPreE1P3Evidence();
  tools.checkE1PlayingIdentity(parent, parent);
  const caseChanged = structuredClone(parent);
  caseChanged.cases[0].attempts[0].accepted = !caseChanged.cases[0].attempts[0].accepted;
  assert.throws(() => tools.checkE1PlayingIdentity(caseChanged, parent), /attempt/i);
  const policyChanged = structuredClone(parent);
  const result = policyChanged.cases[0].attempts[0].result!;
  Object.assign(result.root.ev[0], { 0: result.root.ev[0][0] + 1 });
  assert.throws(() => tools.checkE1PlayingIdentity(policyChanged, parent), /attempt/i);
  const completeChanged = { ...parent, complete: parent.complete.slice(1) };
  assert.throws(() => tools.checkE1PlayingIdentity(completeChanged, parent), /complete/i);
  const logChanged = structuredClone(parent); logChanged.native.rows[0].logHash = "0".repeat(64);
  assert.throws(() => tools.checkE1PlayingIdentity(logChanged, parent), /log/i);
  const ledgerChanged = structuredClone(parent); ledgerChanged.hands.rows[0].ledger.finalStacks[0] += 1;
  assert.throws(() => tools.checkE1PlayingIdentity(ledgerChanged, parent), /hand/i);
});

test("E1 UI successor compares teaching separately while preserving all poker behavior", async () => {
  const tools = await import("../scripts/hu-play-e1-successor");
  assert.equal(typeof tools.checkE1UiIdentity, "function", "UI behavior/teaching identity checker required");
  const { readPreE1P5Evidence } = await import("../scripts/audit-hu-play-p5");
  const parent = readPreE1P5Evidence();
  assert.throws(() => tools.checkE1UiIdentity(parent, parent), /teaching|values/i,
    "Old results alone cannot prove the requested enabled capability");
  const changed = structuredClone(parent); Object.assign(changed.report.ledger[0], { humanNet: changed.report.ledger[0].humanNet + 1 });
  assert.throws(() => tools.checkE1UiIdentity(changed, parent), /ledger/i);
  const changedLog = structuredClone(parent); changedLog.report.rows[0].logHash = "0".repeat(64);
  assert.throws(() => tools.checkE1UiIdentity(changedLog, parent), /log|behavior/i);
});
