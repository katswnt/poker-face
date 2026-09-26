/**
 * Versioned JSON contract between poker-face and the native postflop-solver bridge
 * (`native/solver-bridge`). App and TypeScript code depend only on these types, never on
 * postflop-solver itself, so the engine can be replaced without touching callers.
 *
 * Conventions (see tasks/postflop-solver-bridge-spec.md for the full unit mapping):
 * - Player 0 is out of position (acts first on every street); player 1 is in position.
 * - Chips are whole numbers. `startingPot` is the pot before the first postflop action;
 *   `effectiveStack` is what each player still has behind at that point.
 * - A sized action's `to` is the actor's total contribution on the current street after
 *   the action ("bet-to"/"raise-to"), exactly postflop-solver's Bet(x)/Raise(x)/AllIn(x).
 * - Rake is always 0 in v1.
 *
 * Browser-safe: hashing lives in contract-node.ts so node:crypto stays out of client code.
 */
import { RIVER_DECK, isRiverCard, type RiverCard } from "../river/cards";

export const BRIDGE_SPOT_FORMAT = "poker-face-bridge-spot";
export const BRIDGE_RESULT_FORMAT = "poker-face-bridge-result";
export const BRIDGE_CONTRACT_VERSION = 1;
/** Upstream engine pinned in native/solver-bridge/Cargo.toml. */
export const POSTFLOP_SOLVER_COMMIT = "9d1509fe5077d019825f833eed04b16d342dfda1";

export const BRIDGE_LIMITS = Object.freeze({
  /** i32 amounts inside postflop-solver; keep pot + both stacks far below 2^31. */
  maxChips: 100_000_000,
  maxExplicitNodes: 200_000,
  maxSizesPerList: 8,
  maxIterations: 1_000_000,
  maxTimeoutMs: 24 * 60 * 60 * 1000,
  maxIdLength: 80,
});

export type BridgeStreet = "flop" | "turn" | "river";
export const BRIDGE_STREETS: readonly BridgeStreet[] = ["flop", "turn", "river"];
export type BridgePlayer = 0 | 1;

export interface BridgeBoard {
  readonly flop: readonly [RiverCard, RiverCard, RiverCard];
  readonly turn: RiverCard | null;
  readonly river: RiverCard | null;
}

/** One exact hand. `combo` is canonical: higher-deck-index card first, e.g. "AsKs", "Kh7h". */
export interface BridgeRangeEntry {
  readonly combo: string;
  /** In (0, 1] and exactly representable as float32, so both engines see identical weights. */
  readonly weight: number;
}

export interface BridgeRange {
  /** Human provenance, e.g. "hand-written approximation, not solved". Part of the hash. */
  readonly source: string;
  /** Sorted by (first card index, second card index) ascending; no duplicates. */
  readonly combos: readonly BridgeRangeEntry[];
}

/** Mirrors postflop-solver BetSize. Percentages are percent units (33 = 33% of the pot). */
export type BridgeBetSize =
  | { readonly kind: "pot"; readonly pct: number }
  /** Raise to `multiple` × the previous bet (raises only); postflop-solver "2.5x". */
  | { readonly kind: "prevBet"; readonly multiple: number }
  /** Constant chips; for raises `raiseCap` limits how many bets may precede it (0 = none). */
  | { readonly kind: "chips"; readonly amount: number; readonly raiseCap: number }
  /** Geometric size over `streets` streets (0 = remaining streets), capped at `maxPct` of pot. */
  | { readonly kind: "geometric"; readonly streets: number; readonly maxPct: number | null }
  | { readonly kind: "allin" };

export interface BridgeBetSizeMenu {
  readonly bet: readonly BridgeBetSize[];
  readonly raise: readonly BridgeBetSize[];
}

export interface BridgeStreetMenu {
  readonly oop: BridgeBetSizeMenu;
  readonly ip: BridgeBetSizeMenu;
}

/** Mirrors postflop-solver TreeConfig, plus one bridge extension (`maxRaisesPerStreet`). */
export interface BridgeMenuTree {
  readonly mode: "menu";
  /** Required exactly for streets that are played (from the board's first undealt street). */
  readonly flop: BridgeStreetMenu | null;
  readonly turn: BridgeStreetMenu | null;
  readonly river: BridgeStreetMenu | null;
  /** OOP lead sizes after OOP called the previous street; null = use OOP's bet menu. */
  readonly turnDonk: readonly BridgeBetSize[] | null;
  readonly riverDonk: readonly BridgeBetSize[] | null;
  /** Add all-in when (max bet) ≤ threshold × pot (0 disables). */
  readonly addAllInThreshold: number;
  /** Replace a size with all-in when the SPR after the call is ≤ threshold (0 disables). */
  readonly forceAllInThreshold: number;
  /** PioSOLVER-style merging of close sizes (0 disables). */
  readonly mergingThreshold: number;
  /**
   * Bridge extension, not a TreeConfig field: postflop-solver keeps offering raises until
   * someone is all-in. With a cap, every raise (including an all-in raise) beyond this many
   * on one street is removed from the built tree. null = no cap.
   */
  readonly maxRaisesPerStreet: number | null;
}

export type BridgeAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call" }
  | { readonly type: "bet"; readonly to: number }
  | { readonly type: "raise"; readonly to: number };

export type BridgeExplicitNode =
  | {
    readonly kind: "player";
    readonly player: BridgePlayer;
    /** Canonical order: fold, check, call, then bets/raises by ascending `to`. */
    readonly actions: readonly { readonly action: BridgeAction; readonly next: BridgeExplicitNode }[];
  }
  /** The next street's card is dealt; every card leads to the same betting subtree. */
  | { readonly kind: "chance"; readonly next: BridgeExplicitNode }
  /** "showdown" includes an all-in call before the river (remaining cards run out). */
  | { readonly kind: "terminal"; readonly outcome: "fold" | "showdown" };

