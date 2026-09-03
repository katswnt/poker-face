// Leduc poker v1: two physical copies of J/Q/K, one private card per
// player, one public card, and two fixed-limit betting rounds. This is an
// independent implementation of the locked rules in tasks/solver-lab-roadmap.md;
// no third-party solver implementation code is copied here.
import type {
  ExtensiveFormGame,
  GameNode,
  SolverPlayer,
  Utility,
  Weighted,
} from "./game";

export const LEDUC_RANKS = ["J", "Q", "K"] as const;
export type LeducRank = (typeof LEDUC_RANKS)[number];

export const LEDUC_CARDS = ["J0", "J1", "Q0", "Q1", "K0", "K1"] as const;
export type LeducCard = (typeof LEDUC_CARDS)[number];
export type LeducAction = "check" | "bet" | "fold" | "call" | "raise";
export type LeducRound = 0 | 1;

export interface LeducPrivateDeal {
  readonly cards: readonly [LeducCard, LeducCard];
}

export interface LeducCompleteDeal extends LeducPrivateDeal {
  readonly board: LeducCard;
}

export type LeducChanceOutcome =
  | { readonly kind: "private"; readonly cards: readonly [LeducCard, LeducCard] }
  | { readonly kind: "board"; readonly card: LeducCard };

export interface LeducState {
  readonly privateCards: readonly [LeducCard, LeducCard] | null;
  readonly board: LeducCard | null;
  readonly round: LeducRound;
  readonly histories: readonly [readonly LeducAction[], readonly LeducAction[]];
}

const CHECK_OR_BET = ["check", "bet"] as const;
const FOLD_CALL_OR_RAISE = ["fold", "call", "raise"] as const;
const FOLD_OR_CALL = ["fold", "call"] as const;

type RoundState =
  | { readonly kind: "decision"; readonly player: SolverPlayer; readonly actions: readonly LeducAction[] }
  | { readonly kind: "complete" }
  | { readonly kind: "fold"; readonly winner: SolverPlayer };

export const LEDUC_PRIVATE_DEALS: readonly LeducPrivateDeal[] = LEDUC_CARDS.flatMap(card0 =>
  LEDUC_CARDS
    .filter(card1 => card1 !== card0)
    .map(card1 => ({ cards: [card0, card1] as const })),
);

export const LEDUC_COMPLETE_DEALS: readonly LeducCompleteDeal[] = LEDUC_PRIVATE_DEALS.flatMap(
  deal => LEDUC_CARDS
    .filter(board => !deal.cards.includes(board))
    .map(board => ({ cards: deal.cards, board })),
);

const PRIVATE_CHANCE_OUTCOMES: readonly Weighted<LeducChanceOutcome>[] =
  LEDUC_PRIVATE_DEALS.map(deal => ({
    outcome: { kind: "private", cards: deal.cards },
    probability: 1 / LEDUC_PRIVATE_DEALS.length,
  }));

function historyLabel(history: readonly LeducAction[]): string {
  return history.length === 0 ? "start" : history.join("-");
}

function isLeducCard(value: unknown): value is LeducCard {
  return typeof value === "string" && LEDUC_CARDS.some(card => card === value);
}

export function leducRank(card: LeducCard): LeducRank {
  return card[0] as LeducRank;
}

function roundState(history: readonly LeducAction[]): RoundState {
  switch (historyLabel(history)) {
    case "start":
      return { kind: "decision", player: 0, actions: CHECK_OR_BET };
    case "check":
      return { kind: "decision", player: 1, actions: CHECK_OR_BET };
    case "bet":
      return { kind: "decision", player: 1, actions: FOLD_CALL_OR_RAISE };
    case "check-bet":
      return { kind: "decision", player: 0, actions: FOLD_CALL_OR_RAISE };
    case "bet-raise":
      return { kind: "decision", player: 0, actions: FOLD_OR_CALL };
    case "check-bet-raise":
      return { kind: "decision", player: 1, actions: FOLD_OR_CALL };
    case "check-check":
    case "bet-call":
    case "bet-raise-call":
    case "check-bet-call":
    case "check-bet-raise-call":
      return { kind: "complete" };
    case "bet-fold":
    case "check-bet-raise-fold":
      return { kind: "fold", winner: 0 };
    case "check-bet-fold":
    case "bet-raise-fold":
      return { kind: "fold", winner: 1 };
    default:
      throw new Error(`Illegal Leduc round history: ${historyLabel(history)}`);
  }
}

