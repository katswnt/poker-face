import {
  assertDistinctRiverCards,
  canonicalRiverCombo,
  riverComboKey,
  riverCombosOverlap,
  riverHandScore,
  type RiverCard,
  type RiverCombo,
} from "../river/cards";
import type { MultiwayExtensiveFormGame, MultiwayGameNode, Weighted } from "./game";
import type { MultiwayRiverRangeEntry } from "./river-game";

export type FourPlayers<T> = readonly [T, T, T, T];
export type FourPlayerRiverAction = "check" | "bet-30" | "fold" | "call";
export type FourPlayerRiverPosition = "first" | "second" | "third" | "last";

export interface FourPlayerRiverScenario {
  readonly id: string;
  readonly version: 1;
  readonly board: readonly RiverCard[];
  readonly ranges: FourPlayers<readonly MultiwayRiverRangeEntry[]>;
  readonly committed: FourPlayers<number>;
  readonly stackBehind: FourPlayers<number>;
  readonly positions: FourPlayers<FourPlayerRiverPosition>;
  readonly actionOrder: FourPlayers<number>;
  readonly betSize: 30;
  readonly maxRaises: 0;
}

export interface FourPlayerRiverDeal {
  readonly hands: FourPlayers<RiverCombo>;
}

export interface FourPlayerRiverPublicState {
  readonly active: FourPlayers<boolean>;
  readonly streetContributions: FourPlayers<number>;
  readonly actingPlayer: number | null;
  readonly bettor: number | null;
  readonly pendingResponders: readonly number[];
  readonly checkedCount: number;
  readonly terminal: "fold" | "showdown" | null;
  readonly history: readonly FourPlayerRiverAction[];
}

export interface FourPlayerRiverState {
  readonly hands: FourPlayers<RiverCombo> | null;
  readonly public: FourPlayerRiverPublicState;
}

export interface FourPlayerRiverSettlement {
  readonly contributions: FourPlayers<number>;
  readonly pot: number;
  readonly winners: readonly number[];
  readonly awards: FourPlayers<number>;
  readonly utility: FourPlayers<number>;
}

export interface FourPlayerRiverGame extends MultiwayExtensiveFormGame<
  FourPlayerRiverState,
  FourPlayerRiverAction,
  FourPlayerRiverDeal
> {
  readonly scenario: FourPlayerRiverScenario;
  readonly deals: readonly Weighted<FourPlayerRiverDeal>[];
  totalContributions(state: FourPlayerRiverState): FourPlayers<number>;
  settlement(state: FourPlayerRiverState): FourPlayerRiverSettlement;
}

const UNOPENED_ACTIONS = ["check", "bet-30"] as const;
const RESPONSE_ACTIONS = ["fold", "call"] as const;
const POSITION_ORDER = ["first", "second", "third", "last"] as const;

function asFour<T>(values: readonly T[], label: string): FourPlayers<T> {
  if (values.length !== 4) throw new Error(`${label} must contain exactly four values`);
  return [values[0], values[1], values[2], values[3]];
}

