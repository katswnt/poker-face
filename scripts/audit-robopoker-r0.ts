/** A passing evidence audit reproduces the R0 rejection; it does not accept this engine. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform, arch } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessObservation, type NativeObservation } from "../src/lib/solver/multiway/robopoker/audit";
import { compileRiverFixture, digest, sequentialWitness } from "../src/lib/solver/multiway/robopoker/contract";

const evidencePath = "src/lib/solver/multiway/robopoker/observations.json";
const sources = [
  "native/robopoker-referee/Cargo.toml", "native/robopoker-referee/Cargo.lock",
  "native/robopoker-referee/src/main.rs", "native/robopoker-referee/THIRD_PARTY_NOTICES",
  "src/lib/solver/multiway/robopoker/contract.ts", "src/lib/solver/multiway/robopoker/audit.ts",
  "src/lib/solver/multiway/fixture.ts", "src/lib/solver/multiway/river-game.ts",
  "src/lib/solver/multiway/game.ts", "src/lib/solver/multiway/best-response.ts",
  "scripts/audit-robopoker-r0.ts",
];
function sourceHashes() {
  return Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
}
function numerical(observation: NativeObservation) {
  const { elapsedMs, peakRssBytes, ...rest } = observation;
  assert.ok(elapsedMs > 0 && peakRssBytes > 0);
  return rest;
}
function fresh() {
  const fixtures = [compileRiverFixture(), sequentialWitness().fixture];
  return fixtures.map(fixture => {
    const repeats = [0, 1].map(() => {
      const result = spawnSync("native/robopoker-referee/target/release/robopoker-referee", {
        input: JSON.stringify(fixture), encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, RAYON_NUM_THREADS: "1" },
      });
      if (result.error || result.status !== 0) throw new Error(`R0 process failed: ${result.error ?? result.stderr}`);
      const observation = JSON.parse(result.stdout) as NativeObservation;
      return { observation, assessment: assessObservation(fixture, observation) };
    });
    assert.deepEqual(numerical(repeats[0].observation), numerical(repeats[1].observation), "R0 deterministic full-tree replay");
    return { id: fixture.id, compiledInputHash: digest(fixture), repeats };
  });
}
interface EvidencePayload {
  version: 1; status: "blocked-upstream-best-response-prerequisite";
  observedAt: string; platform: string; arch: string; sources: Record<string, string>;
  attempts: ReturnType<typeof fresh>; trainingAttempted: false; turnRiverAttempted: false;
}
export function auditR0Evidence() {
  const record = JSON.parse(readFileSync(evidencePath, "utf8")) as EvidencePayload & { payloadHash: string };
  const { payloadHash, ...payload } = record;
  assert.equal(digest(payload), payloadHash, "R0 evidence hash");
  assert.deepEqual(record.sources, sourceHashes(), "R0 source identity");
  assert.equal(record.status, "blocked-upstream-best-response-prerequisite");
  assert.equal(record.trainingAttempted, false);
  assert.equal(record.turnRiverAttempted, false);
  const fixtures = [compileRiverFixture(), sequentialWitness().fixture];
  assert.equal(record.attempts.length, fixtures.length);
  record.attempts.forEach((attempt, i) => {
    assert.equal(attempt.id, fixtures[i].id);
    assert.equal(attempt.compiledInputHash, digest(fixtures[i]));
    assert.equal(attempt.repeats.length, 2);
    for (const repeat of attempt.repeats) {
      const checked = assessObservation(fixtures[i], repeat.observation);
      assert.deepEqual(repeat.assessment, checked);
      assert.equal(checked.passed, false, "Do not silently promote a failed prerequisite");
      assert.equal(checked.fullTreeAgreementPassed, false);
      assert.equal(checked.runtimePassed, true); assert.equal(checked.memoryPassed, true);
    }
    assert.deepEqual(numerical(attempt.repeats[0].observation), numerical(attempt.repeats[1].observation));
  });
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--observe") {
    const payload: EvidencePayload = {
      version: 1, status: "blocked-upstream-best-response-prerequisite", observedAt: new Date().toISOString(),
      platform: platform(), arch: arch(), sources: sourceHashes(), attempts: fresh(),
      trainingAttempted: false, turnRiverAttempted: false,
    };
    for (const attempt of payload.attempts) for (const repeat of attempt.repeats) assert.equal(repeat.assessment.passed, false);
    writeFileSync(evidencePath, JSON.stringify({ ...payload, payloadHash: digest(payload) }, null, 2) + "\n", { flag: "wx" });
  } else if (mode !== "--check" && mode !== "--reproduce") throw new Error("Use --observe, --check or --reproduce");
  const saved = auditR0Evidence();
  if (mode === "--reproduce") {
    const actual = fresh();
    actual.forEach((attempt, i) => attempt.repeats.forEach(repeat => {
      assert.deepEqual(numerical(repeat.observation), numerical(saved.attempts[i].repeats[0].observation));
      assert.equal(repeat.assessment.passed, false);
      assert.equal(repeat.assessment.runtimePassed, true); assert.equal(repeat.assessment.memoryPassed, true);
    }));
    console.log(JSON.stringify({ fresh: actual.map(attempt => ({ id: attempt.id,
      measurements: attempt.repeats.map(({ observation: o }) => ({ elapsedMs: o.elapsedMs, peakRssBytes: o.peakRssBytes })) })) }));
  }
  console.log(JSON.stringify({ status: saved.status, payloadHash: saved.payloadHash,
    cases: saved.attempts.map(attempt => ({ id: attempt.id, ...attempt.repeats[0].assessment })) }, null, 2));
}
