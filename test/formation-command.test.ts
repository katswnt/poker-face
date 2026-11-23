import assert from "node:assert/strict";
import { test } from "node:test";
import { planFormationReplay, validateStagedLegacyManifest } from "../scripts/formation-reproduction-command";
import { hashJson, prettyJson } from "../src/lib/solver/preflop-v2/corpus";

test("existing reproduction evidence never silently starts another native solve", () => {
  assert.deepEqual(planFormationReplay(true), ["publish"]);
  assert.deepEqual(planFormationReplay(false), ["native", "publish"]);
});

test("only an exact, canonical unpublished legacy manifest may be archived", () => {
  const row = { id: "spot", dataHashes: { "/solver-data/bridge-formations-v1/example/root.json": "a".repeat(64) } };
  const payload = { format: "poker-face-formation-library", version: 1, formation: "example",
    generationRecordHash: "b".repeat(64), reproductionRecordHash: "c".repeat(64),
    verification: { revision: 2, observations: "fresh-reproduction" },
    spots: [{ id: "spot", root: { url: Object.keys(row.dataHashes)[0], sha256: "a".repeat(64) } }] };
  const text = prettyJson({ ...payload, payloadHash: hashJson(payload) });
  const expected = { formation: "example", generationHash: payload.generationRecordHash, reproductionHash: payload.reproductionRecordHash, rows: [row] };
  validateStagedLegacyManifest(text, expected);
  const changed = (x: object) => { const p = { ...payload, ...x }; return prettyJson({ ...p, payloadHash: hashJson(p) }); };
  for (const bad of [text + " ", text.replace('"payloadHash": "', '"payloadHash": "0'),
    changed({ publication: { revision: 3 } }), changed({ formation: "another" }),
    changed({ generationRecordHash: "d".repeat(64) }), changed({ reproductionRecordHash: "d".repeat(64) }),
    changed({ spots: [] }), changed({ spots: [{ id: "spot", root: { url: Object.keys(row.dataHashes)[0], sha256: "e".repeat(64) } }] }),
    changed({ verification: { revision: 1 } })]) assert.throws(() => validateStagedLegacyManifest(bad, expected));
});

test("the command refuses missing evidence and cancellation before any publication", async () => {
  const { runReproductionBoundary } = await import("../scripts/formation-reproduction-command");
  for (const outcome of [{ code: 1, signal: null }, { code: null, signal: "SIGTERM" }]) {
    let published = false, calls = 0;
    await assert.rejects(runReproductionBoundary({ hasReport: () => ++calls > 1 && outcome.signal !== null,
      runNative: async () => outcome, publish: async () => { published = true; } }));
    assert.equal(published, false);
  }
  let native = 0, published = 0;
  await runReproductionBoundary({ hasReport: () => true, runNative: async () => { native++; return { code: 0, signal: null }; },
    publish: async () => { published++; } });
  assert.equal(native, 0); assert.equal(published, 1);
  let report = false;
  await runReproductionBoundary({ hasReport: () => report, runNative: async () => { native++; report = true; return { code: 1, signal: null }; },
    publish: async () => { published++; } });
  assert.equal(native, 1); assert.equal(published, 2);
});
