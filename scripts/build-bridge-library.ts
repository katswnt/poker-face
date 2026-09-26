// B4 bridge spot library: generate, audit and reproduce the saved BTN vs BB SRP flop spots.
//
//   npm run generate:bridge:library   solve every library flop with the native bridge (~5 min and
//                                     6 GB each, sequential; raw results cached in
//                                     .cache/bridge-library/ so an interrupted run resumes), gate
//                                     each at ≤ 0.3% pot, write hash-bound chunks + manifest to
//                                     public/solver-data/bridge-v1/
//   npm run audit:bridge:library      fast, no engine needed (CI): manifest + chunk hashes and
//                                     schema, spot hashes rebuilt from code, reach/EV invariants,
//                                     re-grade of the saved river referee sample with our grader
//   npm run reproduce:bridge:library  local only (~1 hour, 6 GB): re-solve every spot from scratch
//                                     and require byte-identical chunks (postflop-solver is
//                                     deterministic on one machine: B2 found 1 and 10 threads
//                                     bit-identical). Too slow for CI and CI runners are x86_64,
//                                     where float32 reduction order may differ.
//   add -- --only <spot-id> to reproduce one spot.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalSlicePlan, runBridgeSpot } from "./bridge-runner";
import { POSTFLOP_SOLVER_COMMIT, checkBridgeResult, type BridgeResultV1, type BridgeSpotV1, type BridgeSubtree } from "../src/lib/solver/bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { BENCHMARK_CHIPS_PER_BB, SRP_EFFECTIVE_STACK, SRP_STARTING_POT } from "../src/lib/solver/bridge/fixtures";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { encodeSliceNode } from "../src/lib/solver/bridge/library/encode";
import { auditLibrarySpot } from "../src/lib/solver/bridge/library/invariants";
import { libraryRangesFromSpot, validateLibraryChunk, validateLibraryManifest } from "../src/lib/solver/bridge/library/load";
import {
  BRIDGE_LIBRARY_CHUNK_FORMAT, BRIDGE_LIBRARY_DIR, BRIDGE_LIBRARY_ROOT_FORMAT, BRIDGE_LIBRARY_FILE_BYTES, BRIDGE_LIBRARY_FORMAT, BRIDGE_LIBRARY_GATE_PCT_POT,
  BRIDGE_LIBRARY_GZIP_BUDGET_BYTES, BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK, BRIDGE_LIBRARY_URL_PREFIX, EQUITY_SCALE, EV_SCALE, REACH_SCALE,
  STRATEGY_SCALE, chunkKeyForNode, type BridgeLibraryChunk, type BridgeLibraryChunkRef, type BridgeLibraryFileRef,
  type BridgeLibraryManifest, type BridgeLibraryNode, type BridgeLibraryRoot, type BridgeLibrarySpot,
} from "../src/lib/solver/bridge/library/model";
import {
  LIBRARY_FLOPS, LIBRARY_PROVENANCE, LIBRARY_REFEREE_SAMPLE, LIBRARY_SLICE_POLICY, flopDescriptor, librarySlicePlan, librarySpot,
  type LibraryFlopDefinition,
} from "../src/lib/solver/bridge/library/spots";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

const ROOT = new URL("../", import.meta.url).pathname;
const OUT = resolve(ROOT, "public/solver-data", BRIDGE_LIBRARY_DIR);
const CACHE = resolve(ROOT, ".cache/bridge-library");
const REFEREE_FORMAT = "poker-face-bridge-library-referee-sample";
/** Our grade of the saved sample must reproduce exactly (same code, same inputs). */
const REGRADE_TOLERANCE = 1e-9;
/**
 * |postflop-solver's subgame value − ours| for the sample. B3 measured the float32 value
 * discrepancy on this game's river subgames (see the spec); this bound is 10× that maximum.
 */
const SAMPLE_VALUE_TOLERANCE_CHIPS = 0.01;

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const round = (x: number, digits = 6) => Number(x.toPrecision(digits));

