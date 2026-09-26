/**
 * Public-state bookkeeping for a heads-up postflop hand (pure; browser-safe).
 *
 * The state is a function of (startingPot, startingStack, minimumBet, flop, events): every
 * derived field is recomputed by `derivePublicState`, and `validatePublicState` rejects any
 * object whose fields disagree with its own event list or carry anything extra.
 *
 * Betting rules are the bridge contract's chip model (equal stacks; raise-to ≥ current bet +
 * the last raise increment, or all-in) plus the engine's minimum opening bet
 * (`minimumBet`, or all-in when the stack is shorter). For heads-up with equal stacks these
 * agree with engine.ts runBettingRound; test/hu-play-public-state.test.ts checks that.
 */
import type { BridgeAction, BridgeBoard, BridgePlayer, BridgeStreet } from "../solver/bridge/contract";
import { isRiverCard, type RiverCard } from "../solver/river/cards";
import { HU_PUBLIC_STATE_FORMAT, type HeadsUpPublicState, type HuPublicEvent } from "./types";

export interface HuPublicSetup {
  readonly startingPot: number;
  readonly startingStack: number;
  readonly minimumBet: number;
  readonly flop: BridgeBoard["flop"];
}

const STREETS: readonly BridgeStreet[] = ["flop", "turn", "river"];

function fail(message: string): never {
  throw new Error(`Illegal heads-up state: ${message}`);
}

export function actionToken(action: BridgeAction): string {
  switch (action.type) {
    case "check": return "x";
    case "call": return "c";
    case "fold": return "f";
    case "bet": return `b${action.to}`;
    case "raise": return `r${action.to}`;
  }
}

/** Why `action` is illegal for the player to act, or null when it is legal. */
export function illegalActionReason(state: HeadsUpPublicState, action: BridgeAction): string | null {
  if (state.status !== "betting" || state.toAct === null) return `no one is to act (status ${state.status})`;
  const actor = state.toAct;
  const currentBet = Math.max(...state.streetPut);
  const facing = state.streetPut[actor] < currentBet;
  const maxTo = state.startingStack - state.closed;
  const whole = (to: number) => Number.isSafeInteger(to) && to > 0;
  switch (action.type) {
    case "fold": case "call": return facing ? null : `${action.type} is only legal facing a bet`;
    case "check": return facing ? "check is illegal facing a bet" : null;
    case "bet": {
      if (facing) return "bet is illegal facing a bet (use raise)";
      if (!whole(action.to)) return `bet to ${action.to} is not a positive whole number`;
      if (action.to > maxTo) return `bet to ${action.to} exceeds the all-in total ${maxTo}`;
      return action.to >= Math.min(state.minimumBet, maxTo) ? null
        : `bet to ${action.to} is below the minimum bet ${state.minimumBet} and is not all-in`;
    }
    case "raise": {
      if (!facing) return "raise needs a bet to raise";
      if (!whole(action.to)) return `raise to ${action.to} is not a positive whole number`;
      if (currentBet >= maxTo) return "cannot raise an all-in";
      if (action.to > maxTo) return `raise to ${action.to} exceeds the all-in total ${maxTo}`;
      const minimum = currentBet + (currentBet - state.streetPut[actor]);
      return action.to >= minimum || action.to === maxTo ? null
        : `raise to ${action.to} is below the minimum raise to ${minimum} and is not all-in`;
    }
    default: return `unknown action ${JSON.stringify(action)}`;
  }
}

/** Smallest and largest legal sized action for the player to act (null = none legal). */
export function sizedActionBounds(state: HeadsUpPublicState): { type: "bet" | "raise"; min: number; max: number } | null {
  if (state.status !== "betting" || state.toAct === null) return null;
  const actor = state.toAct;
  const currentBet = Math.max(...state.streetPut);
  const maxTo = state.startingStack - state.closed;
  if (currentBet === 0) return { type: "bet", min: Math.min(state.minimumBet, maxTo), max: maxTo };
  if (currentBet >= maxTo) return null;
  const minimum = Math.min(currentBet + (currentBet - state.streetPut[actor]), maxTo);
  return { type: "raise", min: minimum, max: maxTo };
}

