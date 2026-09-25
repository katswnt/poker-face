/**
 * Public state + ranges → bridge Spot v1 for a re-solve rooted at the current public state.
 *
 * No-leak contract (spec 2.2): the input type carries only the public state, the AI's exact
 * reach and the modelled human reach. There is no field for anyone's hole cards, and a runtime
 * whitelist rejects any extra field (e.g. a spread-in `humanHand`), so the spot, its hash input
 * and the cache key derived from it are functions of public information and ranges only. The
 * AI's own hand is excluded too: every solve covers the whole AI range, which also makes solve
 * time independent of the AI's hand.
 *
 * Contract v1 spots start at a street root (player 0 to act, nothing in yet), so this builds
 * street-root re-solves (spec 2.3). Mid-street (nested, P2) roots need an explicit tree with the
 * actual prefix and are rejected here.
 *
 * Browser-safe: hash the result with contract-node.ts hashBridgeSpot where node:crypto exists.
 */
import {
  BRIDGE_SPOT_FORMAT, compareBridgeCombos, parseBridgeCombo, streetsPlayed, validateBridgeSpot,
  type BridgeMenuTree, type BridgePlayer, type BridgeRange, type BridgeSolveOptions, type BridgeSpotV1,
} from "../solver/bridge/contract";
import { isStreetRoot, validatePublicState } from "./public-state";
import { fnv1a } from "./rng";
import type { HeadsUpPublicState, HuRange } from "./types";

export interface ResolveSpotInput {
  readonly publicState: HeadsUpPublicState;
  readonly aiSeat: BridgePlayer;
  /** AI: exact reach from its played strategy. Human: the solver's model. */
  readonly ranges: { readonly ai: HuRange; readonly human: HuRange };
  /** Street menus for every street (streets already dealt are nulled for the spot). */
  readonly tree: BridgeMenuTree;
  readonly solve: BridgeSolveOptions;
  /** Drop combos whose reach is below this fraction of the player's largest reach (0 = keep all > 0). */
  readonly minimumRelativeReach: number;
}

const INPUT_KEYS = ["publicState", "aiSeat", "ranges", "tree", "solve", "minimumRelativeReach"];

/** Live re-solve defaults: float32 only, deterministic iteration budget, first-street export. */
export const HU_RESOLVE_SOLVE: BridgeSolveOptions = Object.freeze({
  targetExploitabilityPctPot: 0.3, maxIterations: 1000, memoryCapBytes: 4 * 1024 ** 3, timeoutMs: 60_000,
  compression: "off", exportScope: "first-street",
});

function fail(message: string): never {
  throw new Error(`Cannot build re-solve spot: ${message}`);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const extra = Object.keys(value).filter(k => !keys.includes(k));
  const missing = keys.filter(k => !Object.hasOwn(value, k));
  if (extra.length) fail(`${label} has unexpected fields ${extra.join(",")} (only public state and ranges may enter a spot)`);
  if (missing.length) fail(`${label} is missing ${missing.join(",")}`);
  return value as Record<string, unknown>;
}

function toBridgeRange(input: unknown, label: string, blocked: ReadonlySet<string>, minimumRelativeReach: number): BridgeRange {
  const range = exactKeys(input, ["source", "entries"], label);
  if (typeof range.source !== "string") fail(`${label}.source must be a string`);
  if (!Array.isArray(range.entries)) fail(`${label}.entries must be a list`);
  const entries = range.entries.map((raw, i) => {
    const e = exactKeys(raw, ["combo", "weight"], `${label}.entries[${i}]`);
    if (typeof e.combo !== "string" || typeof e.weight !== "number" || !(e.weight >= 0) || !Number.isFinite(e.weight)) {
      fail(`${label}.entries[${i}] needs a combo and a finite weight ≥ 0`);
    }
    return { combo: e.combo, weight: e.weight };
  });
  const maximum = Math.max(0, ...entries.map(e => e.weight));
  if (!(maximum > 0)) fail(`${label} has no reach left`);
  const combos = entries
    .filter(e => !parseBridgeCombo(e.combo).some(c => blocked.has(c)))
    .filter(e => e.weight > 0 && e.weight >= minimumRelativeReach * maximum)
    .map(e => ({ combo: e.combo, weight: Math.fround(e.weight / maximum) }))
    .filter(e => e.weight > 0)
    .sort((a, b) => compareBridgeCombos(a.combo, b.combo));
  return { source: range.source.slice(0, 500), combos };
}

/** The spot for a street-root re-solve at `input.publicState`. Throws on any illegal input. */
export function buildResolveSpot(input: ResolveSpotInput): BridgeSpotV1 {
  const value = exactKeys(input, INPUT_KEYS, "input");
  const state = validatePublicState(value.publicState);
  if (value.aiSeat !== 0 && value.aiSeat !== 1) fail("aiSeat must be 0 or 1");
  const aiSeat = value.aiSeat as BridgePlayer;
  if (state.status === "fold" || state.status === "showdown") fail(`the hand is over (${state.status})`);
  if (state.status === "chance") fail("the next card is due; build the spot after it is dealt");
  if (!isStreetRoot(state)) {
    fail(`the ${state.street} already has ${state.streetActions} action(s); contract v1 spots start at a street root (nested roots are P2)`);
  }
  const stack = state.stacks[0];
  if (stack !== state.stacks[1] || stack <= 0) fail("both players need equal, positive stacks behind");
  const minimumRelativeReach = value.minimumRelativeReach;
  if (typeof minimumRelativeReach !== "number" || !(minimumRelativeReach >= 0 && minimumRelativeReach < 1)) {
    fail("minimumRelativeReach must be in [0, 1)");
  }
  const rangesInput = exactKeys(value.ranges, ["ai", "human"], "ranges");
  const blocked = new Set<string>([...state.board.flop, ...(state.board.turn ? [state.board.turn] : []),
    ...(state.board.river ? [state.board.river] : [])]);
  const ai = toBridgeRange(rangesInput.ai, "ranges.ai", blocked, minimumRelativeReach);
  const human = toBridgeRange(rangesInput.human, "ranges.human", blocked, minimumRelativeReach);
  const tree = value.tree as BridgeMenuTree;
  if (!tree || tree.mode !== "menu") fail("tree must be a menu tree");
  const played = new Set(streetsPlayed(state.board));
  const first = streetsPlayed(state.board)[0];
  const spotTree: BridgeMenuTree = {
    ...tree,
    flop: played.has("flop") ? tree.flop : null,
    turn: played.has("turn") ? tree.turn : null,
    river: tree.river,
    turnDonk: played.has("turn") && first !== "turn" ? tree.turnDonk : null,
    riverDonk: first !== "river" ? tree.riverDonk : null,
  };
  // The id names the public line only (hash of the public event list), never a private card.
  const id = `hu-${state.street}-${fnv1a(JSON.stringify([state.startingPot, state.startingStack, state.flop, state.events])).toString(16).padStart(8, "0")}`;
  return validateBridgeSpot({
    format: BRIDGE_SPOT_FORMAT, version: 1, id, board: state.board,
    ranges: aiSeat === 0 ? [ai, human] : [human, ai],
    startingPot: state.pot, effectiveStack: stack, rake: 0, tree: spotTree, solve: value.solve,
  });
}
