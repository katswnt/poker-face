/**
 * Locked bridge spots (contract v1).
 *
 * Three referee games are derived by walking our own engines' public betting rules, so the
 * explicit tree handed to postflop-solver is exactly the game our referees solve. The hashes
 * below were committed before any bridge solve; a rule change in either engine changes the
 * derived spot and fails test/bridge-contract.test.ts.
 *
 * The benchmark spot is a Griffin-scale 100bb single-raised pot with hand-written
 * approximate ranges (not solved preflop play).
 */
import { RIVER_DECK, RIVER_RANKS, type RiverCard } from "../river/cards";
import { parseConfigurableRiverRange } from "../river/configurable/range";
import { configurableRiverV3DemoGame } from "../river/configurable-v3/fixture";
import type { ConfigurableRiverAction } from "../river/configurable/game";
import { TURN_V2_CORPUS } from "../postflop/configurable-turn/fixtures";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, type TurnV2Action, type TurnV2Request, type TurnV2State } from "../postflop/configurable-turn/rules";
import { FLOP_REFERENCE_REQUEST } from "../postflop/flop/fixtures";
import { flopActions, initialFlopState, nextFlopAction, nextFlopCard, type FlopAction, type FlopState } from "../postflop/flop/rules";
import {
  BRIDGE_SPOT_FORMAT, buildExplicitTree, canonicalBridgeCombo, compareBridgeCombos, validateBridgeSpot,
  type BridgeAction, type BridgeBetSize, type BridgeBoard, type BridgeMenuTree, type BridgeRange, type BridgeSolveOptions,
  type BridgeSpotV1, type BridgeStreetMenu,
} from "./contract";

const GIB = 1024 ** 3;

/** Referee solves: tight target, full export (every real turn/river card). */
export const BRIDGE_REFEREE_SOLVE: BridgeSolveOptions = Object.freeze({
  targetExploitabilityPctPot: 0.01, maxIterations: 20_000, memoryCapBytes: GIB, timeoutMs: 300_000,
  compression: "off", exportScope: "full",
});

/** Normalize to the player's largest weight (probabilities unchanged; postflop-solver needs ≤ 1). */
function rangeFromEntries(entries: readonly { cards: readonly [RiverCard, RiverCard]; weight: number }[], source: string): BridgeRange {
  const maximum = Math.max(...entries.map(entry => entry.weight));
  const combos = entries.map(entry => {
    const weight = entry.weight / maximum;
    if (Math.fround(weight) !== weight) throw new Error(`Weight ${weight} is not float32-exact`);
    return { combo: canonicalBridgeCombo(entry.cards[0], entry.cards[1]), weight };
  }).sort((a, b) => compareBridgeCombos(a.combo, b.combo));
  return { source, combos };
}

function rangeFromText(text: string, board: readonly RiverCard[], source: string): BridgeRange {
  return rangeFromEntries(parseConfigurableRiverRange(text, board).entries, source);
}

const sized = (type: "bet" | "raise", to: number): BridgeAction => ({ type, to });

function engineAction(action: BridgeAction): string {
  return action.type === "bet" || action.type === "raise" ? `${action.type}-to-${action.to}` : action.type;
}

function fromEngineAction(action: string): BridgeAction {
  if (action === "check" || action === "fold" || action === "call") return { type: action };
  const match = /^(bet|raise)-to-(\d+)$/.exec(action);
  if (!match) throw new Error(`Unexpected engine action ${action}`);
  return sized(match[1] as "bet" | "raise", Number(match[2]));
}

// --- Referee 1: configurable river v3 demo game ----------------------------------------