function assertPhysicalCards(cards: readonly [LeducCard, LeducCard]): void {
  if (!isLeducCard(cards[0]) || !isLeducCard(cards[1]) || cards[0] === cards[1]) {
    throw new Error(`Illegal Leduc private cards: ${String(cards[0])}, ${String(cards[1])}`);
  }
}

function assertValidState(state: LeducState): void {
  if (!state.privateCards) {
    if (
      state.board !== null || state.round !== 0 ||
      state.histories[0].length !== 0 || state.histories[1].length !== 0
    ) {
      throw new Error("Undealt Leduc state contains board, round, or action data");
    }
    return;
  }

  assertPhysicalCards(state.privateCards);
  const firstRound = roundState(state.histories[0]);
  if (state.round === 0) {
    if (state.board !== null || state.histories[1].length !== 0) {
      throw new Error("First-round Leduc state contains second-round data");
    }
    if (firstRound.kind === "complete") {
      throw new Error("Completed first-round Leduc state did not advance to the board chance node");
    }
    return;
  }

  if (firstRound.kind !== "complete") {
    throw new Error("Second-round Leduc state does not follow a completed first round");
  }
  if (state.board === null) {
    if (state.histories[1].length !== 0) {
      throw new Error("Leduc second-round actions cannot precede the public card");
    }
    return;
  }
  if (!isLeducCard(state.board) || state.privateCards.includes(state.board)) {
    throw new Error(`Illegal Leduc board card: ${String(state.board)}`);
  }
  roundState(state.histories[1]);
}

function roundContributions(
  history: readonly LeducAction[],
  betSize: 1 | 2,
): readonly [number, number] {
  const contributions = [0, 0];
  const prefix: LeducAction[] = [];
  for (const action of history) {
    const state = roundState(prefix);
    if (state.kind !== "decision" || !state.actions.some(legal => legal === action)) {
      throw new Error(`Illegal Leduc action ${action} after ${historyLabel(prefix)}`);
    }
    const toCall = Math.max(...contributions) - contributions[state.player];
    if (action === "bet") contributions[state.player] += betSize;
    else if (action === "raise") contributions[state.player] += toCall + betSize;
    else if (action === "call") contributions[state.player] += toCall;
    prefix.push(action);
  }
  return contributions as [number, number];
}

export function leducContributions(state: LeducState): readonly [number, number] {
  const firstRound = roundContributions(state.histories[0], 1);
  const secondRound = roundContributions(state.histories[1], 2);
  return [1 + firstRound[0] + secondRound[0], 1 + firstRound[1] + secondRound[1]];
}

function winnerUtility(winner: SolverPlayer, contributions: readonly [number, number]): Utility {
  const pot = contributions[0] + contributions[1];
  return winner === 0
    ? [pot - contributions[0], -contributions[1]]
    : [-contributions[0], pot - contributions[1]];
}

export function leducShowdownWinner(
  cards: readonly [LeducCard, LeducCard],
  board: LeducCard,
): SolverPlayer | null {
  assertPhysicalCards(cards);
  if (!isLeducCard(board) || cards.includes(board)) {
    throw new Error(`Illegal Leduc showdown board: ${String(board)}`);
  }
  const boardRank = leducRank(board);
  const rank0 = leducRank(cards[0]);
  const rank1 = leducRank(cards[1]);
  const pair0 = rank0 === boardRank;
  const pair1 = rank1 === boardRank;
  if (pair0 !== pair1) return pair0 ? 0 : 1;
  const rankDifference = LEDUC_RANKS.indexOf(rank0) - LEDUC_RANKS.indexOf(rank1);
  return rankDifference === 0 ? null : rankDifference > 0 ? 0 : 1;
}

function terminalUtility(state: LeducState, winner: SolverPlayer | null): Utility {
  const contributions = leducContributions(state);
  if (winner !== null) return winnerUtility(winner, contributions);
  const pot = contributions[0] + contributions[1];
  return [pot / 2 - contributions[0], pot / 2 - contributions[1]];
}

function publicHistory(state: LeducState): string {
  return `r0=${historyLabel(state.histories[0])}:r1=${historyLabel(state.histories[1])}`;
}

function cardsFor(state: LeducState): readonly [LeducCard, LeducCard] {
  if (!state.privateCards) throw new Error("Leduc private cards have not been dealt");
  return state.privateCards;
}

