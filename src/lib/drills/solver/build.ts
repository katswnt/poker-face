// Solver-backed decision drills: eligibility, seeded sampling and grading over validated bridge
// library data. Pure and synchronous given loaded data; the async loading lives in source.ts.
// Thresholds and bands are documented in tasks/drills-spec.md ("Solver-backed decisions").
import { EQUITY_SCALE, EV_SCALE, REACH_SCALE, STRATEGY_SCALE, type BridgeLibraryChunk, type BridgeLibraryManifest, type BridgeLibraryNode,
  type BridgeLibraryRanges, type BridgeLibrarySpot } from "@/lib/solver/bridge/library/model";
import { SPEED_TARGET_MS } from "../generators";
import type { Rng } from "../rng";
import type { ChoiceOption, DecisionBand, DecisionGrade, Level, PriceRow, Question, SolverActionRow } from "../types";
import { villainRange } from "./composition";
import { fmtChipsBb as bb, fmtPct, fmtSignedChipsBb as signedBb } from "../format";
import { cardText, comboCards, describeActions, libraryCard, replayNode, solverKey } from "./tree";

// ---------------------------------------------------------------------------------------------
// Thresholds

/** A node is drilled only if both ranges reach it together at least this often (line frequency
 *  given the runout: product of each player's reached share of its range, card removal ignored). */
export const NODE_MIN_FREQUENCY = 0.02;
/** A hand is drilled only if its reach is at least this share of the node's largest reach. */
export const HAND_MIN_RELATIVE_REACH = 0.01;
const HAND_MIN_REACH_UNITS = Math.round(HAND_MIN_RELATIVE_REACH * REACH_SCALE);
/** Mixed-strategy guard: an action the solver plays at least this often for the hand is correct. */
export const MIXED_MIN_FREQUENCY = 0.2;
/** Quantization noise: stored EVs are rounded to 1/EV_SCALE chips, so two stored EVs within one
 *  unit (≤ 0.1 chip) cannot be ordered and are ties. */
export const EV_TIE_UNITS = 1;
export const EV_NOISE_CHIPS = EV_TIE_UNITS / EV_SCALE;
/** EV-loss bands, % of the pot at the node (upper bounds, inclusive). */
export const BAND_LIMITS_PCT_POT = { best: 0.3, inaccuracy: 2, mistake: 8 } as const;
/** Attempts at a chunk with an eligible node before falling back to the flop chunk. */
export const MAX_CHUNK_ATTEMPTS = 6;

/** Street mix per level: 1 flop only, 2 adds the turn, 3 adds the river. */
export const STREET_WEIGHTS: Readonly<Record<Level, Readonly<Partial<Record<"flop" | "turn" | "river", number>>>>> = {
  1: { flop: 1 },
  2: { flop: 0.4, turn: 0.6 },
  3: { flop: 0.25, turn: 0.4, river: 0.35 },
};

export const PROVENANCE_BASE = "postflop-solver (AGPL) via the audited bridge";

export function provenanceLine(manifest: BridgeLibraryManifest): string {
  return `${PROVENANCE_BASE}; ${manifest.spots.length} BTN vs BB flops; ranges are hand-written approximations; not exact or universal GTO.`;
}

// ---------------------------------------------------------------------------------------------
// Weighted picks

/** Index i with probability weights[i] / Σ weights, for u uniform in [0, 1). Zero weights are
 *  never picked. Throws on an empty or all-zero list. */
export function weightedIndex(u: number, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (!(total > 0)) throw new Error("weightedIndex needs a positive weight");
  let target = u * total, last = -1;
  for (let i = 0; i < weights.length; i += 1) {
    if (!(weights[i] > 0)) continue;
    last = i;
    if (target < weights[i]) return i;
    target -= weights[i];
  }
  return last;
}

// ---------------------------------------------------------------------------------------------
// Eligibility

/** Σ input weight of a player's combos that do not use a board card. */
function rangeMass(ranges: BridgeLibraryRanges, player: 0 | 1, board: readonly string[]): number {
  const dead = new Set(board);
  return ranges.hands[player].reduce((s, combo, h) =>
    dead.has(combo.slice(0, 2)) || dead.has(combo.slice(2, 4)) ? s : s + ranges.weights[player][h], 0);
}

/** Share of each player's range (board-blocked combos excluded) that reaches the node. */
export function reachedShare(node: BridgeLibraryNode, ranges: BridgeLibraryRanges, player: 0 | 1): number {
  const mass = rangeMass(ranges, player, node.board);
  const reached = node.reach[player].reduce((s, r) => s + r, 0) / REACH_SCALE * node.reachMax[player];
  return mass > 0 ? reached / mass : 0;
}

/** How often both ranges arrive here together, given the runout (card removal ignored). */
export const nodeFrequency = (node: BridgeLibraryNode, ranges: BridgeLibraryRanges): number =>
  reachedShare(node, ranges, 0) * reachedShare(node, ranges, 1);

/** Live-row indices i (into node.live[actor]) the drill may ask about: reach at least
 *  HAND_MIN_RELATIVE_REACH of the node's largest, an EV for every action, and at least one
 *  action graded wrong (a hand for which every action is fine has nothing to grade). */