/** Full public betting tree. Chance outcomes never change the legal actions. */
export interface BridgeExplicitTree {
  readonly mode: "explicit";
  readonly root: BridgeExplicitNode;
}

export type BridgeTree = BridgeMenuTree | BridgeExplicitTree;

export interface BridgeSolveOptions {
  /** Stop when the engine's self-reported exploitability ≤ this % of startingPot. */
  readonly targetExploitabilityPctPot: number;
  readonly maxIterations: number;
  /** Refuse before allocating if the engine's estimate exceeds this. */
  readonly memoryCapBytes: number;
  readonly timeoutMs: number;
  /** "auto": 32-bit floats if they fit the cap, else 16-bit compressed storage. */
  readonly compression: "off" | "on" | "auto";
  /** "full": every public node and every real turn/river card. "first-street": stop at the first chance node. */
  readonly exportScope: "full" | "first-street";
}

export interface BridgeSpotV1 {
  readonly format: typeof BRIDGE_SPOT_FORMAT;
  readonly version: 1;
  readonly id: string;
  readonly board: BridgeBoard;
  readonly ranges: readonly [BridgeRange, BridgeRange];
  readonly startingPot: number;
  readonly effectiveStack: number;
  readonly rake: 0;
  readonly tree: BridgeTree;
  readonly solve: BridgeSolveOptions;
}

// ---------------------------------------------------------------------------------------
// Result contract v1 (written by the bridge, read by the runner/referee).

export type BridgeResultNode =
  | {
    readonly id: number;
    readonly kind: "player";
    readonly street: BridgeStreet;
    /** Every board card known at this node (flop first). */
    readonly board: readonly RiverCard[];
    readonly player: BridgePlayer;
    /** Chips each player has put in since the start of the spot (excluding startingPot). */
    readonly committed: readonly [number, number];
    readonly actions: readonly {
      readonly action: BridgeAction;
      /** postflop-solver's own label, e.g. "AllIn(975)", kept for audits. */
      readonly engineAction: string;
      readonly child: number;
    }[];
    /** strategy[a][h]: probability of action a for hand h of `player` (result.hands order); null = hand blocked by the board. */
    readonly strategy: readonly (readonly (number | null)[])[];
  }
  | {
    readonly id: number;
    readonly kind: "chance";
    /** Street being dealt. */
    readonly street: "turn" | "river";
    readonly board: readonly RiverCard[];
    readonly committed: readonly [number, number];
    /** One child per real dealable card (isomorphic cards expanded). Empty when truncated. */
    readonly children: readonly {
      readonly card: RiverCard;
      readonly child: number;
      /** false = postflop-solver stores this card only via a suit-isomorphic representative. */
      readonly representative: boolean;
    }[];
    /** Unseen cards the engine never deals because no hand pair survives them. */
    readonly impossibleCards: readonly RiverCard[];
    readonly truncated: boolean;
  }
  | {
    readonly id: number;
    readonly kind: "terminal";
    readonly outcome: "fold" | "showdown";
    readonly board: readonly RiverCard[];
    readonly committed: readonly [number, number];
    readonly folder: BridgePlayer | null;
  };

export interface BridgeResultV1 {
  readonly format: typeof BRIDGE_RESULT_FORMAT;
  readonly version: 1;
  readonly spotId: string;
  /** sha256 of the exact canonical spot JSON the bridge read. */
  readonly spotHash: string;
  readonly engine: {
    readonly name: "postflop-solver";
    readonly repository: string;
    readonly commit: string;
    readonly bridgeVersion: string;
    readonly algorithm: "discounted-cfr";
    readonly precision: "float32" | "int16-compressed";
    readonly threads: number;
  };
  /** Per player, the spot's combos in the spot's order; strategy/EV rows use this order. */
  readonly hands: readonly [readonly string[], readonly string[]];
  readonly tree: readonly BridgeResultNode[];
  readonly root: {
    /** Net chips per hand relative to the start of the spot (excluding startingPot), our utility origin. */
    readonly ev: readonly [readonly number[], readonly number[]];
    /** postflop-solver's raw expected_values(): pot share returned, i.e. ev + startingPot / 2. */
    readonly engineEv: readonly [readonly number[], readonly number[]];
    readonly equity: readonly [readonly number[], readonly number[]];
    /** Normalized weights (combination counts after card removal). */
    readonly weights: readonly [readonly number[], readonly number[]];
  };
  readonly exploitability: {
    readonly chips: number;
    readonly pctPot: number;
    readonly convention: "half-sum-of-best-response-gains";
    readonly target: number;
    readonly reached: boolean;
  };
  readonly iterations: number;
  readonly convergence: readonly { readonly iteration: number; readonly exploitability: number; readonly elapsedMs: number }[];
  readonly timings: {
    readonly buildMs: number;
    readonly allocateMs: number;
    readonly solveMs: number;
    readonly exportMs: number;
    readonly totalMs: number;
  };
  readonly memory: {
    readonly estimatedBytes: number;
    readonly estimatedCompressedBytes: number;
    readonly allocatedEstimateBytes: number;
    readonly peakRssBytes: number;
  };
  readonly counts: { readonly exportedNodes: number };
  /** Present only when the solve was given a slice plan (bridge extension, B3/B4). */
  readonly slices?: BridgeSlices;
}

// ---------------------------------------------------------------------------------------
// Slice plans (bridge extension, B3/B4). A solved flop game is far too large to export
// whole; a plan names the public nodes to write with per-hand detail and the river subgames
// to write in full for the referee. The plan is a separate file hashed into the result, so
// slicing never changes the spot hash.
//
// Path tokens from the root: "x" check, "c" call, "f" fold, "b<to>" bet to street total
// <to> (all-in included), "r<to>" raise to <to>, "s<i>" the i-th sized action (plan input
// only), and a card name ("Qh") at a chance node.