function riverV3Spot(): BridgeSpotV1 {
  const game = configurableRiverV3DemoGame, scenario = game.scenario;
  if (scenario.committed[0] !== scenario.committed[1] || scenario.stackBehind[0] !== scenario.stackBehind[1]) {
    throw new Error("Bridge referee games need equal stacks");
  }
  const board: BridgeBoard = { flop: [scenario.board[0], scenario.board[1], scenario.board[2]], turn: scenario.board[3], river: scenario.board[4] };
  const deal = game.deals[0].outcome;
  const tree = buildExplicitTree(board, scenario.stackBehind[0], history => {
    let state = game.nextChance(game.initialState(), deal);
    for (const action of history) state = game.nextAction(state, engineAction(action) as ConfigurableRiverAction);
    return game.legalActions(state.public).map(fromEngineAction);
  });
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: "referee-river-v3-demo", board,
    ranges: [
      rangeFromEntries(scenario.ranges[0], "configurable river v3 demo fixture (handcrafted teaching range, not preflop advice)"),
      rangeFromEntries(scenario.ranges[1], "configurable river v3 demo fixture (handcrafted teaching range, not preflop advice)"),
    ],
    startingPot: scenario.committed[0] * 2, effectiveStack: scenario.stackBehind[0], rake: 0, tree, solve: BRIDGE_REFEREE_SOLVE,
  };
}

// --- Referee 2: configurable turn v2 "dry value" game ----------------------------------

function turnV2Spot(): BridgeSpotV1 {
  const request = TURN_V2_CORPUS.find(r => r.id === "turn-v2-dry-value");
  if (!request) throw new Error("Turn referee request missing");
  return bridgeSpotFromTurnV2(request, "referee-turn-v2-dry-value",
    "configurable turn v2 corpus 'turn-v2-dry-value' (handcrafted, not preflop advice)");
}

/** Any equal-stack turn v2 request as a bridge spot whose explicit tree is the v2 engine's public tree. */
export function bridgeSpotFromTurnV2(request: TurnV2Request, id: string, source: string,
  solve: BridgeSolveOptions = BRIDGE_REFEREE_SOLVE): BridgeSpotV1 {
  if (request.stackBehind[0] !== request.stackBehind[1]) throw new Error("Bridge turn spots need equal stacks");
  const river = RIVER_DECK.find(c => !request.board.includes(c))!; // Betting never depends on the river card.
  const board: BridgeBoard = { flop: [request.board[0], request.board[1], request.board[2]], turn: request.board[3], river: null };
  const tree = buildExplicitTree(board, request.stackBehind[0], history => {
    let state: TurnV2State = initialTurnV2State(request);
    const settle = () => { if (state.phase === "river-card") state = nextTurnV2River(request, state, river); };
    for (const action of history) { settle(); state = nextTurnV2Action(request, state, engineAction(action) as TurnV2Action); }
    settle();
    return turnV2Actions(request, state).map(fromEngineAction);
  });
  return validateBridgeSpot({
    format: BRIDGE_SPOT_FORMAT, version: 1, id, board,
    ranges: [rangeFromText(request.rangeText[0], request.board, source), rangeFromText(request.rangeText[1], request.board, source)],
    startingPot: request.committedPerPlayer * 2, effectiveStack: request.stackBehind[0], rake: 0, tree, solve,
  });
}

// --- Referee 3: tiny joint flop reference ----------------------------------------------

function flopReferenceSpot(): BridgeSpotV1 {
  const request = FLOP_REFERENCE_REQUEST;
  if (request.stackBehind[0] !== request.stackBehind[1]) throw new Error("Flop referee needs equal stacks");
  const board: BridgeBoard = { flop: [...request.board] as unknown as BridgeBoard["flop"], turn: null, river: null };
  const spare = RIVER_DECK.filter(c => !request.board.includes(c));
  const tree = buildExplicitTree(board, request.stackBehind[0], (history, view) => {
    let state: FlopState = initialFlopState(request), dealt = 0;
    const settle = () => { while (state.phase === "card") state = nextFlopCard(request, state, spare[dealt++]); };
    for (const action of history) {
      settle();
      state = nextFlopAction(request, state, (action.type === "bet" ? "bet" : action.type) as FlopAction);
    }
    settle();
    return flopActions(state).map((action): BridgeAction => {
      if (action !== "bet") return { type: action };
      const next = nextFlopAction(request, state, "bet");
      return sized("bet", next.put[state.actor!] - view.closed);
    });
  });
  const source = "tiny joint flop reference fixture (handcrafted, not preflop advice)";
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: "referee-flop-reference", board,
    ranges: [rangeFromText(request.rangeText[0], request.board, source), rangeFromText(request.rangeText[1], request.board, source)],
    startingPot: request.committedPerPlayer * 2, effectiveStack: request.stackBehind[0], rake: 0, tree, solve: BRIDGE_REFEREE_SOLVE,
  };
}

