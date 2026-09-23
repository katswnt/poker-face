// Audit-only: independent history expansion, chip replay, and slow 5-of-7 evaluator.
// This does NOT call the production transitions to produce expected terminal outcomes.
import { handScore } from "../../poker/eval";
import { RIVER_DECK, riverCardObject, riverComboKey, type RiverCard } from "../river/cards";
import { parseConfigurableRiverRange } from "../river/configurable/range";
import type { Utility } from "../toy/game";
import type { TurnAction, TurnGame, TurnHands, TurnRequest, TurnState } from "./game";

const LINES: readonly (readonly TurnAction[])[] = [
  ["check", "check"], ["bet", "fold"], ["bet", "call"],
  ["check", "bet", "fold"], ["check", "bet", "call"],
];
type Histories = TurnState["histories"];
const key = (hands: TurnHands, river: RiverCard | null, histories: Histories) =>
  JSON.stringify([hands.map(riverComboKey), river, histories]);

function replay(request: TurnRequest, histories: Histories) {
  const paid: [number, number] = [request.committedPerPlayer, request.committedPerPlayer];
  let folded: 0 | 1 | null = null;
  for (const street of [0, 1] as const) {
    let player: 0 | 1 = 0;
    for (const action of histories[street]) {
      if (folded !== null) throw new Error("Oracle history continues after a fold");
      const capacity = request.committedPerPlayer + request.stackBehind[player] - paid[player];
      if (action === "bet") paid[player] += Math.min(request.betSizes[street], capacity);
      if (action === "call") paid[player] += Math.min(paid[1 - player] - paid[player], capacity);
      if (action === "fold") folded = player;
      player = player === 0 ? 1 : 0;
    }
  }
  return { paid, folded };
}

export function oracleTurnUtility(request: TurnRequest, hands: TurnHands, river: RiverCard | null, histories: Histories): Utility {
  const { paid, folded } = replay(request, histories);
  // In heads-up play the amount one player can lose is the smaller contribution.
  const contestedPerPlayer = Math.min(paid[0], paid[1]);
  let sign: number;
  if (folded !== null) sign = folded === 0 ? -1 : 1;
  else {
    if (!river) throw new Error("Oracle showdown lacks a river");
    const board = [...request.board, river].map(riverCardObject);
    const scores = hands.map(hand => handScore(hand.map(riverCardObject), board));
    sign = Math.sign(scores[0] - scores[1]);
  }
  const value = sign * contestedPerPlayer;
  return [value === 0 ? 0 : value, value === 0 ? 0 : -value];
}

export function auditTurnRules(game: TurnGame) {
  const { request } = game;
  const ranges = request.rangeText.map(text => parseConfigurableRiverRange(text, request.board).entries);
  const expectedDeals = ranges[0].flatMap(left => ranges[1].flatMap(right =>
    new Set([...request.board, ...left.cards, ...right.cards]).size === 8
      ? [{ hands: [left.cards, right.cards] as TurnHands, weight: left.weight * right.weight }] : []));
  const mass = expectedDeals.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(mass) || mass <= 0) throw new Error("Oracle needs finite positive raw weight mass");
  const root = game.node(game.initialState());
  if (root.kind !== "chance") throw new Error("Turn oracle expected an initial private deal");
  const actualDeals = new Map(root.outcomes.map(deal => {
    if (deal.outcome.kind !== "deal") throw new Error("Turn root chance is not a private deal");
    return [deal.outcome.hands.map(riverComboKey).join("/"), deal.probability];
  }));
  if (actualDeals.size !== root.outcomes.length) throw new Error("Turn root repeats a private deal");
  if (actualDeals.size !== expectedDeals.length) throw new Error("Turn oracle private deal count mismatch");
  let maximumProbabilityDifference = 0;
  const actualTerminals = new Map<string, Utility>();
  const visit = (state: TurnState): void => {
    const node = game.node(state);
    if (node.kind === "terminal") {
      if (node.utility.length !== 2 || !node.utility.every(Number.isFinite)) {
        throw new Error("Turn oracle encountered non-finite or malformed terminal utility");
      }
      const terminalKey = key(state.hands!, state.river, state.histories);
      if (actualTerminals.has(terminalKey)) throw new Error("Duplicate turn terminal");
      actualTerminals.set(terminalKey, node.utility);
    } else if (node.kind === "chance") {
      if (node.outcomes.some(child => !Number.isFinite(child.probability) || child.probability <= 0 || child.probability > 1)) {
        throw new Error("Turn oracle encountered non-finite or invalid chance probability");
      }
      if (state.phase === "river-card") {
        const expected = RIVER_DECK.filter(card => ![...request.board, ...state.hands!.flat()].includes(card));
        const actual = node.outcomes.map(child => child.outcome.kind === "river" ? child.outcome.card : "invalid");
        if (actual.length !== 44 || new Set(actual).size !== 44 || expected.some(card => !actual.includes(card))) {
          throw new Error("Turn oracle river deck mismatch");
        }
        node.outcomes.forEach(child => {
          maximumProbabilityDifference = Math.max(maximumProbabilityDifference, Math.abs(child.probability - 1 / 44));
        });
      }
      node.outcomes.forEach(child => visit(game.nextChance(state, child.outcome)));
    } else node.actions.forEach(action => visit(game.nextAction(state, action)));
  };
  visit(game.initialState());
  let terminalsChecked = 0;
  let maximumUtilityDifference = 0;
  let maximumZeroSumError = 0;
  const check = (hands: TurnHands, river: RiverCard | null, histories: Histories) => {
    const terminalKey = key(hands, river, histories);
    const actual = actualTerminals.get(terminalKey);
    if (!actual) throw new Error(`Turn game omitted oracle terminal ${terminalKey}`);
    actualTerminals.delete(terminalKey);
    const expected = oracleTurnUtility(request, hands, river, histories);
    maximumUtilityDifference = Math.max(maximumUtilityDifference, ...actual.map((value, player) => Math.abs(value - expected[player])));
    maximumZeroSumError = Math.max(maximumZeroSumError, Math.abs(actual[0] + actual[1]));
    terminalsChecked++;
  };
  for (const { hands, weight } of expectedDeals) {
    const actual = actualDeals.get(hands.map(riverComboKey).join("/"));
    if (actual === undefined) throw new Error("Turn oracle missing private deal");
    maximumProbabilityDifference = Math.max(maximumProbabilityDifference, Math.abs(actual - weight / mass));
    const turnLines = request.stackBehind.some(stack => stack === 0) ? [[]] : LINES;
    for (const turn of turnLines) {
      if (turn.includes("fold")) { check(hands, null, [turn, []]); continue; }
      const { paid } = replay(request, [turn, []]);
      const allIn = paid.some((chips, player) => chips === request.committedPerPlayer + request.stackBehind[player]);
      const riverLines = allIn ? [[]] : LINES;
      for (const river of RIVER_DECK) {
        if ([...request.board, ...hands.flat()].includes(river)) continue;
        for (const line of riverLines) check(hands, river, [turn, line]);
      }
    }
  }
  if (actualTerminals.size) throw new Error("Turn game has terminals absent from oracle");
  if (maximumProbabilityDifference > 1e-12 || maximumUtilityDifference > 1e-12 || maximumZeroSumError > 1e-12) {
    throw new Error("Turn rules differ from independent oracle");
  }
  return { dealsChecked: expectedDeals.length, dealRiverPairsChecked: expectedDeals.length * 44,
    terminalsChecked, maximumProbabilityDifference, maximumUtilityDifference, maximumZeroSumError };
}
