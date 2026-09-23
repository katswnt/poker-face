import { assertDistinctRiverCards, RIVER_DECK, riverComboKey, type RiverCard, type RiverCombo } from "../../river/cards";

export type TurnV2Action = "check" | "fold" | "call" | `bet-to-${number}` | `raise-to-${number}`;
export interface TurnV2Menu {
  readonly openingTargets: readonly number[];
  readonly raiseTargets: readonly number[];
  readonly raiseLimit: 0 | 1;
  readonly includeAllIn: boolean;
}
export interface TurnV2Request {
  readonly id: string;
  readonly version: 2;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard];
  readonly rangeText: readonly [string, string];
  readonly committedPerPlayer: number;
  readonly stackBehind: readonly [number, number];
  readonly streets: readonly [TurnV2Menu, TurnV2Menu];
}
export interface TurnV2State {
  readonly phase: "play" | "river-card" | "terminal";
  readonly street: 0 | 1;
  readonly river: RiverCard | null;
  readonly histories: readonly [readonly TurnV2Action[], readonly TurnV2Action[]];
  /** Matched payments per player from closed streets, excluding the prior pot. */
  readonly carried: number;
  readonly streetPaid: readonly [number, number];
  readonly returned: readonly [number, number];
  readonly currentBet: number;
  readonly lastFullRaise: number;
  readonly raisesUsed: number;
  readonly checks: number;
  readonly actor: 0 | 1 | null;
  readonly folded: 0 | 1 | null;
}

function object(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}
function amount(value: unknown, zero = false): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 1_000_000) {
    throw new Error("Amounts must be whole chips within the declared 1,000,000-chip limit");
  }
}
function menu(value: unknown): TurnV2Menu {
  object(value, ["openingTargets", "raiseTargets", "raiseLimit", "includeAllIn"], "Street menu");
  const targets = (input: unknown, minimum: number) => {
    if (!Array.isArray(input) || input.length < minimum || input.length > 3 || new Set(input).size !== input.length) {
      throw new Error("Each menu needs distinct targets: 1..3 openings and 0..3 raises");
    }
    for (const value of input) amount(value); // Iteration checks sparse-array holes too.
    return Object.freeze([...input].sort((a: number, b: number) => a - b)) as readonly number[];
  };
  const openingTargets = targets(value.openingTargets, 1), raiseTargets = targets(value.raiseTargets, 0);
  if (value.raiseLimit !== 0 && value.raiseLimit !== 1) throw new Error("Turn v2 permits zero or one raise per street");
  if (typeof value.includeAllIn !== "boolean") throw new Error("includeAllIn must be a boolean");
  if (value.raiseLimit && !raiseTargets.length && !value.includeAllIn) throw new Error("A raise limit needs a raise target or all-in option");
  return Object.freeze({ openingTargets, raiseTargets, raiseLimit: value.raiseLimit, includeAllIn: value.includeAllIn });
}
export function validateTurnV2Request(input: unknown): TurnV2Request {
  object(input, ["id", "version", "board", "rangeText", "committedPerPlayer", "stackBehind", "streets"], "Turn v2 request");
  if (input.version !== 2) throw new Error("Expected turn rules version 2");
  if (typeof input.id !== "string" || !input.id.trim() || input.id.length > 128) throw new Error("Request id must contain 1..128 characters");
  if (!Array.isArray(input.board) || input.board.length !== 4) throw new Error("Turn v2 needs four board cards");
  assertDistinctRiverCards([...input.board], "Turn v2 board");
  if (!Array.isArray(input.rangeText) || input.rangeText.length !== 2
    || Array.from(input.rangeText).some(text => typeof text !== "string" || !text.trim() || text.length > 16384)) throw new Error("Two bounded range strings are required");
  amount(input.committedPerPlayer);
  if (!Array.isArray(input.stackBehind) || input.stackBehind.length !== 2) throw new Error("Two stacks are required");
  for (const stack of input.stackBehind) amount(stack, true);
  if (!Array.isArray(input.streets) || input.streets.length !== 2) throw new Error("Turn and river menus are required");
  return Object.freeze({ id: input.id, version: 2, board: Object.freeze([...input.board]) as TurnV2Request["board"],
    rangeText: Object.freeze([...input.rangeText]) as TurnV2Request["rangeText"], committedPerPlayer: input.committedPerPlayer,
    stackBehind: Object.freeze([...input.stackBehind]) as TurnV2Request["stackBehind"],
    streets: Object.freeze(Array.from(input.streets, menu)) as unknown as TurnV2Request["streets"] });
}

