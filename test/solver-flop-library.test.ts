import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FLOP_PRESETS } from "../src/lib/solver/postflop/flop-library/fixtures";
import { flopLibraryKey, flopLibraryRecipe, flopLibrarySourcePaths, verifyFlopLibrarySource } from "../src/lib/solver/postflop/flop-library/source-node";
import { flopQueueCheckpointPaths, runFlopLibraryQueue } from "../scripts/flop-library-queue";
import { flopDigest } from "../src/lib/solver/postflop/flop/artifact-node";

test("all six cache identities bind frozen requests, versions, options and quality targets", () => {
  const locked = JSON.parse(readFileSync("tasks/saved-flop-library-input-hashes.json", "utf8"));
  const report = JSON.parse(readFileSync("src/lib/solver/postflop/flop-library/artifacts/queue.json", "utf8"));
  assert.equal(FLOP_PRESETS.length, 6); assert.equal(report.jobs.length, 6);
  for (const [i, preset] of FLOP_PRESETS.entries()) {
    const key = flopLibraryKey(preset), recipe = flopLibraryRecipe(preset);
    assert.equal(locked[preset.request.id], key); assert.equal(report.jobs[i].key, key); assert.equal(report.jobs[i].status, "accepted");
    assert.ok(report.jobs[i].exploitability <= recipe.maximumExploitability);
    for (const changed of [{ ...recipe, rulesVersion: 2 }, { ...recipe, options: { ...recipe.options, averagingDelay: 0 } },
      { ...recipe, maximumExploitability: 99 }, { ...recipe, request: { ...recipe.request, stackBehind: [1, 2] } }]) assert.notEqual(flopDigest(changed), key);
  }
});

test("cache reuse independently regrades a valid source and refuses corruption or changed identity", () => {
  const preset = FLOP_PRESETS[0], paths = flopLibrarySourcePaths(preset), manifest = JSON.parse(readFileSync(paths.manifest, "utf8")), bytes = readFileSync(paths.policy);
  const source = verifyFlopLibrarySource(preset, manifest, bytes); assert.equal(source.grade.exploitability, manifest.exploitability);
  assert.throws(() => verifyFlopLibrarySource(preset, { ...manifest, request: { ...manifest.request, betSizes: [1, 1, 1] } }, bytes), /identity/);
  assert.throws(() => verifyFlopLibrarySource(preset, { ...manifest, options: { ...manifest.options, averagingDelay: 0 } }, bytes), /identity/);
  assert.throws(() => verifyFlopLibrarySource(preset, { ...manifest, exploitability: 0 }, bytes));
  assert.throws(() => verifyFlopLibrarySource(preset, manifest, bytes.subarray(0, bytes.length - 8)));
  const corrupt = Buffer.from(bytes); corrupt[50] ^= 1; assert.throws(() => verifyFlopLibrarySource(preset, manifest, corrupt));
});

test("queue restart selects the last complete filename, never overwrites it, and requires explicit resume", () => {
  const root = mkdtempSync(join(tmpdir(), "poker-flop-queue-test-")), key = flopLibraryKey(FLOP_PRESETS[0]);
  const first = flopQueueCheckpointPaths(key, true, root); assert.equal(first.resumePath, undefined); assert.ok(first.checkpointPath.endsWith("checkpoint-1.gz"));
  writeFileSync(first.checkpointPath, "test checkpoint sentinel");
  writeFileSync(join(root, key, "checkpoint-9.gz.partial"), "interrupted temporary write");
  const second = flopQueueCheckpointPaths(key, true, root); assert.equal(second.resumePath, first.checkpointPath); assert.ok(second.checkpointPath.endsWith("checkpoint-2.gz"));
  assert.equal(readFileSync(first.checkpointPath, "utf8"), "test checkpoint sentinel");
  assert.equal(flopQueueCheckpointPaths(key, false, root).resumePath, undefined);
  assert.throws(() => flopQueueCheckpointPaths("../unsafe", true, root));
  // Checksum/version/iteration validation of the chosen complete file remains in the
  // existing M5 checkpoint decoder/runner; a filename is not evidence of valid content.
});

test("queue cancellation before a solve records failure and leaves later jobs pending", async () => {
  const original = process.cwd(), root = mkdtempSync(join(tmpdir(), "poker-flop-queue-cancel-"));
  mkdirSync(join(root, "tasks")); writeFileSync(join(root, "tasks/saved-flop-library-input-hashes.json"), readFileSync("tasks/saved-flop-library-input-hashes.json"));
  try {
    process.chdir(root); const controller = new AbortController(); controller.abort();
    await assert.rejects(runFlopLibraryQueue("generate", { signal: controller.signal }));
    const report = JSON.parse(readFileSync("src/lib/solver/postflop/flop-library/artifacts/queue.json", "utf8"));
    assert.equal(report.jobs[0].status, "failed"); assert.ok(report.jobs[0].reason);
    assert.deepEqual(report.jobs.slice(1).map((j: { status: string }) => j.status), Array(5).fill("pending"));
  } finally { process.chdir(original); }
});

test("queue refuses an incomplete cache pair instead of silently solving over it", async () => {
  const original = process.cwd(), root = mkdtempSync(join(tmpdir(), "poker-flop-queue-corrupt-"));
  const paths = flopLibrarySourcePaths(FLOP_PRESETS[0]), manifest = readFileSync(paths.manifest);
  mkdirSync(join(root, "tasks")); writeFileSync(join(root, "tasks/saved-flop-library-input-hashes.json"), readFileSync("tasks/saved-flop-library-input-hashes.json"));
  mkdirSync(dirname(join(root, paths.manifest)), { recursive: true }); writeFileSync(join(root, paths.manifest), manifest);
  try {
    process.chdir(root); await assert.rejects(runFlopLibraryQueue("generate", { resume: true }), /Incomplete source file pair/);
    assert.deepEqual(readFileSync(paths.manifest), manifest);
    const report = JSON.parse(readFileSync("src/lib/solver/postflop/flop-library/artifacts/queue.json", "utf8"));
    assert.equal(report.jobs[0].status, "failed"); assert.ok(report.jobs.slice(1).every((j: { status: string }) => j.status === "pending"));
  } finally { process.chdir(original); }
});
