/** Node-only, prospective manual inputs. These are not validated preflop ranges. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import inputs from "./inputs.json";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import { isRiverCard, type RiverCard } from "../../river/cards";
import { BRIDGE_SPOT_FORMAT, canonicalBridgeCombo, compareBridgeCombos, validateBridgeSpot, type BridgeSpotV1 } from "../contract";
import { hashBridgeSpot } from "../contract-node";
import { LEAN_SRP_TREE } from "../fixtures";
import { librarySlicePlan, type LibraryFlopDefinition } from "../library/spots";
import { canonicalSlicePlan } from "../../../../../scripts/bridge-runner";
import { hashJson, sha256 } from "../../preflop-v2/corpus";

function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export const FORMATION_INPUTS = freeze(inputs);
export const FORMATION_BUDGETS = freeze({ reservationBytes: 12 * 1024 ** 3, sliceWorkingBytes: 512 * 1024 ** 2,
  rssBytes: 16 * 1024 ** 3, threads: 8, perSolveMs: 1_800_000, totalNativeMs: 8 * 3_600_000, iterations: 3000,
  gatePctPot: .3, fileBytes: 1024 ** 2, refereeBytes: 8 * 1024 ** 2, gzipPerFormationBytes: 40 * 1024 ** 2,
  allRawBytes: 512 * 1024 ** 2, cacheBytes: 1024 ** 3, rawResultBytes: 64 * 1024 ** 2 });
export const FORMATION_ROOT = "public/solver-data/bridge-formations-v1";
export const FORMATION_URL = "/solver-data/bridge-formations-v1/";
export const FORMATION_CONTRACT = "tasks/artifacts/formation-libraries-v1/contract.md";
export const FORMATION_SOURCES = ["src/lib/solver/bridge/formations/inputs.json", "src/lib/solver/bridge/formations/fixtures.ts",
  FORMATION_CONTRACT, "src/lib/solver/bridge/fixtures.ts", "src/lib/solver/bridge/contract.ts",
  "src/lib/solver/bridge/contract-node.ts", "src/lib/solver/bridge/library/spots.ts", "src/lib/solver/river/configurable/range.ts"] as const;
export function formationDefinition(id: string) {
  const f = FORMATION_INPUTS.formations.find(f => f.id === id); assert.ok(f, `unknown formation ${id}`); return f;
}
export function formationBoard(formation: string, boardId: string): LibraryFlopDefinition {
  formationDefinition(formation); const b = FORMATION_INPUTS.flops.find(b => b.id === boardId); assert.ok(b, `unknown board ${boardId}`);
  const card = (c: string): RiverCard => { assert.ok(isRiverCard(c)); return c; };
  assert.equal(b.flop.length, 3);
  return { id: `${formation}-${boardId.replace(/^srp-btn-bb-/, "")}`, flop: [card(b.flop[0]), card(b.flop[1]), card(b.flop[2])], texture: b.texture,
    turnCards: b.turnCards.map(card), riverBoards: b.riverBoards.map(r => { assert.equal(r.length, 2); return [card(r[0]), card(r[1])]; }) };
}
export function formationSpot(formation: string, boardId: string): BridgeSpotV1 {
  const f = formationDefinition(formation), b = formationBoard(formation, boardId);
  const ranges = f.rangeText.map((text, p) => ({ source: `${f.players[p]}. ${FORMATION_INPUTS.rangeProvenance}`,
    combos: parseConfigurableRiverRange(text, b.flop).entries.map(h => ({ combo: canonicalBridgeCombo(...h.cards), weight: h.weight }))
      .sort((a, b) => compareBridgeCombos(a.combo, b.combo)) }));
  const tree = structuredClone(LEAN_SRP_TREE);
  const menu = { ...tree, flop: { ...tree.flop!, ip: { ...tree.flop!.ip, bet: [{ kind: "pot" as const, pct: 33 }, { kind: "pot" as const, pct: 66 }] } } };
  return validateBridgeSpot({ format: BRIDGE_SPOT_FORMAT, version: 1, id: b.id, board: { flop: b.flop, turn: null, river: null },
    ranges: [ranges[0], ranges[1]], startingPot: f.startingPot, effectiveStack: f.effectiveStack, rake: 0, tree: menu,
    solve: { targetExploitabilityPctPot: .3, maxIterations: 3000, memoryCapBytes: FORMATION_BUDGETS.reservationBytes,
      timeoutMs: FORMATION_BUDGETS.perSolveMs, compression: "off", exportScope: "first-street" } });
}
export function formationPlan(formation: string, boardId: string) {
  const b = formationBoard(formation, boardId), benchmark = boardId === FORMATION_INPUTS.flops[0].id;
  return librarySlicePlan(b, benchmark ? [["x", "s1", "c", "Qh", "x", "s0", "c", "2c"]] : []);
}
export function buildFormationManifest() {
  assert.equal(FORMATION_INPUTS.formations.length, 3); assert.equal(FORMATION_INPUTS.flops.length, 12);
  const roots = FORMATION_INPUTS.formations.flatMap(f => FORMATION_INPUTS.flops.map(b => {
    const spot = formationSpot(f.id, b.id), plan = canonicalSlicePlan(formationPlan(f.id, b.id), spot);
    return { formation: f.id, boardId: b.id, id: spot.id, spotHash: hashBridgeSpot(spot), planHash: plan.hash,
      hands: spot.ranges.map(r => r.combos.length), benchmark: b.id === FORMATION_INPUTS.flops[0].id };
  }));
  const payload = { format: "poker-face-formation-corpus", version: 1, budgets: FORMATION_BUDGETS,
    sourceHashes: Object.fromEntries(FORMATION_SOURCES.map(p => [p, sha256(readFileSync(p))])), roots,
    benchmarks: roots.filter(r => r.benchmark).map(r => r.id),
    scope: "Hand-written teaching ranges; approximate finite postflop games; independent offline libraries; no PF4 promotion or play change." };
  return { ...payload, payloadHash: hashJson(payload) };
}
export type FormationCorpus = ReturnType<typeof buildFormationManifest>;
export function verifyFormationManifest(value: unknown): asserts value is FormationCorpus {
  assert.deepEqual(value, buildFormationManifest(), "formation corpus must reproduce without changing frozen inputs");
}
