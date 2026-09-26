/**
 * B4 library definition: which flops, which turn/river slices, and the slice policy.
 * Node-side (imports the fixture builders); the browser reads only the generated manifest.
 *
 * Formation: BTN vs BB single-raised pot, 100bb, the locked benchmark's hand-written
 * approximate ranges and Griffin's lean "Fold" tree (`LEAN_SRP_TREE`).
 *
 * Slice policy (the full tree × ~1,100 hands is far too big to ship):
 * - Flop: every flop decision node (all flop betting lines).
 * - Turn: for 8 turn cards per flop, the turn decisions with ≤ 2 turn actions before them
 *   (OOP's first action, IP after a check, IP facing a lead, OOP facing a stab after checking,
 *   OOP facing a raise of its lead), on every flop line that reaches the turn without a raise.
 * - River: for 2 (turn, river) boards per flop, the river decisions with ≤ 2 river actions
 *   before them, on every flop+turn line that reaches the river without a raise.
 * - Every sliced node carries, for both players, per-hand reach, from-now EV and equity, plus
 *   the actor's per-hand strategy and per-action EV: enough for pot odds, MDF, bluff ratios,
 *   blocker and range-composition drills. Raised pots stay flop-only (thin, rare lines).
 */
import type { RiverCard } from "../../river/cards";
import { BRIDGE_SLICE_PLAN_FORMAT, type BridgeBoard, type BridgeSlicePlanV1, type BridgeSpotV1 } from "../contract";
import { leanSrpSpot } from "../fixtures";

export interface LibraryFlopDefinition {
  readonly id: string;
  readonly flop: BridgeBoard["flop"];
  readonly texture: string;
  /** Hand-picked for variety: overcards, board pairs, flush/straight completers, bricks. */
  readonly turnCards: readonly RiverCard[];
  readonly riverBoards: readonly (readonly [RiverCard, RiverCard])[];
}

const def = (id: string, flop: string, texture: string, turns: string, rivers: string): LibraryFlopDefinition => ({
  id: `srp-btn-bb-${id}`,
  flop: flop.match(/../g) as unknown as BridgeBoard["flop"],
  texture,
  turnCards: turns.split(" ") as RiverCard[],
  riverBoards: rivers.split(" ").map(b => [b.slice(0, 2), b.slice(2, 4)] as [RiverCard, RiverCard]),
});

/** Order is generation order; the first is the benchmark flop. */
export const LIBRARY_FLOPS: readonly LibraryFlopDefinition[] = Object.freeze([
  def("ks7h2d", "Ks7h2d", "dry high (K-high rainbow)", "Ac Kd 7c Qh Th 9s 5d 3c", "Qh2c 5dJs"),
  def("ad8c3s", "Ad8c3s", "ace-high dry rainbow", "Kh Ac 8d Qs Js 9h 5c 2d", "Kh4c 9hTs"),
  def("khqdtc", "KhQdTc", "broadway rainbow", "As Kc Js 9d 8h 5s 2c Qc", "Js3d 2cAh"),
  def("9h8h6c", "9h8h6c", "wet connected two-tone", "Ah Ts 7d 2h 9s 5c Kd 3s", "TsQh Kd4h"),
  def("qs9s4s", "Qs9s4s", "monotone", "As Ah 2s Qd Jc 9d 7h 3c", "Ah5s 7hKd"),
  def("td7d3c", "Td7d3c", "two-tone middle", "Ad Kh 2d Ts 8s 6h 4c Jc", "Kh9d 4c3s"),
  def("8s8d3h", "8s8d3h", "paired middle", "Ac Kh 8c 3c Qd 9h 5s 2d", "Ac7h 5sKd"),
  def("5h4c2d", "5h4c2d", "low connected rainbow", "Ac Kd 3s 6h 5c 9s Th 2h", "Kd7c 3sQh"),
  def("tc9d7s", "Tc9d7s", "middle connected rainbow", "As Kh 8c Jh 6d 2c Td 4s", "Kh5h 2cQd"),
  def("ahth5c", "AhTh5c", "ace-high two-tone", "Kc Ad 2h 5d Js 8s 4c Qh", "Kc9d 4c3h"),
  def("jcjd4s", "JcJd4s", "paired high", "Ah Kc Jh 4d Tc 8h 6s 2c", "Ah5h 8hQs"),
  def("7c6c5d", "7c6c5d", "low wet two-tone", "Ac 8c 4s Kd 7h 3d Th 2c", "Kd9h 2cJs"),
]);

export const LIBRARY_TURN_DEPTH = 2;
export const LIBRARY_RIVER_DEPTH = 2;

export function librarySpot(definition: LibraryFlopDefinition): BridgeSpotV1 {
  return leanSrpSpot(definition.id, definition.flop);
}