export const BRIDGE_SLICE_PLAN_FORMAT = "poker-face-bridge-slices";

export interface BridgeSlicePlanV1 {
  readonly format: typeof BRIDGE_SLICE_PLAN_FORMAT;
  readonly version: 1;
  /** Flop decision nodes with at most maxDepth flop actions before them (null = every flop node). */
  readonly flop: { readonly maxDepth: number | null } | null;
  /**
   * For each listed turn card, turn decision nodes with at most maxDepth turn actions before
   * them, on lines with at most maxPriorRaises raises on earlier streets (null = any line).
   */
  readonly turn: { readonly cards: readonly RiverCard[]; readonly maxDepth: number; readonly maxPriorRaises: number | null } | null;
  /** For each listed (turn, river) board, river decision nodes up to maxDepth (same line filter). */
  readonly river: {
    readonly boards: readonly (readonly [RiverCard, RiverCard])[]; readonly maxDepth: number; readonly maxPriorRaises: number | null;
  } | null;
  /** Decision nodes whose whole subtree is exported (strategies only) for referee spot-checks. */
  readonly subtrees: readonly (readonly string[])[];
  readonly equity: boolean;
}

export interface BridgeSliceNode {
  /** Canonical tokens from the root, e.g. ["x", "b363", "c", "Qh"]. */
  readonly path: readonly string[];
  readonly street: BridgeStreet;
  readonly board: readonly RiverCard[];
  readonly player: BridgePlayer;
  readonly committed: readonly [number, number];
  readonly actions: readonly { readonly action: BridgeAction; readonly engineAction: string; readonly token: string }[];
  /** strategy[a][h] of `player`; null = hand blocked by the board. */
  readonly strategy: readonly (readonly (number | null)[])[];
  /**
   * Acting player's EV per action and hand, "from now": chips won back from the pot minus
   * chips still to be paid (sunk chips excluded; fold = 0). null = blocked or zero reach.
   */
  readonly actionEv: readonly (readonly (number | null)[])[];
  /** Both players' from-now EV per hand under the saved strategy. */
  readonly ev: readonly [readonly (number | null)[], readonly (number | null)[]];
  /** Both players' reach: range weight × own action probabilities on the path (0 = blocked). */
  readonly reach: readonly [readonly number[], readonly number[]];
  readonly equity: readonly [readonly (number | null)[], readonly (number | null)[]] | null;
}

export interface BridgeSubtree {
  readonly path: readonly string[];
  readonly reach: readonly [readonly number[], readonly number[]];
  readonly ev: readonly [readonly (number | null)[], readonly (number | null)[]];
  /** Result-tree format with local ids; node 0 is the subtree root. */
  readonly nodes: readonly BridgeResultNode[];
}

export interface BridgeSlices {
  /** sha256 of the exact plan bytes the bridge read. */
  readonly planHash: string;
  readonly nodes: readonly BridgeSliceNode[];
  readonly subtrees: readonly BridgeSubtree[];
  /** Listed turn cards / "TtRr" boards the engine never dealt (dead cards). */
  readonly unreached: readonly string[];
}

const PATH_TOKEN = /^(?:x|c|f|[br][1-9][0-9]*|s[0-9]+|[2-9TJQKA][cdhs])$/;

/** Strict parse of a slice plan (unknown fields rejected, cards checked against the board). */
export function validateBridgeSlicePlan(input: unknown, board: BridgeBoard): BridgeSlicePlanV1 {
  const value = record(input, ["format", "version", "flop", "turn", "river", "subtrees", "equity"], "slices");
  if (value.format !== BRIDGE_SLICE_PLAN_FORMAT || value.version !== 1) fail(`slices must be ${BRIDGE_SLICE_PLAN_FORMAT} version 1`);
  if (board.turn !== null && (value.flop !== null || value.turn !== null)) fail("flop/turn slices need a flop spot");
  const known = new Set(boardCards(board));
  const offBoard = (c: unknown, label: string) => { const k = card(c, label); if (known.has(k)) fail(`${label} ${k} is on the board`); return k; };
  const depth = (v: unknown, label: string) => whole(v, label, 0, 20);
  const flop = value.flop === null ? null : (() => {
    const f = record(value.flop, ["maxDepth"], "slices.flop");
    return { maxDepth: f.maxDepth === null ? null : depth(f.maxDepth, "slices.flop.maxDepth") };
  })();
  const turn = value.turn === null ? null : (() => {
    const t = record(value.turn, ["cards", "maxDepth", "maxPriorRaises"], "slices.turn");
    if (!Array.isArray(t.cards) || t.cards.length > 49) fail("slices.turn.cards must list at most 49 cards");
    const cards = t.cards.map((c, i) => offBoard(c, `slices.turn.cards[${i}]`));
    if (new Set(cards).size !== cards.length) fail("slices.turn.cards repeats a card");
    return { cards, maxDepth: depth(t.maxDepth, "slices.turn.maxDepth"),
      maxPriorRaises: t.maxPriorRaises === null ? null : depth(t.maxPriorRaises, "slices.turn.maxPriorRaises") };
  })();
  const river = value.river === null ? null : (() => {
    const r = record(value.river, ["boards", "maxDepth", "maxPriorRaises"], "slices.river");
    if (!Array.isArray(r.boards) || r.boards.length > 2352) fail("slices.river.boards is too long");
    const boards = r.boards.map((b, i) => {
      if (!Array.isArray(b) || b.length !== 2) fail(`slices.river.boards[${i}] must be [turn, river]`);
      const pair = [offBoard(b[0], `slices.river.boards[${i}][0]`), offBoard(b[1], `slices.river.boards[${i}][1]`)] as const;
      if (pair[0] === pair[1]) fail(`slices.river.boards[${i}] repeats a card`);
      return pair;
    });
    if (new Set(boards.map(b => b.join())).size !== boards.length) fail("slices.river.boards repeats a board");
    return { boards, maxDepth: depth(r.maxDepth, "slices.river.maxDepth"),
      maxPriorRaises: r.maxPriorRaises === null ? null : depth(r.maxPriorRaises, "slices.river.maxPriorRaises") };
  })();
  if (!Array.isArray(value.subtrees) || value.subtrees.length > 64) fail("slices.subtrees must list at most 64 paths");
  const subtrees = value.subtrees.map((path, i) => {
    if (!Array.isArray(path) || path.length > 40 || path.some(t => typeof t !== "string" || !PATH_TOKEN.test(t))) fail(`slices.subtrees[${i}] is not a path`);
    return [...path] as string[];
  });
  if (typeof value.equity !== "boolean") fail("slices.equity must be a boolean");
  return { format: BRIDGE_SLICE_PLAN_FORMAT, version: 1, flop, turn, river, subtrees, equity: value.equity };
}

