// B2 referee audit: postflop-solver (via the native bridge) against our independent engines.
//
//   npm run audit:bridge              solve the three locked referee games + the suit-isomorphism
//                                     probe, prove tree identity, grade the exported strategies
//                                     with our own graders and apply the locked gates
//   npm run audit:bridge -- --measure measure float32 / int16 discrepancies (the tolerance input;
//                                     several iteration counts, compression off/on, 1 vs all threads)
//
// Needs the native binary (npm run build:bridge). Exits nonzero on any mismatch or failed gate.
import { runBridgeSpot } from "./bridge-runner";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { BRIDGE_FIXTURE_HASHES, buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import {
  BRIDGE_FLOAT32_TOLERANCE_CHIPS, bridgeSelfReportedValue, refereeGates, refereeRangeMismatches, refereeWalk,
  type RefereeArtifactBounds, type RefereeEngine,
} from "../src/lib/solver/bridge/referee";
import {
  ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY, ISOMORPHISM_PROBE_REQUEST, REFEREE_GAMES, flopReferenceRefereeEngine,
  isomorphismProbeSpot, turnV2RefereeEngine,
} from "../src/lib/solver/bridge/referee-node";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- engines differ in state/action types
type AnyEngine = RefereeEngine<any, any>;
interface Case {
  readonly id: string;
  readonly spot: BridgeSpotV1;
  readonly engine: () => AnyEngine;
  readonly bounds: RefereeArtifactBounds | null;
  readonly lockedHash: string | null;
  readonly artifactPayloadHash: string | null;
}

function cases(): Case[] {
  return [
    ...REFEREE_GAMES.map(game => ({ id: game.id, spot: buildBridgeFixture(game.id), engine: game.engine, bounds: game.bounds,
      lockedHash: BRIDGE_FIXTURE_HASHES[game.id], artifactPayloadHash: game.artifactPayloadHash })),
    { id: "probe-turn-v2-suit-isomorphism", spot: isomorphismProbeSpot(), engine: () => turnV2RefereeEngine(ISOMORPHISM_PROBE_REQUEST),
      bounds: null, lockedHash: null, artifactPayloadHash: null },
  ];
}

const round = (x: number, digits = 9) => Number(x.toPrecision(digits));

/** Walk + grade one result; throws on any tree/policy mismatch. */
function grade(engine: AnyEngine, result: BridgeResultV1) {
  const walk = refereeWalk(engine, result);
  if (walk.mismatches.length) throw new Error(`Tree/policy mismatch (${walk.mismatches.length}):\n  ${walk.mismatches.join("\n  ")}`);
  return { walk, ours: engine.grade(walk.policy) };
}

async function check() {
  const tolerance = BRIDGE_FLOAT32_TOLERANCE_CHIPS;
  if (!(tolerance > 0)) throw new Error("BRIDGE_FLOAT32_TOLERANCE_CHIPS is not locked");
  const started = performance.now(), failures: string[] = [];
  for (const item of cases()) {
    const caseStarted = performance.now(), fail = (message: string) => failures.push(`${item.id}: ${message}`);
    const spotHash = hashBridgeSpot(item.spot);
    if (item.lockedHash !== null && spotHash !== item.lockedHash) { fail(`spot hash ${spotHash} ≠ locked ${item.lockedHash}`); continue; }
    const engine = item.engine();
    refereeRangeMismatches(engine, item.spot).forEach(fail);
    const run = await runBridgeSpot(item.spot);
    const result = run.result;
    if (result.engine.precision !== "float32") fail(`solved with ${result.engine.precision}; referees lock float32`);
    if (!result.exploitability.reached) fail("postflop-solver did not reach the spot's exploitability target");
    let graded: ReturnType<typeof grade>;
    try { graded = grade(engine, result); } catch (error) { fail(String(error)); continue; }
    const gates = refereeGates(result, graded.ours, tolerance, item.bounds);
    gates.failures.forEach(fail);
    if (!item.bounds && !(graded.ours.exploitability <= ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY)) {
      fail(`(c) our grade ${graded.ours.exploitability} fails the probe's ${ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY}-chip gate`);
    }
    if (!item.bounds && graded.walk.stats.nonRepresentativeChildren === 0) fail("probe exercised no suit-isomorphic card");
    console.log(JSON.stringify({
      game: item.id, spotHash, artifactPayloadHash: item.artifactPayloadHash, grader: graded.ours.grader,
      iterations: result.iterations, precision: result.engine.precision, threads: result.engine.threads,
      selfReported: { exploitability: round(gates.selfReported.exploitability), value0: round(gates.selfReported.value0) },
      ours: { exploitability: round(graded.ours.exploitability), value0: round(graded.ours.value[0]), gains: graded.ours.gains.map(g => round(g)) },
      deltas: { exploitability: round(gates.deltas.exploitability, 3), value0: round(gates.deltas.value0, 3), zeroSum: round(gates.deltas.zeroSum, 3) },
      tolerance, artifactInterval: gates.artifactInterval?.map(x => round(x)) ?? null, bridgeInterval: gates.bridgeInterval.map(x => round(x)),
      qualityGate: item.bounds?.maximumExploitability ?? ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY, walk: graded.walk.stats,
      solveMs: result.timings.totalMs, caseMs: Math.round(performance.now() - caseStarted),
    }));
  }
  console.log(JSON.stringify({ audit: "bridge", passed: failures.length === 0, elapsedMs: Math.round(performance.now() - started) }));
  if (failures.length) throw new Error(`audit:bridge failed:\n${failures.join("\n")}`);
}

const MEASURE_ITERATIONS = [10, 30, 100, 300, 1000] as const;

async function measure() {
  const rows: { game: string; compression: string; threads: number | "all"; iterations: number; selfExploitability: number;
    ourExploitability: number; exploitability: number; value: number; zeroSum: number }[] = [];
  for (const item of cases()) {
    // The flop cross-check (exact generic best response) is exercised by the check mode; the
    // vector grader alone keeps the 20 flop solves here to a few minutes.
    const engine = item.id === "referee-flop-reference" ? flopReferenceRefereeEngine() : item.engine();
    for (const compression of ["off", "on"] as const) {
      for (const threads of [1, undefined]) {
        for (const iterations of MEASURE_ITERATIONS) {
          const spot = { ...item.spot, solve: { ...item.spot.solve, compression, maxIterations: iterations, targetExploitabilityPctPot: 1e-9 } };
          const { result } = await runBridgeSpot(spot, { threads });
          const { ours } = grade(engine, result);
          const value0 = bridgeSelfReportedValue(result, 0), value1 = bridgeSelfReportedValue(result, 1);
          const row = { game: item.id, compression, threads: threads ?? "all" as const, iterations: result.iterations,
            selfExploitability: result.exploitability.chips, ourExploitability: ours.exploitability,
            exploitability: Math.abs(result.exploitability.chips - ours.exploitability), value: Math.abs(value0 - ours.value[0]),
            zeroSum: Math.abs(value0 + value1) };
          rows.push(row);
          console.log(JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? round(v, 4) : v]))));
        }
      }
    }
  }
  for (const compression of ["off", "on"]) {
    const subset = rows.filter(row => row.compression === compression);
    const max = (key: "exploitability" | "value" | "zeroSum") => Math.max(...subset.map(row => row[key]));
    const perGame = Object.fromEntries(cases().map(item => [item.id, round(Math.max(...subset.filter(r => r.game === item.id)
      .flatMap(r => [r.exploitability, r.value, r.zeroSum])), 3)]));
    console.log(JSON.stringify({ summary: compression === "off" ? "float32" : "int16-compressed", solves: subset.length,
      maxExploitabilityDelta: round(max("exploitability"), 3), maxValueDelta: round(max("value"), 3), maxZeroSumError: round(max("zeroSum"), 3),
      maxPerGame: perGame }));
  }
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--measure")) {
  console.error("Usage: npm run audit:bridge [-- --measure]");
  process.exitCode = 1;
} else {
  (args[0] === "--measure" ? measure() : check()).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
