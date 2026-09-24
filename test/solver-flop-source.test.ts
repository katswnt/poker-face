import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { flopDigest } from "../src/lib/solver/postflop/flop/artifact-node";
import { readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";
import { verifyFlopSource } from "../src/lib/solver/postflop/flop/verify-node";

test("the complete wider flop source is rebound to its game, decoded and independently regraded", () => {
  const base = "src/lib/solver/postflop/flop/artifacts/flop-vector-wide-64", artifact = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  const bytes = readFlopBinary(`${base}.policy.f64.gz`), result = verifyFlopSource(artifact, bytes);
  assert.equal(result.iterations, 256); assert.equal(result.grade.exploitability, 0.024089327546898076);
  assert.equal(result.game.informationSets, 5017600);
  assert.throws(() => verifyFlopSource({ ...artifact, payloadHash: "bad" }, bytes), /payload hash/);
  const counts = { ...artifact, counts: { ...artifact.counts, compatibleDeals: 1 } };
  const { payloadHash: ignored, ...payload } = counts; void ignored;
  assert.throws(() => verifyFlopSource({ ...payload, payloadHash: flopDigest(payload) }, bytes), /counts/);
});
