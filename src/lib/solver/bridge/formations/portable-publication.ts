/** Read-only publication check; the frozen encoder and numerical gates are unchanged. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { portableGzip, portableFileTotals as fileTotals, COMPRESSION_PROFILE } from "./portable-compression";
import { POSTFLOP_SOLVER_COMMIT, type BridgeResultV1, type BridgeSubtree } from "../contract";
import { auditLibrarySpot } from "../library/invariants";
import { libraryRangesFromSpot, validateLibraryChunk } from "../library/load";
import { EV_SCALE, EQUITY_SCALE, REACH_SCALE, STRATEGY_SCALE, type BridgeLibraryFileRef } from "../library/model";
import { gradeRiverSubgame } from "../subgame-referee";
import { hashJson, prettyJson } from "../../preflop-v2/corpus";
import { FORMATION_BUDGETS as B, FORMATION_INPUTS, FORMATION_URL, formationDefinition, formationSpot, formationPlan, buildFormationManifest } from "./fixtures";
import { FORMATION_LABEL, formationSourceHashes, verifyDataFile, type FormationRootFile, type FormationLibraryManifest } from "./library";

/** Mirror Rust: f32 serialized as a short decimal, then f64::from(f32) / pot * 100. */
export function checkNativeGap(gap: { chips: number; pctPot: number }, pot: number) {
  assert.ok(Number.isFinite(pot) && pot > 0);
  assert.ok(Number.isFinite(gap.chips) && gap.chips >= 0);
  assert.ok(Number.isFinite(gap.pctPot) && gap.pctPot >= 0 && gap.pctPot <= B.gatePctPot);
  assert.equal(gap.pctPot, Math.fround(gap.chips) / pot * 100, "native float32 percentage differs");
}

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const rootValue = (result: Pick<BridgeResultV1, "root">, p: 0 | 1) => {
  const w = result.root.weights[p]; return w.reduce((n, x, i) => n + x * result.root.ev[p][i], 0) / w.reduce((n, x) => n + x, 0);
};
const stableGrade = (g: ReturnType<typeof gradeRiverSubgame>) => ({ path: g.path, board: g.board, handsInPlay: g.handsInPlay,
  deals: g.deals, publicNodes: g.publicNodes, pot: g.pot, ours: g.ours, theirs: g.theirs, localExploitabilityPctPot: g.localExploitabilityPctPot,
  reachMass: g.reachMass, maxColumnSumError: g.maxColumnSumError });

/** Audits all saved bytes, every decision invariant and the full-precision local referee. */
export function auditPublishedFormation(directory: string, formation: string) {
  const f = formationDefinition(formation), corpus = buildFormationManifest(), prefix = `${FORMATION_URL}${formation}/`;
  const manifestText = readFileSync(join(directory, "manifest.json"), "utf8"), m: FormationLibraryManifest & { compression: typeof COMPRESSION_PROFILE } = JSON.parse(manifestText);
  assert.ok(Buffer.byteLength(manifestText) <= B.fileBytes);
  const { payloadHash, ...payload } = m; assert.equal(payloadHash, hashJson(payload)); assert.equal(manifestText, prettyJson(m));
  assert.equal(m.format, "poker-face-formation-library"); assert.equal(m.version, 1); assert.equal(m.formation, formation);
  assert.equal(m.corpusHash, corpus.payloadHash); assert.equal(m.provenance.label, FORMATION_LABEL);
  assert.equal(m.provenance.ranges, FORMATION_INPUTS.rangeProvenance); assert.equal(m.provenance.engineCommit, POSTFLOP_SOLVER_COMMIT);
  assert.equal(m.provenance.engineLicense, "AGPL-3.0");
  assert.deepEqual(m.compression, COMPRESSION_PROFILE);
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
    checkNativeGap(entry.exploitability, spot.startingPot);
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
  assert.ok(totals.rawBytes <= B.allRawBytes && totals.gzipBytes + portableGzip(manifestText).length <= B.gzipPerFormationBytes);
  const onDisk = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => relative(directory, join(e.parentPath, e.name))).sort();
  assert.deepEqual(onDisk, ["manifest.json", ...files.keys()].map(p => p.startsWith(prefix) ? p.slice(prefix.length) : p).sort());
  return { formation, spots: reports, referee: grade, totals, payloadHash };
}