// ---------------------------------------------------------------------------------------
// Validation.

const CARD_INDEX = new Map(RIVER_DECK.map((card, index) => [card, index]));
const cardIndex = (card: RiverCard) => CARD_INDEX.get(card)!;

function fail(message: string): never {
  throw new Error(`Invalid bridge spot: ${message}`);
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  const unknown = actual.filter(key => !keys.includes(key));
  const missing = keys.filter(key => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    fail(`${label} has ${unknown.length ? `unknown fields ${unknown.join(",")}` : ""}${unknown.length && missing.length ? " and " : ""}${missing.length ? `missing fields ${missing.join(",")}` : ""}`);
  }
  return value as Record<string, unknown>;
}

function whole(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a whole number in [${minimum}, ${maximum}]; received ${String(value)}`);
  }
  return value;
}

function finite(value: unknown, label: string, minimum: number, maximum: number, exclusiveMinimum = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value > maximum
    || (exclusiveMinimum ? value <= minimum : value < minimum)) {
    fail(`${label} must be a finite number in ${exclusiveMinimum ? "(" : "["}${minimum}, ${maximum}]; received ${String(value)}`);
  }
  return value;
}

function card(value: unknown, label: string): RiverCard {
  if (!isRiverCard(value)) fail(`${label} is not a card: ${String(value)}`);
  return value;
}

export function streetsPlayed(board: BridgeBoard): readonly BridgeStreet[] {
  return board.turn === null ? BRIDGE_STREETS : board.river === null ? ["turn", "river"] : ["river"];
}

export function boardCards(board: BridgeBoard): readonly RiverCard[] {
  return [...board.flop, ...(board.turn ? [board.turn] : []), ...(board.river ? [board.river] : [])];
}

function validateBoard(input: unknown): BridgeBoard {
  const value = record(input, ["flop", "turn", "river"], "board");
  if (!Array.isArray(value.flop) || value.flop.length !== 3) fail("board.flop needs exactly three cards");
  const flop = value.flop.map((c, i) => card(c, `board.flop[${i}]`)) as unknown as BridgeBoard["flop"];
  const turn = value.turn === null ? null : card(value.turn, "board.turn");
  const river = value.river === null ? null : card(value.river, "board.river");
  if (river !== null && turn === null) fail("board.river requires board.turn");
  const board = { flop, turn, river };
  const cards = boardCards(board);
  if (new Set(cards).size !== cards.length) fail("board repeats a card");
  return board;
}

/** Canonical combo string: two distinct cards, higher deck index first. */
export function canonicalBridgeCombo(first: RiverCard, second: RiverCard): string {
  if (first === second) throw new Error(`A combo repeats ${first}`);
  return cardIndex(first) > cardIndex(second) ? `${first}${second}` : `${second}${first}`;
}

export function parseBridgeCombo(combo: string): readonly [RiverCard, RiverCard] {
  const first = combo.slice(0, 2), second = combo.slice(2, 4);
  if (combo.length !== 4 || !isRiverCard(first) || !isRiverCard(second) || first === second) {
    throw new Error(`Invalid combo ${combo}`);
  }
  return [first, second];
}

/** Sort key used for BridgeRange.combos: (first card index, second card index) ascending. */
export function compareBridgeCombos(left: string, right: string): number {
  const [a1, a2] = parseBridgeCombo(left), [b1, b2] = parseBridgeCombo(right);
  return cardIndex(a1) - cardIndex(b1) || cardIndex(a2) - cardIndex(b2);
}

function validateRange(input: unknown, player: BridgePlayer, board: readonly RiverCard[]): BridgeRange {
  const value = record(input, ["source", "combos"], `ranges[${player}]`);
  if (typeof value.source !== "string" || !value.source.trim() || value.source.length > 500) {
    fail(`ranges[${player}].source must be 1..500 characters`);
  }
  if (!Array.isArray(value.combos) || value.combos.length === 0) fail(`ranges[${player}] is empty`);
  if (value.combos.length > 1326) fail(`ranges[${player}] has more than 1326 combos`);
  const blocked = new Set(board);
  const combos: BridgeRangeEntry[] = [];
  let previous: string | null = null;
  for (let index = 0; index < value.combos.length; index += 1) {
    const entry = record(value.combos[index], ["combo", "weight"], `ranges[${player}].combos[${index}]`);
    if (typeof entry.combo !== "string") fail(`ranges[${player}].combos[${index}].combo must be a string`);
    let cards: readonly [RiverCard, RiverCard];
    try { cards = parseBridgeCombo(entry.combo); } catch { fail(`ranges[${player}] has invalid combo ${entry.combo}`); }
    if (canonicalBridgeCombo(cards[0], cards[1]) !== entry.combo) {
      fail(`ranges[${player}] combo ${entry.combo} is not canonical (higher card first)`);
    }
    if (cards.some(c => blocked.has(c))) fail(`ranges[${player}] combo ${entry.combo} overlaps the board`);
    if (previous !== null && compareBridgeCombos(previous, entry.combo) >= 0) {
      fail(`ranges[${player}] combos must be unique and sorted; ${entry.combo} follows ${previous}`);
    }
    const weight = finite(entry.weight, `ranges[${player}] weight of ${entry.combo}`, 0, 1, true);
    if (Math.fround(weight) !== weight) fail(`ranges[${player}] weight of ${entry.combo} is not exactly representable as float32`);
    combos.push({ combo: entry.combo, weight });
    previous = entry.combo;
  }
  return { source: value.source, combos };
}

function validateBetSize(input: unknown, label: string, allowPrevBet: boolean): BridgeBetSize {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${label} must be an object`);
  const kind = (input as { kind?: unknown }).kind;
  switch (kind) {
    case "pot": {
      const value = record(input, ["kind", "pct"], label);
      return { kind, pct: finite(value.pct, `${label}.pct`, 0, 100_000, true) };
    }
    case "prevBet": {
      if (!allowPrevBet) fail(`${label}: prevBet sizes are only valid for raises`);
      const value = record(input, ["kind", "multiple"], label);
      return { kind, multiple: finite(value.multiple, `${label}.multiple`, 1, 1000, true) };
    }
    case "chips": {
      const value = record(input, ["kind", "amount", "raiseCap"], label);
      return { kind, amount: whole(value.amount, `${label}.amount`, 1, BRIDGE_LIMITS.maxChips),
        raiseCap: whole(value.raiseCap, `${label}.raiseCap`, 0, 100) };
    }
    case "geometric": {
      const value = record(input, ["kind", "streets", "maxPct"], label);
      return { kind, streets: whole(value.streets, `${label}.streets`, 0, 100),
        maxPct: value.maxPct === null ? null : finite(value.maxPct, `${label}.maxPct`, 0, 100_000, true) };
    }
    case "allin":
      record(input, ["kind"], label);
      return { kind };
    default:
      fail(`${label} has unknown kind ${String(kind)}`);
  }
}

