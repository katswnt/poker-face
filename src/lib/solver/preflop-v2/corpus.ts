/** Node-only prospective research corpus. This module neither solves nor fits anything. */
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { COMBOS, classOfCards } from "../comboCounts";
import { HANDS } from "../hands";
import { ALL_FLOPS, TEXTURE_STRATA, cardName, parseCard, type TextureStratum } from "../preflop/texture";
import { LEAN_SRP_TREE } from "../bridge/fixtures";
import { LIBRARY_FLOPS } from "../bridge/library/spots";
import { BRIDGE_SPOT_FORMAT, compareBridgeCombos, validateBridgeSpot, type BridgeSpotV1 } from "../bridge/contract";
import { hashBridgeSpot } from "../bridge/contract-node";
import type { RiverCard } from "../river/cards";
import { canonicalSolverJson } from "../toy/artifact";

export const CORPUS_DIRECTORY = "src/lib/solver/preflop-v2";
const SOURCE_PATHS = [`${CORPUS_DIRECTORY}/frozen-contract.md`, "src/lib/solver/preflop/texture.ts",
  "src/lib/solver/bridge/fixtures.ts", "src/lib/solver/bridge/library/spots.ts", "src/lib/solver/hands.ts", "src/lib/solver/comboCounts.ts"] as const;
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const hashJson = (v: unknown) => sha256(canonicalSolverJson(v));
export const prettyJson = (v: unknown) => `${canonicalSolverJson(v, true)}\n`;
const GIB = 1024 ** 3;
export const VALIDATION_BUDGETS = Object.freeze({ estimatedAllocationAndExportBytes: 12 * GIB, peakRssBytes: 16 * GIB,
  threads: 8, perRootMs: 600_000, corpusSolveMs: 4 * 3_600_000, iterations: 5000, rawRecordBytes: GIB,
  referenceExploitabilityPctPot: 0.001, heldoutMaxErrorBb: 0.01, heldoutWeightedMaeBb: 0.002 });
export const POT_SETTINGS = Object.freeze({
  srp: { startingPot: 550, effectiveStack: 9750, paidPerPlayer: 250 },
  "3bp": { startingPot: 2250, effectiveStack: 8900, paidPerPlayer: 1100 },
  "4bp": { startingPot: 4850, effectiveStack: 7600, paidPerPlayer: 2400 },
});
type PotType = keyof typeof POT_SETTINGS;
type Profile = "A" | "B";
type Role = "legacy" | "calibration" | "holdout";
export interface FlopOrbit { readonly key: string; readonly cards: readonly [number, number, number]; readonly stratum: TextureStratum; readonly multiplicity: number }
interface CorpusBoard extends FlopOrbit { readonly role: Role }
export interface SelectionTranscript {
  readonly format: "poker-face-preflop-v2-selection"; readonly version: 1;
  readonly method: "crypto.randomInt-without-replacement";
  readonly populationHash: string; readonly contractHash: string;
  readonly strata: readonly { readonly stratum: TextureStratum; readonly eligibleOrbits: number; readonly draws: number[] }[];
}
export interface CorpusRoot {
  readonly id: string; readonly boardKey: string; readonly profile: Profile; readonly potType: PotType;
  readonly spotHash: string; readonly removedCombosPerPlayer: number;
}
export interface SymmetricHand { readonly cards: readonly [number, number]; readonly classIndex: number; readonly weight: number }
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const permutations = (xs: number[]): number[][] => xs.length === 0 ? [[]] : xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map(p => [x, ...p]));
const SUIT_PERMUTATIONS = permutations([0, 1, 2, 3]);