function selfValue(result: BridgeResultV1, player: 0 | 1): number {
  const w = result.root.weights[player], ev = result.root.ev[player];
  let n = 0, d = 0;
  for (let h = 0; h < w.length; h += 1) { n += w[h] * ev[h]; d += w[h]; }
  return n / d;
}

function subtreesFor(definition: LibraryFlopDefinition) {
  return definition.id === LIBRARY_REFEREE_SAMPLE.spotId ? [LIBRARY_REFEREE_SAMPLE.path] : [];
}

interface Built {
  readonly definition: LibraryFlopDefinition;
  readonly spot: BridgeSpotV1;
  readonly spotHash: string;
  readonly planHash: string;
  readonly result: BridgeResultV1;
  /** Relative path under OUT → exact bytes. */
  readonly files: Map<string, string>;
  readonly entry: BridgeLibrarySpot;
}

/** Turn a checked bridge result into the spot's published files and manifest entry. */
function buildSpot(definition: LibraryFlopDefinition, spot: BridgeSpotV1, result: BridgeResultV1, solveMs: number, peakRssBytes: number): Built {
  const spotHash = hashBridgeSpot(spot), plan = canonicalSlicePlan(librarySlicePlan(definition, subtreesFor(definition)), spot);
  if (result.spotHash !== spotHash || result.slices?.planHash !== plan.hash) throw new Error(`${definition.id}: result does not match its spot/plan`);
  if (result.slices.unreached.length) throw new Error(`${definition.id}: planned cards never dealt: ${result.slices.unreached.join(", ")}`);
  const prefix = `${definition.id}/${spotHash}/`, files = new Map<string, string>();
  const ref = (name: string, text: string): BridgeLibraryFileRef => {
    const bytes = Buffer.byteLength(text);
    if (bytes > BRIDGE_LIBRARY_FILE_BYTES) throw new Error(`${prefix}${name} is ${bytes} bytes, over the ${BRIDGE_LIBRARY_FILE_BYTES}-byte file cap`);
    files.set(`${prefix}${name}`, text);
    return { url: `${BRIDGE_LIBRARY_URL_PREFIX}${prefix}${name}`, bytes, sha256: sha256(text) };
  };
  const groups = new Map<string, BridgeLibraryNode[]>();
  for (const node of result.slices.nodes) {
    const encoded = encodeSliceNode(node), key = chunkKeyForNode(encoded);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(encoded);
  }
  const keys = ["flop", ...definition.turnCards.map(t => `turn-${t}`),
    ...[...groups.keys()].filter(k => k.startsWith("river-")).sort()];
  for (const [turn, river] of definition.riverBoards) {
    if (!keys.some(k => k.startsWith(`river-${turn}${river}-`))) throw new Error(`${definition.id}: no river slices for ${turn}${river}`);
  }
  const chunks: Record<string, BridgeLibraryChunkRef> = {};
  for (const key of keys) {
    const nodes = groups.get(key) ?? [];
    if (!nodes.length || nodes.length > BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK) throw new Error(`${definition.id}: chunk ${key} has ${nodes.length} nodes`);
    const chunk: BridgeLibraryChunk = { format: BRIDGE_LIBRARY_CHUNK_FORMAT, version: 1, spotId: definition.id, spotHash, key, nodes };
    chunks[key] = { ...ref(`${key}.json`, JSON.stringify(chunk)), nodes: nodes.length };
  }
  if ([...groups.keys()].some(key => !keys.includes(key))) throw new Error(`${definition.id}: slices outside the planned chunks`);
  const full = flopDescriptor(definition);
  const descriptor: BridgeLibrarySpot["descriptor"] = { suitPattern: full.suitPattern, pairing: full.pairing, ranks: full.ranks,
    highRank: full.highRank, broadwayCards: full.broadwayCards, gaps: full.gaps, straightPossible: full.straightPossible };
  const entry: BridgeLibrarySpot = {
    id: definition.id, flop: [...definition.flop] as [string, string, string], texture: definition.texture, spotHash, slicePlanHash: plan.hash,
    spot: ref("spot.json", canonicalBridgeSpotJson(spot)),
    root: ref("root.json", JSON.stringify(rootFile(definition, spot, spotHash, result))), descriptor,
    engine: { precision: result.engine.precision, threads: result.engine.threads }, iterations: result.iterations,
    exploitability: { chips: round(result.exploitability.chips), pctPot: round(result.exploitability.pctPot, 5) },
    value: [round(selfValue(result, 0)), round(selfValue(result, 1))], solveMs: Math.round(solveMs), peakRssBytes,
    turnCards: [...definition.turnCards], riverBoards: definition.riverBoards.map(b => [b[0], b[1]] as [string, string]), chunks,
  };
  return { definition, spot, spotHash, planHash: plan.hash, result, files, entry };
}