function validateSizeList(input: unknown, label: string, allowPrevBet: boolean): readonly BridgeBetSize[] {
  if (!Array.isArray(input) || input.length > BRIDGE_LIMITS.maxSizesPerList) {
    fail(`${label} must be a list of at most ${BRIDGE_LIMITS.maxSizesPerList} sizes`);
  }
  const sizes = input.map((size, i) => validateBetSize(size, `${label}[${i}]`, allowPrevBet));
  const keys = sizes.map(size => JSON.stringify(size));
  if (new Set(keys).size !== keys.length) fail(`${label} repeats a size`);
  return sizes;
}

function validateMenu(input: unknown, label: string): BridgeBetSizeMenu {
  const value = record(input, ["bet", "raise"], label);
  return { bet: validateSizeList(value.bet, `${label}.bet`, false), raise: validateSizeList(value.raise, `${label}.raise`, true) };
}

function validateMenuTree(value: Record<string, unknown>, board: BridgeBoard): BridgeMenuTree {
  record(value, ["mode", "flop", "turn", "river", "turnDonk", "riverDonk", "addAllInThreshold",
    "forceAllInThreshold", "mergingThreshold", "maxRaisesPerStreet"], "tree");
  const played = new Set(streetsPlayed(board));
  const street = (name: BridgeStreet): BridgeStreetMenu | null => {
    const menu = value[name];
    if (!played.has(name)) {
      if (menu !== null) fail(`tree.${name} must be null: that street is already dealt`);
      return null;
    }
    const streetMenu = record(menu, ["oop", "ip"], `tree.${name}`);
    return { oop: validateMenu(streetMenu.oop, `tree.${name}.oop`), ip: validateMenu(streetMenu.ip, `tree.${name}.ip`) };
  };
  const donk = (name: "turnDonk" | "riverDonk", streetName: BridgeStreet) => {
    if (value[name] === null) return null;
    // A donk bet needs a previous street, so a turn lead exists only in flop spots.
    if (!played.has(streetName) || streetsPlayed(board)[0] === streetName) fail(`tree.${name} must be null in this spot`);
    const sizes = validateSizeList(value[name], `tree.${name}`, false);
    if (!sizes.length) fail(`tree.${name} must be null or non-empty`);
    return sizes;
  };
  return {
    mode: "menu", flop: street("flop"), turn: street("turn"), river: street("river"),
    turnDonk: donk("turnDonk", "turn"), riverDonk: donk("riverDonk", "river"),
    addAllInThreshold: finite(value.addAllInThreshold, "tree.addAllInThreshold", 0, 1000),
    forceAllInThreshold: finite(value.forceAllInThreshold, "tree.forceAllInThreshold", 0, 1000),
    mergingThreshold: finite(value.mergingThreshold, "tree.mergingThreshold", 0, 1000),
    maxRaisesPerStreet: value.maxRaisesPerStreet === null ? null : whole(value.maxRaisesPerStreet, "tree.maxRaisesPerStreet", 0, 100),
  };
}

/** Public betting state used to validate explicit trees and export them. */
interface BettingState {
  readonly street: number; // index into BRIDGE_STREETS
  readonly actor: BridgePlayer;
  /** Chips each player put in on closed streets (always equal: streets close matched). */
  readonly closed: number;
  readonly streetPut: readonly [number, number];
  readonly checks: number;
}

const actionOrder = (action: BridgeAction) =>
  ({ fold: 0, check: 1, call: 2, bet: 3, raise: 4 })[action.type] * 1e12 + ("to" in action ? action.to : 0);