function checkSetup(setup: HuPublicSetup): void {
  const { startingPot, startingStack, minimumBet, flop } = setup;
  if (!Number.isSafeInteger(startingPot) || startingPot <= 0 || startingPot % 2 !== 0) fail("startingPot must be a positive even whole number");
  if (!Number.isSafeInteger(startingStack) || startingStack <= 0) fail("startingStack must be a positive whole number");
  if (!Number.isSafeInteger(minimumBet) || minimumBet <= 0) fail("minimumBet must be a positive whole number");
  if (!Array.isArray(flop) || flop.length !== 3 || !flop.every(isRiverCard) || new Set(flop).size !== 3) fail("flop needs three distinct cards");
}

/** Recompute the whole public state from its setup and events. Throws on any illegal event. */
export function derivePublicState(setup: HuPublicSetup, events: readonly HuPublicEvent[]): HeadsUpPublicState {
  checkSetup(setup);
  let state = initialPublicState(setup);
  events.forEach((event, index) => {
    try { state = applyPublicEvent(state, event); } catch (error) { fail(`event ${index}: ${(error as Error).message}`); }
  });
  return state;
}

export function initialPublicState(setup: HuPublicSetup): HeadsUpPublicState {
  checkSetup(setup);
  return {
    format: HU_PUBLIC_STATE_FORMAT, version: 1,
    startingPot: setup.startingPot, startingStack: setup.startingStack, minimumBet: setup.minimumBet,
    flop: [setup.flop[0], setup.flop[1], setup.flop[2]], events: [],
    board: { flop: [setup.flop[0], setup.flop[1], setup.flop[2]], turn: null, river: null },
    street: "flop", status: "betting", toAct: 0, closed: 0, streetPut: [0, 0], streetActions: 0,
    pot: setup.startingPot, stacks: [setup.startingStack, setup.startingStack], folder: null, path: [],
  };
}

function withMoney(state: HeadsUpPublicState, patch: Partial<HeadsUpPublicState>): HeadsUpPublicState {
  const next = { ...state, ...patch };
  const closed = next.closed, put = next.streetPut;
  return {
    ...next,
    pot: next.startingPot + 2 * closed + put[0] + put[1],
    stacks: [next.startingStack - closed - put[0], next.startingStack - closed - put[1]],
  };
}

/** Apply one public event (an action by the player to act, or the due card). */
export function applyPublicEvent(state: HeadsUpPublicState, event: HuPublicEvent): HeadsUpPublicState {
  if (!event || typeof event !== "object") fail("event must be an object");
  const events = [...state.events, event];
  if (event.kind === "card") {
    if (state.status !== "chance") fail(`no card is due (status ${state.status})`);
    const street = STREETS[STREETS.indexOf(state.street) + 1];
    if (event.street !== street) fail(`the ${street} is due, not the ${String(event.street)}`);
    if (!isRiverCard(event.card)) fail(`${String(event.card)} is not a card`);
    const known = [...state.board.flop, ...(state.board.turn ? [state.board.turn] : [])];
    if (known.includes(event.card)) fail(`${event.card} is already on the board`);
    const board: BridgeBoard = street === "turn"
      ? { ...state.board, turn: event.card } : { ...state.board, river: event.card };
    const allIn = state.closed === state.startingStack;
    const status = allIn ? (street === "river" ? "showdown" : "chance") : "betting";
    return { ...state, events, board, street, status, toAct: status === "betting" ? 0 : null,
      streetPut: [0, 0], streetActions: 0, path: [...state.path, event.card] };
  }
  if (event.kind !== "action") fail(`unknown event kind ${String((event as { kind?: unknown }).kind)}`);
  if (event.player !== state.toAct) fail(`player ${String(event.player)} acted out of turn (to act: ${String(state.toAct)})`);
  const illegal = illegalActionReason(state, event.action);
  if (illegal) fail(illegal);
  const action = event.action;
  const actor = event.player, other = (1 - actor) as BridgePlayer;
  const path = [...state.path, actionToken(action)];
  const base = { ...state, events, path, streetActions: state.streetActions + 1 };
  const closeStreet = (matched: number): HeadsUpPublicState => {
    const closed = state.closed + matched;
    const over = state.street === "river";
    return withMoney(base, { closed, streetPut: [0, 0], toAct: null, status: over ? "showdown" : "chance" });
  };
  switch (action.type) {
    case "fold": return withMoney(base, { status: "fold", folder: actor, toAct: null });
    case "check": return actor === 1 ? closeStreet(0) : withMoney(base, { toAct: other });
    case "call": return closeStreet(Math.max(...state.streetPut));
    case "bet": case "raise": {
      const put: [number, number] = [state.streetPut[0], state.streetPut[1]];
      put[actor] = action.to;
      return withMoney(base, { streetPut: put, toAct: other });
    }
  }
}

