/** Complete offline v2 pack encoding and independent saved-data audit. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { BridgeResultV1, BridgeSubtree } from "../contract";
import { POSTFLOP_SOLVER_COMMIT } from "../contract";
import { canonicalBridgeSpotJson } from "../contract-node";
import { flopDescriptor } from "../library/spots";
import { EV_SCALE, EQUITY_SCALE, STRATEGY_SCALE, type BridgeLibraryFileRef, type BridgeLibrarySpot } from "../library/model";
import { gradeRiverSubgame } from "../subgame-referee";
import { canonicalSolverJson } from "../../toy/artifact";
import { hashJson, prettyJson, sha256 } from "../../preflop-v2/corpus";
import { FORMATION_BUDGETS as B, FORMATION_INPUTS, FORMATION_ROOT, buildFormationManifest, formationSpot, formationPlan, formationBoard, formationDefinition } from "./fixtures";
import { checkFormationResult, verifyDataFile, FORMATION_LABEL } from "./library";
import { portableFileTotals, portableGzip, COMPRESSION_PROFILE } from "./portable-compression";
import { FULL_REACH_URL, encodeFullReachNode, splitFullReachChunks, validateFullReachParts, auditFullReachChunks, type FullReachChunk, type FullReachContext } from "./full-reach-v2";

export const V2_FORMATION = "co-btn-srp-v1", V2_DIRECTORY = `public/solver-data/bridge-formations-v2/${V2_FORMATION}`;
export const v2Roots = () => buildFormationManifest().roots.filter(r => r.formation === V2_FORMATION);
export type V2Root = ReturnType<typeof v2Roots>[number];
export interface FullReachPartRef extends BridgeLibraryFileRef { key: string; part: number; nodes: number }
export interface FullReachEntry extends Omit<BridgeLibrarySpot, "chunks"> { chunks: FullReachPartRef[] }
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const rootValue = (root: BridgeResultV1["root"], p: 0 | 1) => root.weights[p].reduce((sum, w, h) => sum + w * root.ev[p][h], 0) / root.weights[p].reduce((sum, w) => sum + w, 0);
export const stableV2Grade = (g: ReturnType<typeof gradeRiverSubgame>) => ({ path: g.path, board: g.board, handsInPlay: g.handsInPlay,
  deals: g.deals, publicNodes: g.publicNodes, pot: g.pot, ours: g.ours, theirs: g.theirs, localExploitabilityPctPot: g.localExploitabilityPctPot,
  reachMass: g.reachMass, maxColumnSumError: g.maxColumnSumError });
export interface V2Referee { ref: BridgeLibraryFileRef; spotId: string; grade: ReturnType<typeof stableV2Grade> }
const contextFor = (spec: V2Root): FullReachContext => {
  const spot = formationSpot(V2_FORMATION, spec.boardId);
  return { id: spec.id, spotHash: spec.spotHash, flop: spot.board.flop, effectiveStack: spot.effectiveStack,
    ranges: { hands: [spot.ranges[0].combos.map(c => c.combo), spot.ranges[1].combos.map(c => c.combo)],
      weights: [spot.ranges[0].combos.map(c => c.weight), spot.ranges[1].combos.map(c => c.weight)] } };
};
function coverage(chunks: readonly FullReachChunk[], spec: V2Root) {
  const plan = formationPlan(V2_FORMATION, spec.boardId);
  for (const key of ["flop", ...plan.turn!.cards.map(t => `turn-${t}`)]) assert.ok(chunks.some(c => c.key === key), `missing ${key}`);
  for (const pair of plan.river!.boards) assert.ok(chunks.some(c => c.key.startsWith(`river-${pair.join("")}-`)), "missing river board");
  for (const chunk of chunks) for (const n of chunk.nodes) {
    if (n.street === "turn") assert.ok(plan.turn!.cards.includes(n.board[3] as never));
    if (n.street === "river") assert.ok(plan.river!.boards.some(p => p[0] === n.board[3] && p[1] === n.board[4]));
  }
}
export function encodeFullReachSpot(spec: V2Root, input: unknown, solveMs: number, peakRssBytes: number) {
  const spot = formationSpot(V2_FORMATION, spec.boardId), plan = formationPlan(V2_FORMATION, spec.boardId);
  const result = checkFormationResult(spot, plan, input), context = contextFor(spec), definition = formationBoard(V2_FORMATION, spec.boardId);
  assert.ok(solveMs > 0 && solveMs <= B.perSolveMs && peakRssBytes > 0 && peakRssBytes <= B.rssBytes);
  const prefix = `${FULL_REACH_URL}${V2_FORMATION}/${spec.id}/${spec.spotHash}/`, files = new Map<string, string>();
  const add = (name: string, value: unknown, cap = B.fileBytes): BridgeLibraryFileRef => {
    const text = typeof value === "string" ? value : canonicalSolverJson(value), url = prefix + name;
    assert.ok(Buffer.byteLength(text) <= cap, `${name} size gate`); assert.ok(!files.has(url)); files.set(url, text);
    return { url, bytes: Buffer.byteLength(text), sha256: sha256(text) };
  };
  const chunks = splitFullReachChunks(result.slices!.nodes.map(encodeFullReachNode), context); validateFullReachParts(chunks, context); coverage(chunks, spec);
  const refs = chunks.map(c => ({ ...add(`${c.key}.part-${String(c.part).padStart(3, "0")}.json`, c), key: c.key, part: c.part, nodes: c.nodes.length }));
  const invariants = auditFullReachChunks(chunks, context.ranges, spot); assert.deepEqual(invariants.failures, []);
  assert.ok(invariants.reachChecked > 0 && invariants.opponentEvChecked > 0 && invariants.reachSkipped === 0);
  const entry: FullReachEntry = { id: spec.id, spotHash: spec.spotHash, slicePlanHash: spec.planHash, flop: spot.board.flop,
    texture: definition.texture, descriptor: flopDescriptor(definition), spot: add("spot.json", canonicalBridgeSpotJson(spot)),
    root: add("root.json", { format: "poker-face-formation-root", version: 2, spotId: spec.id, spotHash: spec.spotHash,
      roles: formationDefinition(V2_FORMATION).players, rangesHash: hashJson(spot.ranges), hands: result.hands, root: result.root }),
    engine: { precision: "float32", threads: B.threads }, iterations: result.iterations, exploitability: { chips: result.exploitability.chips, pctPot: result.exploitability.pctPot },
    value: [rootValue(result.root, 0), rootValue(result.root, 1)], solveMs: Math.round(solveMs), peakRssBytes,
    turnCards: definition.turnCards, riverBoards: definition.riverBoards, chunks: refs };
  let referee: V2Referee | null = null;
  if (spec.benchmark) {
    assert.equal(result.slices!.subtrees.length, 1);
    const subtree = result.slices!.subtrees[0], grade = stableV2Grade(gradeRiverSubgame({ hands: result.hands, startingPot: spot.startingPot, subtree }));
    near(grade.ours.value[0], grade.theirs.value[0], .01);
    referee = { spotId: spec.id, grade, ref: add("referee.json", { format: "poker-face-formation-referee", version: 2,
      spotId: spec.id, spotHash: spec.spotHash, hands: result.hands, startingPot: spot.startingPot, subtree }, B.refereeBytes) };
  }
  return { entry, referee, files, invariants };
}
export interface FullReachManifest {
  format: "poker-face-formation-library"; version: 2; formation: string; corpusHash: string;
  provenance: { label: string; ranges: string; engineCommit: string; engineLicense: string };
  sourceHashes: Record<string, string>; generationRecordHash: string; reproductionRecordHash: string;
  encoding: { reach: "native-f32"; strategy: number; ev: number; equity: number };
  compression: typeof COMPRESSION_PROFILE; spots: FullReachEntry[]; referee: V2Referee;
  totals: ReturnType<typeof portableFileTotals>; payloadHash: string;
}
export const FULL_REACH_ENCODING = { reach: "native-f32" as const, strategy: STRATEGY_SCALE, ev: EV_SCALE, equity: EQUITY_SCALE };
export const FULL_REACH_PROVENANCE = { label: FORMATION_LABEL, ranges: FORMATION_INPUTS.rangeProvenance, engineCommit: POSTFLOP_SOLVER_COMMIT, engineLicense: "AGPL-3.0" };

/** Manifest references bind every physical part; trailing omissions cannot pass. */
export function checkFullReachReferences(chunks: readonly FullReachChunk[], refs: readonly FullReachPartRef[], context: FullReachContext) {
  assert.equal(chunks.length, refs.length); const urls = new Set<string>();
  chunks.forEach((c, i) => {
    const ref = refs[i], text = canonicalSolverJson(c);
    assert.ok(!urls.has(ref.url)); urls.add(ref.url);
    assert.equal(ref.key, c.key); assert.equal(ref.part, c.part); assert.equal(ref.nodes, c.nodes.length);
    assert.equal(ref.bytes, Buffer.byteLength(text)); assert.equal(ref.sha256, sha256(text));
  });
  validateFullReachParts(chunks, context);
}