export const leducGame: ExtensiveFormGame<LeducState, LeducAction, LeducChanceOutcome> = {
  id: "leduc-v1",

  initialState(): LeducState {
    return { privateCards: null, board: null, round: 0, histories: [[], []] };
  },

  node(state): GameNode<LeducAction, LeducChanceOutcome> {
    assertValidState(state);
    if (!state.privateCards) return { kind: "chance", outcomes: PRIVATE_CHANCE_OUTCOMES };

    const currentRound = roundState(state.histories[state.round]);
    if (state.round === 0) {
      if (currentRound.kind === "decision") {
        return { kind: "player", player: currentRound.player, actions: currentRound.actions };
      }
      if (currentRound.kind === "fold") {
        return { kind: "terminal", utility: terminalUtility(state, currentRound.winner) };
      }
      throw new Error("Completed first-round Leduc state was not advanced");
    }

    if (state.board === null) {
      const outcomes: readonly Weighted<LeducChanceOutcome>[] = LEDUC_CARDS
        .filter(card => !state.privateCards!.includes(card))
        .map(card => ({ outcome: { kind: "board", card }, probability: 1 / 4 }));
      return { kind: "chance", outcomes };
    }
    if (currentRound.kind === "decision") {
      return { kind: "player", player: currentRound.player, actions: currentRound.actions };
    }
    if (currentRound.kind === "fold") {
      return { kind: "terminal", utility: terminalUtility(state, currentRound.winner) };
    }
    return {
      kind: "terminal",
      utility: terminalUtility(state, leducShowdownWinner(state.privateCards, state.board)),
    };
  },

  nextChance(state, outcome): LeducState {
    const node = this.node(state);
    if (node.kind !== "chance") throw new Error("Cannot deal cards at a non-chance Leduc node");
    if (!state.privateCards) {
      if (outcome.kind !== "private") throw new Error("The first Leduc deal must contain private cards");
      assertPhysicalCards(outcome.cards);
      return { privateCards: [...outcome.cards], board: null, round: 0, histories: [[], []] };
    }

    if (outcome.kind !== "board") throw new Error("The second Leduc deal must contain a board card");
    if (!isLeducCard(outcome.card) || state.privateCards.includes(outcome.card)) {
      throw new Error(`Illegal Leduc board card: ${String(outcome.card)}`);
    }
    return { ...state, board: outcome.card };
  },

  nextAction(state, action): LeducState {
    const node = this.node(state);
    if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} Leduc node`);
    if (!node.actions.some(legal => legal === action)) {
      throw new Error(
        `Illegal Leduc action ${action} in round ${state.round + 1} ` +
        `after ${historyLabel(state.histories[state.round])}`,
      );
    }

    const histories: [LeducAction[], LeducAction[]] = [
      [...state.histories[0]],
      [...state.histories[1]],
    ];
    histories[state.round].push(action);
    if (state.round === 0 && roundState(histories[0]).kind === "complete") {
      return { privateCards: cardsFor(state), board: null, round: 1, histories };
    }
    return { ...state, histories };
  },

  informationSet(state, player: SolverPlayer): string {
    const node = this.node(state);
    if (node.kind !== "player") throw new Error("Terminal and chance nodes have no information set");
    if (node.player !== player) {
      throw new Error(`Player ${player} does not act at ${publicHistory(state)}`);
    }
    const board = state.board === null ? "-" : leducRank(state.board);
    return `${this.id}:p${player}:card=${leducRank(cardsFor(state)[player])}:board=${board}:` +
      publicHistory(state);
  },
};

export interface LeducStateInput {
  readonly privateCards: readonly [LeducCard, LeducCard];
  readonly firstRound?: readonly LeducAction[];
  readonly board?: LeducCard;
  readonly secondRound?: readonly LeducAction[];
}

/** Build a validated state by applying public events through the rule engine. */
export function leducState({
  privateCards,
  firstRound = [],
  board,
  secondRound = [],
}: LeducStateInput): LeducState {
  let state = leducGame.nextChance(
    leducGame.initialState(),
    { kind: "private", cards: privateCards },
  );
  for (const action of firstRound) state = leducGame.nextAction(state, action);
  if (board !== undefined) state = leducGame.nextChance(state, { kind: "board", card: board });
  if (secondRound.length > 0 && board === undefined) {
    throw new Error("Leduc second-round actions require a board card");
  }
  for (const action of secondRound) state = leducGame.nextAction(state, action);
  return state;
}