export function rangesHash(spot: BridgeSpotV1): string {
  return sha256(canonicalSolverJson(spot.ranges));
}

/** Full-precision flop-root values straight from the bridge result (float32 as exported). */
function rootFile(definition: LibraryFlopDefinition, spot: BridgeSpotV1, spotHash: string, result: BridgeResultV1): BridgeLibraryRoot {
  const roles = ["BB (out of position)", "BTN (in position)"];
  return {
    format: BRIDGE_LIBRARY_ROOT_FORMAT, version: 1, spotId: definition.id, spotHash, rangesHash: rangesHash(spot), potType: "srp",
    startingPot: spot.startingPot, effectiveStack: spot.effectiveStack, exploitabilityPctPot: result.exploitability.pctPot,
    flop: flopDescriptor(definition),
    players: ([0, 1] as const).map(p => ({
      role: roles[p], rangeSource: spot.ranges[p].source, hands: result.hands[p], weight: spot.ranges[p].combos.map(c => c.weight),
      normalizedWeight: result.root.weights[p], rootEv: result.root.ev[p], rootEquity: result.root.equity[p],
    })) as unknown as BridgeLibraryRoot["players"],
  };
}

function refereeSampleFile(built: Built) {
  const subtree: BridgeSubtree | undefined = built.result.slices!.subtrees[0];
  if (!subtree) throw new Error("Referee sample subtree missing");
  const grade = gradeRiverSubgame({ hands: built.result.hands, startingPot: built.spot.startingPot, subtree });
  const text = JSON.stringify({ format: REFEREE_FORMAT, version: 1, spotId: built.definition.id, spotHash: built.spotHash,
    startingPot: built.spot.startingPot, hands: built.result.hands, subtree });
  return { text, grade };
}

