import type { GameTreeIndex, InformationSetDefinition } from "../toy/game";
import { RIVER_DECK, riverComboKey, riverHandScore, type RiverCard, type RiverCombo } from "../river/cards";
import { createTurnGame, type TurnAction, type TurnGame, type TurnRequest, type TurnState } from "../turn/game";

export const COMPACT_TURN_VERSION = 1;
export const TURN_TERMINAL = 0;
export const TURN_PLAYER = 1;
export const TURN_CHANCE = 2;
export const COMPACT_TURN_MEMORY_LIMIT = 512 * 1024 * 1024;

export interface CompactTurnPreflight {
  readonly sourceCounts: TurnGame["preflight"];
  readonly publicNodeUpperBound: number;
  readonly informationSetUpperBound: number;
  /** Conservative admission estimate, not a measured RSS or an OS-enforced memory cap. */
  readonly estimatedPeakBytes: number;
  readonly memoryLimitBytes: number;
}

function estimate(game: TurnGame, memoryLimitBytes: number): CompactTurnPreflight {
  if (!Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1 || memoryLimitBytes > COMPACT_TURN_MEMORY_LIMIT) {
    throw new Error(`Compact turn memory limit must be between 1 and ${COMPACT_TURN_MEMORY_LIMIT} bytes`);
  }
  const perDeal = (game.preflight.totalStates - 1) / game.deals.length;
  // Expand the 44-card conditional river tree to its 48-card public union.
  // Applying this factor to pre-river nodes too deliberately overestimates.
  const publicNodeUpperBound = Math.ceil(perDeal * 48 / 44);
  const informationSetUpperBound = publicNodeUpperBound * game.preflight.rangeEntries.reduce((a, b) => a + b, 0);
  // Includes headroom for runtime/GC, JS metadata, readable grading, detached
  // snapshots and 16 retained policies. The fixed reserve was increased after
  // isolated RSS profiling; typed arrays alone badly undercount the job.
  const estimatedPeakBytes = 160 * 1024 * 1024 + publicNodeUpperBound * 1024
    + informationSetUpperBound * 8192 + game.preflight.totalStates * 4096;
  if (estimatedPeakBytes > memoryLimitBytes) {
    throw new Error(`Compact turn estimates ${estimatedPeakBytes} peak bytes; limit is ${memoryLimitBytes}`);
  }
  return Object.freeze({ sourceCounts: game.preflight, publicNodeUpperBound,
    informationSetUpperBound, estimatedPeakBytes, memoryLimitBytes });
}

/** Uses bounded v1 preparation/counting, never builds a repeated state tree. */
export function preflightCompactTurn(request: TurnRequest, memoryLimitBytes = COMPACT_TURN_MEMORY_LIMIT): CompactTurnPreflight {
  return estimate(createTurnGame(request), memoryLimitBytes);
}

export interface CompiledCompactTurn {
  readonly version: 1;
  readonly source: TurnGame;
  readonly preflight: CompactTurnPreflight;
  readonly index: GameTreeIndex<TurnAction>;
  readonly publicStates: readonly TurnState[];
  readonly actions: readonly (readonly TurnAction[])[];
  readonly riverCards: readonly RiverCard[];
  readonly hands: readonly [readonly RiverCombo[], readonly RiverCombo[]];
  readonly nodeKinds: Uint8Array;
  readonly nodePlayers: Int8Array;
  readonly nodeRivers: Int8Array;
  readonly nodeEdgeStarts: Int32Array;
  readonly nodeEdgeCounts: Uint8Array;
  readonly postorder: Int32Array;
  readonly edgeChildren: Int32Array;
  readonly terminalScale: Float64Array;
  readonly terminalFoldSign: Int8Array;
  readonly dealProbabilities: Float64Array;
  readonly dealHand0: Uint16Array;
  readonly dealHand1: Uint16Array;
  /** -1/0/+1 = exact showdown sign; 2 = blocked river. */
  readonly dealRiverSigns: Int8Array;
  readonly lookup0: Int32Array;
  readonly lookup1: Int32Array;
  readonly informationSetPlayers: Int8Array;
  readonly actionStarts: Int32Array;
  readonly actionCounts: Uint8Array;
  readonly actionSlotCount: number;
  readonly typedStorageBytes: number;
}

function freezeState(state: TurnState): TurnState {
  return Object.freeze({ ...state, put: Object.freeze([...state.put]) as TurnState["put"],
    histories: Object.freeze(state.histories.map(history => Object.freeze([...history]))) as unknown as TurnState["histories"] });
}

