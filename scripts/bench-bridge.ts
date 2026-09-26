// B3 Griffin-scale benchmark (local only: ~15 minutes and 6 GB RAM on an M1 Pro).
//
//   npm run bench:bridge                 solve the locked lean benchmark in float32 and int16,
//                                        record iterations, wall time, peak RSS and the
//                                        exploitability curve, and referee-grade sampled river
//                                        subgames of both solves with our factorized grader
//   npm run bench:bridge -- --experiment how much do extra IP sizes buy: lean tree vs IP
//                                        33/66/125% on every street, both at 0.15% pot (int16)
//
// Writes src/lib/solver/bridge/artifacts/benchmark-b3.json (or benchmark-b3-experiment.json),
// never overwriting an existing file (delete it to re-measure). Needs npm run build:bridge.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runBridgeSpot, type BridgeRun } from "./bridge-runner";
import { BRIDGE_SLICE_PLAN_FORMAT, validateBridgeSpot, type BridgeResultV1, type BridgeSliceNode, type BridgeSlicePlanV1,
  type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { BRIDGE_BENCHMARK_ID, BRIDGE_FIXTURE_HASHES, LEAN_SRP_TREE, buildBridgeFixture } from "../src/lib/solver/bridge/fixtures";
import { compatibleMass, gradeRiverSubgame, subgameProbability, type RiverSubgameGrade } from "../src/lib/solver/bridge/subgame-referee";

const ARTIFACTS = new URL("../src/lib/solver/bridge/artifacts/", import.meta.url).pathname;

/**
 * River subgames sampled for the referee spot-check, chosen before the solve for line
 * variety (not for results): check-through, OOP flop c-bet called, IP barrels called twice,
 * OOP turn lead called, the IP decision after a river check, and IP facing a river bet.
 */
const REFEREE_PATHS: readonly (readonly string[])[] = [
  ["x", "x", "9c", "x", "x", "3s"],
  ["s0", "c", "Ad", "x", "x", "5h"],
  ["x", "s0", "c", "7c", "x", "s0", "c", "Jd"],
  ["x", "x", "Th", "s0", "c", "2s"],
  ["x", "x", "9c", "x", "x", "3s", "x"],
  ["x", "x", "9c", "x", "x", "3s", "s0"],
];

const PLAN: BridgeSlicePlanV1 = {
  format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop: { maxDepth: null }, turn: null, river: null,
  subtrees: REFEREE_PATHS.map(p => [...p]), equity: false,
};

const round = (x: number, digits = 6) => Number(x.toPrecision(digits));

function writeNew(name: string, value: unknown) {
  const target = resolve(ARTIFACTS, name);
  if (existsSync(target)) throw new Error(`${target} exists; delete it to re-measure`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.partial`, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(`${target}.partial`, target);
  console.error(`wrote ${target}`);
}

function selfValue(result: BridgeResultV1, player: 0 | 1): number {
  const w = result.root.weights[player], ev = result.root.ev[player];
  let n = 0, d = 0;
  for (let h = 0; h < w.length; h += 1) { n += w[h] * ev[h]; d += w[h]; }
  return n / d;
}

function summary(run: BridgeRun) {
  const r = run.result;
  return {
    spotId: r.spotId, spotHash: run.spotHash, precision: r.engine.precision, threads: r.engine.threads, iterations: r.iterations,
    exploitability: { chips: round(r.exploitability.chips), pctPot: round(r.exploitability.pctPot, 4), reached: r.exploitability.reached },
    wallMs: Math.round(run.elapsedMs), timings: r.timings,
    memory: { ...r.memory, sampledPeakRssBytes: run.sampledPeakRssBytes },
    selfReportedValue: [round(selfValue(r, 0)), round(selfValue(r, 1))],
    curve: r.convergence.map(c => [c.iteration, round(c.exploitability, 5), c.elapsedMs]),
  };
}

function refereeRows(run: BridgeRun, spot: BridgeSpotV1) {
  const weights = [spot.ranges[0].combos.map(c => c.weight), spot.ranges[1].combos.map(c => c.weight)] as const;
  const rootMass = compatibleMass(run.result.hands, weights, spot.board.flop);
  return run.result.slices!.subtrees.map((subtree): Record<string, unknown> => {
    const g: RiverSubgameGrade = gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot, subtree });
    const probability = subgameProbability(g.reachMass, rootMass, 2);
    const contribution = probability * g.ours.exploitability;
    if (contribution > run.result.exploitability.chips * (1 + 1e-3)) {
      throw new Error(`${g.path.join(" ")}: probability × local exploitability ${contribution} exceeds the whole-game ${run.result.exploitability.chips}`);
    }
    return {
      probability: round(probability, 4), weightedLocalExploitability: round(contribution, 4),
      path: g.path.join(" "), board: g.board.join(""), handsInPlay: g.handsInPlay, deals: g.deals, publicNodes: g.publicNodes, pot: g.pot,
      ours: { value0: round(g.ours.value[0], 9), gains: g.ours.gains.map(x => round(x)), exploitability: round(g.ours.exploitability) },
      theirs: { value0: round(g.theirs.value[0], 9), value1: round(g.theirs.value[1], 9) },
      valueDelta: round(Math.abs(g.theirs.value[0] - g.ours.value[0]), 3),
      zeroSumError: round(Math.abs(g.theirs.value[0] + g.theirs.value[1]), 3),
      localExploitabilityPctPot: round(g.localExploitabilityPctPot, 4), maxColumnSumError: round(g.maxColumnSumError, 2),
      gradeMs: Math.round(g.elapsedMs),
    };
  });
}

/** Reach-weighted total-variation distance between two solves' flop strategies, per node. */
function flopStrategyDistance(a: BridgeResultV1, b: BridgeResultV1) {
  const byPath = new Map(b.slices!.nodes.map(n => [n.path.join(" "), n]));
  let worst = 0, weighted = 0, weight = 0;
  for (const n of a.slices!.nodes) {
    const m = byPath.get(n.path.join(" ")) as BridgeSliceNode | undefined;
    if (!m || m.actions.map(x => x.token).join() !== n.actions.map(x => x.token).join()) throw new Error(`Flop trees differ at ${n.path.join(" ")}`);
    let tv = 0, w = 0;
    n.reach[n.player].forEach((r, h) => {
      if (!(r > 0)) return;
      const d = n.strategy.reduce((s, row, i) => s + Math.abs((row[h] ?? 0) - (m.strategy[i][h] ?? 0)), 0) / 2;
      tv += r * d; w += r;
    });
    if (w > 0) { worst = Math.max(worst, tv / w); weighted += tv; weight += w; }
  }
  return { nodes: a.slices!.nodes.length, meanReachWeightedTv: round(weighted / weight, 4), worstNodeTv: round(worst, 4) };
}

async function benchmark() {
  const spot = buildBridgeFixture(BRIDGE_BENCHMARK_ID);
  if (hashBridgeSpot(spot) !== BRIDGE_FIXTURE_HASHES[BRIDGE_BENCHMARK_ID]) throw new Error("Benchmark spot hash differs from the locked hash");
  const progress = (label: string) => (p: { stage: string; iteration?: number; exploitability?: number }) => {
    if (p.stage === "solving") console.error(`${label} iteration ${p.iteration} exploitability ${p.exploitability}`);
  };
  console.error("float32 solve …");
  const f32 = await runBridgeSpot(spot, { slices: PLAN, onProgress: progress("float32") });
  const f32Referee = refereeRows(f32, spot);
  // Same spot with int16 storage forced (a documented variant: its hash differs only in solve.compression).
  const compressedSpot = validateBridgeSpot({ ...spot, solve: { ...spot.solve, compression: "on" } });
  console.error("int16 solve …");
  const i16 = await runBridgeSpot(compressedSpot, { slices: PLAN, onProgress: progress("int16") });
  const i16Referee = refereeRows(i16, compressedSpot);
  // Same iteration count as the float32 run, to separate compression noise from convergence speed.
  const matchedSpot = validateBridgeSpot({ ...compressedSpot, solve: { ...compressedSpot.solve, targetExploitabilityPctPot: 1e-9,
    maxIterations: f32.result.iterations } });
  console.error(`int16 solve at ${f32.result.iterations} iterations …`);
  const i16Matched = await runBridgeSpot(matchedSpot, { slices: PLAN, onProgress: progress("int16@f32") });
  const i16MatchedReferee = refereeRows(i16Matched, matchedSpot);
  const report = {
    format: "poker-face-bridge-b3-benchmark", version: 1, measuredOn: "Apple M1 Pro, 10 cores, 32 GB; Rust 1.98.1 release; 10 rayon threads",
    note: "Measured wall times include the bridge's own exploitability pass every 10 iterations. Values are chips (1 bb = 100); pot 550.",
    spot: { id: spot.id, hash: hashBridgeSpot(spot), tree: LEAN_SRP_TREE, ranges: spot.ranges.map(r => ({ source: r.source, combos: r.combos.length })) },
    slicePlanHash: f32.slicePlanHash,
    float32: { ...summary(f32), referee: f32Referee },
    int16: { ...summary(i16), referee: i16Referee },
    int16AtFloat32Iterations: { ...summary(i16Matched), referee: i16MatchedReferee },
    compression: {
      selfReportedValueDelta0: round(Math.abs(selfValue(f32.result, 0) - selfValue(i16Matched.result, 0)), 4),
      exploitabilityDeltaChips: round(Math.abs(f32.result.exploitability.chips - i16Matched.result.exploitability.chips), 4),
      flopStrategy: flopStrategyDistance(f32.result, i16Matched.result),
      maxRiverValueDeltaFloat32: round(Math.max(...f32Referee.map(r => r.valueDelta as number)), 3),
      maxRiverValueDeltaInt16: round(Math.max(...[...i16Referee, ...i16MatchedReferee].map(r => r.valueDelta as number)), 3),
    },
  };
  writeNew("benchmark-b3.json", report);
  console.log(JSON.stringify({ float32: report.float32.exploitability, int16: report.int16.exploitability, compression: report.compression }));
}

async function experiment() {
  const lean = buildBridgeFixture(BRIDGE_BENCHMARK_ID);
  const target = 0.15;
  const tight = (spot: BridgeSpotV1, id: string, ipBets: readonly number[]) => validateBridgeSpot({
    ...spot, id,
    tree: { ...LEAN_SRP_TREE, ...Object.fromEntries((["flop", "turn", "river"] as const).map(street => [street,
      { ...LEAN_SRP_TREE[street]!, ip: { ...LEAN_SRP_TREE[street]!.ip, bet: ipBets.map(pct => ({ kind: "pot" as const, pct })) } }])) },
    // int16 for both: the richer tree needs 22.9 GB in float32, which swapped on the 32 GB
    // machine (measured: ~20 GB of swap, < 10 iterations a minute); int16 needs 11.6 GB.
    // int16 EV noise here is ~1e-3 chips (B3), far below the solves' own resolution.
    solve: { ...spot.solve, targetExploitabilityPctPot: target, compression: "on" as const },
  });
  const cases = [
    tight(lean, "experiment-lean-srp-ks7h2d", [66]),
    tight(lean, "experiment-ip-33-66-125-srp-ks7h2d", [33, 66, 125]),
  ];
  const rows = [];
  for (const spot of cases) {
    console.error(`${spot.id} …`);
    const run = await runBridgeSpot(spot, { onProgress: p => { if (p.stage === "solving") console.error(`${spot.id} ${p.iteration} ${p.exploitability}`); } });
    rows.push({ ...summary(run), ipBetsPctPot: (spot.tree as typeof LEAN_SRP_TREE).flop!.ip.bet.map(b => b.kind === "pot" ? b.pct : null) });
  }
  const [a, b] = rows;
  writeNew("benchmark-b3-experiment.json", {
    format: "poker-face-bridge-b3-experiment", version: 1,
    question: "How much EV do extra IP bet sizes (33% and 125% added to 66% on every street) buy on the benchmark flop?",
    note: `Both solves int16-compressed, stopping at ${target}% pot; differences below the sum of both exploitabilities are not resolvable.`,
    cases: rows,
    ipValueGainChips: round(b.selfReportedValue[1] - a.selfReportedValue[1], 4),
    ipValueGainPctPot: round(100 * (b.selfReportedValue[1] - a.selfReportedValue[1]) / lean.startingPot, 4),
    resolution: round(a.exploitability.chips + b.exploitability.chips, 4),
  });
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--experiment")) {
  console.error("Usage: npm run bench:bridge [-- --experiment]");
  process.exitCode = 1;
} else {
  (args[0] === "--experiment" ? experiment() : benchmark()).catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
}
