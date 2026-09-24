// Audit only: independent line enumeration, payment replay and slow 5-of-7 scoring.
import { handScore } from "../../../poker/eval";
import { RIVER_DECK, riverCardObject, riverComboKey, type RiverCard } from "../../river/cards";
import { parseConfigurableRiverRange } from "../../river/configurable/range";
import type { FlopHands, FlopReference, FlopReferenceState } from "./reference";
import type { FlopAction, FlopRequest, FlopState } from "./rules";

const LINES: readonly (readonly FlopAction[])[] = [["check", "check"], ["bet", "fold"], ["bet", "call"], ["check", "bet", "fold"], ["check", "bet", "call"]];
type Histories = FlopState["histories"];
const terminalKey = (hands: FlopHands, turn: RiverCard | null, river: RiverCard | null, histories: Histories) =>
  JSON.stringify([hands.map(riverComboKey), turn, river, histories]);

export function replayFlopMoney(request: FlopRequest, histories: Histories) {
  const paid: [number, number] = [request.committedPerPlayer, request.committedPerPlayer];
  let folded: 0 | 1 | null = null;
  for (let street = 0; street < 3; street++) {
    let actor: 0 | 1 = 0;
    for (const action of histories[street]) {
      if (folded !== null) throw new Error("Oracle continues after fold");
      const capacity = request.committedPerPlayer + request.stackBehind[actor] - paid[actor];
      if (action === "bet") paid[actor] += Math.min(request.betSizes[street], capacity);
      else if (action === "call") paid[actor] += Math.min(paid[1 - actor] - paid[actor], capacity);
      else if (action === "fold") folded = actor;
      actor = actor === 0 ? 1 : 0;
    }
  }
  const matched = Math.min(...paid), returned = paid.map(n => n - matched);
  return { paid, matched, returned, folded, allIn: paid.some((n, p) => n === request.committedPerPlayer + request.stackBehind[p]) };
}

export function auditFlopReference(game: FlopReference) {
  const request = game.request, ranges = request.rangeText.map(t => parseConfigurableRiverRange(t, request.board).entries);
  const deals = ranges[0].flatMap(a => ranges[1].flatMap(b => new Set([...request.board, ...a.cards, ...b.cards]).size === 7
    ? [{ hands: [a.cards, b.cards] as FlopHands, weight: a.weight * b.weight }] : []));
  const mass = deals.reduce((s, d) => s + d.weight, 0);
  if (!(mass > 0) || !Number.isFinite(mass)) throw new Error("Flop oracle needs finite positive raw weight mass");
  const expected = new Set<string>();
  for (const { hands } of deals) {
    const deck = RIVER_DECK.filter(c => ![...request.board, ...hands.flat()].includes(c));
    const enumerate = (street: number, turn: RiverCard | null, river: RiverCard | null, histories: Histories) => {
      const before = replayFlopMoney(request, histories);
      for (const line of before.allIn ? [[]] : LINES) {
        const next = histories.map((h, i) => i === street ? line : h) as unknown as Histories;
        const cash = replayFlopMoney(request, next);
        if (cash.folded !== null || street === 2) expected.add(terminalKey(hands, turn, river, next));
        else for (const card of deck) if (card !== turn) enumerate(street + 1, street === 0 ? card : turn, street === 1 ? card : null, next);
      }
    };
    enumerate(0, null, null, [[], [], []]);
  }
  const terminalCount = expected.size, scoreCache = new Map<string, number>();
  let maximumProbabilityDifference = 0, maximumUtilityDifference = 0, statesChecked = 0, terminalsChecked = 0;
  const root = game.node(game.initialState());
  if (root.kind !== "chance" || root.outcomes.length !== deals.length) throw new Error("Flop oracle private deal count differs");
  const rootKeys = new Set<string>();
  for (const child of root.outcomes) {
    if (child.outcome.kind !== "deal") throw new Error("Invalid flop root chance");
    const k = child.outcome.hands.map(riverComboKey).join("/");
    const deal = deals.find(d => d.hands.map(riverComboKey).join("/") === k);
    if (!deal || rootKeys.has(k)) throw new Error("Flop root deal mismatch");
    rootKeys.add(k); maximumProbabilityDifference = Math.max(maximumProbabilityDifference, Math.abs(child.probability - deal.weight / mass));
  }
  const visit = (state: FlopReferenceState): void => {
    statesChecked++;
    const node = game.node(state), p = state.public;
    if (node.kind === "terminal") {
      const k = terminalKey(state.hands!, p.turn, p.river, p.histories);
      if (!expected.delete(k)) throw new Error("Unexpected or duplicate flop terminal");
      const cash = replayFlopMoney(request, p.histories), actual = game.settlement(state);
      if (JSON.stringify(actual.contributions) !== JSON.stringify(cash.paid) || JSON.stringify(actual.returnedUncalled) !== JSON.stringify(cash.returned)
        || actual.contestablePot !== 2 * cash.matched) throw new Error("Flop cash ledger differs");
      let sign: number;
      if (cash.folded !== null) sign = cash.folded === 0 ? -1 : 1;
      else {
        if (!p.turn || !p.river) throw new Error("Oracle showdown missing a card");
        const board = [...request.board, p.turn, p.river].map(riverCardObject);
        const scores = state.hands!.map(hand => {
          const id = `${riverComboKey(hand)}/${p.turn}/${p.river}`;
          if (!scoreCache.has(id)) scoreCache.set(id, handScore(hand.map(riverCardObject), board));
          return scoreCache.get(id)!;
        });
        sign = Math.sign(scores[0] - scores[1]);
      }
      const value = sign * cash.matched;
      if (!node.utility.every(Number.isFinite)) throw new Error("Non-finite flop payoff");
      maximumUtilityDifference = Math.max(maximumUtilityDifference, Math.abs(node.utility[0] - value), Math.abs(node.utility[1] + value));
      terminalsChecked++;
    } else if (node.kind === "chance") {
      if (state.hands) {
        const deck = RIVER_DECK.filter(c => ![...request.board, ...state.hands!.flat(), p.turn].includes(c));
        const cards = node.outcomes.map(c => c.outcome.kind === "card" ? c.outcome.card : "invalid");
        if (cards.length !== deck.length || new Set(cards).size !== deck.length || deck.some(c => !cards.includes(c))) throw new Error("Flop oracle runout deck differs");
        node.outcomes.forEach(c => { maximumProbabilityDifference = Math.max(maximumProbabilityDifference, Math.abs(c.probability - 1 / deck.length)); });
      }
      for (const c of node.outcomes) { if (!Number.isFinite(c.probability) || c.probability <= 0) throw new Error("Invalid flop chance mass"); visit(game.nextChance(state, c.outcome)); }
    } else node.actions.forEach(a => visit(game.nextAction(state, a)));
  };
  visit(game.initialState());
  if (expected.size || terminalsChecked !== terminalCount || maximumProbabilityDifference > 1e-12 || maximumUtilityDifference > 1e-12) throw new Error("Flop independent audit failed");
  return { dealsChecked: deals.length, orderedRunoutsChecked: deals.length * 1980, statesChecked, terminalsChecked,
    maximumProbabilityDifference, maximumUtilityDifference };
}