export function eligibleHands(node: BridgeLibraryNode, startingPot: number): number[] {
  const actor = node.player, out: number[] = [];
  const pot = startingPot + node.committed[0] + node.committed[1];
  node.reach[actor].forEach((units, i) => {
    if (units < HAND_MIN_REACH_UNITS || node.actionEv.some(row => row[i] === null)) return;
    if (gradeActions(node, i, pot).grades.some(g => !g.correct)) out.push(i);
  });
  return out;
}

export interface EligibleNode { readonly node: BridgeLibraryNode; readonly frequency: number; readonly hands: readonly number[]; }

export function eligibleNodes(chunk: BridgeLibraryChunk, ranges: BridgeLibraryRanges, startingPot: number): EligibleNode[] {
  return chunk.nodes.flatMap(node => {
    if (node.actions.length < 2) return [];
    const frequency = nodeFrequency(node, ranges);
    if (frequency < NODE_MIN_FREQUENCY) return [];
    const hands = eligibleHands(node, startingPot);
    return hands.length ? [{ node, frequency, hands }] : [];
  });
}

// ---------------------------------------------------------------------------------------------
// Seeded sampling (the rng sequence is part of the determinism contract: tests replay it)

export function chunkKeysForStreet(spot: BridgeLibrarySpot, street: "flop" | "turn" | "river"): string[] {
  return Object.keys(spot.chunks).filter(k => street === "flop" ? k === "flop" : k.startsWith(`${street}-`)).sort();
}

/** Attempt k's chunk: a street by the level's mix, then a uniform chunk of that street. */
export function planChunk(rng: Rng, spot: BridgeLibrarySpot, level: Level): string {
  const entries = Object.entries(STREET_WEIGHTS[level]) as ["flop" | "turn" | "river", number][];
  const street = entries[weightedIndex(rng(), entries.map(([, w]) => w))][0];
  const keys = chunkKeysForStreet(spot, street);
  return keys.length ? keys[Math.floor(rng() * keys.length)] : "flop";
}

/** Node uniform among the eligible ones (the frequency threshold already drops rare lines;
 *  weighting by frequency would make the flop root most questions), then hand ∝ reach. */
export function pickFromEligible(rng: Rng, eligible: readonly EligibleNode[]): { node: BridgeLibraryNode; row: number } {
  const chosen = eligible[Math.floor(rng() * eligible.length)];
  const reach = chosen.node.reach[chosen.node.player];
  const row = chosen.hands[weightedIndex(rng(), chosen.hands.map(i => reach[i]))];
  return { node: chosen.node, row };
}

// ---------------------------------------------------------------------------------------------
// Grading

export function bandFor(lossPctPot: number, frequency: number): { band: DecisionBand; correct: boolean } {
  if (lossPctPot <= BAND_LIMITS_PCT_POT.best) return { band: "best", correct: true };
  if (frequency >= MIXED_MIN_FREQUENCY) return { band: "mixed", correct: true };
  if (lossPctPot <= BAND_LIMITS_PCT_POT.inaccuracy) return { band: "inaccuracy", correct: false };
  if (lossPctPot <= BAND_LIMITS_PCT_POT.mistake) return { band: "mistake", correct: false };
  return { band: "blunder", correct: false };
}

/** Grades every action for live row `row` from the stored integers (EV units, per-mille). */
export function gradeActions(node: BridgeLibraryNode, row: number, potChips: number): { grades: DecisionGrade[]; best: number } {
  const units = node.actionEv.map(evs => evs[row]);
  if (units.some(u => u === null)) throw new Error(`Node ${node.path} has no action EV for row ${row}`);
  const evs = units as number[];
  const max = Math.max(...evs);
  const grades = evs.map((u, a) => {
    const frequency = node.strategy[a][row] / STRATEGY_SCALE;
    const lossUnits = max - u <= EV_TIE_UNITS ? 0 : max - u;
    const evLossChips = lossUnits / EV_SCALE;
    const evLossPctPot = (evLossChips / potChips) * 100;
    return { ...bandFor(evLossPctPot, frequency), frequency, evChips: u / EV_SCALE, evLossChips, evLossPctPot };
  });
  // Best: highest stored EV; among ties, the action the solver plays most.
  let best = 0;
  grades.forEach((g, a) => {
    const b = grades[best];
    if (g.evLossChips < b.evLossChips || (g.evLossChips === b.evLossChips && (evs[a] > evs[best] || (evs[a] === evs[best] && g.frequency > b.frequency)))) best = a;
  });
  return { grades, best };
}

// ---------------------------------------------------------------------------------------------
// Question

export interface BuildInput {
  readonly manifest: BridgeLibraryManifest;
  readonly spot: BridgeLibrarySpot;
  readonly ranges: BridgeLibraryRanges;
  readonly node: BridgeLibraryNode;
  /** Index into node.live[node.player]. */
  readonly row: number;
  readonly seed: number;
  readonly level: Level;
}