export function orbitKey(cards: readonly number[]): string {
  if (cards.length !== 3 || new Set(cards).size !== 3 || cards.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw new Error("invalid flop");
  let key = "99-99-99";
  for (const permutation of SUIT_PERMUTATIONS) {
    const candidate = cards.map(c => 4 * (c >> 2) + permutation[c & 3]).sort((a, b) => a - b).map(c => String(c).padStart(2, "0")).join("-");
    if (candidate < key) key = candidate;
  }
  return key;
}

let cachedPopulation: readonly FlopOrbit[] | undefined;
export function flopPopulation(): readonly FlopOrbit[] {
  if (cachedPopulation) return cachedPopulation;
  const groups = new Map<string, { cards: [number, number, number]; stratum: TextureStratum; multiplicity: number }>();
  for (const flop of ALL_FLOPS) {
    const key = orbitKey(flop.cards), previous = groups.get(key);
    if (previous) { assert.equal(previous.stratum, flop.stratum, "texture must be invariant under all suit permutations"); previous.multiplicity++; }
    else groups.set(key, { cards: key.split("-").map(Number) as [number, number, number], stratum: flop.stratum, multiplicity: 1 });
  }
  cachedPopulation = Object.freeze([...groups].sort(([a], [b]) => lex(a, b)).map(([key, o]) => Object.freeze({ key, ...o, cards: Object.freeze(o.cards) })));
  assert.equal(cachedPopulation.length, 1755); assert.equal(cachedPopulation.reduce((s, o) => s + o.multiplicity, 0), 22100);
  return cachedPopulation;
}
function legacyKeys() { return new Set(LIBRARY_FLOPS.map(f => orbitKey(f.flop.map(parseCard)))); }
function eligible(stratum: TextureStratum) { const legacy = legacyKeys(); return flopPopulation().filter(o => o.stratum === stratum && !legacy.has(o.key)); }
function sourceHashes() { return Object.fromEntries(SOURCE_PATHS.map(path => [path, sha256(readFileSync(path))])); }

/** Called once by the explicit freeze command. Audits only replay the saved transcript. */
export function drawSelection(): SelectionTranscript {
  return { format: "poker-face-preflop-v2-selection", version: 1, method: "crypto.randomInt-without-replacement",
    populationHash: hashJson(flopPopulation()), contractHash: sha256(readFileSync(`${CORPUS_DIRECTORY}/frozen-contract.md`)),
    strata: TEXTURE_STRATA.map(stratum => {
      const count = eligible(stratum).length; if (count < 6) throw new Error("insufficient eligible orbits; contract cannot be satisfied");
      return { stratum, eligibleOrbits: count, draws: Array.from({ length: 6 }, (_, i) => randomInt(count - i)) };
    }),
  };
}

export function profileRange(profile: Profile, player: 0 | 1): SymmetricHand[] {
  if ((profile !== "A" && profile !== "B") || (player !== 0 && player !== 1)) throw new Error("unknown profile/player");
  return COMBOS.map(c => {
    const h = HANDS[c.cls], pair = h.type === "pair", suited = h.type === "suited", broadway = h.lo >= 10;
    const weight = profile === "A" ? (player === 0 || pair || h.hi === 14 || broadway ? 1 : 0.5)
      : player === 0 ? (pair || suited || broadway ? 1 : 0.5) : pair || (suited && h.hi === 14) ? 1 : 0.25;
    return { cards: [c.c1, c.c2], classIndex: c.cls, weight };
  });
}
export function validateSymmetricRange(range: readonly SymmetricHand[]): void {
  if (range.length !== 1326) throw new Error("suit reduction requires a complete class-constant range");
  const seen = new Set<string>(), weights = new Map<number, number>();
  for (const h of range) {
    const [a, b] = h.cards;
    if (h.cards.length !== 2 || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 51 || a >= b || classOfCards(a, b) !== h.classIndex)
      throw new Error("invalid canonical range hand/class");
    const key = `${a},${b}`; if (seen.has(key)) throw new Error("duplicate range hand"); seen.add(key);
    if (!Number.isFinite(h.weight) || h.weight <= 0 || h.weight > 1 || Math.fround(h.weight) !== h.weight) throw new Error("invalid float32 range weight");
    const old = weights.get(h.classIndex); if (old !== undefined && old !== h.weight) throw new Error("suit-asymmetric range cannot use orbit multiplicities");
    weights.set(h.classIndex, h.weight);
  }
}

function spotFor(root: Pick<CorpusRoot, "id" | "profile" | "potType">, board: CorpusBoard): BridgeSpotV1 {
  const flop = board.cards.map(c => cardName(c) as RiverCard) as [RiverCard, RiverCard, RiverCard], settings = POT_SETTINGS[root.potType];
  const ranges = ([0, 1] as const).map(player => {
    const range = profileRange(root.profile, player); validateSymmetricRange(range);
    const combos = range.filter(h => !h.cards.some(c => board.cards.includes(c))).map(h => ({
      combo: cardName(h.cards[1]) + cardName(h.cards[0]), weight: h.weight,
    })).sort((a, b) => compareBridgeCombos(a.combo, b.combo));
    assert.equal(combos.length, 1176);
    return { source: `Preflop v2 validation profile ${root.profile}, ${player === 0 ? "OOP" : "IP"}: hand-written stress distribution, not a playing range or solved preflop policy.`, combos };
  }) as unknown as BridgeSpotV1["ranges"];
  return validateBridgeSpot({ format: BRIDGE_SPOT_FORMAT, version: 1, id: root.id, board: { flop, turn: null, river: null },
    ranges, startingPot: settings.startingPot, effectiveStack: settings.effectiveStack, rake: 0, tree: LEAN_SRP_TREE,
    solve: { targetExploitabilityPctPot: VALIDATION_BUDGETS.referenceExploitabilityPctPot, maxIterations: VALIDATION_BUDGETS.iterations,
      memoryCapBytes: VALIDATION_BUDGETS.estimatedAllocationAndExportBytes, timeoutMs: VALIDATION_BUDGETS.perRootMs, compression: "off", exportScope: "first-street" } });
}

export function buildManifest(transcript: SelectionTranscript) {
  assert.equal(transcript.format, "poker-face-preflop-v2-selection"); assert.equal(transcript.version, 1);
  assert.equal(transcript.method, "crypto.randomInt-without-replacement");
  assert.equal(transcript.populationHash, hashJson(flopPopulation()));
  assert.equal(transcript.contractHash, sha256(readFileSync(`${CORPUS_DIRECTORY}/frozen-contract.md`)));
  assert.deepEqual(transcript.strata.map(s => s.stratum), TEXTURE_STRATA);
  const legacy = legacyKeys(); assert.equal(legacy.size, 12);
  const boards: CorpusBoard[] = flopPopulation().filter(o => legacy.has(o.key)).map(o => ({ ...o, role: "legacy" }));
  const strata = transcript.strata.map(s => {
    const pool = eligible(s.stratum), count = pool.length; assert.equal(s.eligibleOrbits, count); assert.equal(s.draws.length, 6);
    const physical = pool.reduce((n, o) => n + o.multiplicity, 0);
    s.draws.forEach((draw, i) => {
      if (!Number.isInteger(draw) || draw < 0 || draw >= pool.length) throw new Error(`invalid bounded draw for ${s.stratum}`);
      const [orbit] = pool.splice(draw, 1); boards.push({ ...orbit, role: i < 3 ? "calibration" : "holdout" });
    });
    return { stratum: s.stratum, nonlegacyOrbits: count, nonlegacyPhysicalFlops: physical,
      calibrationInclusion: { numerator: 3, denominator: count }, holdoutInclusionGivenCalibration: { numerator: 3, denominator: count - 3 } };
  });
  const roots: CorpusRoot[] = [];
  for (const b of boards) for (const potType of ["srp", "3bp", "4bp"] as const) for (const profile of ["A", "B"] as const) {
    const root = { id: `pfv2-${potType}-${profile.toLowerCase()}-${b.role}-${b.key}`, boardKey: b.key, profile, potType };
    roots.push({ ...root, spotHash: hashBridgeSpot(spotFor(root, b)), removedCombosPerPlayer: 150 });
  }
  const payload = { format: "poker-face-preflop-validation-corpus", version: 2, scope: "research-only; no production range promotion",
    chipsPerBb: 100, playerOrder: ["OOP", "IP"], physicalFlops: 22100, flopOrbits: 1755, legalFlopsGivenPrivatePair: 17296,
    sourceHashes: sourceHashes(), selectionHash: hashJson(transcript), tree: LEAN_SRP_TREE, treeHash: hashJson(LEAN_SRP_TREE),
    budgets: VALIDATION_BUDGETS, potSettings: POT_SETTINGS,
    profiles: (["A", "B"] as const).map(id => ({ id, rangeHashes: ([0, 1] as const).map(p => hashJson(profileRange(id, p))),
      classWeights: ([0, 1] as const).map(p => HANDS.map((_, i) => profileRange(id, p).find(h => h.classIndex === i)!.weight)) })),
    strata, boards, roots };
  return { ...payload, payloadHash: hashJson(payload) };
}
export type ValidationManifest = ReturnType<typeof buildManifest>;
export function corpusSpot(root: CorpusRoot, manifest: ValidationManifest): BridgeSpotV1 {
  const board = manifest.boards.find(b => b.key === root.boardKey); if (!board) throw new Error("root board absent from manifest");
  const spot = spotFor(root, board); assert.equal(hashBridgeSpot(spot), root.spotHash, "root spot hash mismatch"); return spot;
}
export function verifyManifest(input: unknown): asserts input is ValidationManifest {
  const transcript = JSON.parse(readFileSync(`${CORPUS_DIRECTORY}/selection.json`, "utf8")) as SelectionTranscript;
  assert.deepEqual(input, buildManifest(transcript), "frozen manifest/hash does not reproduce from source and selection");
}
