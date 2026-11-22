/** Exact nine-card reference rules. The resulting CFR strategy is still approximate. */
import { buildGameTreeIndex, type BehavioralStrategy, type ExtensiveFormGame, type GameNode } from "../toy/game";
import { evaluateStrategy } from "../toy/best-response";
import { riverHandScore, type RiverCard } from "../river/cards";
import { parseCard } from "../preflop/texture";
import { settleContinuation } from "./accounting";
import { jointMeasure, type WeightedHand } from "./measure";
import { continuationTable, type ContinuationTable } from "./table";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const TINY_INPUT = freeze({
  deck: ["As", "Ah", "Ks", "Kh", "Qs", "Qh", "Ac", "Ad", "2c"],
  ranges: [
    [{ cards: ["As", "Ah"], weight: 1 }, { cards: ["Ks", "Kh"], weight: 0.5 }, { cards: ["Qs", "Qh"], weight: 0.25 }],
    [{ cards: ["Ac", "Ad"], weight: 1 }, { cards: ["Ks", "Kh"], weight: 0.5 }, { cards: ["Qs", "Qh"], weight: 0.25 }],
  ],
  initialPaid: [3, 1], startingStack: 10, dead: 0.5, potAfterCall: 6.5, behindAfterCall: 7,
  preflopCall: [1, 0.5, 0.25], oopLead: [0.75, 0.5, 0.25], ipStab: [0.5, 0.5, 0.75], facingBetCall: [1, 0.5, 0.25],
} as const);
export type TinyMode = "bet" | "checkdown" | "allin";
export type TinyAction = "f" | "c" | "x" | "b";
type TinyChance = { type: "deal"; hands: readonly [number, number] } | { type: "flop"; cards: readonly RiverCard[] } | { type: "card"; card: RiverCard };
export interface TinyState {
  readonly stage: "deal" | "preflop" | "flop" | "betting" | "turn" | "river" | "terminal";
  readonly hands: readonly [number, number]; readonly board: readonly RiverCard[]; readonly history: string;
  readonly paid: readonly [number, number]; readonly future: readonly [number, number]; readonly folded: 0 | 1 | null;
}
export type TinyGame = ExtensiveFormGame<TinyState, TinyAction, TinyChance> & { readonly mode: TinyMode };
const ranges = (): [WeightedHand[], WeightedHand[]] => {
  const rows = TINY_INPUT.ranges.map(r => r.map(h => ({
  cards: h.cards.map(c => TINY_INPUT.deck.indexOf(c)) as [number, number], weight: h.weight,
  })));
  return [rows[0], rows[1]];
};
const handCards = (s: TinyState, p: 0 | 1) => TINY_INPUT.ranges[p][s.hands[p]].cards;
const remaining = (s: TinyState) => TINY_INPUT.deck.filter(c => !s.board.includes(c) && !handCards(s, 0).some(x => x === c) && !handCards(s, 1).some(x => x === c));
const flopChoices = (s: TinyState) => {
  const cards = remaining(s), out: RiverCard[][] = [];
  for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) for (let c = b + 1; c < cards.length; c++)
    out.push([cards[a], cards[b], cards[c]].sort((a, b) => parseCard(a) - parseCard(b)));
  return out;
};