function writeFileAtomically(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.partial`, text); renameSync(`${path}.partial`, path);
}

async function solveOrLoad(definition: LibraryFlopDefinition, spot: BridgeSpotV1, useCache: boolean) {
  const spotHash = hashBridgeSpot(spot), plan = librarySlicePlan(definition, subtreesFor(definition));
  const planHash = canonicalSlicePlan(plan, spot).hash, cached = join(CACHE, `${definition.id}-${spotHash.slice(0, 16)}-${planHash.slice(0, 16)}.json`);
  if (useCache && existsSync(cached)) {
    const saved = JSON.parse(readFileSync(cached, "utf8"));
    return { result: checkBridgeResult(saved.result, spot, spotHash), solveMs: saved.solveMs as number, peakRssBytes: saved.peakRssBytes as number, cached: true };
  }
  const started = performance.now();
  const run = await runBridgeSpot(spot, { slices: plan, onProgress: p => {
    if (p.stage === "solving" && p.iteration! % 50 === 0) console.error(`  ${definition.id} iteration ${p.iteration} exploitability ${p.exploitability}`);
  } });
  const solveMs = performance.now() - started, peakRssBytes = Math.max(run.sampledPeakRssBytes, run.result.memory.peakRssBytes);
  if (useCache) writeFileAtomically(cached, JSON.stringify({ solveMs, peakRssBytes, result: run.result }));
  return { result: run.result, solveMs, peakRssBytes, cached: false };
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter(e => e.isFile())
    .map(e => relative(directory, join(e.parentPath, e.name))).sort();
}

const FORMATION = {
  name: "BTN vs BB single-raised pot, 100bb (BTN opens 2.5bb, SB folds, BB calls)",
  players: ["BB (out of position, acts first)", "BTN (in position)"] as [string, string],
  startingPot: SRP_STARTING_POT, effectiveStack: SRP_EFFECTIVE_STACK, chipsPerBigBlind: BENCHMARK_CHIPS_PER_BB,
};

async function generate() {
  const started = performance.now(), published: Built[] = [], rejected: string[] = [];
  for (const definition of LIBRARY_FLOPS) {
    const spot = librarySpot(definition);
    console.error(`${definition.id} (${definition.texture}) …`);
    const solved = await solveOrLoad(definition, spot, true);
    const pct = solved.result.exploitability.pctPot;
    console.error(`  ${solved.cached ? "cached" : "solved"}: ${solved.result.iterations} iterations, ${round(pct, 4)}% pot, ${Math.round(solved.solveMs / 1000)} s, peak ${Math.round(solved.peakRssBytes / 2 ** 20)} MiB`);
    if (!solved.result.exploitability.reached || pct > BRIDGE_LIBRARY_GATE_PCT_POT) { rejected.push(`${definition.id}: ${pct}% pot`); continue; }
    published.push(buildSpot(definition, spot, solved.result, solved.solveMs, solved.peakRssBytes));
  }
  const sampleOwner = published.find(b => b.definition.id === LIBRARY_REFEREE_SAMPLE.spotId);
  if (!sampleOwner) throw new Error("The referee sample's spot was not published");
  const sample = refereeSampleFile(sampleOwner);
  const files = new Map<string, string>();
  for (const built of published) for (const [path, text] of built.files) files.set(path, text);
  files.set("referee-sample.json", sample.text);
  const sampleRef = { url: `${BRIDGE_LIBRARY_URL_PREFIX}referee-sample.json`, bytes: Buffer.byteLength(sample.text), sha256: sha256(sample.text) };
  if (sampleRef.bytes > BRIDGE_LIBRARY_FILE_BYTES) throw new Error("Referee sample exceeds the file cap");
  let rawBytes = 0, gzipBytes = 0;
  for (const text of files.values()) { rawBytes += Buffer.byteLength(text); gzipBytes += gzipSync(text, { level: 9 }).length; }
  const manifestBase: Omit<BridgeLibraryManifest, "totals"> = {
    format: BRIDGE_LIBRARY_FORMAT, version: 1, title: "BTN vs BB single-raised pot flops (postflop-solver, lean tree)",
    formation: FORMATION,
    provenance: {
      ranges: LIBRARY_PROVENANCE.ranges, tree: LIBRARY_PROVENANCE.tree, label: LIBRARY_PROVENANCE.label,
      engine: { name: "postflop-solver", repository: "https://github.com/b-inary/postflop-solver", commit: POSTFLOP_SOLVER_COMMIT, license: "AGPL-3.0" },
    },
    slicePolicy: LIBRARY_SLICE_POLICY, quantization: { reach: REACH_SCALE, strategy: STRATEGY_SCALE, ev: EV_SCALE, equity: EQUITY_SCALE },
    gatePctPot: BRIDGE_LIBRARY_GATE_PCT_POT, spots: published.map(b => b.entry),
    refereeSample: { ...sampleRef, spotId: sampleOwner.definition.id, path: sample.grade.path,
      grade: { exploitability: sample.grade.ours.exploitability, value0: sample.grade.ours.value[0], theirValue0: sample.grade.theirs.value[0] } },
  };
  // Totals cover the data files; the manifest (a few KB) is reported and budgeted separately.
  const totals = { files: files.size, rawBytes, gzipBytes };
  const manifest = JSON.stringify({ ...manifestBase, totals }, null, 1);
  const manifestGzip = gzipSync(manifest, { level: 9 }).length;
  if (totals.gzipBytes + manifestGzip > BRIDGE_LIBRARY_GZIP_BUDGET_BYTES) {
    throw new Error(`Library is ${totals.gzipBytes + manifestGzip} bytes gzip, over the ${BRIDGE_LIBRARY_GZIP_BUDGET_BYTES} budget`);
  }
  validateLibraryManifest(JSON.parse(manifest));
  // Replace the published directory wholesale so stale hashes never linger.
  const staging = `${OUT}.staging`;
  rmSync(staging, { recursive: true, force: true });
  for (const [path, text] of files) writeFileAtomically(join(staging, path), text);
  writeFileAtomically(join(staging, "manifest.json"), manifest);
  rmSync(OUT, { recursive: true, force: true }); renameSync(staging, OUT);
  console.log(JSON.stringify({ published: published.map(b => ({ id: b.entry.id, iterations: b.entry.iterations, pctPot: b.entry.exploitability.pctPot,
    solveS: Math.round(b.entry.solveMs / 1000), chunks: Object.keys(b.entry.chunks).length })), rejected, totals,
    manifest: { rawBytes: Buffer.byteLength(manifest), gzipBytes: manifestGzip },
    refereeSample: manifestBase.refereeSample.grade, elapsedS: Math.round((performance.now() - started) / 1000) }));
  if (rejected.length) console.error(`Not published (failed the ${BRIDGE_LIBRARY_GATE_PCT_POT}% gate): ${rejected.join("; ")}`);
}

function readText(path: string, ref: BridgeLibraryFileRef): string {
  const bytes = readFileSync(path);
  if (bytes.length !== ref.bytes || sha256(bytes) !== ref.sha256) throw new Error(`${relative(ROOT, path)} does not match its manifest hash/size`);
  return bytes.toString("utf8");
}
const localPath = (url: string) => join(OUT, url.slice(BRIDGE_LIBRARY_URL_PREFIX.length));

/** root.json: identity, shape, and agreement with the (quantized) flop-root node of the flop chunk. */
function checkRootFile(root: BridgeLibraryRoot, entry: BridgeLibrarySpot, spot: BridgeSpotV1, flop: BridgeLibraryChunk | undefined): string[] {
  const failures: string[] = [];
  if (root.format !== BRIDGE_LIBRARY_ROOT_FORMAT || root.version !== 1 || root.spotId !== entry.id || root.spotHash !== entry.spotHash) failures.push("identity");
  if (root.rangesHash !== rangesHash(spot)) failures.push("rangesHash differs from the spot's ranges");
  if (root.flop.cards.join("") !== entry.flop.join("") || JSON.stringify(flopDescriptor(LIBRARY_FLOPS.find(d => d.id === entry.id)!)) !== JSON.stringify(root.flop)) failures.push("flop descriptor");
  if (root.exploitabilityPctPot > BRIDGE_LIBRARY_GATE_PCT_POT) failures.push("exploitability above the gate");
  const node = flop?.nodes.find(n => n.path === "");
  if (!node) return [...failures, "flop chunk has no root node"];
  for (const p of [0, 1] as const) {
    const player = root.players[p], combos = spot.ranges[p].combos;
    if (player.hands.join() !== combos.map(c => c.combo).join() || player.weight.some((w, h) => w !== combos[h].weight)) failures.push(`players[${p}] hands/weights`);
    for (const key of ["normalizedWeight", "rootEv", "rootEquity"] as const) {
      if (player[key].length !== combos.length || player[key].some(v => typeof v !== "number" || !Number.isFinite(v))) failures.push(`players[${p}].${key} shape`);
    }
    // The chunk stores from-now EV (= net EV + startingPot/2 at the root) and equity, quantized.
    node.live[p].forEach((h, i) => {
      const ev = node.ev[p][i], eq = node.equity[p][i];
      if (ev !== null && Math.abs(ev - Math.round((player.rootEv[h] + spot.startingPot / 2) * EV_SCALE)) > 1) failures.push(`players[${p}] EV of ${player.hands[h]}`);
      if (eq !== null && Math.abs(eq - Math.round(player.rootEquity[h] * EQUITY_SCALE)) > 1) failures.push(`players[${p}] equity of ${player.hands[h]}`);
      if (node.reach[p][i] !== Math.round(player.weight[h] / node.reachMax[p] * REACH_SCALE)) failures.push(`players[${p}] weight of ${player.hands[h]}`);
    });
  }
  return failures.slice(0, 10);
}

async function check() {
  const started = performance.now(), failures: string[] = [];
  const manifestPath = join(OUT, "manifest.json");
  if (statSync(manifestPath).size > BRIDGE_LIBRARY_FILE_BYTES) throw new Error("manifest too large");
  const manifest = validateLibraryManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const expectedFiles = new Set(["manifest.json", relative(OUT, localPath(manifest.refereeSample.url))]);
  let rawBytes = 0;
  const reports = [];
  for (const entry of manifest.spots) {
    const definition = LIBRARY_FLOPS.find(d => d.id === entry.id);
    if (!definition) { failures.push(`${entry.id}: not a library flop in code`); continue; }
    const spot = librarySpot(definition);
    const spotHash = hashBridgeSpot(spot);
    if (spotHash !== entry.spotHash) failures.push(`${entry.id}: code builds spot ${spotHash}, manifest has ${entry.spotHash}`);
    const planHash = canonicalSlicePlan(librarySlicePlan(definition, subtreesFor(definition)), spot).hash;
    if (planHash !== entry.slicePlanHash) failures.push(`${entry.id}: code builds slice plan ${planHash}, manifest has ${entry.slicePlanHash}`);
    const spotText = readText(localPath(entry.spot.url), entry.spot);
    if (sha256(spotText) !== entry.spotHash) failures.push(`${entry.id}: spot.json hash ≠ spotHash`);
    expectedFiles.add(relative(OUT, localPath(entry.spot.url))); rawBytes += entry.spot.bytes;
    const ranges = libraryRangesFromSpot(JSON.parse(spotText), entry);
    const chunks: BridgeLibraryChunk[] = [];
    for (const [key, ref] of Object.entries(entry.chunks)) {
      expectedFiles.add(relative(OUT, localPath(ref.url))); rawBytes += ref.bytes;
      try { chunks.push(validateLibraryChunk(JSON.parse(readText(localPath(ref.url), ref)), entry, key, ranges)); }
      catch (error) { failures.push(`${entry.id}/${key}: ${error instanceof Error ? error.message : error}`); }
    }
    expectedFiles.add(relative(OUT, localPath(entry.root.url))); rawBytes += entry.root.bytes;
    checkRootFile(JSON.parse(readText(localPath(entry.root.url), entry.root)), entry, spot, chunks.find(c => c.key === "flop"))
      .forEach(f => failures.push(`${entry.id}/root.json: ${f}`));
    const report = auditLibrarySpot(chunks, ranges, { startingPot: spot.startingPot, effectiveStack: spot.effectiveStack });
    report.failures.forEach(f => failures.push(`${entry.id}: ${f}`));
    if (report.reachChecked === 0 || report.opponentEvChecked === 0) failures.push(`${entry.id}: invariants covered nothing`);
    reports.push({ id: entry.id, pctPot: entry.exploitability.pctPot, nodes: report.nodes, reachChecked: report.reachChecked, reachSkipped: report.reachSkipped,
      opponentEvChecked: report.opponentEvChecked, maxReachError: round(report.maxReachError, 3), maxActorEvError: round(report.maxActorEvError, 3),
      maxOpponentEvError: round(report.maxOpponentEvError, 3) });
  }
  // Referee sample: re-grade with our factorized river grader.
  const sample = JSON.parse(readText(localPath(manifest.refereeSample.url), manifest.refereeSample));
  rawBytes += manifest.refereeSample.bytes;
  const owner = manifest.spots.find(s => s.id === manifest.refereeSample.spotId)!;
  if (sample.format !== REFEREE_FORMAT || sample.spotHash !== owner.spotHash) failures.push("referee sample belongs to another spot");
  const grade = gradeRiverSubgame({ hands: sample.hands, startingPot: sample.startingPot, subtree: sample.subtree });
  const recorded = manifest.refereeSample.grade;
  if (Math.abs(grade.ours.exploitability - recorded.exploitability) > REGRADE_TOLERANCE || Math.abs(grade.ours.value[0] - recorded.value0) > REGRADE_TOLERANCE) {
    failures.push(`referee sample re-grade ${grade.ours.exploitability}/${grade.ours.value[0]} ≠ recorded ${recorded.exploitability}/${recorded.value0}`);
  }
  if (Math.abs(grade.theirs.value[0] - grade.ours.value[0]) > SAMPLE_VALUE_TOLERANCE_CHIPS) failures.push(`referee sample: postflop-solver value ${grade.theirs.value[0]} vs ours ${grade.ours.value[0]}`);
  const onDisk = listFiles(OUT);
  const extra = onDisk.filter(f => !expectedFiles.has(f)), missing = [...expectedFiles].filter(f => !onDisk.includes(f));
  if (extra.length || missing.length) failures.push(`unexpected files ${extra.join(", ")}; missing ${missing.join(", ")}`);
  if (rawBytes !== manifest.totals.rawBytes || expectedFiles.size - 1 !== manifest.totals.files) {
    failures.push(`data files ${expectedFiles.size - 1} / ${rawBytes} bytes ≠ manifest totals ${manifest.totals.files} / ${manifest.totals.rawBytes}`);
  }
  console.log(JSON.stringify({ audit: "bridge-library", spots: reports, refereeSample: { path: grade.path.join(" "), deals: grade.deals,
    exploitability: round(grade.ours.exploitability), localPctPot: round(grade.localExploitabilityPctPot, 4),
    valueDelta: round(Math.abs(grade.theirs.value[0] - grade.ours.value[0]), 3), gradeMs: Math.round(grade.elapsedMs) },
    totals: manifest.totals, passed: failures.length === 0, elapsedMs: Math.round(performance.now() - started) }));
  if (failures.length) throw new Error(`audit:bridge:library failed:\n${failures.slice(0, 40).join("\n")}`);
}

async function reproduce(only: string | null) {
  const manifest = validateLibraryManifest(JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")));
  const failures: string[] = [];
  for (const entry of manifest.spots) {
    if (only && entry.id !== only) continue;
    const definition = LIBRARY_FLOPS.find(d => d.id === entry.id)!;
    const spot = librarySpot(definition);
    console.error(`${entry.id}: re-solving from scratch …`);
    const solved = await solveOrLoad(definition, spot, false);
    const built = buildSpot(definition, spot, solved.result, solved.solveMs, solved.peakRssBytes);
    if (built.result.iterations !== entry.iterations) failures.push(`${entry.id}: ${built.result.iterations} iterations ≠ ${entry.iterations}`);
    for (const [key, ref] of Object.entries(entry.chunks)) {
      if (built.entry.chunks[key]?.sha256 !== ref.sha256) failures.push(`${entry.id}/${key}: re-solved chunk differs`);
    }
    console.error(`  ${failures.length ? "differs" : "byte-identical"} (${Math.round(solved.solveMs / 1000)} s)`);
  }
  if (only && !manifest.spots.some(s => s.id === only)) throw new Error(`No published spot ${only}`);
  if (failures.length) throw new Error(`reproduce:bridge:library failed:\n${failures.join("\n")}`);
  console.log(JSON.stringify({ reproduce: "bridge-library", only, passed: true }));
}

const args = process.argv.slice(2);
const mode = args[0], onlyIndex = args.indexOf("--only"), only = onlyIndex >= 0 ? args[onlyIndex + 1] ?? null : null;
const valid = (mode === "--generate" || mode === "--check") ? args.length === 1 : mode === "--reproduce" && (args.length === 1 || (args.length === 3 && only));
if (!valid) {
  console.error("Usage: build-bridge-library.ts --generate | --check | --reproduce [--only <spot-id>]");
  process.exitCode = 1;
} else {
  (mode === "--generate" ? generate() : mode === "--check" ? check() : reproduce(only))
    .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