const shortName = (full: string): string => full.split(" ")[0];
const pct1 = (x: number) => fmtPct(x * 100);

export function priceRow(label: string, potBefore: number, bet: number): PriceRow {
  const potOdds = bet / (potBefore + 2 * bet);
  const mdf = potBefore / (potBefore + bet);
  return {
    label, potBefore, bet, potOdds, mdf,
    plugged: `pot odds ${bb(bet)} ÷ (${bb(potBefore)} + 2 × ${bb(bet)}) = ${pct1(potOdds)}; MDF ${bb(potBefore)} ÷ (${bb(potBefore)} + ${bb(bet)}) = ${pct1(mdf)}`,
  };
}

export function buildSolverQuestion(input: BuildInput): Question {
  const { manifest, spot, ranges, node, row, seed, level } = input;
  const { startingPot, effectiveStack } = manifest.formation;
  const names = [shortName(manifest.formation.players[0]), shortName(manifest.formation.players[1])] as const;
  const actor = node.player, villain = (1 - actor) as 0 | 1;
  const hand = node.live[actor][row];
  if (hand === undefined) throw new Error(`Node ${node.path} has no live row ${row}`);
  const combo = ranges.hands[actor][hand];
  const replay = replayNode(spot.flop, node, names);
  const pot = startingPot + node.committed[0] + node.committed[1];
  const toCall = replay.street[villain] - replay.street[actor];
  const infos = describeActions(node, replay, startingPot, effectiveStack);
  const { grades, best } = gradeActions(node, row, pot);
  const options: ChoiceOption[] = infos.map(i => ({ id: i.id, label: i.label }));
  const actions: SolverActionRow[] = infos.map((info, a) => ({ id: info.id, label: info.label, grade: grades[a] }));
  const equityUnits = node.equity[actor][row];
  const equity = equityUnits === null ? null : equityUnits / EQUITY_SCALE;
  const facingBet = toCall > 0;
  const price: PriceRow[] = facingBet
    ? [priceRow(`${names[villain]}'s bet: ${bb(toCall)} bb more into ${bb(pot - toCall)} bb`, pot - toCall, toCall)]
    : infos.filter(i => i.adds > 0).map(i => priceRow(`If you ${i.label.toLowerCase().replace(/ \(.*\)$/, "")}`, pot, i.adds));
  const stacks = [effectiveStack - node.committed[0], effectiveStack - node.committed[1]] as const;
  const provenance = provenanceLine(manifest);
  const key = solverKey({ spotId: spot.id, path: node.path, combo });
  const heroCards = comboCards(combo);
  const streetName = node.street[0].toUpperCase() + node.street.slice(1);
  const situation = facingBet
    ? replay.street[actor] > 0
      ? `${names[villain]} raises to ${bb(replay.street[villain])} bb (${bb(toCall)} bb more to call)`
      : `${names[villain]} bets ${bb(toCall)} bb into ${bb(pot - toCall)} bb`
    : actor === 0 ? "you act first" : `${names[villain]} checks to you`;
  const bestRow = actions[best];
  const plugged = actions.map(a => `${a.label}: ${signedBb(a.grade.evChips)} bb`).join(" · ");
  return {
    id: `solver:${key}`, type: "solver", level, seed,
    prompt: `${streetName}: ${situation}. You are ${names[actor]} with ${heroCards.map(c => c.rank + c.suit).join("")}. Your play?`,
    facts: [
      { label: "Board", value: node.board.map(cardText).join(" ") },
      { label: "Your hand", value: heroCards.map(c => c.rank + c.suit).join(" ") },
      { label: "Pot", value: `${bb(pot)} bb` },
      ...(facingBet ? [{ label: "To call", value: `${bb(toCall)} bb` }] : []),
      { label: "Stacks behind", value: `${names[0]} ${bb(stacks[0])} bb · ${names[1]} ${bb(stacks[1])} bb` },
      { label: "Action", value: replay.history.join(". ") },
    ],
    hole: heroCards,
    board: node.board.map(libraryCard),
    answer: { kind: "decision", value: bestRow.id, options, grades: Object.fromEntries(actions.map(a => [a.id, a.grade])) },
    speedTargetMs: SPEED_TARGET_MS.solver,
    explanation: {
      formula: "EV loss = EV(best action for this hand) − EV(your action), as a percentage of the pot now",
      plugged,
      result: `Best: ${bestRow.label} (solver plays it ${pct1(bestRow.grade.frequency)} with this hand)`,
      shortcut: price.map(p => `${p.label}: ${p.plugged}`).join(" | ") || "No bet to price.",
      shortcutApproximate: false,
      note: provenance,
    },
    params: { spotId: spot.id, path: node.path, combo, row, hand },
    reviewKey: key,
    solver: {
      spotId: spot.id, path: node.path, combo, heroName: names[actor], villainName: names[villain], street: node.street,
      history: replay.history, potChips: pot, toCallChips: toCall, stacksChips: stacks, equity, actions, price, facingBet,
      villainRange: villainRange(node, ranges, villain, combo), nodeFrequency: nodeFrequency(node, ranges), provenance,
    },
  };
}
