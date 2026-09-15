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

export type ThreePlayers<T> = readonly [T, T, T];
export type MultiwayRiverAction = "check" | "bet" | "fold" | "call";
export type MultiwayRiverPosition = "first" | "middle" | "last";

export interface MultiwayRiverRangeEntry {
  readonly cards: RiverCombo;
  readonly weight: number;
}

export interface MultiwayRiverScenario {
  readonly id: string;
  readonly version: 1;
  readonly board: readonly RiverCard[];
  readonly ranges: ThreePlayers<readonly MultiwayRiverRangeEntry[]>;
  readonly committed: ThreePlayers<number>;
  readonly stackBehind: ThreePlayers<number>;
  readonly positions: ThreePlayers<MultiwayRiverPosition>;
  readonly actionOrder: ThreePlayers<number>;
  readonly betSize: number;
  readonly maxRaises: 0;
}

export interface MultiwayRiverDeal {
  readonly hands: ThreePlayers<RiverCombo>;
}

export interface MultiwayRiverPublicState {
  readonly active: ThreePlayers<boolean>;
  readonly streetContributions: ThreePlayers<number>;
  readonly actingPlayer: number | null;
  readonly bettor: number | null;
  readonly pendingResponders: readonly number[];
  readonly checkedCount: number;
  readonly terminal: "fold" | "showdown" | null;
  readonly history: readonly MultiwayRiverAction[];
}

export interface MultiwayRiverState {
  readonly hands: ThreePlayers<RiverCombo> | null;
  readonly public: MultiwayRiverPublicState;
}

export interface MultiwayRiverGame extends MultiwayExtensiveFormGame<
  MultiwayRiverState,
  MultiwayRiverAction,
  MultiwayRiverDeal
> {
  readonly scenario: MultiwayRiverScenario;
  readonly deals: readonly Weighted<MultiwayRiverDeal>[];
  totalContributions(state: MultiwayRiverState): ThreePlayers<number>;
  showdownWinners(state: MultiwayRiverState): readonly number[];
}

const UNOPENED_ACTIONS = ["check", "bet"] as const;
const RESPONSE_ACTIONS = ["fold", "call"] as const;

function asThree<T>(values: readonly T[], label: string): ThreePlayers<T> {
  if (values.length !== 3) throw new Error(`${label} must contain exactly three values`);
  return [values[0], values[1], values[2]];
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

function validateScenario(input: MultiwayRiverScenario): MultiwayRiverScenario {
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) throw new Error(`Invalid scenario id ${input.id}`);
  if (input.version !== 1) throw new Error(`Unsupported multiway river version ${input.version}`);
  if (input.board.length !== 5) throw new Error(`A river board needs five cards; received ${input.board.length}`);
  assertDistinctRiverCards(input.board, "Multiway river board");
  input.committed.forEach((value, player) => assertPositiveWhole(value, `Player ${player} commitment`));
  input.stackBehind.forEach((value, player) => assertPositiveWhole(value, `Player ${player} stack`));
  assertPositiveWhole(input.betSize, "Bet size");
  if (new Set(input.committed).size !== 1) throw new Error("River v1 requires equal prior contributions");
  if (new Set(input.stackBehind).size !== 1) throw new Error("River v1 requires equal stacks");
  if (input.stackBehind.some(stack => input.betSize > stack)) throw new Error("Bet exceeds a player's stack");
  if (input.maxRaises !== 0) throw new Error("Multiway river v1 does not allow raises");
  if (input.actionOrder.join(",") !== "0,1,2") throw new Error("River v1 action order must be 0,1,2");
  if (input.positions.join(",") !== "first,middle,last") {
    throw new Error("River v1 positions must match its action order");
  }
  return {
    ...input,
    board: [...input.board],
    ranges: asThree(
      input.ranges.map((range, player) => validateRange(range, input.board, player)),
      "Ranges",
    ),
    committed: asThree([...input.committed], "Commitments"),
    stackBehind: asThree([...input.stackBehind], "Stacks"),
    positions: asThree([...input.positions], "Positions"),
    actionOrder: asThree([...input.actionOrder], "Action order"),
  };
}

function buildDeals(scenario: MultiwayRiverScenario): readonly Weighted<MultiwayRiverDeal>[] {
  const compatible: { hands: ThreePlayers<RiverCombo>; weight: number }[] = [];
  for (const first of scenario.ranges[0]) {
    for (const second of scenario.ranges[1]) {
      if (riverCombosOverlap(first.cards, second.cards)) continue;
      for (const third of scenario.ranges[2]) {
        if (
          riverCombosOverlap(first.cards, third.cards) ||
          riverCombosOverlap(second.cards, third.cards)
        ) continue;
        compatible.push({
          hands: [first.cards, second.cards, third.cards],
          weight: first.weight * second.weight * third.weight,
        });
      }
    }
  }
  const totalWeight = compatible.reduce((sum, deal) => sum + deal.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Multiway ranges contain no compatible private-hand tuples");
  }
  return compatible.map(deal => ({
    outcome: { hands: deal.hands },
    probability: deal.weight / totalWeight,
  }));
}

