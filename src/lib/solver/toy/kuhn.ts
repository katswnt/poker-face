// Kuhn poker v1: J/Q/K, one private card each, one-chip antes, player 0 first.
// With no open bet a player may check or bet one chip; facing a bet they may fold
// or call, and there are no raises. Utilities are net chips from the start of the
// hand, so every terminal result is exactly zero-sum.
import type {
  ExtensiveFormGame,
  GameNode,
  SolverPlayer,
  Utility,
  Weighted,
} from "./game";

export const KUHN_RANKS = ["J", "Q", "K"] as const;
export type KuhnRank = (typeof KUHN_RANKS)[number];
export type KuhnAction = "check" | "bet" | "fold" | "call";

export interface KuhnDeal {
  readonly cards: readonly [KuhnRank, KuhnRank];
}

export interface KuhnState {
  readonly cards: readonly [KuhnRank, KuhnRank] | null;
  readonly history: readonly KuhnAction[];
}

const CHECK_OR_BET = ["check", "bet"] as const;
const FOLD_OR_CALL = ["fold", "call"] as const;

export const KUHN_DEALS: readonly KuhnDeal[] = KUHN_RANKS.flatMap(card0 =>
  KUHN_RANKS
    .filter(card1 => card1 !== card0)
    .map(card1 => ({ cards: [card0, card1] as const })),
);

const KUHN_CHANCE_OUTCOMES: readonly Weighted<KuhnDeal>[] = KUHN_DEALS.map(outcome => ({
  outcome,
  probability: 1 / KUHN_DEALS.length,
}));

function historyLabel(history: readonly KuhnAction[]): string {
  return history.length === 0 ? "start" : history.join("-");
}

function cardsFor(state: KuhnState): readonly [KuhnRank, KuhnRank] {
  if (!state.cards) throw new Error("Kuhn private cards have not been dealt");
  return state.cards;
}

function showdownUtility(cards: readonly [KuhnRank, KuhnRank], stake: 1 | 2): Utility {
  const winner = KUHN_RANKS.indexOf(cards[0]) > KUHN_RANKS.indexOf(cards[1]) ? 0 : 1;
  return winner === 0 ? [stake, -stake] : [-stake, stake];
}

function nodeForDealtState(state: KuhnState): GameNode<KuhnAction, KuhnDeal> {
  const cards = cardsFor(state);
  switch (historyLabel(state.history)) {
    case "start":
      return { kind: "player", player: 0, actions: CHECK_OR_BET };
    case "check":
      return { kind: "player", player: 1, actions: CHECK_OR_BET };
    case "bet":
      return { kind: "player", player: 1, actions: FOLD_OR_CALL };
    case "check-bet":
      return { kind: "player", player: 0, actions: FOLD_OR_CALL };
    case "check-check":
      return { kind: "terminal", utility: showdownUtility(cards, 1) };
    case "bet-fold":
      return { kind: "terminal", utility: [1, -1] };
    case "bet-call":
    case "check-bet-call":
      return { kind: "terminal", utility: showdownUtility(cards, 2) };
    case "check-bet-fold":
      return { kind: "terminal", utility: [-1, 1] };
    default:
      throw new Error(`Illegal Kuhn history: ${historyLabel(state.history)}`);
  }
}

function isKuhnRank(value: string): value is KuhnRank {
  return KUHN_RANKS.some(rank => rank === value);
}

export const kuhnGame: ExtensiveFormGame<KuhnState, KuhnAction, KuhnDeal> = {
  id: "kuhn-v1",

  initialState(): KuhnState {
    return { cards: null, history: [] };
  },

  node(state): GameNode<KuhnAction, KuhnDeal> {
    if (!state.cards) {
      if (state.history.length !== 0) throw new Error("Undealt Kuhn state cannot have action history");
      return { kind: "chance", outcomes: KUHN_CHANCE_OUTCOMES };
    }
    return nodeForDealtState(state);
  },

  nextChance(state, outcome): KuhnState {
    const node = this.node(state);
    if (node.kind !== "chance") throw new Error("Cannot deal cards at a non-chance Kuhn node");
    const [card0, card1] = outcome.cards;
    if (!isKuhnRank(card0) || !isKuhnRank(card1) || card0 === card1) {
      throw new Error(`Illegal Kuhn deal: ${String(card0)}, ${String(card1)}`);
    }
    if (!KUHN_DEALS.some(deal => deal.cards[0] === card0 && deal.cards[1] === card1)) {
      throw new Error(`Unknown Kuhn deal: ${card0}, ${card1}`);
    }
    return { cards: [card0, card1], history: [] };
  },

  nextAction(state, action): KuhnState {
    const node = this.node(state);
    if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} Kuhn node`);
    if (!node.actions.some(legal => legal === action)) {
      throw new Error(`Illegal Kuhn action ${action} after ${historyLabel(state.history)}`);
    }
    return { cards: cardsFor(state), history: [...state.history, action] };
  },

  informationSet(state, player: SolverPlayer): string {
    const node = this.node(state);
    if (node.kind !== "player") throw new Error("Terminal and chance nodes have no information set");
    if (node.player !== player) {
      throw new Error(`Player ${player} does not act after ${historyLabel(state.history)}`);
    }
    return `${this.id}:p${player}:card=${cardsFor(state)[player]}:history=${historyLabel(state.history)}`;
  },
};

export function kuhnState(
  cards: readonly [KuhnRank, KuhnRank],
  history: readonly KuhnAction[] = [],
): KuhnState {
  let state = kuhnGame.nextChance(kuhnGame.initialState(), { cards });
  for (const action of history) state = kuhnGame.nextAction(state, action);
  return state;
}
