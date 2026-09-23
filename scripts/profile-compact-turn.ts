import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { COMPACT_TURN_FIXTURES } from "../src/lib/solver/postflop/fixtures";
import { compileCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession } from "../src/lib/solver/postflop/session";
import { createTurnGame } from "../src/lib/solver/turn/game";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { compileCompactGame, solveCompiledCompactCfr } from "../src/lib/solver/river/compact/cfr";

const measure = <T>(fn: () => T) => { const started = performance.now(); const value = fn(); return { value, ms: performance.now() - started }; };
const hash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
const args = process.argv.slice(2), backends = ["readable", "repeated", "shared"];
if (args.length === 0) {
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, reportedPhysicalMemoryBytes: totalmem(), iterations: 256, samples: 5,
    note: "Each fixture/backend runs in its own process. RSS includes that process, imports, warmup, grading and serialization; typed bytes are not total RAM." }));
  for (let fixture = 0; fixture < 2; fixture++) {
    const results = backends.map(backend => JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
      fileURLToPath(import.meta.url), "--child", backend, String(fixture)], { encoding: "utf8", timeout: 60000 })));
    results.forEach(result => { assert.equal(result.policyHash, results[0].policyHash); console.log(JSON.stringify(result)); });
  }
} else {
  if (args.length !== 3 || args[0] !== "--child" || !backends.includes(args[1]) || !["0", "1"].includes(args[2])) {
    throw new Error("Usage: npm run profile:turn:compact");
  }
  const backend = args[1], request = COMPACT_TURN_FIXTURES[Number(args[2])];
  const rows: Record<string, number>[] = [];
  let last: Record<string, unknown> = {};
  for (let sample = -1; sample < 5; sample++) {
    const iterations = sample < 0 ? 16 : 256;
    const preparation = measure(() => createTurnGame(request));
    let policy, compiledBytes: number | null = null, workingBytes: number | null = null;
    const row: Record<string, number> = { preparationMs: preparation.ms };
    if (backend === "readable") {
      const solve = measure(() => solveCfr(preparation.value, { iterations }));
      policy = solve.value.averageStrategy; row.solveIncludingCompileMs = solve.ms;
    } else if (backend === "repeated") {
      const compiled = measure(() => compileCompactGame(preparation.value));
      const solve = measure(() => solveCompiledCompactCfr(compiled.value, { iterations }));
      policy = solve.value.averageStrategy; row.compileMs = compiled.ms; row.solveAndSnapshotMs = solve.ms;
      compiledBytes = compiled.value.storageBytes; workingBytes = solve.value.workingStorageBytes;
    } else {
      const compiled = measure(() => compileCompactTurn(request));
      const session = measure(() => createCompactTurnSession(compiled.value, { iterations }));
      const solve = measure(() => session.value.advance(iterations));
      const snapshot = measure(() => session.value.snapshot());
      policy = snapshot.value.averageStrategy;
      row.compileIncludingPreparationMs = compiled.ms; row.createSessionMs = session.ms;
      row.advanceMs = solve.ms; row.snapshotMs = snapshot.ms;
      compiledBytes = compiled.value.typedStorageBytes; workingBytes = snapshot.value.workingStorageBytes;
    }
    const grade = measure(() => gradeStrategy(preparation.value, policy));
    const serialized = measure(() => canonicalSolverJson(serializeBehavioralStrategy(policy)));
    row.gradeMs = grade.ms; row.serializationMs = serialized.ms;
    if (sample >= 0) rows.push(row);
    last = { request: request.id, requestHash: hash(request), backend, compiledTypedBytes: compiledBytes,
      solverWorkingTypedBytes: workingBytes, policyHash: createHash("sha256").update(serialized.value).digest("hex"),
      value: grade.value.value, exploitability: grade.value.exploitability, serializedBytes: Buffer.byteLength(serialized.value),
      processMaxRssKiB: process.resourceUsage().maxRSS };
  }
  console.log(JSON.stringify({ ...last, medianMs: Object.fromEntries(Object.keys(rows[0]).map(key =>
    [key, rows.map(row => row[key]).sort((a, b) => a - b)[2]])), samplesMs: rows }));
}