function validateAction(input: unknown, label: string): BridgeAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${label} must be an object`);
  const type = (input as { type?: unknown }).type;
  if (type === "fold" || type === "check" || type === "call") {
    record(input, ["type"], label);
    return { type };
  }
  if (type === "bet" || type === "raise") {
    const value = record(input, ["type", "to"], label);
    return { type, to: whole(value.to, `${label}.to`, 1, BRIDGE_LIMITS.maxChips) };
  }
  fail(`${label} has unknown type ${String(type)}`);
}

/** Legal public actions in the chip model shared by both engines (equal effective stacks). */
function actionIsLegal(state: BettingState, stack: number, action: BridgeAction): string | null {
  const facing = state.streetPut[state.actor] < Math.max(...state.streetPut);
  const currentBet = Math.max(...state.streetPut);
  const maxTo = stack - state.closed;
  switch (action.type) {
    case "fold": case "call": return facing ? null : `${action.type} is only legal facing a bet`;
    case "check": return facing ? "check is illegal facing a bet" : null;
    case "bet":
      if (facing) return "bet is illegal facing a bet (use raise)";
      return action.to <= maxTo ? null : `bet to ${action.to} exceeds the all-in total ${maxTo}`;
    case "raise": {
      if (!facing) return "raise needs a bet to raise";
      if (currentBet >= maxTo) return "cannot raise an all-in";
      if (action.to > maxTo) return `raise to ${action.to} exceeds the all-in total ${maxTo}`;
      const minimum = currentBet + (currentBet - state.streetPut[state.actor]);
      return action.to >= minimum || action.to === maxTo ? null
        : `raise to ${action.to} is below the minimum raise to ${minimum} and is not all-in`;
    }
  }
}

type NextState =
  | { readonly kind: "player"; readonly state: BettingState }
  | { readonly kind: "chance"; readonly state: BettingState }
  | { readonly kind: "terminal"; readonly outcome: "fold" | "showdown"; readonly folder: BridgePlayer | null; readonly committed: readonly [number, number] };

function applyAction(state: BettingState, stack: number, action: BridgeAction): NextState {
  const actor = state.actor, other = (1 - actor) as BridgePlayer;
  const put = [...state.streetPut] as [number, number];
  const committed = (p: readonly [number, number]) => [state.closed + p[0], state.closed + p[1]] as const;
  const closeStreet = (matched: number): NextState => {
    const closed = state.closed + matched;
    if (state.street === 2 || closed === stack) return { kind: "terminal", outcome: "showdown", folder: null, committed: [closed, closed] };
    return { kind: "chance", state: { street: state.street + 1, actor: 0, closed, streetPut: [0, 0], checks: 0 } };
  };
  switch (action.type) {
    case "fold": return { kind: "terminal", outcome: "fold", folder: actor, committed: committed(put) };
    case "check":
      if (state.checks === 1 || actor === 1) return closeStreet(0);
      return { kind: "player", state: { ...state, actor: other, checks: 1 } };
    case "call": return closeStreet(Math.max(...put));
    case "bet": case "raise":
      put[actor] = action.to;
      return { kind: "player", state: { ...state, actor: other, streetPut: put, checks: 0 } };
  }
}

function initialBettingState(board: BridgeBoard): BettingState {
  return { street: BRIDGE_STREETS.indexOf(streetsPlayed(board)[0]), actor: 0, closed: 0, streetPut: [0, 0], checks: 0 };
}

function validateExplicitTree(value: Record<string, unknown>, board: BridgeBoard, stack: number): BridgeExplicitTree {
  record(value, ["mode", "root"], "tree");
  let nodes = 0;
  const visit = (input: unknown, expected: NextState, path: string): BridgeExplicitNode => {
    nodes += 1;
    if (nodes > BRIDGE_LIMITS.maxExplicitNodes) fail(`explicit tree exceeds ${BRIDGE_LIMITS.maxExplicitNodes} nodes`);
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${path} must be a node object`);
    const kind = (input as { kind?: unknown }).kind;
    if (kind !== expected.kind) fail(`${path} must be a ${expected.kind} node; found ${String(kind)}`);
    if (expected.kind === "terminal") {
      const node = record(input, ["kind", "outcome"], path);
      if (node.outcome !== expected.outcome) fail(`${path} must end in ${expected.outcome}; found ${String(node.outcome)}`);
      return { kind: "terminal", outcome: expected.outcome };
    }
    if (expected.kind === "chance") {
      const node = record(input, ["kind", "next"], path);
      return { kind: "chance", next: visit(node.next, { kind: "player", state: expected.state }, `${path}.next`) };
    }
    const node = record(input, ["kind", "player", "actions"], path);
    const state = expected.state;
    if (node.player !== state.actor) fail(`${path} must be player ${state.actor} to act; found ${String(node.player)}`);
    if (!Array.isArray(node.actions) || node.actions.length === 0) fail(`${path} needs at least one action`);
    const facing = state.streetPut[state.actor] < Math.max(...state.streetPut);
    const actions = node.actions.map((entry, index) => {
      const edge = record(entry, ["action", "next"], `${path}.actions[${index}]`);
      const action = validateAction(edge.action, `${path}.actions[${index}].action`);
      const illegal = actionIsLegal(state, stack, action);
      if (illegal) fail(`${path}.actions[${index}]: ${illegal}`);
      const label = action.type + ("to" in action ? action.to : "");
      return { action, next: visit(edge.next, applyAction(state, stack, action), `${path}/${label}`) };
    });
    for (let i = 1; i < actions.length; i += 1) {
      if (actionOrder(actions[i - 1].action) >= actionOrder(actions[i].action)) {
        fail(`${path} actions must be unique and in canonical order (fold, check, call, bets/raises by amount)`);
      }
    }
    const types = new Set(actions.map(a => a.action.type));
    if (facing && !(types.has("fold") && types.has("call"))) fail(`${path} facing a bet must offer fold and call`);
    if (!facing && !types.has("check")) fail(`${path} must offer check`);
    return { kind: "player", player: state.actor, actions };
  };
  return { mode: "explicit", root: visit(value.root, { kind: "player", state: initialBettingState(board) }, "tree.root") };
}