export function auditFullReachLibrary(directory: string, sourceHashes: Record<string, string>) {
  const text = readFileSync(join(directory, "manifest.json"), "utf8"), m: FullReachManifest = JSON.parse(text);
  const { payloadHash, ...payload } = m; assert.equal(payloadHash, hashJson(payload)); assert.equal(text, prettyJson(m));
  assert.ok(Buffer.byteLength(text) <= B.fileBytes); assert.equal(m.format, "poker-face-formation-library"); assert.equal(m.version, 2);
  assert.equal(m.formation, V2_FORMATION); assert.equal(m.corpusHash, buildFormationManifest().payloadHash);
  assert.deepEqual(m.encoding, FULL_REACH_ENCODING); assert.deepEqual(m.compression, COMPRESSION_PROFILE);
  assert.deepEqual(m.provenance, FULL_REACH_PROVENANCE); assert.deepEqual(m.sourceHashes, sourceHashes);
  assert.match(m.generationRecordHash, /^[a-f0-9]{64}$/); assert.match(m.reproductionRecordHash, /^[a-f0-9]{64}$/);
  const specs = v2Roots(); assert.deepEqual(m.spots.map(s => s.id), specs.map(s => s.id));
  const files = new Map<string, string>(), prefix = `${FULL_REACH_URL}${V2_FORMATION}/`;
  const read = (ref: BridgeLibraryFileRef, cap = B.fileBytes) => {
    assert.ok(ref.url.startsWith(prefix) && !ref.url.includes("..") && /^[a-zA-Z0-9/_.-]+$/.test(ref.url));
    assert.ok(!files.has(ref.url), "duplicate file reference");
    const value = verifyDataFile(readFileSync(join(directory, ref.url.slice(prefix.length))), ref, prefix, cap); files.set(ref.url, value);
    return JSON.parse(value);
  };
  const reports = m.spots.map((entry, i) => {
    const spec = specs[i], context = contextFor(spec), spot = formationSpot(V2_FORMATION, spec.boardId), definition = formationBoard(V2_FORMATION, spec.boardId);
    assert.equal(entry.spotHash, spec.spotHash); assert.equal(entry.slicePlanHash, spec.planHash);
    assert.deepEqual(entry.flop, spot.board.flop); assert.equal(entry.texture, definition.texture); assert.deepEqual(entry.descriptor, flopDescriptor(definition));
    assert.deepEqual(entry.engine, { precision: "float32", threads: 8 });
    assert.ok(Number.isInteger(entry.iterations) && entry.iterations > 0 && entry.iterations <= B.iterations);
    assert.ok(entry.solveMs > 0 && entry.solveMs <= B.perSolveMs && entry.peakRssBytes > 0 && entry.peakRssBytes <= B.rssBytes);
    assert.ok(entry.exploitability.pctPot >= 0 && entry.exploitability.pctPot <= B.gatePctPot); near(entry.exploitability.pctPot, entry.exploitability.chips / spot.startingPot * 100);
    assert.deepEqual(entry.turnCards, definition.turnCards); assert.deepEqual(entry.riverBoards, definition.riverBoards);
    const base = `${prefix}${spec.id}/${spec.spotHash}/`;
    assert.equal(entry.spot.url, `${base}spot.json`); assert.equal(entry.root.url, `${base}root.json`);
    assert.deepEqual(read(entry.spot), spot); assert.equal(entry.spot.sha256, spec.spotHash);
    const chunks: FullReachChunk[] = entry.chunks.map(ref => {
      assert.equal(ref.url, `${base}${ref.key}.part-${String(ref.part).padStart(3, "0")}.json`); return read(ref);
    });
    checkFullReachReferences(chunks, entry.chunks, context); coverage(chunks, spec);
    const root: { format: string; version: number; spotId: string; spotHash: string; roles: string[]; rangesHash: string; hands: BridgeResultV1["hands"]; root: BridgeResultV1["root"] } = read(entry.root);
    assert.equal(root.format, "poker-face-formation-root"); assert.equal(root.version, 2); assert.equal(root.spotId, spec.id); assert.equal(root.spotHash, spec.spotHash);
    assert.equal(root.rangesHash, hashJson(spot.ranges)); assert.deepEqual(root.roles, formationDefinition(V2_FORMATION).players); assert.deepEqual(root.hands, context.ranges.hands);
    const node = chunks.flatMap(c => c.nodes).find(n => n.path === "")!;
    for (const p of [0, 1] as const) {
      for (const key of ["ev", "engineEv", "equity", "weights"] as const) {
        assert.equal(root.root[key][p].length, context.ranges.hands[p].length); assert.ok(root.root[key][p].every(Number.isFinite));
      }
      near(rootValue(root.root, p), entry.value[p]);
      node.live[p].forEach((h, i) => {
        if (node.ev[p][i] !== null) near(node.ev[p][i]!, Math.round((root.root.ev[p][h] + spot.startingPot / 2) * EV_SCALE), 1);
        if (node.equity[p][i] !== null) near(node.equity[p][i]!, Math.round(root.root.equity[p][h] * EQUITY_SCALE), 1);
      });
    }
    const report = auditFullReachChunks(chunks, context.ranges, spot); assert.deepEqual(report.failures, []);
    assert.ok(report.reachChecked > 0 && report.opponentEvChecked > 0 && report.reachSkipped === 0); return { id: spec.id, ...report };
  });
  const benchmark = specs.find(r => r.benchmark)!;
  assert.equal(m.referee.spotId, benchmark.id); assert.equal(m.referee.ref.url, `${prefix}${benchmark.id}/${benchmark.spotHash}/referee.json`);
  const sample: { format: string; version: number; spotId: string; spotHash: string; hands: BridgeResultV1["hands"]; startingPot: number; subtree: BridgeSubtree } = read(m.referee.ref, B.refereeBytes);
  assert.equal(sample.format, "poker-face-formation-referee"); assert.equal(sample.version, 2); assert.equal(sample.spotId, benchmark.id); assert.equal(sample.spotHash, benchmark.spotHash);
  assert.equal(sample.startingPot, formationDefinition(V2_FORMATION).startingPot);
  assert.deepEqual(sample.hands, contextFor(benchmark).ranges.hands);
  const grade = stableV2Grade(gradeRiverSubgame(sample)); near(grade.ours.value[0], grade.theirs.value[0], .01);
  for (const p of [0, 1] as const) { near(grade.ours.value[p], m.referee.grade.ours.value[p]); near(grade.ours.gains[p], m.referee.grade.ours.gains[p]); }
  near(grade.ours.exploitability, m.referee.grade.ours.exploitability); assert.deepEqual(grade.path, m.referee.grade.path); assert.equal(grade.deals, m.referee.grade.deals);
  const totals = portableFileTotals(files); assert.deepEqual(totals, m.totals); assert.ok(totals.gzipBytes + portableGzip(text).length <= B.gzipPerFormationBytes);
  const legacyRaw = readdirSync(FORMATION_ROOT).reduce((n, name) => {
    const raw = readFileSync(join(FORMATION_ROOT, name, "manifest.json")); return n + JSON.parse(raw.toString()).totals.rawBytes + raw.length;
  }, 0);
  assert.ok(legacyRaw + totals.rawBytes + Buffer.byteLength(text) <= B.allRawBytes);
  const onDisk = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => relative(directory, join(e.parentPath, e.name))).sort();
  assert.deepEqual(onDisk, ["manifest.json", ...[...files.keys()].map(p => p.slice(prefix.length))].sort());
  return { spots: reports, referee: grade, totals, combinedRawBytes: legacyRaw + totals.rawBytes + Buffer.byteLength(text), payloadHash };
}