function assertPositiveWhole(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number; received ${value}`);
  }
}

function validateRange(
  range: readonly MultiwayRiverRangeEntry[],
  board: readonly RiverCard[],
  player: number,
): readonly MultiwayRiverRangeEntry[] {
  if (range.length === 0) throw new Error(`Player ${player} range is empty`);
  const boardCards = new Set(board);
  const seen = new Set<string>();
  return range.map(entry => {
    const cards = canonicalRiverCombo(entry.cards);
    const key = riverComboKey(cards);
    if (cards.some(card => boardCards.has(card))) {
      throw new Error(`Player ${player} range combo ${key} collides with the board`);
    }
    if (seen.has(key)) throw new Error(`Player ${player} range repeats combo ${key}`);
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(`Player ${player} range combo ${key} has invalid weight ${entry.weight}`);
    }
    seen.add(key);
    return { cards, weight: entry.weight };
  });
}

function validateScenario(input: FourPlayerRiverScenario): FourPlayerRiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid scenario id ${input.id}`);
  if (input.version !== 1) throw new Error(`Unsupported four-player river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Four-player river board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} commitment`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} stack`));
  if (input.committed.some(value => value !== 30)) {
    throw new Error("Four-player river v1 requires each player to have committed 30 chips");
  }
  if (input.stackBehind.some(value => value !== 60)) {
    throw new Error("Four-player river v1 requires each player to have 60 chips behind");
  }
  if (input.betSize !== 30) throw new Error("Four-player river v1 locks the bet at 30 chips");
  if (input.maxRaises !== 0) throw new Error("Four-player river v1 does not allow raises");
  if (
    new Set(input.actionOrder).size !== 4 ||
    input.actionOrder.some(player => !Number.isSafeInteger(player) || player < 0 || player > 3)
  ) throw new Error("Four-player action order must contain seats 0,1,2,3 exactly once");
  input.actionOrder.forEach((seat, orderIndex) => {
    if (input.positions[seat] !== POSITION_ORDER[orderIndex]) {
      throw new Error("Four-player positions must match action order");
    }
  });
  return {
    ...input,
    board: [...input.board],
    ranges: asFour(
      input.ranges.map((range, player) => validateRange(range, input.board, player)),
      "Ranges",
    ),
    committed: asFour(input.committed, "Commitments"),
    stackBehind: asFour(input.stackBehind, "Stacks"),
    positions: asFour(input.positions, "Positions"),
    actionOrder: asFour(input.actionOrder, "Action order"),
  };
}

function buildDeals(scenario: FourPlayerRiverScenario): readonly Weighted<FourPlayerRiverDeal>[] {
  const compatible: { hands: FourPlayers<RiverCombo>; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      if (riverCombosOverlap(first.cards, second.cards)) continue;
      for (const third of scenario.ranges[2]) {
        if (
          riverCombosOverlap(first.cards, third.cards) ||
          riverCombosOverlap(second.cards, third.cards)
        ) continue;
        for (const fourth of scenario.ranges[3]) {
          if (
            riverCombosOverlap(first.cards, fourth.cards) ||
            riverCombosOverlap(second.cards, fourth.cards) ||
            riverCombosOverlap(third.cards, fourth.cards)
          ) continue;
          compatible.push({
            hands: [first.cards, second.cards, third.cards, fourth.cards],
            weight: first.weight * second.weight * third.weight * fourth.weight,
          });
        }
      }
    }
  }
  const totalWeight = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Four-player ranges contain no compatible private-hand tuples");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / totalWeight,
  }));
}

function dealKey(hands: FourPlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function orderedAfter(player: number, order: FourPlayers<number>): readonly number[] {
  const index = order.indexOf(player);
  if (index < 0) throw new Error(`Player ${player} is absent from action order`);
  return [1, 2, 3].map(offset => order[(index + offset) % 4]);
}

function initialPublicState(order: FourPlayers<number>): FourPlayerRiverPublicState {
  return {
    active: [true, true, true, true],
    streetContributions: [0, 0, 0, 0],
    actingPlayer: order[0],
    bettor: null,
    pendingResponders: [],
    checkedCount: 0,
    terminal: null,
    history: [],
  };
}

function advance(
  current: FourPlayerRiverPublicState,
  action: FourPlayerRiverAction,
  scenario: FourPlayerRiverScenario,
): FourPlayerRiverPublicState {
  const player = current.actingPlayer;
  if (player === null || current.terminal) throw new Error(`Cannot play ${action} after the hand ended`);
  const active = [...current.active] as [boolean, boolean, boolean, boolean];
  const contributions = [...current.streetContributions] as [number, number, number, number];
  const history = [...current.history, action];

  if (current.bettor === null) {
    if (action === "check") {
      const checkedCount = current.checkedCount + 1;
      return checkedCount === 4
        ? { ...current, actingPlayer: null, checkedCount, terminal: "showdown", history }
        : {
            ...current,
            actingPlayer: orderedAfter(player, scenario.actionOrder)[0],
            checkedCount,
            history,
          };
    }
    if (action !== "bet-30") throw new Error(`${action} is illegal when no bet is open`);
    contributions[player] = scenario.betSize;
    const pendingResponders = orderedAfter(player, scenario.actionOrder);
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0],
      bettor: player,
      pendingResponders,
      history,
    };
  }

  if (current.pendingResponders[0] !== player) throw new Error(`Player ${player} is not next to respond`);
  if (action !== "fold" && action !== "call") throw new Error(`${action} is illegal facing a bet`);
  if (action === "fold") active[player] = false;
  else contributions[player] = scenario.betSize;
  const pendingResponders = current.pendingResponders.slice(1);
  const onlyOneActive = active.filter(Boolean).length === 1;
  const finished = onlyOneActive || pendingResponders.length === 0;
  return {
    ...current,
    active,
    streetContributions: contributions,
    actingPlayer: finished ? null : pendingResponders[0],
    pendingResponders,
    terminal: finished ? (onlyOneActive ? "fold" : "showdown") : null,
    history,
  };
}

export function createFourPlayerRiverGame(input: FourPlayerRiverScenario): FourPlayerRiverGame {
  const scenario = validateScenario(input);
  const deals = buildDeals(scenario);
  const dealKeys = new Set(deals.map(deal => dealKey(deal.outcome.hands)));
  const game: FourPlayerRiverGame = {
    id: scenario.id,
    playerCount: 4,
    scenario,
    deals,
    initialState: () => ({ hands: null, public: initialPublicState(scenario.actionOrder) }),
    node(state): MultiwayGameNode<FourPlayerRiverAction, FourPlayerRiverDeal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt four-player state has actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: game.settlement(state).utility };
      if (state.public.actingPlayer === null) throw new Error("Non-terminal four-player state has no actor");
      return {
        kind: "player",
        player: state.public.actingPlayer,
        actions: state.public.bettor === null ? UNOPENED_ACTIONS : RESPONSE_ACTIONS,
      };
    },
    nextChance(state, outcome): FourPlayerRiverState {
      if (game.node(state).kind !== "chance") throw new Error("Cannot deal at a non-chance node");
      const hands = asFour(outcome.hands.map(canonicalRiverCombo), "Private hands");
      if (!dealKeys.has(dealKey(hands))) throw new Error(`Deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState(scenario.actionOrder) };
    },
    nextAction(state, action): FourPlayerRiverState {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} node`);
      if (!node.actions.includes(action)) {
        throw new Error(`Illegal ${action} after ${state.public.history.join("-") || "start"}`);
      }
      return { hands: state.hands, public: advance(state.public, action, scenario) };
    },
    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act in this state`);
      }
      const view = state.public;
      return `${scenario.id}:board=${scenario.board.join("")}:p${player}:` +
        `hand=${riverComboKey(state.hands[player])}:order=${scenario.actionOrder.join("")}:` +
        `active=${view.active.map(Number).join("")}:put=${view.streetContributions.join(",")}:` +
        `bettor=${view.bettor ?? "none"}:history=${view.history.join("-") || "start"}`;
    },
    totalContributions(state): FourPlayers<number> {
      return asFour(
        scenario.committed.map((amount, player) => amount + state.public.streetContributions[player]),
        "Total contributions",
      );
    },
    settlement(state): FourPlayerRiverSettlement {
      if (!state.public.terminal) throw new Error("Cannot settle a non-terminal four-player state");
      if (!state.hands) throw new Error("Cannot settle an undealt four-player state");
      const contributions = game.totalContributions(state);
      const activePlayers = state.public.active.map((active, player) => active ? player : null)
        .filter((player): player is number => player !== null);
      if (activePlayers.length === 0) throw new Error("Four-player terminal has no active player");
      let winners = activePlayers;
      if (activePlayers.length > 1) {
        const scores = activePlayers.map(player => ({
          player,
          score: riverHandScore(state.hands![player], scenario.board),
        }));
        const best = Math.max(...scores.map(result => result.score));
        winners = scores.filter(result => result.score === best).map(result => result.player);
      }
      const pot = contributions.reduce((sum, amount) => sum + amount, 0);
      const awards = asFour([0, 1, 2, 3].map(player =>
        winners.includes(player) ? pot / winners.length : 0), "Awards");
      const utility = asFour(contributions.map((amount, player) => awards[player] - amount), "Utility");
      return { contributions, pot, winners, awards, utility };
    },
  };
  return game;
}

export function fourPlayerRiverState(
  game: FourPlayerRiverGame,
  hands: FourPlayers<RiverCombo>,
  history: readonly FourPlayerRiverAction[] = [],
): FourPlayerRiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
