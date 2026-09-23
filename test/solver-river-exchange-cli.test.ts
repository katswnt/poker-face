import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../src/lib/solver/river/exchange/artifacts/benchmarks-v1.json";
import { RIVER_EXCHANGE_MAX_FILE_BYTES } from "../src/lib/solver/river/exchange/types";

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/river-exchange.ts", ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  return result;
}

test("CLI exports a complete game, solves a policy, and independently grades it across processes", t => {
  const directory = mkdtempSync(join(tmpdir(), "poker-river-exchange-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const gamePath = join(directory, "game.json");
  const policyPath = join(directory, "policy.json");
  const reportPath = join(directory, "report.json");
  for (const args of [
    ["export", "weighted-blockers", "--out", gamePath],
    ["solve", "weighted-blockers", "--out", policyPath],
    ["grade", "weighted-blockers", "--strategy", policyPath, "--out", reportPath],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
  const game = JSON.parse(readFileSync(gamePath, "utf8"));
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(game.gameFingerprint, policy.gameFingerprint);
  assert.equal(report.gameFingerprint, game.gameFingerprint);
  assert.equal(game.counts.compatibleDeals, 8);
  assert.deepEqual(report, manifest.benchmarks.find(item => item.id === "weighted-blockers")!.report);
  const stdout = cli("grade", "weighted-blockers", "--strategy", policyPath);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.deepEqual(JSON.parse(stdout.stdout), report);
  const wrongGame = cli("grade", "board-ties", "--strategy", policyPath);
  assert.equal(wrongGame.status, 1);
  assert.equal(wrongGame.stdout, "");
  assert.match(wrongGame.stderr, /fingerprint/);
});

test("CLI list/export/solve output is JSON, deterministic, and matches the declared options", () => {
  const list = cli("list");
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).map((entry: { id: string }) => entry.id), manifest.benchmarks.map(item => item.id));
  const exported = cli("export", "short-all-in");
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(exported.stdout, cli("export", "short-all-in").stdout);
  const policy = cli("solve", "board-ties", "--iterations", "21");
  assert.equal(policy.status, 0, policy.stderr);
  assert.equal(JSON.parse(policy.stdout).format, "poker-face-river-policy");
  assert.equal(policy.stdout, cli("solve", "board-ties", "--iterations", "21").stdout);
  const help = cli("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not universal or exact GTO/);
});

test("CLI rejects unknown, duplicate, incomplete, and out-of-bounds arguments", () => {
  for (const args of [
    ["unknown"], ["list", "extra"], ["export"], ["export", "missing-game"],
    ["grade", "weighted-blockers"], ["solve", "weighted-blockers", "--iterations"],
    ["solve", "weighted-blockers", "--iterations", "20"],
    ["solve", "weighted-blockers", "--iterations", "20001"],
    ["solve", "weighted-blockers", "--iterations", "NaN"],
    ["solve", "weighted-blockers", "--iterations", "21.5"],
    ["solve", "weighted-blockers", "--iterations", "21", "--iterations", "22"],
    ["export", "weighted-blockers", "--strategy", "policy.json"],
    ["solve", "weighted-blockers", "--surprise", "yes"],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^River exchange:/);
  }
});

test("CLI refuses existing output files, including the policy it is grading", t => {
  const directory = mkdtempSync(join(tmpdir(), "poker-river-exchange-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "owned-file.json");
  writeFileSync(path, "keep this user content");
  const result = cli("export", "weighted-blockers", "--out", path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(readFileSync(path, "utf8"), "keep this user content");
  const policyPath = join(directory, "policy.json");
  assert.equal(cli("solve", "board-ties", "--out", policyPath).status, 0);
  const policy = readFileSync(policyPath, "utf8");
  assert.equal(cli("grade", "board-ties", "--strategy", policyPath, "--out", policyPath).status, 1);
  assert.equal(readFileSync(policyPath, "utf8"), policy);
});

test("CLI rejects malformed, oversized, missing, and non-regular inputs without a grade", t => {
  const directory = mkdtempSync(join(tmpdir(), "poker-river-exchange-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const malformed = join(directory, "malformed.json");
  const tooLarge = join(directory, "oversized.json");
  writeFileSync(malformed, '{"strategy":');
  writeFileSync(tooLarge, Buffer.alloc(RIVER_EXCHANGE_MAX_FILE_BYTES + 1, " "));
  const inputs = [malformed, tooLarge, directory, join(directory, "missing.json")];
  if (process.platform !== "win32") {
    const fifo = join(directory, "not-a-json-file");
    execFileSync("mkfifo", [fifo]);
    inputs.push(fifo);
  }
  for (const input of inputs) {
    const result = cli("grade", "weighted-blockers", "--strategy", input);
    assert.equal(result.status, 1, input);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^River exchange:/);
  }
});