/** Internal read-only numeric representation. No external compiled-array import API. */
export function compileCompactTurn(request: TurnRequest, memoryLimitBytes = COMPACT_TURN_MEMORY_LIMIT): CompiledCompactTurn {
  const source = createTurnGame(request);
  const preflight = estimate(source, memoryLimitBytes);
  const input = source.request;
  const riverCards = Object.freeze(RIVER_DECK.filter(card => !input.board.includes(card)));
  const states: TurnState[] = [];
  const actions: (readonly TurnAction[])[] = [];
  const kinds: number[] = [], players: number[] = [], rivers: number[] = [];
  const starts: number[] = [], counts: number[] = [], edges: number[] = [], postorder: number[] = [];
  const scales: number[] = [], folds: number[] = [];
  const allIn = (state: TurnState) => input.stackBehind.some((stack, player) => stack === state.put[player]);
  const root: TurnState = { ...source.initialState(), phase: input.stackBehind.includes(0) ? "river-card" : "play",
    actor: input.stackBehind.includes(0) ? null : 0 };
  const visit = (state: TurnState): number => {
    const id = states.length;
    if (id >= preflight.publicNodeUpperBound) throw new Error("Compact turn exceeded its public-node preflight");
    states.push(freezeState(state));
    rivers.push(state.river === null ? -1 : riverCards.indexOf(state.river));
    players.push(state.actor ?? -1);
    scales.push(input.committedPerPlayer + Math.min(...state.put));
    folds.push(state.folded === null ? 0 : state.folded === 0 ? -1 : 1);
    starts.push(edges.length);
    if (state.phase === "terminal") {
      kinds.push(TURN_TERMINAL); actions.push(Object.freeze([])); counts.push(0);
    } else if (state.phase === "river-card") {
      kinds.push(TURN_CHANCE); actions.push(Object.freeze([])); counts.push(riverCards.length);
      const start = edges.length;
      edges.push(...riverCards.map(() => -1));
      riverCards.forEach((card, i) => {
        // Public union, deliberately independent of any representative private hand.
        edges[start + i] = visit({ ...state, street: 1, river: card,
          phase: allIn(state) ? "terminal" : "play", actor: allIn(state) ? null : 0 });
      });
    } else {
      const node = source.node(state); // v1's player actions depend only on public state.
      if (node.kind !== "player") throw new Error("Compact turn expected a public player node");
      const menu = Object.freeze([...node.actions]);
      kinds.push(TURN_PLAYER); actions.push(menu); counts.push(menu.length);
      const start = edges.length;
      edges.push(...menu.map(() => -1));
      menu.forEach((action, i) => { edges[start + i] = visit(source.nextAction(state, action)); });
    }
    postorder.push(id);
    return id;
  };
  visit(root);
  const hands = ([0, 1] as const).map(player => {
    const unique = new Map(source.deals.map(deal => [riverComboKey(deal.outcome.hands[player]), deal.outcome.hands[player]]));
    return Object.freeze([...unique.values()]);
  }) as unknown as readonly [readonly RiverCombo[], readonly RiverCombo[]];
  const handIds = hands.map(range => new Map(range.map((hand, id) => [riverComboKey(hand), id])));
  const dealHand0 = Uint16Array.from(source.deals.map(deal => handIds[0].get(riverComboKey(deal.outcome.hands[0]))!));
  const dealHand1 = Uint16Array.from(source.deals.map(deal => handIds[1].get(riverComboKey(deal.outcome.hands[1]))!));
  const dealProbabilities = Float64Array.from(source.deals.map(deal => deal.probability));
  const dealRiverSigns = new Int8Array(source.deals.length * riverCards.length).fill(2);
  const rankCache = new Map<string, number>();
  const score = (hand: RiverCombo, river: RiverCard) => {
    const key = `${riverComboKey(hand)}/${river}`;
    if (!rankCache.has(key)) rankCache.set(key, riverHandScore(hand, [...input.board, river]));
    return rankCache.get(key)!;
  };
  source.deals.forEach((deal, d) => {
    const pair = deal.outcome.hands;
    let legal = 0;
    riverCards.forEach((river, r) => {
      if (pair.some(hand => hand.includes(river))) return;
      const a = score(pair[0], river), b = score(pair[1], river);
      dealRiverSigns[d * riverCards.length + r] = a === b ? 0 : a > b ? 1 : -1;
      legal++;
    });
    if (legal !== 44) throw new Error(`Compact turn has ${legal} rivers for private deal ${d}`);
  });
  const live = (d: number, n: number) => rivers[n] < 0 || dealRiverSigns[d * riverCards.length + rivers[n]] !== 2;
  const definitions = new Map<string, InformationSetDefinition<TurnAction> & { node: number; hand: number }>();
  let totalStates = 1, chanceNodes = 1, decisionNodes = 0, terminalNodes = 0;
  source.deals.forEach((deal, d) => {
    states.forEach((state, n) => {
      if (!live(d, n)) return;
      totalStates++;
      if (kinds[n] === TURN_TERMINAL) { terminalNodes++; return; }
      if (kinds[n] === TURN_CHANCE) { chanceNodes++; return; }
      decisionNodes++;
      const player = state.actor!;
      const hand = player === 0 ? dealHand0[d] : dealHand1[d];
      const coordinate = `${n}:${hand}`;
      const prior = definitions.get(coordinate);
      if (prior) definitions.set(coordinate, { ...prior, stateCount: prior.stateCount + 1 });
      else definitions.set(coordinate, { key: source.informationSet({ ...state, hands: deal.outcome.hands }, player),
        player, actions: actions[n], stateCount: 1, node: n, hand });
    });
  });
  for (const [key, count] of Object.entries({ totalStates, chanceNodes, decisionNodes, terminalNodes })) {
    if (count !== source.preflight[key as keyof typeof source.preflight]) throw new Error(`Compact turn ${key} count disagrees with preflight`);
  }
  const sorted = [...definitions.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (sorted.length > preflight.informationSetUpperBound) throw new Error("Compact turn exceeded its information-set estimate");
  const informationSets = Object.freeze(sorted.map(({ key, player, actions, stateCount }) => Object.freeze({ key, player, actions, stateCount })));
  const byKey = new Map(informationSets.map(entry => [entry.key, entry]));
  if (byKey.size !== informationSets.length) throw new Error("Compact turn duplicated an information-set key");
  const index: GameTreeIndex<TurnAction> = Object.freeze({ gameId: source.id, totalStates, chanceNodes, decisionNodes, terminalNodes,
    informationSets, informationSetByKey: byKey });
  const lookup0 = new Int32Array(states.length * hands[0].length).fill(-1);
  const lookup1 = new Int32Array(states.length * hands[1].length).fill(-1);
  const actionStarts = new Int32Array(sorted.length);
  let actionSlotCount = 0;
  sorted.forEach((entry, id) => {
    (entry.player === 0 ? lookup0 : lookup1)[entry.node * hands[entry.player].length + entry.hand] = id;
    actionStarts[id] = actionSlotCount;
    actionSlotCount += entry.actions.length;
  });
  const arrays = {
    nodeKinds: Uint8Array.from(kinds), nodePlayers: Int8Array.from(players), nodeRivers: Int8Array.from(rivers),
    nodeEdgeStarts: Int32Array.from(starts), nodeEdgeCounts: Uint8Array.from(counts), postorder: Int32Array.from(postorder),
    edgeChildren: Int32Array.from(edges), terminalScale: Float64Array.from(scales), terminalFoldSign: Int8Array.from(folds),
    dealProbabilities, dealHand0, dealHand1, dealRiverSigns, lookup0, lookup1,
    informationSetPlayers: Int8Array.from(sorted.map(entry => entry.player)), actionStarts,
    actionCounts: Uint8Array.from(sorted.map(entry => entry.actions.length)),
  };
  return Object.freeze({ version: COMPACT_TURN_VERSION, source, preflight, index,
    publicStates: Object.freeze(states), actions: Object.freeze(actions), riverCards, hands: Object.freeze(hands),
    ...arrays, actionSlotCount, typedStorageBytes: Object.values(arrays).reduce((sum, array) => sum + array.byteLength, 0) });
}

export function compactTurnNodeIsLive(game: CompiledCompactTurn, deal: number, node: number): boolean {
  const river = game.nodeRivers[node];
  return river < 0 || game.dealRiverSigns[deal * game.riverCards.length + river] !== 2;
}

export function compactTurnInformationSet(game: CompiledCompactTurn, deal: number, node: number): number {
  const player = game.nodePlayers[node];
  if (player !== 0 && player !== 1) throw new Error("Not a compact turn player node");
  const hand = player === 0 ? game.dealHand0[deal] : game.dealHand1[deal];
  const id = (player === 0 ? game.lookup0 : game.lookup1)[node * game.hands[player].length + hand];
  if (id < 0 || id === undefined) throw new Error("Missing compact turn information set");
  return id;
}

export function compactTurnUtility0(game: CompiledCompactTurn, deal: number, node: number): number {
  if (game.nodeKinds[node] !== TURN_TERMINAL || !compactTurnNodeIsLive(game, deal, node)) throw new Error("Not a legal compact turn terminal");
  const fold = game.terminalFoldSign[node];
  return game.terminalScale[node] * (fold || game.dealRiverSigns[deal * game.riverCards.length + game.nodeRivers[node]]);
}
