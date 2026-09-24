import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicFlopWrite } from "../src/lib/solver/postflop/flop/binary-node";
import { FLOP_WIDE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";

test("flop CLI documents its finite scope, preflights without solving, and refuses ambiguous arguments", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/solve-flop.ts", ...args], { encoding: "utf8", timeout: 15000 });
  const help = run("--help"); assert.equal(help.status, 0); assert.match(help.stdout, /not exact GTO/); assert.match(help.stdout, /0.25%/);
  const directory = mkdtempSync(join(tmpdir(), "poker-flop-cli-")), request = join(directory, "request.json");
  atomicFlopWrite(request, Buffer.from(JSON.stringify(FLOP_WIDE_REQUEST)));
  const preflight = run("--request", request, "--preflight"); assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(JSON.parse(preflight.stdout).compatibleDeals, 3755); assert.equal(preflight.stderr, "");
  for (const args of [["--unknown"], ["--request", request, "--request", request], ["--request", request, "--preflight", "--output", "unused"], ["--request", request]]) {
    assert.equal(run(...args).status, 1);
  }
  const prefix = join(directory, "existing"); atomicFlopWrite(`${prefix}.json`, Buffer.from("keep me"));
  assert.match(run("--request", request, "--output", prefix).stderr, /Output exists/);
});