// --- Benchmark: 100bb BTN vs BB single-raised pot flop ---------------------------------

/** 1 big blind = 100 chips, so percentage sizes round to 0.01bb. */
export const BENCHMARK_CHIPS_PER_BB = 100;
const BENCHMARK_BOARD: BridgeBoard = { flop: ["Ks", "7h", "2d"], turn: null, river: null };
export const BENCHMARK_RANGE_SOURCE =
  "hand-written approximations, not solved: rough 100bb BTN 2.5bb open / BB flat-call ranges for benchmarking only";

const rankIndex = (rank: string) => RIVER_RANKS.indexOf(rank as (typeof RIVER_RANKS)[number]);
/** "A", "2", "9", "s" → A2s A3s … A9s (second rank inclusive range). */
function run(high: string, fromLow: string, toLow: string, suffix: "s" | "o", weight = 1): string[] {
  const tokens: string[] = [];
  for (let low = rankIndex(fromLow); low <= rankIndex(toLow); low += 1) tokens.push(`${high}${RIVER_RANKS[low]}${suffix}:${weight}`);
  return tokens;
}
function pairs(from: string, to: string, weight = 1): string[] {
  const tokens: string[] = [];
  for (let rank = rankIndex(from); rank <= rankIndex(to); rank += 1) tokens.push(`${RIVER_RANKS[rank]}${RIVER_RANKS[rank]}:${weight}`);
  return tokens;
}

/** ~45% BTN open. */
const BTN_OPEN = [
  ...pairs("2", "A"),
  ...run("A", "2", "K", "s"), ...run("K", "2", "Q", "s"), ...run("Q", "4", "J", "s"), ...run("J", "6", "T", "s"),
  ...run("T", "6", "9", "s"), ...run("9", "6", "8", "s"), ...run("8", "5", "7", "s"), ...run("7", "5", "6", "s"),
  ...run("6", "4", "5", "s"), "54s:1",
  ...run("A", "2", "K", "o"), ...run("K", "8", "Q", "o"), ...run("Q", "9", "J", "o"), ...run("J", "9", "T", "o"), "T9o:1",
];
/** BB flat vs a 2.5bb BTN open; the strongest hands are mostly 3-bet (partial weights). */
const BB_CALL = [
  ...pairs("2", "9"), "TT:0.75", "JJ:0.5", "QQ:0.25",
  ...run("A", "2", "9", "s"), "ATs:0.75", "AJs:0.75", "AQs:0.5",
  ...run("K", "2", "J", "s"), "KQs:0.75", ...run("Q", "2", "J", "s"), ...run("J", "4", "T", "s"), ...run("T", "6", "9", "s"),
  ...run("9", "5", "8", "s"), ...run("8", "5", "7", "s"), ...run("7", "4", "6", "s"), ...run("6", "3", "5", "s"),
  ...run("5", "3", "4", "s"), "43s:1",
  ...run("A", "2", "J", "o"), "AQo:0.75", "AKo:0.25", ...run("K", "7", "Q", "o"), ...run("Q", "8", "J", "o"),
  ...run("J", "8", "T", "o"), ...run("T", "8", "9", "o"), "98o:1", "87o:1", "76o:1", "65o:0.5",
];

const pot = (pct: number): BridgeBetSize => ({ kind: "pot", pct });
const benchmarkStreet = (raise: readonly BridgeBetSize[]): BridgeStreetMenu => {
  const menu = { bet: [pot(33), pot(75), pot(125), { kind: "allin" } as const], raise };
  return { oop: menu, ip: menu };
};
/**
 * Rich variant (the B0/B1 draft benchmark, kept as an experiment, not the pass/fail spot):
 * bets 33/75/125% + all-in on every street; one raise per street (maxRaisesPerStreet 1):
 * 3x or all-in on the flop, all-in on the turn and river. A 3x raise on later streets too
 * estimates 57.0 GB float32 / 28.9 GB int16, beyond a 32 GB laptop; this menu estimates
 * ~17 GB int16 (see tasks/postflop-solver-bridge-spec.md for the sizing table).
 */