export function librarySlicePlan(definition: LibraryFlopDefinition, subtrees: readonly (readonly string[])[] = []): BridgeSlicePlanV1 {
  const board = new Set<string>(definition.flop);
  for (const card of definition.turnCards) if (board.has(card)) throw new Error(`${definition.id}: turn ${card} is on the flop`);
  if (new Set(definition.turnCards).size !== definition.turnCards.length) throw new Error(`${definition.id}: repeated turn card`);
  for (const [turn, river] of definition.riverBoards) {
    if (!definition.turnCards.includes(turn) || board.has(river) || river === turn) throw new Error(`${definition.id}: bad river board ${turn}${river}`);
  }
  return {
    format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop: { maxDepth: null },
    turn: { cards: [...definition.turnCards], maxDepth: LIBRARY_TURN_DEPTH, maxPriorRaises: 0 },
    river: { boards: definition.riverBoards.map(b => [b[0], b[1]] as const), maxDepth: LIBRARY_RIVER_DEPTH, maxPriorRaises: 0 },
    subtrees: subtrees.map(p => [...p]), equity: true,
  };
}

/**
 * The river subgame kept at full precision for audits (first flop): IP bets flop and turn,
 * OOP calls both, then the river root. Narrow ranges keep the file and the re-grade small.
 */
export const LIBRARY_REFEREE_SAMPLE = Object.freeze({
  spotId: LIBRARY_FLOPS[0].id,
  path: ["x", "s0", "c", "Qh", "x", "s0", "c", "2c"] as readonly string[],
});

export const LIBRARY_PROVENANCE = Object.freeze({
  ranges: "BB (OOP) flat-call and BTN (IP) 2.5bb open ranges at 100bb: hand-written approximations, not solved (no preflop solve behind them).",
  tree: "Griffin's lean Fold tree: OOP bets flop 33%/66%, turn 66%, river 50%/100%; IP bets 66% every street; raises to call + 60% pot; one raise per street; all-in when ≤ 0.2 × the pot would be left behind.",
  label: "Approximate equilibrium of this finite game (exploitability ≤ 0.3% of the pot), not exact or universal GTO.",
});

export const LIBRARY_SLICE_POLICY = Object.freeze({
  summary: "Saved slices of each full-tree solve: all flop decisions; turn and river decisions near each street's start on unraised lines for sampled cards.",
  flop: "Every flop decision node (all flop betting lines).",
  turn: `8 turn cards per flop; turn decisions with ≤ ${LIBRARY_TURN_DEPTH} turn actions before them, on flop lines without a raise.`,
  river: `2 turn+river boards per flop; river decisions with ≤ ${LIBRARY_RIVER_DEPTH} river actions before them, on flop and turn lines without a raise.`,
  omittedReach: "Hands whose reach rounds to 0 at 1e-4 are omitted from a node; their total reach is recorded per node.",
});

const RANKS = "23456789TJQKA";
export interface FlopDescriptor {
  readonly cards: readonly [string, string, string];
  readonly texture: string;
  readonly suitPattern: "rainbow" | "two-tone" | "monotone";
  readonly pairing: "unpaired" | "paired" | "trips";
  /** Ranks high to low, e.g. ["K", "7", "2"]. */
  readonly ranks: readonly [string, string, string];
  readonly highRank: string;
  /** Cards ten or higher. */
  readonly broadwayCards: number;
  /** Distinct-rank gaps high→middle and middle→low (0 for a pair). */
  readonly gaps: readonly [number, number];
  /** Three distinct ranks inside one five-rank window (ace also low): a straight is possible by the river with two cards. */
  readonly straightPossible: boolean;
}

/** Deterministic texture fields for one library flop (the free-text `texture` label is hand-written). */
export function flopDescriptor(definition: LibraryFlopDefinition): FlopDescriptor {
  const cards = definition.flop;
  const values = cards.map(c => RANKS.indexOf(c[0])).sort((a, b) => b - a);
  const suits = new Set(cards.map(c => c[1])).size;
  const distinct = new Set(values).size;
  // Five-rank windows from A-5 (low = −1, the ace counted low) up to T-A (low = 8).
  const straightPossible = distinct === 3 && Array.from({ length: 10 }, (_, i) => i - 1).some(low =>
    values.every(v => (v >= low && v <= low + 4) || (v === 12 && low === -1)));
  return {
    cards: [cards[0], cards[1], cards[2]], texture: definition.texture,
    suitPattern: suits === 3 ? "rainbow" : suits === 2 ? "two-tone" : "monotone",
    pairing: distinct === 3 ? "unpaired" : distinct === 2 ? "paired" : "trips",
    ranks: values.map(v => RANKS[v]) as unknown as [string, string, string], highRank: RANKS[values[0]],
    broadwayCards: values.filter(v => v >= RANKS.indexOf("T")).length,
    gaps: [values[0] - values[1], values[1] - values[2]], straightPossible,
  };
}

