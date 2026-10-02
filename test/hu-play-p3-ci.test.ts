import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P3 evidence, native prefix and actual Worker regressions stay in CI", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["audit:hu-play:p3"], "node --import tsx scripts/audit-hu-play-p3.ts --check");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(ci.includes("npm run audit:hu-play:p3"));
  for (const path of ["test/bridge-turn-subgame.test.ts", "test/hu-play-turn-worker.test.ts",
    "test/hu-play-turn-quality.test.ts", "test/hu-play-heads-up-source.test.ts"]) {
    assert.ok(ci.includes(path), `${path} must run with the real engine available`);
  }
});