const PUBLIC_KEYS = ["format", "version", "startingPot", "startingStack", "minimumBet", "flop", "events", "board", "street",
  "status", "toAct", "closed", "streetPut", "streetActions", "pot", "stacks", "folder", "path"] as const;

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  const extra = actual.filter(k => !keys.includes(k)), missing = keys.filter(k => !Object.hasOwn(value, k));
  if (extra.length || missing.length) fail(`${label} has ${extra.length ? `unexpected fields ${extra.join(",")}` : ""}${extra.length && missing.length ? " and " : ""}${missing.length ? `missing fields ${missing.join(",")}` : ""}`);
  return value as Record<string, unknown>;
}

function validateEvent(input: unknown, index: number): HuPublicEvent {
  const kind = (input as { kind?: unknown } | null)?.kind;
  if (kind === "card") {
    const value = exactKeys(input, ["kind", "street", "card"], `events[${index}]`);
    return { kind: "card", street: value.street as "turn" | "river", card: value.card as RiverCard };
  }
  const value = exactKeys(input, ["kind", "player", "action"], `events[${index}]`);
  const action = value.action as { type?: unknown };
  const sized = action?.type === "bet" || action?.type === "raise";
  const raw = exactKeys(action, sized ? ["type", "to"] : ["type"], `events[${index}].action`);
  return { kind: "action", player: value.player as BridgePlayer,
    action: (sized ? { type: raw.type, to: raw.to } : { type: raw.type }) as BridgeAction };
}

/**
 * Strict check of an untrusted public state: exact fields (so a stray `holeCards` or
 * `humanHand` is rejected), every event legal in order, every derived field consistent.
 * Returns a fresh copy built only from the whitelisted fields.
 */
export function validatePublicState(input: unknown): HeadsUpPublicState {
  const value = exactKeys(input, PUBLIC_KEYS, "public state");
  if (value.format !== HU_PUBLIC_STATE_FORMAT || value.version !== 1) fail(`public state must be ${HU_PUBLIC_STATE_FORMAT} version 1`);
  if (!Array.isArray(value.events)) fail("events must be a list");
  const events = value.events.map(validateEvent);
  const flop = value.flop as BridgeBoard["flop"];
  const derived = derivePublicState({
    startingPot: value.startingPot as number, startingStack: value.startingStack as number,
    minimumBet: value.minimumBet as number, flop,
  }, events);
  for (const key of PUBLIC_KEYS) {
    if (JSON.stringify(value[key]) !== JSON.stringify(derived[key])) fail(`${key} disagrees with the event list`);
  }
  return derived;
}

/** True at the first decision of a street (the only root a contract v1 spot can express). */
export function isStreetRoot(state: HeadsUpPublicState): boolean {
  return state.status === "betting" && state.streetActions === 0;
}
