import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fixtures, gradeTiny, imperfectRecallFixture } from "../src/lib/solver/multiway/robopoker-v2/fixtures";
import { assess, type Observation } from "../src/lib/solver/multiway/robopoker-v2/audit";
import { auditR0V2 } from "../scripts/audit-robopoker-r0-v2";

const binary = "native/robopoker-referee-v2/target/release/robopoker-referee-v2";
test("R0 v2 saved evidence preserves sources and stops at the first failed gate", () => {
  const result = auditR0V2();
  assert.equal(result.turnRiverAttempted, false);
  assert.ok(result.attempts.length > 0);
});
test("R0 v2 exhaustive witnesses require one legal response across hidden states", () => {
  for (const f of fixtures().filter(f => f.id !== "three-player-river-v1")) {
    const profile = f.profile ?? f.informationSets.map(i => i.actions.map(() => 1 / i.actions.length));
    const recursive = gradeTiny(f, profile);
    const exhaustive = gradeTiny(f, profile, true);
    assert.deepEqual(recursive.value, exhaustive.value);
    assert.deepEqual(recursive.bestResponses.map(r => r.value), exhaustive.bestResponses.map(r => r.value));
    if (f.id.includes("weighted-hidden")) assert.equal(exhaustive.bestResponses[0].value, 17.5);
    if (f.id.includes("zero-opponent")) assert.equal(exhaustive.bestResponses[0].value, 2);
  }
});
test("R0 v2 audit rejects wrong identity, partial profiles, false scores and hidden normalization", () => {
  const f = fixtures()[0];
  const o: Observation = { version: 2, id: f.id, fixtureHash: f.fixtureHash,
    upstreamCommit: "72360adc7fbc6afa4119be3aefcc0e990d3789a7", crateVersion: "1.2.0-poker-face.1",
    mode: "uniform", epochs: 0, treeSeed: 20261122, workers: 1, fullNodeCount: 5,
    rawProfile: [[0.5, 0.5], [0.5, 0.5]], profile: [[0.5, 0.5], [0.5, 0.5]],
    values: [0.5, -0.25, -0.25], bestResponses: [10, -0.25, -0.25], score: 9.5 / 3,
    rawValues: [0.5, -0.25, -0.25], rawBestResponses: [10, -0.25, -0.25], rawScore: 9.5 / 3,
    elapsedMs: 1, peakRssBytes: 1024 };
  assert.equal(assess(f, o, "uniform").passed, true);
  assert.equal(assess(f, { ...o, bestResponses: [1, -0.25, -0.25] }, "uniform").passed, false);
  assert.throws(() => assess(f, { ...o, crateVersion: "1.2.0" }, "uniform"), /identity/);
  assert.throws(() => assess(f, { ...o, fullNodeCount: 4 }, "uniform"), /tree/);
  assert.throws(() => assess(f, { ...o, profile: [] }, "uniform"), /profile/);
  assert.throws(() => assess(f, { ...o, rawProfile: [[0.25, 0.25], [0.5, 0.5]] }, "uniform"), /uniform/);
  assert.throws(() => assess(f, { ...o, score: NaN }, "uniform"), /finite/);
  assert.equal(assess(f, { ...o, elapsedMs: 60_000 }, "uniform").passed, false);
});
test("R0 v2 native full-tree scorer passes exhaustive fixtures and refuses imperfect recall", { skip: !existsSync(binary) }, () => {
  for (const f of fixtures().filter(f => f.id !== "three-player-river-v1")) {
    const mode = f.profile ? "profile" : "uniform";
    const result = spawnSync(binary, [mode], { input: JSON.stringify(f), encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(assess(f, JSON.parse(result.stdout), mode).passed, true);
  }
  const result = spawnSync(binary, ["uniform"], { input: JSON.stringify(imperfectRecallFixture()), encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imperfect recall/);
});