const RICH_FLOP = benchmarkStreet([{ kind: "prevBet", multiple: 3 }, { kind: "allin" }]);
const RICH_LATER = benchmarkStreet([{ kind: "allin" }]);

const BENCHMARK_RANGES = (): readonly [BridgeRange, BridgeRange] => [
  // Player 0 (out of position) is the big blind; player 1 is the button.
  rangeFromText(BB_CALL.join(" "), BENCHMARK_BOARD.flop, `BB (OOP): ${BENCHMARK_RANGE_SOURCE}`),
  rangeFromText(BTN_OPEN.join(" "), BENCHMARK_BOARD.flop, `BTN (IP): ${BENCHMARK_RANGE_SOURCE}`),
];
// SRP: BTN opens 2.5bb, SB folds, BB calls → 2.5 + 2.5 + 0.5 = 5.5bb; 100 − 2.5 = 97.5bb behind.
export const SRP_STARTING_POT = 5.5 * BENCHMARK_CHIPS_PER_BB;
export const SRP_EFFECTIVE_STACK = 97.5 * BENCHMARK_CHIPS_PER_BB;

function richBenchmarkSpot(): BridgeSpotV1 {
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: "benchmark-srp-btn-bb-100bb-ks7h2d", board: BENCHMARK_BOARD,
    ranges: BENCHMARK_RANGES(), startingPot: SRP_STARTING_POT, effectiveStack: SRP_EFFECTIVE_STACK, rake: 0,
    tree: {
      mode: "menu", flop: RICH_FLOP, turn: RICH_LATER, river: RICH_LATER, turnDonk: null, riverDonk: null,
      addAllInThreshold: 1.5, forceAllInThreshold: 0.15, mergingThreshold: 0.1, maxRaisesPerStreet: 1,
    },
    solve: { targetExploitabilityPctPot: 0.3, maxIterations: 2000, memoryCapBytes: 24 * GIB, timeoutMs: 3_600_000,
      compression: "auto", exportScope: "first-street" },
  };
}

/**
 * Griffin's own lean "Fold" tree for BTN vs BB SRP 100bb (locked B3 benchmark and B4 library
 * tree): OOP (BB) bets flop 33% and 66%, turn 66%, river 50% and 100%; IP (BTN) bets 66% on
 * every street; every raise is call + 60% of the pot after the call, i.e. raise-to =
 * bet + 0.6 × (pot + 2·bet), which is postflop-solver's pot-relative raise exactly; at most
 * one raise per street; a size becomes all-in when the stack left after it would be
 * ≤ 0.2 × the pot after the call (postflop-solver forceAllInThreshold 0.2: the same rule, with
 * the threshold rounded to whole chips). No extra all-in size, no merging. No separate donk
 * menu: OOP's turn/river leads use OOP's bet menu, as in Fold.
 */
export const LEAN_SRP_TREE: BridgeMenuTree = Object.freeze({
  mode: "menu",
  flop: { oop: { bet: [pot(33), pot(66)], raise: [pot(60)] }, ip: { bet: [pot(66)], raise: [pot(60)] } },
  turn: { oop: { bet: [pot(66)], raise: [pot(60)] }, ip: { bet: [pot(66)], raise: [pot(60)] } },
  river: { oop: { bet: [pot(50), pot(100)], raise: [pot(60)] }, ip: { bet: [pot(66)], raise: [pot(60)] } },
  turnDonk: null, riverDonk: null, addAllInThreshold: 0, forceAllInThreshold: 0.2, mergingThreshold: 0, maxRaisesPerStreet: 1,
});

