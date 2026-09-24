import { assertDistinctRiverCards, riverComboKey, type RiverCard, type RiverCombo } from "../../river/cards";
import type { SolverPlayer } from "../../toy/game";

export type FlopAction = "check" | "bet" | "fold" | "call";
export interface FlopRequest {
  readonly id: string;
  readonly board: readonly [RiverCard, RiverCard, RiverCard];
  readonly rangeText: readonly [string, string];
  readonly committedPerPlayer: number;
  readonly stackBehind: readonly [number, number];
  readonly betSizes: readonly [number, number, number];
}
export interface FlopState {
  readonly phase: "play" | "card" | "terminal";
  readonly street: 0 | 1 | 2;
  readonly turn: RiverCard | null;
  readonly river: RiverCard | null;
  readonly histories: readonly [readonly FlopAction[], readonly FlopAction[], readonly FlopAction[]];
  /** Gross payments after the initial contribution. Excess returns at settlement. */
  readonly put: readonly [number, number];
  readonly actor: SolverPlayer | null;
  readonly folded: SolverPlayer | null;
}
export const FLOP_RULES_VERSION = 1;
export const FLOP_REFERENCE_LIMITS = Object.freeze({ hands: 8, deals: 16, states: 1_000_000, iterations: 100_000 });

export function validateFlopRequest(input: FlopRequest): FlopRequest {
  if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.id)) throw new Error("Invalid flop game id");
  if (!Array.isArray(input.board) || input.board.length !== 3) throw new Error("Flop board needs three cards");
  assertDistinctRiverCards([...input.board], "Flop board");
  if (!Array.isArray(input.rangeText) || input.rangeText.length !== 2 || [...input.rangeText].some(t => typeof t !== "string" || t.length > 16384)) throw new Error("Flop needs two bounded range texts");
  if (!Array.isArray(input.stackBehind) || input.stackBehind.length !== 2 || !Array.isArray(input.betSizes) || input.betSizes.length !== 3) throw new Error("Flop needs two stacks and three street bets");
  const whole = (n: number, zero = false) => {
    if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > 1_000_000) throw new Error("Flop money must be bounded whole chips");
  };
  whole(input.committedPerPlayer); for (const n of input.stackBehind) whole(n, true); for (const n of input.betSizes) whole(n);
  return Object.freeze({ id: input.id, board: Object.freeze([...input.board]) as FlopRequest["board"],
    rangeText: Object.freeze([...input.rangeText]) as FlopRequest["rangeText"], committedPerPlayer: input.committedPerPlayer,
    stackBehind: Object.freeze([...input.stackBehind]) as FlopRequest["stackBehind"], betSizes: Object.freeze([...input.betSizes]) as FlopRequest["betSizes"] });
}
const allIn = (request: FlopRequest, state: FlopState) => request.stackBehind.some((stack, p) => stack === state.put[p]);
export function initialFlopState(request: FlopRequest): FlopState {
  const forced = request.stackBehind.includes(0);
  return { phase: forced ? "card" : "play", street: 0, turn: null, river: null,
    histories: [[], [], []], put: [0, 0], actor: forced ? null : 0, folded: null };
}
export function flopActions(state: FlopState): readonly FlopAction[] {
  return state.phase !== "play" ? [] : state.histories[state.street].includes("bet") ? ["fold", "call"] : ["check", "bet"];
}
export function nextFlopAction(request: FlopRequest, state: FlopState, action: FlopAction): FlopState {
  if (state.actor === null || !flopActions(state).includes(action)) throw new Error("Illegal flop action");
  const p = state.actor, opponent = p === 0 ? 1 : 0;
  const histories = [...state.histories] as [readonly FlopAction[], readonly FlopAction[], readonly FlopAction[]];
  histories[state.street] = [...histories[state.street], action];
  const put: [number, number] = [...state.put], capacity = request.stackBehind[p] - put[p];
  if (action === "bet") put[p] += Math.min(request.betSizes[state.street], capacity);
  if (action === "call") put[p] += Math.min(put[opponent] - put[p], capacity);
  const end = action === "call" || action === "check" && histories[state.street].length === 2;
  const phase = action === "fold" || end && state.street === 2 ? "terminal" : end ? "card" : "play";
  return { ...state, histories, put, phase, actor: phase === "play" ? opponent : null, folded: action === "fold" ? p : null };
}
/** Public legality only: the private-deal adapter/compiled masks additionally exclude hole cards. */
export function nextFlopCard(request: FlopRequest, state: FlopState, card: RiverCard): FlopState {
  if (state.phase !== "card" || state.street === 2) throw new Error("Not a flop public-card node");
  assertDistinctRiverCards([...request.board, ...(state.turn ? [state.turn] : []), card], "Flop runout");
  const street = (state.street + 1) as 1 | 2, forced = allIn(request, state);
  return { ...state, street, turn: street === 1 ? card : state.turn, river: street === 2 ? card : null,
    phase: forced ? street === 2 ? "terminal" : "card" : "play", actor: forced ? null : 0 };
}
export function flopInformationKey(request: FlopRequest, state: FlopState, player: SolverPlayer, hand: RiverCombo): string {
  if (state.phase !== "play" || state.actor !== player) throw new Error("Not this player's flop decision");
  return `flop-v1:p${player}:${riverComboKey(hand)}:board=${request.board.join("")}:turn=${state.turn ?? "hidden"}`
    + `:river=${state.river ?? "hidden"}:street=${state.street}:history=${state.histories.map(h => h.join("-") || "start").join("/")}`;
}
export interface FlopCounts { totalStates: number; chanceNodes: number; decisionNodes: number; terminalNodes: number }
/** Card identities do not affect this finite betting menu. Count multiplicities before allocation. */
export function countFlopSkeleton(request: FlopRequest, publicUnion = false): FlopCounts {
  const visit = (state: FlopState): FlopCounts => {
    const result = { totalStates: 1, chanceNodes: 0, decisionNodes: 0, terminalNodes: 0 };
    const add = (child: FlopCounts, factor = 1) => {
      for (const key of ["totalStates", "chanceNodes", "decisionNodes", "terminalNodes"] as const) result[key] += factor * child[key];
    };
    if (state.phase === "terminal") result.terminalNodes++;
    else if (state.phase === "play") { result.decisionNodes++; flopActions(state).forEach(a => add(visit(nextFlopAction(request, state, a)))); }
    else {
      result.chanceNodes++;
      // Only a structural placeholder, never an actual public deck or payoff.
      const next = { ...state, street: (state.street + 1) as 1 | 2,
        phase: allIn(request, state) ? state.street === 1 ? "terminal" as const : "card" as const : "play" as const,
        actor: allIn(request, state) ? null : 0 as const };
      add(visit(next), (state.street === 0 ? 45 : 44) + (publicUnion ? 4 : 0));
    }
    return result;
  };
  return visit(initialFlopState(request));
}