function dealKey(hands: ThreePlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function initialPublicState(): MultiwayRiverPublicState {
  return {
    active: [true, true, true],
    streetContributions: [0, 0, 0],
    actingPlayer: 0,
    bettor: null,
    pendingResponders: [],
    checkedCount: 0,
    terminal: null,
    history: [],
  };
}

function seatsAfter(player: number): readonly number[] {
  return [1, 2].map(offset => (player + offset) % 3);
}

function activeCount(active: ThreePlayers<boolean>): number {
  return active.filter(Boolean).length;
}

function advancePublicState(
  current: MultiwayRiverPublicState,
  action: MultiwayRiverAction,
  betSize: number,
): MultiwayRiverPublicState {
  const player = current.actingPlayer;
  if (player === null || current.terminal) throw new Error(`Cannot play ${action} after the hand ended`);
  const active = [...current.active] as [boolean, boolean, boolean];
  const contributions = [...current.streetContributions] as [number, number, number];
  const history = [...current.history, action];

  if (current.bettor === null) {
    if (action === "check") {
      const checkedCount = current.checkedCount + 1;
      return checkedCount === activeCount(active)
        ? {
            ...current,
            actingPlayer: null,
            checkedCount,
            terminal: "showdown",
            history,
          }
        : {
            ...current,
            actingPlayer: seatsAfter(player).find(seat => active[seat]) ?? null,
            checkedCount,
            history,
          };
    }
    if (action !== "bet") throw new Error(`${action} is illegal when no bet is open`);
    contributions[player] = betSize;
    const pendingResponders = seatsAfter(player).filter(seat => active[seat]);
    return {
      ...current,
      streetContributions: contributions,
      actingPlayer: pendingResponders[0] ?? null,
      bettor: player,
      pendingResponders,
      history,
    };
  }

  if (action !== "fold" && action !== "call") throw new Error(`${action} is illegal facing a bet`);
  if (current.pendingResponders[0] !== player) throw new Error(`Player ${player} is not the next responder`);
  if (action === "fold") active[player] = false;
  else contributions[player] = betSize;
  const pendingResponders = current.pendingResponders.slice(1);
  const onlyOneActive = activeCount(active) === 1;
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

function terminalUtility(game: MultiwayRiverGame, state: MultiwayRiverState): ThreePlayers<number> {
  const contributions = game.totalContributions(state);
  const pot = contributions.reduce((sum, value) => sum + value, 0);
  const winners = game.showdownWinners(state);
  const share = pot / winners.length;
  return asThree(
    contributions.map((contribution, player) =>
      winners.includes(player) ? share - contribution : -contribution),
    "Terminal utility",
  );
}

export function createMultiwayRiverGame(input: MultiwayRiverScenario): MultiwayRiverGame {
  const scenario = validateScenario(input);
  const deals = buildDeals(scenario);
  const dealKeys = new Set(deals.map(({ outcome }) => dealKey(outcome.hands)));
  const game: MultiwayRiverGame = {
    id: scenario.id,
    playerCount: 3,
    scenario,
    deals,
    initialState: () => ({ hands: null, public: initialPublicState() }),
    node(state): MultiwayGameNode<MultiwayRiverAction, MultiwayRiverDeal> {
      if (!state.hands) {
        if (state.public.history.length > 0) throw new Error("Undealt river state contains actions");
        return { kind: "chance", outcomes: deals };
      }
      if (state.public.terminal) return { kind: "terminal", utility: terminalUtility(game, state) };
      if (state.public.actingPlayer === null) throw new Error("Non-terminal river state has no acting player");
      return {
        kind: "player",
        player: state.public.actingPlayer,
        actions: state.public.bettor === null ? UNOPENED_ACTIONS : RESPONSE_ACTIONS,
      };
    },
    nextChance(state, outcome): MultiwayRiverState {
      const node = game.node(state);
      if (node.kind !== "chance") throw new Error("Cannot deal hands at a non-chance node");
      const hands = asThree(outcome.hands.map(canonicalRiverCombo), "Private hands");
      if (!dealKeys.has(dealKey(hands))) throw new Error(`Deal ${dealKey(hands)} is outside the ranges`);
      return { hands, public: initialPublicState() };
    },
    nextAction(state, action): MultiwayRiverState {
      const node = game.node(state);
      if (node.kind !== "player") throw new Error(`Cannot play ${action} at a ${node.kind} node`);
      if (!node.actions.includes(action)) {
        throw new Error(`Illegal action ${action} after ${state.public.history.join("-") || "start"}`);
      }
      return { hands: state.hands, public: advancePublicState(state.public, action, scenario.betSize) };
    },
    informationSet(state, player): string {
      const node = game.node(state);
      if (node.kind !== "player" || node.player !== player || !state.hands) {
        throw new Error(`Player ${player} does not act in this state`);
      }
      const view = state.public;
      return `${scenario.id}:board=${scenario.board.join("")}:p${player}:` +
        `hand=${riverComboKey(state.hands[player])}:active=${view.active.map(Number).join("")}:` +
        `put=${view.streetContributions.join(",")}:history=${view.history.join("-") || "start"}`;
    },
    totalContributions(state): ThreePlayers<number> {
      return asThree(
        scenario.committed.map((committed, player) => committed + state.public.streetContributions[player]),
        "Total contributions",
      );
    },
    showdownWinners(state): readonly number[] {
      if (!state.hands) throw new Error("Cannot score an undealt river state");
      const active = state.public.active.map((isActive, player) => isActive ? player : null)
        .filter((player): player is number => player !== null);
      if (active.length === 0) throw new Error("A river state cannot have zero active players");
      if (active.length === 1) return active;
      const scores = active.map(player => ({
        player,
        score: riverHandScore(state.hands![player], scenario.board),
      }));
      const best = Math.max(...scores.map(result => result.score));
      return scores.filter(result => result.score === best).map(result => result.player);
    },
  };
  return game;
}

export function multiwayRiverState(
  game: MultiwayRiverGame,
  hands: ThreePlayers<RiverCombo>,
  history: readonly MultiwayRiverAction[] = [],
): MultiwayRiverState {
  let state = game.nextChance(game.initialState(), { hands });
  for (const action of history) state = game.nextAction(state, action);
  return state;
}
