import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { buildGameTreeIndex } from "../src/lib/solver/toy/game";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import { compileCompactGame, solveCompiledCompactCfr } from "../src/lib/solver/river/compact/cfr";
import { createTurnGame } from "../src/lib/solver/turn/game";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { parseConfigurableRiverRange } from "../src/lib/solver/river/configurable/range";
import { riverCombosOverlap } from "../src/lib/solver/river/cards";

const iterations = 256;
if (process.argv.length !== 2) throw new Error("Usage: npm run profile:turn:baseline");
const samples = 5;
const measure = <T>(fn: () => T) => { const started = performance.now(); const value = fn(); return { value, ms: performance.now() - started }; };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
console.log(JSON.stringify({ runtime: process.version, arch: process.arch, platform: process.platform,
  cpu: cpus()[0]?.model ?? "unavailable", reportedPhysicalMemoryBytes: totalmem(), iterations, samples,
  note: "RSS is this entire sequential process high-water mark, not per-fixture allocated bytes." }));
for (const request of COMPACT_TURN_FIXTURES.slice(0, 2)) {
  const game = createTurnGame(request);
  solveCfr(game, { iterations: 16 });
  const rows: Record<string, number>[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const prepared = measure(() => createTurnGame(request));
    const index = measure(() => buildGameTreeIndex(prepared.value));
    const readable = measure(() => solveCfr(prepared.value, { iterations }));
    const compiled = measure(() => compileCompactGame(prepared.value));
    const compact = measure(() => solveCompiledCompactCfr(compiled.value, { iterations }));
    const grade = measure(() => gradeStrategy(prepared.value, readable.value.averageStrategy));
    const serialized = measure(() => canonicalSolverJson(serializeBehavioralStrategy(readable.value.averageStrategy)));
    rows.push({ prepareMs: prepared.ms, indexMs: index.ms, readableSolveIncludingCompileMs: readable.ms,
      repeatedCompileMs: compiled.ms, repeatedSolveAndSnapshotMs: compact.ms,
      gradeMs: grade.ms, serializationMs: serialized.ms });
    if (sample === samples - 1) console.log(JSON.stringify({ request: request.id, requestHash: hash(request),
      counts: prepared.value.preflight, informationSets: index.value.informationSets.length,
      repeatedTypedBytes: compiled.value.storageBytes, repeatedWorkspaceBytes: compact.value.workingStorageBytes,
      value: grade.value.value, exploitability: grade.value.exploitability,
      policyHash: hash(serializeBehavioralStrategy(readable.value.averageStrategy)),
      serializedBytes: Buffer.byteLength(serialized.value), processMaxRssKiB: process.resourceUsage().maxRSS }));
  }
  console.log(JSON.stringify({ request: request.id, medianMs: Object.fromEntries(Object.keys(rows[0]).map(key =>
    [key, median(rows.map(row => row[key as keyof typeof row]))])), samplesMs: rows }));
}
const ranges = POSTFLOP_M2_PROBE.rangeText.map(text => parseConfigurableRiverRange(text, POSTFLOP_M2_PROBE.board).entries);
const compatible = ranges[0].reduce((sum, a) => sum + ranges[1].filter(b => !riverCombosOverlap(a.cards, b.cards)).length, 0);
if (ranges.some(range => range.length !== 64) || compatible < 2_000) throw new Error("M2 probe did not meet its locked structural target");
console.log(JSON.stringify({ futureM2Probe: POSTFLOP_M2_PROBE, requestHash: hash(POSTFLOP_M2_PROBE), compatibleDeals: compatible,
  status: "Not solved; outside unchanged M1 admission limits." }));