/** Lean-tree solve settings: 0.3%-pot bar, float32 when it fits the cap. */
export const LEAN_SRP_SOLVE: BridgeSolveOptions = Object.freeze({
  targetExploitabilityPctPot: 0.3, maxIterations: 3000, memoryCapBytes: 24 * GIB, timeoutMs: 3 * 3_600_000,
  compression: "auto", exportScope: "first-street",
});

/** Any flop with the benchmark's formation, ranges and lean tree (the B4 library uses this). */
export function leanSrpSpot(id: string, flop: BridgeBoard["flop"], solve: BridgeSolveOptions = LEAN_SRP_SOLVE): BridgeSpotV1 {
  const board: BridgeBoard = { flop, turn: null, river: null };
  return validateBridgeSpot({
    format: BRIDGE_SPOT_FORMAT, version: 1, id, board,
    ranges: [rangeFromText(BB_CALL.join(" "), flop, `BB (OOP): ${BENCHMARK_RANGE_SOURCE}`),
      rangeFromText(BTN_OPEN.join(" "), flop, `BTN (IP): ${BENCHMARK_RANGE_SOURCE}`)],
    startingPot: SRP_STARTING_POT, effectiveStack: SRP_EFFECTIVE_STACK, rake: 0, tree: LEAN_SRP_TREE, solve,
  });
}

function benchmarkSpot(): BridgeSpotV1 {
  return leanSrpSpot("benchmark-lean-srp-btn-bb-100bb-ks7h2d", BENCHMARK_BOARD.flop);
}

// --- Smoke: upstream examples/basic.rs expressed in the contract -----------------------

const UPSTREAM_BASIC_OOP = "66+,A8s+,A5s-A4s,AJo+,K9s+,KQo,QTs+,JTs,96s+,85s+,75s+,65s,54s";
const UPSTREAM_BASIC_IP = "QQ-22,AQs-A2s,ATo+,K5s+,KJo+,Q8s+,J8s+,T7s+,96s+,86s+,75s+,64s+,53s+";
/** Upstream range strings expanded by hand into our single-class syntax (identical combos). */
const BASIC_OOP_TOKENS = [
  ...pairs("6", "A"), ...run("A", "8", "K", "s"), "A5s", "A4s", ...run("A", "J", "K", "o"), ...run("K", "9", "Q", "s"), "KQo",
  ...run("Q", "T", "J", "s"), "JTs", ...run("9", "6", "8", "s"), ...run("8", "5", "7", "s"), ...run("7", "5", "6", "s"), "65s", "54s",
];
const BASIC_IP_TOKENS = [
  ...pairs("2", "Q"), ...run("A", "2", "Q", "s"), ...run("A", "T", "K", "o"), ...run("K", "5", "Q", "s"), ...run("K", "J", "Q", "o"),
  ...run("Q", "8", "J", "s"), ...run("J", "8", "T", "s"), ...run("T", "7", "9", "s"), ...run("9", "6", "8", "s"), ...run("8", "6", "7", "s"),
  ...run("7", "5", "6", "s"), ...run("6", "4", "5", "s"), ...run("5", "3", "4", "s"),
];

/**
 * Same cards, pot, stack and bet menu as upstream examples/basic.rs ("60%, e, a" / "2.5x",
 * river donk 50%, thresholds 1.5/0.15/0.1), 1000-iteration cap, 0.5%-pot target.
 */
function upstreamBasicSpot(): BridgeSpotV1 {
  const board: BridgeBoard = { flop: ["Td", "9d", "6h"], turn: "Qc", river: null };
  const cards = ["Td", "9d", "6h", "Qc"] as const;
  const menu = { bet: [pot(60), { kind: "geometric", streets: 0, maxPct: null }, { kind: "allin" }] as BridgeBetSize[],
    raise: [{ kind: "prevBet", multiple: 2.5 }] as BridgeBetSize[] };
  const source = "postflop-solver examples/basic.rs ranges (upstream demo input)";
  return {
    format: BRIDGE_SPOT_FORMAT, version: 1, id: "smoke-upstream-basic", board,
    ranges: [rangeFromText(BASIC_OOP_TOKENS.join(" "), cards, source), rangeFromText(BASIC_IP_TOKENS.join(" "), cards, source)],
    startingPot: 200, effectiveStack: 900, rake: 0,
    tree: { mode: "menu", flop: null, turn: { oop: menu, ip: menu }, river: { oop: menu, ip: menu }, turnDonk: null,
      riverDonk: [pot(50)], addAllInThreshold: 1.5, forceAllInThreshold: 0.15, mergingThreshold: 0.1, maxRaisesPerStreet: null },
    solve: { targetExploitabilityPctPot: 0.5, maxIterations: 1000, memoryCapBytes: 8 * GIB, timeoutMs: 600_000,
      compression: "off", exportScope: "first-street" },
  };
}
export const UPSTREAM_BASIC_RANGE_STRINGS = Object.freeze([UPSTREAM_BASIC_OOP, UPSTREAM_BASIC_IP]);

