/** Node-only saved formation data: complete publication gates, partial-policy provenance. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalSlicePlan } from "../../../../../scripts/bridge-runner";
import { parseLiveEstimate } from "../live/admission";
import { checkBridgeResult, POSTFLOP_SOLVER_COMMIT, type BridgeSpotV1, type BridgeResultV1, type BridgeSlicePlanV1, type BridgeSubtree } from "../contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../contract-node";
import { encodeSliceNode } from "../library/encode";
import { auditLibrarySpot } from "../library/invariants";
import { libraryRangesFromSpot, validateLibraryChunk } from "../library/load";
import { flopDescriptor, type LibraryFlopDefinition } from "../library/spots";
import { BRIDGE_LIBRARY_CHUNK_FORMAT, chunkKeyForNode, EV_SCALE, EQUITY_SCALE, REACH_SCALE, STRATEGY_SCALE,
  type BridgeLibraryChunk, type BridgeLibraryChunkRef, type BridgeLibraryFileRef, type BridgeLibraryNode, type BridgeLibrarySpot } from "../library/model";
import { gradeRiverSubgame } from "../subgame-referee";
import { hashJson, prettyJson, sha256 } from "../../preflop-v2/corpus";
import { FORMATION_BUDGETS as B, FORMATION_INPUTS, FORMATION_URL, FORMATION_SOURCES, formationDefinition, formationSpot, formationPlan, buildFormationManifest } from "./fixtures";

export const FORMATION_LIBRARY_SOURCES = [...FORMATION_SOURCES, "src/lib/solver/bridge/formations/manifest.json",
  "src/lib/solver/bridge/formations/library.ts", "scripts/build-formation-libraries.ts", "scripts/bridge-runner.ts",
  "src/lib/solver/bridge/library/model.ts", "src/lib/solver/bridge/library/encode.ts", "src/lib/solver/bridge/library/load.ts",
  "src/lib/solver/bridge/library/invariants.ts", "src/lib/solver/bridge/subgame-referee.ts", "src/lib/solver/preflop-v2/preflight.ts"];
export const formationSourceHashes = () => Object.fromEntries(FORMATION_LIBRARY_SOURCES.map(p => [p, sha256(readFileSync(p))]));

export const FORMATION_LABEL = "Approximate strategies for specified finite postflop games, not exact or universal GTO. Ranges are hand-written teaching assumptions, not solved preflop play. The reported whole-game exploitability grades the complete unrounded native policy; rounded partial saved slices are not separately certified. Local re-solving is not a global guarantee.";
export function formationReservation(spot: BridgeSpotV1, raw: string) {
  assert.equal(spot.solve.compression, "off", "float32 required");
  const e = parseLiveEstimate(raw, spot, hashBridgeSpot(spot));
  const reservedBytes = e.estimatedBytes + e.estimateExport.workingBytesEstimate + B.sliceWorkingBytes;
  assert.ok(Number.isSafeInteger(reservedBytes));
  return { engineBytes: e.estimatedBytes, firstStreetExportBytes: e.estimateExport.workingBytesEstimate,
    sliceWorkingBytes: B.sliceWorkingBytes, reservedBytes, admitted: reservedBytes <= Math.min(B.reservationBytes, spot.solve.memoryCapBytes) };
}
export function checkFormationResult(spot: BridgeSpotV1, plan: BridgeSlicePlanV1, input: unknown): BridgeResultV1 {
  const r = checkBridgeResult(input, spot, hashBridgeSpot(spot));
  assert.equal(r.engine.precision, "float32"); assert.equal(r.engine.threads, B.threads);
  assert.ok(r.exploitability.reached && r.exploitability.pctPot <= Math.min(B.gatePctPot, spot.solve.targetExploitabilityPctPot), "quality gate missed");
  assert.ok(r.iterations <= Math.min(B.iterations, spot.solve.maxIterations));
  assert.ok(r.timings.totalMs <= Math.min(B.perSolveMs, spot.solve.timeoutMs)); assert.ok(r.memory.peakRssBytes <= B.rssBytes);
  assert.equal(r.slices?.planHash, canonicalSlicePlan(plan, spot).hash, "slice plan mismatch");
  assert.deepEqual(r.slices!.unreached, [], "planned cards must all be covered");
  assert.equal(r.slices!.subtrees.length, plan.subtrees.length);
  return r;
}
export function verifyDataFile(bytes: Buffer, ref: BridgeLibraryFileRef, prefix: string, cap = B.fileBytes): string {
  assert.ok(typeof ref.url === "string" && ref.url.startsWith(prefix) && /^[a-zA-Z0-9/_.-]+$/.test(ref.url) && !ref.url.includes(".."), "file outside formation namespace");
  assert.ok(Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= cap, "file exceeds size gate");
  assert.equal(bytes.length, ref.bytes); assert.equal(sha256(bytes), ref.sha256); return bytes.toString("utf8");
}
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const rootValue = (result: Pick<BridgeResultV1, "root">, p: 0 | 1) => {
  const w = result.root.weights[p]; return w.reduce((n, x, i) => n + x * result.root.ev[p][i], 0) / w.reduce((n, x) => n + x, 0);
};
const stableGrade = (g: ReturnType<typeof gradeRiverSubgame>) => ({ path: g.path, board: g.board, handsInPlay: g.handsInPlay,
  deals: g.deals, publicNodes: g.publicNodes, pot: g.pot, ours: g.ours, theirs: g.theirs, localExploitabilityPctPot: g.localExploitabilityPctPot,
  reachMass: g.reachMass, maxColumnSumError: g.maxColumnSumError });
export type FormationReferee = { ref: BridgeLibraryFileRef; spotId: string; grade: ReturnType<typeof stableGrade> };
export interface FormationRootFile { format: "poker-face-formation-root"; version: 1; spotId: string; spotHash: string;
  roles: readonly string[]; rangesHash: string; hands: BridgeResultV1["hands"]; root: BridgeResultV1["root"] }

export function encodeFormationSpot(formation: string, definition: LibraryFlopDefinition, spot: BridgeSpotV1,
  plan: BridgeSlicePlanV1, input: unknown, solveMs: number, peakRssBytes: number) {
  const result = checkFormationResult(spot, plan, input), f = formationDefinition(formation), spotHash = hashBridgeSpot(spot);
  assert.equal(definition.id, spot.id); assert.deepEqual(definition.flop, spot.board.flop);
  assert.ok(solveMs >= 0 && solveMs <= B.perSolveMs && peakRssBytes >= 0 && peakRssBytes <= B.rssBytes);
  const prefix = `${FORMATION_URL}${formation}/${spot.id}/${spotHash}/`, files = new Map<string, string>();
  const add = (name: string, text: string, cap = B.fileBytes) => {
    assert.ok(Buffer.byteLength(text) <= cap, `${name} exceeds file size gate`); const url = prefix + name;
    assert.ok(!files.has(url)); files.set(url, text); return { url, bytes: Buffer.byteLength(text), sha256: sha256(text) };
  };
  const groups = new Map<string, BridgeLibraryNode[]>(), seen = new Set<string>();
  for (const raw of result.slices!.nodes) {
    const node = encodeSliceNode(raw); assert.ok(!seen.has(node.path), "duplicate saved decision"); seen.add(node.path);
    const key = chunkKeyForNode(node); (groups.get(key) ?? groups.set(key, []).get(key)!).push(node);
  }
  for (const key of ["flop", ...definition.turnCards.map(c => `turn-${c}`)]) assert.ok(groups.has(key), `missing ${key}`);
  for (const pair of definition.riverBoards) assert.ok([...groups.keys()].some(k => k.startsWith(`river-${pair.join("")}-`)), `missing river ${pair}`);
  const chunks: Record<string, BridgeLibraryChunkRef> = {}, decoded: BridgeLibraryChunk[] = [];
  for (const [key, nodes] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    assert.ok(nodes.length > 0 && nodes.length <= 200);
    const chunk: BridgeLibraryChunk = { format: BRIDGE_LIBRARY_CHUNK_FORMAT, version: 1, spotId: spot.id, spotHash, key, nodes };
    chunks[key] = { ...add(`${key}.json`, JSON.stringify(chunk)), nodes: nodes.length }; decoded.push(chunk);
  }
  const root: FormationRootFile = { format: "poker-face-formation-root", version: 1, spotId: spot.id, spotHash,
    roles: f.players, rangesHash: hashJson(spot.ranges), hands: result.hands, root: result.root };
  const descriptor = flopDescriptor(definition);
  const entry: BridgeLibrarySpot = { id: spot.id, flop: spot.board.flop, texture: definition.texture, spotHash,
    slicePlanHash: canonicalSlicePlan(plan, spot).hash, spot: add("spot.json", canonicalBridgeSpotJson(spot)), root: add("root.json", JSON.stringify(root)),
    descriptor, engine: { precision: "float32", threads: B.threads }, iterations: result.iterations,
    exploitability: { chips: result.exploitability.chips, pctPot: result.exploitability.pctPot },
    value: [rootValue(result, 0), rootValue(result, 1)], solveMs: Math.round(solveMs), peakRssBytes,
    turnCards: definition.turnCards, riverBoards: definition.riverBoards, chunks };
  const ranges = libraryRangesFromSpot(spot, entry);
  decoded.forEach(c => validateLibraryChunk(c, entry, c.key, ranges));
  const invariants = auditLibrarySpot(decoded, ranges, spot);
  assert.deepEqual(invariants.failures, []); assert.ok(invariants.reachChecked > 0 && invariants.opponentEvChecked > 0);
  let referee: FormationReferee | null = null;
  if (plan.subtrees.length) {
    assert.equal(plan.subtrees.length, 1); const subtree = result.slices!.subtrees[0];
    const grade = gradeRiverSubgame({ hands: result.hands, startingPot: spot.startingPot, subtree });
    near(grade.ours.value[0], grade.theirs.value[0], .01);
    referee = { ref: add("referee.json", JSON.stringify({ format: "poker-face-formation-referee", version: 1,
      spotId: spot.id, spotHash, hands: result.hands, startingPot: spot.startingPot, subtree }), B.refereeBytes), spotId: spot.id, grade: stableGrade(grade) };
  }
  return { files, entry, invariants, referee };
}
export interface FormationLibraryManifest {
  format: "poker-face-formation-library"; version: 1; formation: string; corpusHash: string;
  provenance: { label: string; ranges: string; engineCommit: string; engineLicense: string };
  sourceHashes: Record<string, string>; generationRecordHash: string; reproductionRecordHash: string;
  quantization: { reach: number; strategy: number; ev: number; equity: number };
  spots: BridgeLibrarySpot[]; referee: FormationReferee;
  totals: { files: number; rawBytes: number; gzipBytes: number }; payloadHash: string;
}
export function fileTotals(files: ReadonlyMap<string, string>) {
  let rawBytes = 0, gzipBytes = 0;
  for (const text of files.values()) { rawBytes += Buffer.byteLength(text); gzipBytes += gzipSync(text, { level: 9 }).length; }
  return { files: files.size, rawBytes, gzipBytes };
}

/** Audits all saved bytes, every decision invariant and the full-precision local referee. */
export function auditFormationLibrary(directory: string, formation: string) {
  const f = formationDefinition(formation), corpus = buildFormationManifest(), prefix = `${FORMATION_URL}${formation}/`;
  const manifestText = readFileSync(join(directory, "manifest.json"), "utf8"), m: FormationLibraryManifest = JSON.parse(manifestText);
  assert.ok(Buffer.byteLength(manifestText) <= B.fileBytes);
  const { payloadHash, ...payload } = m; assert.equal(payloadHash, hashJson(payload)); assert.equal(manifestText, prettyJson(m));
  assert.equal(m.format, "poker-face-formation-library"); assert.equal(m.version, 1); assert.equal(m.formation, formation);
  assert.equal(m.corpusHash, corpus.payloadHash); assert.equal(m.provenance.label, FORMATION_LABEL);
  assert.equal(m.provenance.ranges, FORMATION_INPUTS.rangeProvenance); assert.equal(m.provenance.engineCommit, POSTFLOP_SOLVER_COMMIT);
  assert.equal(m.provenance.engineLicense, "AGPL-3.0");
  assert.deepEqual(m.quantization, { reach: REACH_SCALE, strategy: STRATEGY_SCALE, ev: EV_SCALE, equity: EQUITY_SCALE });
  assert.deepEqual(m.sourceHashes, formationSourceHashes(), "complete source identity required");
  assert.match(m.generationRecordHash, /^[0-9a-f]{64}$/); assert.match(m.reproductionRecordHash, /^[0-9a-f]{64}$/);
  const expected = corpus.roots.filter(r => r.formation === formation); assert.equal(m.spots.length, 12);
  assert.deepEqual(m.spots.map(s => s.id), expected.map(r => r.id));
  const files = new Map<string, string>();
  const read = (ref: BridgeLibraryFileRef, cap = B.fileBytes) => {
    assert.ok(!files.has(ref.url), "duplicate file reference");
    // Validate namespace before forming a filesystem path.
    assert.ok(ref.url.startsWith(prefix) && !ref.url.includes("..") && /^[a-zA-Z0-9/_.-]+$/.test(ref.url), "invalid path");
    const value = verifyDataFile(readFileSync(join(directory, ref.url.slice(prefix.length))), ref, prefix, cap);
    files.set(ref.url, value); return JSON.parse(value);
  };
  const reports = m.spots.map((entry, i) => {
    const spec = expected[i], spot = formationSpot(formation, spec.boardId), plan = formationPlan(formation, spec.boardId);
    assert.equal(entry.spotHash, spec.spotHash); assert.equal(entry.slicePlanHash, spec.planHash);
    assert.deepEqual(entry.flop, spot.board.flop); assert.equal(entry.engine.precision, "float32"); assert.equal(entry.engine.threads, 8);
    assert.ok(entry.iterations > 0 && entry.iterations <= B.iterations && entry.solveMs >= 0 && entry.solveMs <= B.perSolveMs);
    assert.ok(entry.peakRssBytes > 0 && entry.peakRssBytes <= B.rssBytes);
    assert.ok(entry.exploitability.pctPot >= 0 && entry.exploitability.pctPot <= B.gatePctPot);
    near(entry.exploitability.pctPot, entry.exploitability.chips / spot.startingPot * 100);
    assert.equal(entry.spot.url, `${prefix}${spot.id}/${spec.spotHash}/spot.json`); assert.equal(entry.root.url, `${prefix}${spot.id}/${spec.spotHash}/root.json`);
    assert.deepEqual(read(entry.spot), spot); assert.equal(entry.spot.sha256, spec.spotHash);
    assert.deepEqual(entry.turnCards, plan.turn!.cards); assert.deepEqual(entry.riverBoards, plan.river!.boards);
    const ranges = libraryRangesFromSpot(spot, entry);
    const chunks = Object.entries(entry.chunks).map(([key, ref]) => {
      assert.equal(ref.url, `${prefix}${spot.id}/${spec.spotHash}/${key}.json`);
      return validateLibraryChunk(read(ref), entry, key, ranges);
    });
    for (const key of ["flop", ...entry.turnCards.map(t => `turn-${t}`)]) assert.ok(chunks.some(c => c.key === key), `missing ${key}`);
    for (const pair of entry.riverBoards) assert.ok(chunks.some(c => c.key.startsWith(`river-${pair.join("")}-`)));
    const all = chunks.flatMap(c => c.nodes); assert.equal(new Set(all.map(n => n.path)).size, all.length);
    const root: FormationRootFile = read(entry.root);
    assert.equal(root.format, "poker-face-formation-root"); assert.equal(root.version, 1); assert.equal(root.spotId, spot.id); assert.equal(root.spotHash, spec.spotHash);
    assert.equal(root.rangesHash, hashJson(spot.ranges)); assert.deepEqual(root.roles, f.players); assert.deepEqual(root.hands, ranges.hands);
    const node = all.find(n => n.path === ""); assert.ok(node);
    for (const p of [0, 1] as const) {
      for (const key of ["ev", "engineEv", "equity", "weights"] as const) {
        assert.equal(root.root[key][p].length, ranges.hands[p].length); assert.ok(root.root[key][p].every(Number.isFinite));
      }
      near(rootValue(root, p), entry.value[p]);
      node.live[p].forEach((h, i) => {
        if (node.ev[p][i] !== null) near(node.ev[p][i]!, Math.round((root.root.ev[p][h] + spot.startingPot / 2) * EV_SCALE), 1);
        if (node.equity[p][i] !== null) near(node.equity[p][i]!, Math.round(root.root.equity[p][h] * EQUITY_SCALE), 1);
      });
    }
    const report = auditLibrarySpot(chunks, ranges, spot); assert.deepEqual(report.failures, []);
    assert.ok(report.reachChecked > 0 && report.opponentEvChecked > 0); return { id: entry.id, pctPot: entry.exploitability.pctPot, ...report };
  });
  const benchmark = expected.find(r => r.benchmark)!;
  assert.equal(m.referee.ref.url, `${prefix}${benchmark.id}/${benchmark.spotHash}/referee.json`);
  const sample: { format: string; version: number; spotId: string; spotHash: string; hands: BridgeResultV1["hands"]; startingPot: number; subtree: BridgeSubtree } = read(m.referee.ref, B.refereeBytes);
  assert.equal(m.referee.spotId, benchmark.id); assert.equal(sample.spotId, benchmark.id); assert.equal(sample.spotHash, benchmark.spotHash);
  assert.equal(sample.format, "poker-face-formation-referee"); assert.equal(sample.version, 1); assert.equal(sample.startingPot, f.startingPot);
  const grade = stableGrade(gradeRiverSubgame(sample));
  near(grade.ours.value[0], grade.theirs.value[0], .01);
  for (const p of [0, 1] as const) { near(grade.ours.value[p], m.referee.grade.ours.value[p]); near(grade.ours.gains[p], m.referee.grade.ours.gains[p]); }
  near(grade.ours.exploitability, m.referee.grade.ours.exploitability);
  assert.deepEqual(grade.path, m.referee.grade.path); assert.equal(grade.deals, m.referee.grade.deals);
  const totals = fileTotals(files); assert.deepEqual(totals, m.totals);
  assert.ok(totals.rawBytes <= B.allRawBytes && totals.gzipBytes + gzipSync(manifestText, { level: 9 }).length <= B.gzipPerFormationBytes);
  const onDisk = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => relative(directory, join(e.parentPath, e.name))).sort();
  assert.deepEqual(onDisk, ["manifest.json", ...files.keys()].map(p => p.startsWith(prefix) ? p.slice(prefix.length) : p).sort());
  return { formation, spots: reports, referee: grade, totals, payloadHash };
}
