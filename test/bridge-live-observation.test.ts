import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { LiveEngine, LiveSession } from "../src/lib/solver/bridge/live/model";

test("Worker export observations measure original UTF-8 bytes and elapsed time without changing output", async () => {
  assert.ok(existsSync("scripts/bridge-live-observation.ts"), "Actual export observation is required");
  const { observeLiveExports } = await import("../scripts/bridge-live-observation");
  let now = 100, freed = false, fail = false;
  const session = { finish() { assert.equal(this, session); now += 7.25; if (fail) throw new Error("refused"); return '{"value":"é"}'; },
    free() { freed = true; } } as unknown as LiveSession;
  const engine: LiveEngine = { create: () => session, memoryBytes: () => 65536,
    provenance: { buildHash: "a", sourceHash: "b", engineCommit: "c", sourceUrl: "/source", licenseUrl: "/license" } };
  const observed = observeLiveExports(engine, () => now);
  assert.equal(observed.read(), null);
  const wrapped = observed.engine.create(new Uint8Array());
  assert.equal(wrapped, session); assert.equal(wrapped.finish(), '{"value":"é"}');
  assert.deepEqual(observed.read(), { jsonBytes: 14, elapsedMs: 7.25 });
  wrapped.free(); assert.equal(freed, true); assert.equal(observed.engine.memoryBytes(), 65536);
  fail = true; assert.throws(() => wrapped.finish(), /refused/); assert.equal(observed.read(), null);
});