export type BridgeFixtureId = "referee-river-v3-demo" | "referee-turn-v2-dry-value" | "referee-flop-reference"
  | "benchmark-lean-srp-btn-bb-100bb-ks7h2d" | "benchmark-srp-btn-bb-100bb-ks7h2d" | "smoke-upstream-basic";

const BUILDERS: Readonly<Record<BridgeFixtureId, () => BridgeSpotV1>> = {
  "referee-river-v3-demo": riverV3Spot,
  "referee-turn-v2-dry-value": turnV2Spot,
  "referee-flop-reference": flopReferenceSpot,
  "benchmark-lean-srp-btn-bb-100bb-ks7h2d": benchmarkSpot,
  "benchmark-srp-btn-bb-100bb-ks7h2d": richBenchmarkSpot,
  "smoke-upstream-basic": upstreamBasicSpot,
};

export const BRIDGE_REFEREE_IDS: readonly BridgeFixtureId[] = ["referee-river-v3-demo", "referee-turn-v2-dry-value", "referee-flop-reference"];
/** Locked pass/fail benchmark (lean Fold tree, re-locked for B3). */
export const BRIDGE_BENCHMARK_ID: BridgeFixtureId = "benchmark-lean-srp-btn-bb-100bb-ks7h2d";
/** B0/B1 draft benchmark: a documented "rich" experiment, not a gate. */
export const BRIDGE_RICH_BENCHMARK_ID: BridgeFixtureId = "benchmark-srp-btn-bb-100bb-ks7h2d";

/**
 * sha256(canonical spot JSON), locked 2026-09-25. The referee hashes were fixed before any
 * bridge result was inspected; the rich benchmark menu was trimmed once to fit a 32 GB
 * machine after the memory preflight refused the first draft (see the spec). B3 re-locked the
 * pass/fail benchmark to the lean Fold tree (decided before its first solve); the rich spot
 * keeps its original hash as a documented experiment.
 */
export const BRIDGE_FIXTURE_HASHES: Readonly<Record<BridgeFixtureId, string>> = Object.freeze({
  "referee-river-v3-demo": "f56f2ddd8b95510211ab3d5e90342e374aac85641e9e5623d956586ba4bf829d",
  "referee-turn-v2-dry-value": "f3fe979856453af9e85466ea542ebd93039240620ee176878edf78ead6c3929a",
  "referee-flop-reference": "e232578f4d7ce705a7b63c6c3a285b90d38886e35fe3a294c133354f26acc8d2",
  "benchmark-lean-srp-btn-bb-100bb-ks7h2d": "b9e032fcbe228fbe306e9c515562b524cc5a1a48cc9c75f082bad2a8cf24a101",
  "benchmark-srp-btn-bb-100bb-ks7h2d": "cbe72c1982aa2abdc6f41094116025221f57545c73379afcf1267278cce62329",
  "smoke-upstream-basic": "6f22b70ff45761e4b00cb9ec3226dae94295f5ff7aa759d21812229cec42d025",
});

export function bridgeFixtureIds(): readonly BridgeFixtureId[] {
  return Object.keys(BUILDERS) as BridgeFixtureId[];
}

export function buildBridgeFixture(id: BridgeFixtureId): BridgeSpotV1 {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`Unknown bridge fixture ${id}`);
  return validateBridgeSpot(builder());
}
