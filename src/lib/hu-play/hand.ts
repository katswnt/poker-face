/**
 * Heads-up hand reducer and replay harness (spec 2.2, 2.6). Pure given a pure decision source.
 *
 * The reducer is the only holder of the private deal. A decision source sees the public state,
 * both reach vectors and the AI's own hand; the human's hole cards are never passed to it.
 * Determinism: the k-th AI draw is decisionDraw(handSeed, k, path), so the same seed, the same
 * human actions and the same source reproduce every AI action exactly.
 */
import { distributePots } from "../poker/pots";
import { parseBridgeCombo, type BridgeAction, type BridgePlayer } from "../solver/bridge/contract";
import { riverCardObject, type RiverCard } from "../solver/river/cards";
import { assertNoCards } from "./leak";
import { applyPublicEvent, illegalActionReason, initialPublicState } from "./public-state";
import { applyStrategy, removeCard } from "./reach";
import { decisionDraw, sampleAction } from "./rng";
import {
  HU_HAND_LOG_FORMAT, type ActionDistribution, type AiDecisionRecord, type DecisionProvenance, type HeadsUpPublicState,
  type HuHandConfig, type HuHandLogV1, type HuHandResult, type HuRange, type PrivateDeal,
} from "./types";

export interface HuRanges { readonly ai: HuRange; readonly human: HuRange }

/** What a policy sees at an AI decision. Deliberately has no field for the human's cards. */
export interface DecisionRequest {
  readonly publicState: HeadsUpPublicState;
  readonly aiSeat: BridgePlayer;
  readonly aiHand: string;
  readonly ranges: HuRanges;
  readonly index: number;
}

export interface DecisionResponse {
  /** σ(· | aiHand) over the legal actions it may take. */
  readonly strategy: ActionDistribution;
  readonly provenance: DecisionProvenance;
  /** σ(action | h) for every AI combo h: multiplied into the AI's exact reach after the draw. */
  readonly rangeProbability: (action: BridgeAction, combo: string) => number;
}

export interface HumanModelRequest {
  readonly publicState: HeadsUpPublicState;
  readonly aiSeat: BridgePlayer;
  readonly ranges: HuRanges;
}

export interface DecisionSource {
  decide(request: DecisionRequest): DecisionResponse;
  /** The solver model σ*_H(action | g) for every human combo g (the human reach update). */
  humanModel(request: HumanModelRequest, action: BridgeAction): (combo: string) => number;
}

export interface HeadsUpHandState {
  readonly config: HuHandConfig;
  readonly public: HeadsUpPublicState;
  readonly deal: PrivateDeal;
  readonly ranges: HuRanges;
  readonly decisions: readonly AiDecisionRecord[];
  readonly humanActions: readonly BridgeAction[];
  readonly result: HuHandResult | null;
}

function fail(message: string): never {
  throw new Error(`Illegal heads-up hand: ${message}`);
}

const sameAction = (a: BridgeAction, b: BridgeAction) => a.type === b.type && ("to" in a ? a.to : null) === ("to" in b ? b.to : null);

export function startHand(config: HuHandConfig, deal: PrivateDeal, ranges: HuRanges): HeadsUpHandState {
  const cards = [...config.flop, ...parseBridgeCombo(deal.aiHand), ...parseBridgeCombo(deal.humanHand), ...deal.runout];
  if (new Set(cards).size !== cards.length) fail("the deal repeats a card");
  if (!Number.isSafeInteger(config.handSeed)) fail("handSeed must be a whole number");
  if (config.aiSeat !== 0 && config.aiSeat !== 1) fail("aiSeat must be 0 or 1");
  const publicState = initialPublicState(config);
  return { config, public: publicState, deal, ranges, decisions: [], humanActions: [], result: null };
}

function settle(state: HeadsUpHandState): HeadsUpHandState {
  const p = state.public;
  const seats = [0, 1] as const;
  const contributions = seats.map(i => p.startingPot / 2 + p.closed + p.streetPut[i]);
  const handOf = (seat: BridgePlayer) => parseBridgeCombo(seat === state.config.aiSeat ? state.deal.aiHand : state.deal.humanHand);
  const board = [...p.board.flop, ...(p.board.turn ? [p.board.turn] : []), ...(p.board.river ? [p.board.river] : [])] as RiverCard[];
  const folded = seats.map(i => p.folder === i);
  const { payouts } = distributePots(contributions, folded, seats.map(i => handOf(i).map(riverCardObject)), board.map(riverCardObject));
  const result: HuHandResult = {
    payouts: [payouts[0], payouts[1]],
    net: [payouts[0] - contributions[0], payouts[1] - contributions[1]],
  };
  return { ...state, result };
}

