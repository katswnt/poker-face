import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { COMPACT_TURN_FIXTURES, POSTFLOP_M2_PROBE } from "../src/lib/solver/postflop/fixtures";
import { compileVectorTurn, preflightVectorTurn } from "../src/lib/solver/postflop/vector/game";
import { createVectorTurnSession } from "../src/lib/solver/postflop/vector/session";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "../src/lib/solver/postflop/vector/kernels";
import { vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { compileCompactTurn } from "../src/lib/solver/postflop/compact-turn";
import { createCompactTurnSession } from "../src/lib/solver/postflop/session";
import { createTurnGame, type TurnAction, type TurnRequest } from "../src/lib/solver/turn/game";
import { RIVER_DECK, canonicalRiverCombo } from "../src/lib/solver/river/cards";
import { solveCfr } from "../src/lib/solver/toy/cfr";
import { gradeStrategy } from "../src/lib/solver/toy/best-response";
import type { BehavioralStrategy } from "../src/lib/solver/toy/game";
import { canonicalSolverJson, serializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";

const measure = <T>(fn: () => T) => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };
const args = process.argv.slice(2), iterations = 128;
if (args.length === 0) {
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    reportedPhysicalMemoryBytes: totalmem(), iterations, algorithm: "vanilla", samples: 5,
    note: "Each size/backend has its own process; timings are five samples after warmup. RSS includes imports and discarded samples; typed bytes exclude objects/strings/runtime. No time-to-quality claim from this fixed-iteration profile." }));
  for (const size of [8, 16, 32, 64]) console.log(execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--wide", String(size)], { encoding: "utf8", timeout: 60000 }).trim());
  for (const backend of ["readable", "shared", "vector"]) console.log(execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--tiny", backend], { encoding: "utf8", timeout: 60000 }).trim());
  const deck = RIVER_DECK.filter(card => !POSTFLOP_M2_PROBE.board.includes(card)), combos: string[] = [];
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) combos.push(canonicalRiverCombo([deck[i], deck[j]]).join(""));
  for (const size of [128, 256]) {
    const request = { ...POSTFLOP_M2_PROBE, rangeText: [combos.slice(0, size).join(" "), combos.slice(size, 2 * size).join(" ")] as const };
    assert.throws(() => preflightVectorTurn(request), /64/);
    console.log(JSON.stringify({ combinationsPerPlayer: size, admitted: false, reason: "M2 cap is 64; no larger-range performance measured" }));
  }
} else {
  if (args.length !== 2 || !(args[0] === "--wide" && ["8", "16", "32", "64"].includes(args[1])
    || args[0] === "--tiny" && ["readable", "shared", "vector"].includes(args[1]))) throw new Error("Usage: npm run profile:turn:vector");
  const wide = args[0] === "--wide", backend = wide ? "vector" : args[1];
  const request: TurnRequest = wide ? { ...POSTFLOP_M2_PROBE, id: `postflop-m2-prefix-${args[1]}`,
    rangeText: POSTFLOP_M2_PROBE.rangeText.map(text => text.split(" ").slice(0, Number(args[1])).join(" ")) as [string, string] } : COMPACT_TURN_FIXTURES[1];
  const rows: Record<string, number>[] = [];
  let last: Record<string, unknown> = {};
  for (let sample = -1; sample < 5; sample++) {
    const n = sample < 0 ? 16 : iterations, row: Record<string, number> = {};
    let policy: BehavioralStrategy<TurnAction>;
    let grade: Pick<ReturnType<typeof gradeVectorTurn>, "value" | "exploitability">;
    let compiledTypedBytes: number | null = null, workingTypedBytes: number | null = null;
    if (backend === "vector") {
      const compiled = measure(() => compileVectorTurn(request)), game = compiled.value;
      const session = createVectorTurnSession(game, { iterations: n });
      row.compileMs = compiled.ms; row.iterationMs = measure(() => session.advance(n)).ms / n;
      const snapshot = measure(() => session.snapshot()); row.snapshotMs = snapshot.ms; policy = snapshot.value.averageStrategy;
      compiledTypedBytes = game.typedStorageBytes; workingTypedBytes = snapshot.value.workingStorageBytes;
      const measuredGrade = measure(() => gradeVectorTurn(game, policy)); row.gradeMs = measuredGrade.ms; grade = measuredGrade.value;
      last = { ...last, preflight: game.preflight, gradeWorkingTypedBytes: measuredGrade.value.workingStorageBytes,
        fallbackQueries: snapshot.value.kernelObservationsSinceStart };
      if (wide) {
        const naive = measure(() => gradeVectorTurn(game, policy, "naive")); row.naiveGradeMs = naive.ms;
        assert.ok(Math.abs(grade.exploitability - naive.value.exploitability) < 2e-8);
        const own = game.ranges.players[0], other = game.ranges.players[1], scratch = createVectorKernelScratch(other.hands.length);
        const out = new Float64Array(own.hands.length), weights = Float64Array.from(other.weights, (w, i) => w * (1 + i % 7) / 7);
        for (const kernel of ["vector", "naive"] as const) {
          const timing = measure(() => {
            for (let repeat = 0; repeat < 10; repeat++) for (let river = 0; river < 48; river++) {
              if (kernel === "vector") vectorTerminalValues(game.ranges, 0, river, weights, 200, 0, out, scratch);
              else naiveTerminalValues(game.ranges, 0, river, weights, 200, 0, out);
            }
          });
          row[`${kernel}ShowdownKernelMs`] = timing.ms / 480;
        }
      }
    } else if (backend === "shared") {
      const compiled = measure(() => compileCompactTurn(request)), session = createCompactTurnSession(compiled.value, { iterations: n });
      row.compileMs = compiled.ms; row.iterationMs = measure(() => session.advance(n)).ms / n;
      const snapshot = measure(() => session.snapshot()); row.snapshotMs = snapshot.ms; policy = snapshot.value.averageStrategy;
      compiledTypedBytes = compiled.value.typedStorageBytes; workingTypedBytes = snapshot.value.workingStorageBytes;
      const measuredGrade = measure(() => gradeStrategy(compiled.value.source, policy)); row.gradeMs = measuredGrade.ms; grade = measuredGrade.value;
    } else {
      const prepared = measure(() => createTurnGame(request)); row.prepareMs = prepared.ms;
      const solved = measure(() => solveCfr(prepared.value, { iterations: n })); row.solveIncludingCompileMs = solved.ms; policy = solved.value.averageStrategy;
      const measuredGrade = measure(() => gradeStrategy(prepared.value, policy)); row.gradeMs = measuredGrade.ms; grade = measuredGrade.value;
    }
    const serialized = measure(() => canonicalSolverJson(serializeBehavioralStrategy(policy))); row.serializationMs = serialized.ms;
    if (sample >= 0) rows.push(row);
    last = { ...last, request: request.id, requestHash: vectorDigest(request), backend, compiledTypedBytes, workingTypedBytes,
      policyHash: vectorDigest(serializeBehavioralStrategy(policy)), value: grade.value, exploitability: grade.exploitability,
      serializedBytes: Buffer.byteLength(serialized.value), processMaxRssKiB: process.resourceUsage().maxRSS };
  }
  console.log(JSON.stringify({ ...last, medianMs: Object.fromEntries(Object.keys(rows[0]).map(key => [key, rows.map(row => row[key]).sort((a, b) => a - b)[2]])), samplesMs: rows }));
}