function validateSolve(input: unknown): BridgeSolveOptions {
  const value = record(input, ["targetExploitabilityPctPot", "maxIterations", "memoryCapBytes", "timeoutMs",
    "compression", "exportScope"], "solve");
  if (value.compression !== "off" && value.compression !== "on" && value.compression !== "auto") {
    fail("solve.compression must be off, on or auto");
  }
  if (value.exportScope !== "full" && value.exportScope !== "first-street") fail("solve.exportScope must be full or first-street");
  return {
    targetExploitabilityPctPot: finite(value.targetExploitabilityPctPot, "solve.targetExploitabilityPctPot", 0, 100, true),
    maxIterations: whole(value.maxIterations, "solve.maxIterations", 1, BRIDGE_LIMITS.maxIterations),
    memoryCapBytes: whole(value.memoryCapBytes, "solve.memoryCapBytes", 1, Number.MAX_SAFE_INTEGER),
    timeoutMs: whole(value.timeoutMs, "solve.timeoutMs", 1, BRIDGE_LIMITS.maxTimeoutMs),
    compression: value.compression, exportScope: value.exportScope,
  };
}

/** Strict parse of an untrusted spot. Returns a fresh normalized copy or throws. */
export function validateBridgeSpot(input: unknown): BridgeSpotV1 {
  const value = record(input, ["format", "version", "id", "board", "ranges", "startingPot", "effectiveStack",
    "rake", "tree", "solve"], "spot");
  if (value.format !== BRIDGE_SPOT_FORMAT) fail(`format must be ${BRIDGE_SPOT_FORMAT}`);
  if (value.version !== BRIDGE_CONTRACT_VERSION) fail(`unsupported version ${String(value.version)}`);
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.id) || value.id.length > BRIDGE_LIMITS.maxIdLength) {
    fail("id must be lowercase letters, digits and dashes");
  }
  const board = validateBoard(value.board);
  if (!Array.isArray(value.ranges) || value.ranges.length !== 2) fail("ranges must list [oop, ip]");
  const known = boardCards(board);
  const ranges = [validateRange(value.ranges[0], 0, known), validateRange(value.ranges[1], 1, known)] as const;
  const opponent = ranges[1].combos.map(e => parseBridgeCombo(e.combo));
  const compatible = ranges[0].combos.some(e => {
    const cards = parseBridgeCombo(e.combo);
    return opponent.some(other => !other.some(c => cards.includes(c)));
  });
  if (!compatible) fail("no non-overlapping pair of hands exists between the two ranges");
  const startingPot = whole(value.startingPot, "startingPot", 1, BRIDGE_LIMITS.maxChips);
  const effectiveStack = whole(value.effectiveStack, "effectiveStack", 1, BRIDGE_LIMITS.maxChips);
  if (value.rake !== 0) fail("rake must be 0 in contract v1");
  const treeInput = value.tree;
  if (!treeInput || typeof treeInput !== "object" || Array.isArray(treeInput)) fail("tree must be an object");
  const mode = (treeInput as { mode?: unknown }).mode;
  const tree = mode === "menu" ? validateMenuTree(treeInput as Record<string, unknown>, board)
    : mode === "explicit" ? validateExplicitTree(treeInput as Record<string, unknown>, board, effectiveStack)
      : fail("tree.mode must be menu or explicit");
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: value.id, board, ranges, startingPot, effectiveStack, rake: 0,
    tree, solve: validateSolve(value.solve),
  };
}

/** Walk an explicit tree with the shared betting model (used by fixtures, tests and B2). */
export function explicitTreeStats(tree: BridgeExplicitTree): { players: number; chances: number; terminals: number } {
  const stats = { players: 0, chances: 0, terminals: 0 };
  const visit = (node: BridgeExplicitNode): void => {
    if (node.kind === "terminal") { stats.terminals += 1; return; }
    if (node.kind === "chance") { stats.chances += 1; visit(node.next); return; }
    stats.players += 1;
    node.actions.forEach(edge => visit(edge.next));
  };
  visit(tree.root);
  return stats;
}

/**
 * Build an explicit tree by walking any engine's public betting rules. `legal` returns the
 * engine's actions (already in contract form) for a history of contract actions.
 */
export function buildExplicitTree(
  board: BridgeBoard,
  effectiveStack: number,
  legal: (history: readonly BridgeAction[], state: { street: BridgeStreet; streetPut: readonly [number, number]; closed: number }) => readonly BridgeAction[],
): BridgeExplicitTree {
  const visit = (expected: NextState, history: readonly BridgeAction[]): BridgeExplicitNode => {
    if (expected.kind === "terminal") return { kind: "terminal", outcome: expected.outcome };
    if (expected.kind === "chance") return { kind: "chance", next: visit({ kind: "player", state: expected.state }, history) };
    const state = expected.state;
    const actions = [...legal(history, { street: BRIDGE_STREETS[state.street], streetPut: state.streetPut, closed: state.closed })]
      .sort((a, b) => actionOrder(a) - actionOrder(b));
    return { kind: "player", player: state.actor, actions: actions.map(action => {
      const illegal = actionIsLegal(state, effectiveStack, action);
      if (illegal) throw new Error(`Engine offered an action outside the bridge chip model: ${illegal}`);
      return { action, next: visit(applyAction(state, effectiveStack, action), [...history, action]) };
    }) };
  };
  return { mode: "explicit", root: visit({ kind: "player", state: initialBettingState(board) }, []) };
}