/** Run chance events and AI decisions until the human is to act or the hand is over. */
export function advance(state: HeadsUpHandState, source: DecisionSource): HeadsUpHandState {
  let current = state;
  for (let guard = 0; guard < 200; guard++) {
    const p = current.public;
    if (p.status === "fold" || p.status === "showdown") return current.result ? current : settle(current);
    if (p.status === "chance") {
      const card = p.board.turn === null ? current.deal.runout[0] : current.deal.runout[1];
      const street = p.board.turn === null ? "turn" as const : "river" as const;
      current = {
        ...current, public: applyPublicEvent(p, { kind: "card", street, card }),
        ranges: { ai: removeCard(current.ranges.ai, card), human: removeCard(current.ranges.human, card) },
      };
      continue;
    }
    if (p.toAct !== current.config.aiSeat) return current;
    current = aiDecision(current, source);
  }
  fail("the hand did not finish");
}

function aiDecision(state: HeadsUpHandState, source: DecisionSource): HeadsUpHandState {
  const index = state.decisions.length;
  const request: DecisionRequest = {
    publicState: state.public, aiSeat: state.config.aiSeat, aiHand: state.deal.aiHand, ranges: state.ranges, index,
  };
  const response = source.decide(request);
  for (const entry of response.strategy) {
    const illegal = illegalActionReason(state.public, entry.action);
    if (illegal) fail(`the decision source offered an illegal action: ${illegal}`);
    const row = response.rangeProbability(entry.action, state.deal.aiHand);
    if (Math.abs(row - entry.probability) > 1e-12) fail("rangeProbability disagrees with the strategy for the AI's own hand");
  }
  const u = decisionDraw(state.config.handSeed, index, state.public.path);
  const { action, boundaryDistance } = sampleAction(response.strategy, u);
  const record: AiDecisionRecord = {
    index, path: state.public.path, provenance: response.provenance, strategy: response.strategy, u, boundaryDistance, action,
  };
  assertNoCards(record, state.deal.humanHand, `AI decision record ${index}`);
  return {
    ...state,
    public: applyPublicEvent(state.public, { kind: "action", player: state.config.aiSeat, action }),
    ranges: { ...state.ranges, ai: applyStrategy(state.ranges.ai, combo => response.rangeProbability(action, combo)) },
    decisions: [...state.decisions, record],
  };
}

/** Apply the human's action (must be their turn and legal), then advance. */
export function applyHumanAction(state: HeadsUpHandState, action: BridgeAction, source: DecisionSource): HeadsUpHandState {
  const p = state.public;
  const human = (1 - state.config.aiSeat) as BridgePlayer;
  if (p.status !== "betting" || p.toAct !== human) fail("it is not the human's turn");
  const illegal = illegalActionReason(p, action);
  if (illegal) fail(illegal);
  const model = source.humanModel({ publicState: p, aiSeat: state.config.aiSeat, ranges: state.ranges }, action);
  const next: HeadsUpHandState = {
    ...state,
    public: applyPublicEvent(p, { kind: "action", player: human, action }),
    ranges: { ...state.ranges, human: applyStrategy(state.ranges.human, model) },
    humanActions: [...state.humanActions, action],
  };
  return advance(next, source);
}

export function handLog(state: HeadsUpHandState): HuHandLogV1 {
  const over = state.result !== null;
  return {
    format: HU_HAND_LOG_FORMAT, version: 1, config: state.config, events: state.public.events,
    humanActions: state.humanActions, decisions: state.decisions,
    reveal: over ? { aiHand: state.deal.aiHand, humanHand: state.deal.humanHand } : null,
    result: state.result,
  };
}

export interface ReplayDivergence {
  readonly index: number;
  /** "boundary": the draw sat within 1e-6 of a CDF boundary, so float noise may explain it. */
  readonly kind: "action" | "boundary" | "missing" | "extra";
  readonly logged: BridgeAction | null;
  readonly replayed: BridgeAction | null;
}

/**
 * Re-play a logged hand with the same deal, initial ranges and source, feeding the logged human
 * actions, and compare every AI decision. The events must match exactly for `ok`.
 */
export function replayHand(log: HuHandLogV1, deal: PrivateDeal, ranges: HuRanges, source: DecisionSource):
  { readonly ok: boolean; readonly divergences: readonly ReplayDivergence[]; readonly state: HeadsUpHandState } {
  let state = advance(startHand(log.config, deal, ranges), source);
  for (const action of log.humanActions) {
    if (state.result) break;
    state = applyHumanAction(state, action, source);
  }
  const divergences: ReplayDivergence[] = [];
  const count = Math.max(log.decisions.length, state.decisions.length);
  for (let k = 0; k < count; k++) {
    const logged = log.decisions[k], replayed = state.decisions[k];
    if (!logged || !replayed) {
      divergences.push({ index: k, kind: logged ? "missing" : "extra", logged: logged?.action ?? null, replayed: replayed?.action ?? null });
      continue;
    }
    if (!sameAction(logged.action, replayed.action)) {
      divergences.push({ index: k, kind: logged.boundaryDistance < 1e-6 ? "boundary" : "action", logged: logged.action, replayed: replayed.action });
    }
  }
  const eventsMatch = JSON.stringify(state.public.events) === JSON.stringify(log.events);
  return { ok: divergences.length === 0 && eventsMatch, divergences, state };
}
