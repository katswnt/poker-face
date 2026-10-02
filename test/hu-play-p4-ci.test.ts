import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P4 production translation and its source-bound evidence remain mandatory in CI", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["audit:hu-play:p4"], "node --import tsx scripts/audit-hu-play-p4.ts --check");
  assert.equal(pkg.scripts["reproduce:hu-play:p4"], "node --import tsx scripts/reproduce-hu-play-p4.ts");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(ci.includes("npm run audit:hu-play:p4"));
  for (const path of ["test/hu-play-flop-source.test.ts", "test/hu-play-translated-heads-up.test.ts", "test/hu-play-p4-reproduction.test.ts"]) {
    assert.ok(ci.includes(path), `${path} must also run with real engine assets available`);
  }
});