function freeze(state: TurnV2State): TurnV2State {
  return Object.freeze({ ...state, streetPaid: Object.freeze([...state.streetPaid]) as TurnV2State["streetPaid"],
    returned: Object.freeze([...state.returned]) as TurnV2State["returned"],
    histories: Object.freeze(state.histories.map(history => Object.freeze([...history]))) as unknown as TurnV2State["histories"] });
}
export function initialTurnV2State(request: TurnV2Request): TurnV2State {
  const allIn = request.stackBehind.includes(0);
  return freeze({ phase: allIn ? "river-card" : "play", street: 0, river: null, histories: [[], []], carried: 0,
    streetPaid: [0, 0], returned: [0, 0], currentBet: 0, lastFullRaise: 0, raisesUsed: 0, checks: 0,
    actor: allIn ? null : 0, folded: null });
}
export function remainingTurnV2(request: TurnV2Request, state: TurnV2State, player: 0 | 1): number {
  return request.stackBehind[player] - state.carried - state.streetPaid[player];
}
/** Public actions have no dependency on either private hand or an unseen river. */
export function turnV2Actions(request: TurnV2Request, state: TurnV2State): readonly TurnV2Action[] {
  if (state.phase !== "play" || state.actor === null) return [];
  const actor = state.actor, other = (1 - actor) as 0 | 1, settings = request.streets[state.street];
  const maximum = request.stackBehind[actor] - state.carried;
  const facing = state.currentBet > state.streetPaid[actor];
  const result: TurnV2Action[] = facing ? ["fold", "call"] : ["check"];
  if (remainingTurnV2(request, state, other) <= 0 || remainingTurnV2(request, state, actor) <= 0
    || (facing && state.raisesUsed >= settings.raiseLimit)) return result;
  const candidates = new Set(facing ? settings.raiseTargets : settings.openingTargets);
  if (settings.includeAllIn) candidates.add(maximum);
  for (const target of [...candidates].sort((a, b) => a - b)) {
    if (target > maximum || target <= state.currentBet || target <= state.streetPaid[actor]) continue;
    if (facing && target - state.currentBet < state.lastFullRaise && target !== maximum) continue;
    result.push(facing ? `raise-to-${target}` : `bet-to-${target}`);
  }
  return result;
}

/** Close now, not at the end of the next street: uncalled chips are never at risk. */
function closeStreet(state: TurnV2State, folded: 0 | 1 | null): TurnV2State {
  const matched = Math.min(...state.streetPaid);
  return freeze({ ...state, carried: state.carried + matched, streetPaid: [0, 0],
    returned: [state.returned[0] + state.streetPaid[0] - matched, state.returned[1] + state.streetPaid[1] - matched],
    currentBet: 0, lastFullRaise: 0, raisesUsed: 0, checks: 0, folded, actor: null,
    phase: folded !== null || state.street === 1 ? "terminal" : "river-card" });
}
export function nextTurnV2Action(request: TurnV2Request, state: TurnV2State, action: TurnV2Action): TurnV2State {
  if (!turnV2Actions(request, state).includes(action) || state.actor === null) throw new Error(`Illegal turn v2 action: ${action}`);
  const actor = state.actor, other = (1 - actor) as 0 | 1;
  const histories = state.histories.map((history, street) => street === state.street ? [...history, action] : history) as unknown as TurnV2State["histories"];
  let next: TurnV2State = { ...state, histories, actor: other };
  if (action === "fold") return closeStreet(next, actor);
  if (action === "check") {
    if (state.checks === 1) return closeStreet(next, null);
    return freeze({ ...next, checks: 1 });
  }
  const paid = [...state.streetPaid] as [number, number];
  paid[actor] = action === "call" ? Math.min(state.currentBet, request.stackBehind[actor] - state.carried)
    : Number(action.slice(action.startsWith("bet-") ? 7 : 9));
  next = { ...next, streetPaid: paid };
  if (action === "call") return closeStreet(next, null);
  const increment = paid[actor] - state.currentBet;
  return freeze({ ...next, currentBet: paid[actor], checks: 0,
    lastFullRaise: Math.max(state.lastFullRaise, increment), raisesUsed: state.raisesUsed + (action.startsWith("raise-") ? 1 : 0) });
}
export function nextTurnV2River(request: TurnV2Request, state: TurnV2State, river: RiverCard): TurnV2State {
  if (state.phase !== "river-card" || !RIVER_DECK.includes(river) || request.board.includes(river)) throw new Error("Illegal turn v2 river");
  const allIn = request.stackBehind.some(stack => stack === state.carried);
  return freeze({ ...state, river, street: 1, phase: allIn ? "terminal" : "play", actor: allIn ? null : 0 });
}
export function turnV2InformationKey(request: TurnV2Request, state: TurnV2State, player: 0 | 1, hand: RiverCombo): string {
  return `turn-v2:p${player}:${riverComboKey(hand)}:board=${request.board.join("")}`
    + `:river=${state.street === 0 ? "hidden" : state.river}:street=${state.street}`
    + `:turn=${state.histories[0].join("-") || "start"}:river-actions=${state.histories[1].join("-") || "start"}`;
}