export function tinyGame(mode: TinyMode = "bet"): TinyGame {
  if (!["bet", "checkdown", "allin"].includes(mode)) throw new Error("unknown tiny mode");
  const law = jointMeasure(9, 0, ranges()), wager = mode === "allin" ? 7 : 2;
  const initialState = (): TinyState => ({ stage: "deal", hands: [-1, -1], board: [], history: "", paid: [3, 1], future: [0, 0], folded: null });
  const node = (s: TinyState): GameNode<TinyAction, TinyChance> => {
    if (s.stage === "deal") {
      const outcomes: { outcome: TinyChance; probability: number }[] = [];
      for (let h = 0; h < 3; h++) for (let k = 0; k < 3; k++) {
        const probability = law.jointMass(h, k, []); if (probability) outcomes.push({ outcome: { type: "deal", hands: [h, k] }, probability });
      }
      return { kind: "chance", outcomes };
    }
    if (s.stage === "preflop") return { kind: "player", player: 1, actions: ["f", "c"] };
    if (s.stage === "flop") {
      const choices = flopChoices(s); return { kind: "chance", outcomes: choices.map(cards => ({ outcome: { type: "flop", cards }, probability: 1 / choices.length })) };
    }
    if (s.stage === "turn" || s.stage === "river") {
      const cards = remaining(s); return { kind: "chance", outcomes: cards.map(card => ({ outcome: { type: "card", card }, probability: 1 / cards.length })) };
    }
    if (s.stage === "terminal") {
      let winner: 0 | 1 | "split";
      if (s.folded !== null) winner = s.folded === 0 ? 1 : 0;
      else { const a = riverHandScore(handCards(s, 0), s.board), b = riverHandScore(handCards(s, 1), s.board); winner = a === b ? "split" : a > b ? 0 : 1; }
      const pot = s.paid[0] + s.paid[1] + 0.5, g = settleContinuation(pot, 7, s.future, winner).values;
      return { kind: "terminal", utility: [g[0] - s.paid[0] - 0.25, g[1] - s.paid[1] - 0.25] };
    }
    if (s.history === "" || s.history === "x") return { kind: "player", player: s.history === "" ? 0 : 1, actions: mode === "checkdown" ? ["x"] : ["x", "b"] };
    if (s.history === "b" || s.history === "xb") return { kind: "player", player: s.history === "b" ? 1 : 0, actions: ["f", "c"] };
    throw new Error("invalid tiny betting history");
  };
  const game: TinyGame = {
    id: `preflop-v2-nine-card-${mode}`, mode, initialState, node,
    nextChance(s, o) {
      const n = node(s);
      if (n.kind !== "chance" || !n.outcomes.some(x => JSON.stringify(x.outcome) === JSON.stringify(o))) throw new Error("illegal tiny chance outcome");
      if (o.type === "deal") return { ...s, stage: "preflop", hands: [...o.hands] };
      if (o.type === "flop") return { ...s, stage: "betting", board: [...o.cards] };
      return { ...s, stage: s.stage === "turn" ? "river" : "terminal", board: [...s.board, o.card] };
    },
    nextAction(s, a) {
      const n = node(s); if (n.kind !== "player" || !n.actions.includes(a)) throw new Error("illegal tiny action");
      if (s.stage === "preflop") return a === "f" ? { ...s, stage: "terminal", folded: 1 } : { ...s, stage: "flop", paid: [3, 3] };
      const history = s.history + a, future: [number, number] = [...s.future];
      if (a === "b") future[n.player] = wager;
      if (a === "c") future[n.player] = future[1 - n.player];
      return { ...s, history, future, folded: a === "f" ? n.player : null,
        stage: a === "f" ? "terminal" : a === "c" || history === "xx" ? "turn" : "betting" };
    },
    informationSet(s, p) {
      const n = node(s); if (n.kind !== "player" || n.player !== p) throw new Error("no tiny information set for this player/state");
      return s.stage === "preflop" ? `pre|1|${s.hands[1]}` : `flop|${p}|${s.hands[p]}|${s.board.join("")}|${s.history}`;
    },
  };
  return game;
}

export function tinyFixedStrategy(game: TinyGame): BehavioralStrategy<TinyAction> {
  return new Map(buildGameTreeIndex(game).informationSets.map(d => {
    const parts = d.key.split("|"), h = Number(parts[2]), history = parts[4];
    const p = parts[0] === "pre" ? TINY_INPUT.preflopCall[h] : history === "" ? TINY_INPUT.oopLead[h]
      : history === "x" ? TINY_INPUT.ipStab[h] : TINY_INPUT.facingBetCall[h];
    return [d.key, { actions: d.actions, probabilities: d.actions.map(a => d.actions.length === 1 ? 1 : a === "b" || a === "c" ? p : 1 - p) }];
  }));
}

export function tinyContinuationTable(game: TinyGame, strategy: BehavioralStrategy<TinyAction>): ContinuationTable {
  const r = ranges();
  const oopGross = r[0].map((hand, h) => r[1].map((other, k) => {
    if (hand.cards.some(c => other.cards.includes(c))) return null;
    // Condition only for EVALUATION of one fixed policy. Never optimize with revealed cards.
    const start = game.nextAction(game.nextChance(game.initialState(), { type: "deal", hands: [h, k] }), "c");
    const subgame = { ...game, id: `${game.id}/pair-${h}-${k}`, initialState: () => start }, index = buildGameTreeIndex(subgame);
    const subset = new Map(index.informationSets.map(d => [d.key, strategy.get(d.key)!]));
    return evaluateStrategy(subgame, subset, index)[0] + 3.25;
  }));
  return continuationTable({ deckSize: 9, pot: 6.5, stack: 7, ranges: r, oopGross });
}

/** Restricted preflop-only deviation with the continuation policy held fixed. */
export function tinyCollapsedGrade(table: ContinuationTable, strategy: BehavioralStrategy<TinyAction>) {
  if (table.pot !== 6.5 || table.stack !== 7 || JSON.stringify(table.ranges) !== JSON.stringify(ranges())) throw new Error("not the frozen tiny continuation");
  let value0 = 0, ipPreflopBestResponse = 0;
  for (let k = 0; k < 3; k++) {
    const entry = strategy.get(`pre|1|${k}`); if (!entry || entry.actions.join() !== "f,c") throw new Error("missing preflop policy");
    const call = entry.probabilities[1]; if (!Number.isFinite(call) || call < 0 || call > 1 || Math.abs(entry.probabilities[0] + call - 1) > 1e-12) throw new Error("invalid preflop policy");
    let mass = 0, callIp = 0;
    for (let h = 0; h < 3; h++) {
      const g = table.oopGross[h][k]; if (g === null) continue; const p = table.mass[h][k];
      mass += p; callIp += p * (6.5 - g - 3.25); value0 += p * ((1 - call) * 1.25 + call * (g - 3.25));
    }
    ipPreflopBestResponse += Math.max(-1.25 * mass, callIp);
  }
  return { value: [value0, -value0] as const, ipPreflopBestResponse };
}