// ---------------------------------------------------------------------------------------
// Light structural check of a bridge result before anything is published.

export function checkBridgeResult(result: unknown, spot: BridgeSpotV1, spotHash: string): BridgeResultV1 {
  const bad = (message: string): never => { throw new Error(`Invalid bridge result: ${message}`); };
  if (!result || typeof result !== "object") bad("not an object");
  const value = result as BridgeResultV1;
  if (value.format !== BRIDGE_RESULT_FORMAT || value.version !== 1) bad("wrong format or version");
  if (value.spotHash !== spotHash || value.spotId !== spot.id) bad("spot hash/id mismatch");
  if (value.engine?.name !== "postflop-solver" || value.engine.commit !== POSTFLOP_SOLVER_COMMIT) bad("unexpected engine identity");
  for (const player of [0, 1] as const) {
    const expected = spot.ranges[player].combos.map(e => e.combo);
    if (!Array.isArray(value.hands?.[player]) || value.hands[player].join() !== expected.join()) bad(`hands[${player}] differ from the spot range`);
    for (const key of ["ev", "engineEv", "equity", "weights"] as const) {
      const row = value.root?.[key]?.[player];
      if (!Array.isArray(row) || row.length !== expected.length || row.some(x => typeof x !== "number" || !Number.isFinite(x))) {
        bad(`root.${key}[${player}] is malformed`);
      }
    }
  }
  if (!Array.isArray(value.tree) || value.tree.length === 0) bad("empty tree");
  value.tree.forEach((node, id) => {
    if (node.id !== id) bad(`node ${id} has id ${node.id}`);
    const childIds = node.kind === "player" ? node.actions.map(a => a.child) : node.kind === "chance" ? node.children.map(c => c.child) : [];
    if (childIds.some(child => !Number.isSafeInteger(child) || child <= id || child >= value.tree.length)) bad(`node ${id} has invalid children`);
    if (node.kind === "player") {
      const hands = value.hands[node.player].length;
      if (node.strategy.length !== node.actions.length || node.strategy.some(row => row.length !== hands)) bad(`node ${id} strategy shape`);
      for (let h = 0; h < hands; h += 1) {
        const column = node.strategy.map(row => row[h]);
        if (column.every(p => p === null)) continue;
        if (column.some(p => p === null || p < -1e-6 || p > 1 + 1e-6)) bad(`node ${id} hand ${h} has invalid probabilities`);
        const sum = (column as number[]).reduce((s, p) => s + p, 0);
        if (Math.abs(sum - 1) > 1e-4) bad(`node ${id} hand ${h} probabilities sum to ${sum}`);
      }
    }
  });
  if (!Number.isFinite(value.exploitability?.chips) || !Number.isSafeInteger(value.iterations)) bad("missing exploitability/iterations");
  if (value.slices !== undefined) checkSlices(value.slices, value.hands, bad);
  return value;
}

function checkSlices(slices: BridgeSlices, hands: BridgeResultV1["hands"], bad: (message: string) => never): void {
  if (!slices || !/^[0-9a-f]{64}$/.test(slices.planHash) || !Array.isArray(slices.nodes) || !Array.isArray(slices.subtrees)) bad("slices are malformed");
  const row = (r: readonly unknown[], length: number, nullable: boolean, label: string) => {
    if (!Array.isArray(r) || r.length !== length || r.some(x => (x === null ? !nullable : typeof x !== "number" || !Number.isFinite(x)))) bad(`${label} is malformed`);
  };
  slices.nodes.forEach((node: BridgeSliceNode, n: number) => {
    const label = `slices.nodes[${n}] (${node.path?.join(" ")})`, count = hands[node.player]?.length;
    if (count === undefined || !Array.isArray(node.actions) || !node.actions.length) bad(`${label} has no actions`);
    if (node.strategy.length !== node.actions.length || node.actionEv.length !== node.actions.length) bad(`${label} shape`);
    node.strategy.forEach((r: readonly (number | null)[], a: number) => row(r, count, true, `${label} strategy[${a}]`));
    node.actionEv.forEach((r: readonly (number | null)[], a: number) => row(r, count, true, `${label} actionEv[${a}]`));
    for (const p of [0, 1] as const) {
      row(node.ev[p], hands[p].length, true, `${label} ev[${p}]`);
      row(node.reach[p], hands[p].length, false, `${label} reach[${p}]`);
      if (node.reach[p].some((x: number) => x < 0 || x > 1 + 1e-6)) bad(`${label} reach[${p}] outside [0, 1]`);
      if (node.equity) row(node.equity[p], hands[p].length, true, `${label} equity[${p}]`);
    }
    for (let h = 0; h < count; h += 1) {
      const column = node.strategy.map((r: readonly (number | null)[]) => r[h]);
      if (column.every((p: number | null) => p === null)) continue;
      if (column.some((p: number | null) => p === null || p < -1e-6 || p > 1 + 1e-6)) bad(`${label} hand ${h} has invalid probabilities`);
      const sum = (column as number[]).reduce((t, p) => t + p, 0);
      if (Math.abs(sum - 1) > 1e-4) bad(`${label} hand ${h} probabilities sum to ${sum}`);
    }
  });
  slices.subtrees.forEach((tree, t) => {
    if (!Array.isArray(tree.nodes) || !tree.nodes.length || tree.nodes[0].kind !== "player") bad(`slices.subtrees[${t}] must start at a decision node`);
    for (const p of [0, 1] as const) { row(tree.reach[p], hands[p].length, false, `subtree ${t} reach[${p}]`); row(tree.ev[p], hands[p].length, true, `subtree ${t} ev[${p}]`); }
  });
}
