/**
 * Referee engines for the three locked bridge referee games (Node only: loads our saved
 * artifacts). Each adapter exposes one of our engines' public trees to `refereeWalk` and
 * grades the adapted bridge policy with the grader that engine's own acceptance uses:
 * - river v3 demo: factorized scorekeeper (`gradeFactorizedRiverStrategy`);
 * - turn v2 dry value: vector turn grader (`gradeVectorTurn`);
 * - tiny flop reference: vector flop grader (`gradeVectorFlop`), cross-checked by the
 *   generic exact best response (`gradeStrategy`) that certified the saved artifact.
 */
import riverV3Artifact from "../river/configurable-v3/artifacts/configurable-river-v3.json" with { type: "json" };
import turnDryValueArtifact from "../postflop/configurable-turn/artifacts/turn-v2-dry-value.json" with { type: "json" };
import flopReferenceArtifact from "../postflop/flop/artifacts/heads-up-flop-v1.json" with { type: "json" };
import type { RiverCard } from "../river/cards";
import type { ConfigurableRiverAction } from "../river/configurable/game";
import { configurableRiverV3DemoGame } from "../river/configurable-v3/fixture";
import type { ConfigurableRiverV3State } from "../river/configurable-v3/game";
import { compileFactorizedRiverGame } from "../river/factorized/game";
import { compileFactorizedRiverScorekeeper, gradeFactorizedRiverStrategy } from "../river/factorized/scorekeeper";
import { TURN_V2_CORPUS } from "../postflop/configurable-turn/fixtures";
import { compileTurnV2 } from "../postflop/configurable-turn/game";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, turnV2InformationKey,
  validateTurnV2Request, type TurnV2Action, type TurnV2Request, type TurnV2State } from "../postflop/configurable-turn/rules";
import { gradeVectorTurn } from "../postflop/vector/scorekeeper";
import { FLOP_PLAYER, compileVectorFlop } from "../postflop/flop/compiled";
import { FLOP_REFERENCE_REQUEST } from "../postflop/flop/fixtures";
import { encodeFlopPolicy } from "../postflop/flop/policy";
import { createFlopReference } from "../postflop/flop/reference";
import { flopActions, flopInformationKey, initialFlopState, nextFlopAction, nextFlopCard, type FlopAction,
  type FlopState } from "../postflop/flop/rules";
import { gradeVectorFlop } from "../postflop/flop/scorekeeper";
import { gradeStrategy } from "../toy/best-response";
import type { BehavioralStrategy } from "../toy/game";
import type { BridgeAction } from "./contract";
import { bridgeSpotFromTurnV2, type BridgeFixtureId } from "./fixtures";
import type { RefereeArtifactBounds, RefereeEngine, RefereeGrade, RefereeView } from "./referee";

/** "bet-to-50" / "raise-to-150" / "check" … → contract action. */
function contractAction(action: string): BridgeAction {
  if (action === "check" || action === "fold" || action === "call") return { type: action };
  const match = /^(bet|raise)-to-(\d+)$/.exec(action);
  if (!match) throw new Error(`Referee cannot map engine action ${action}`);
  return { type: match[1] as "bet" | "raise", to: Number(match[2]) };
}
const pair = (a: number, b: number) => [a, b] as const;
const gradeOf = (grade: { value: readonly number[]; gains: readonly number[]; exploitability: number }, grader: string): RefereeGrade =>
  ({ value: pair(grade.value[0], grade.value[1]), gains: pair(grade.gains[0], grade.gains[1]), exploitability: grade.exploitability, grader });

// --- River v3 demo ------------------------------------------------------------------------

export function riverV3RefereeEngine(): RefereeEngine<ConfigurableRiverV3State, ConfigurableRiverAction> {
  const game = configurableRiverV3DemoGame, scenario = game.scenario;
  const compiled = compileFactorizedRiverGame(game), scorekeeper = compileFactorizedRiverScorekeeper(compiled);
  const keys = compiled.index.informationSetByKey;
  const maxima = scenario.ranges.map(range => Math.max(...range.map(entry => entry.weight)));
  return {
    name: "configurable river v3 (factorized scorekeeper)",
    hands: [scenario.ranges[0].map(e => e.cards), scenario.ranges[1].map(e => e.cards)],
    weights: [scenario.ranges[0].map(e => e.weight / maxima[0]), scenario.ranges[1].map(e => e.weight / maxima[1])],
    root: () => game.nextChance(game.initialState(), game.deals[0].outcome),
    view(state): RefereeView<ConfigurableRiverAction> {
      const view = state.public, committed = pair(view.streetContributions[0], view.streetContributions[1]);
      if (view.terminal) return { kind: "terminal", outcome: view.terminal, folder: view.foldedPlayer, board: scenario.board, committed };
      return { kind: "player", player: view.actingPlayer!, street: "river", board: scenario.board, committed,
        actions: game.legalActions(view).map(native => ({ native, contract: contractAction(native) })) };
    },
    act: (state, action) => game.nextAction(state, action),
    deal: () => { throw new Error("River v3 has no public chance"); },
    informationSet(state, player, hand) {
      const own = scenario.ranges[player][hand].cards;
      const key = game.informationSet({ hands: [own, own], public: state.public }, player);
      return keys.has(key) ? key : null;
    },
    cardLeavesNoPair: () => { throw new Error("River v3 has no public chance"); },
    informationSetKeys: () => compiled.index.informationSets.map(info => info.key),
    grade: policy => gradeOf(gradeFactorizedRiverStrategy(scorekeeper, policy), "gradeFactorizedRiverStrategy"),
  };
}

// --- Turn v2 --------------------------------------------------------------------------------

export function turnV2RefereeEngine(request: TurnV2Request): RefereeEngine<TurnV2State, TurnV2Action> {
  const game = compileTurnV2(request), ranges = game.ranges;
  const keys = game.index.informationSetByKey;
  const allIn = (state: TurnV2State) => request.stackBehind.some(stack => stack === state.carried);
  const committed = (state: TurnV2State) => pair(state.carried + state.returned[0] + state.streetPaid[0],
    state.carried + state.returned[1] + state.streetPaid[1]);
  const board = (state: TurnV2State): readonly RiverCard[] => state.river ? [...request.board, state.river] : request.board;
  return {
    name: `configurable turn v2 '${request.id}' (vector turn grader)`,
    hands: [ranges.players[0].hands, ranges.players[1].hands],
    weights: [Array.from(ranges.players[0].weights), Array.from(ranges.players[1].weights)],
    root: () => initialTurnV2State(request),
    view(state): RefereeView<TurnV2Action> {
      if (state.phase === "terminal") {
        return { kind: "terminal", outcome: state.folded === null ? "showdown" : "fold", folder: state.folded, board: board(state), committed: committed(state) };
      }
      if (state.phase === "river-card") {
        // An all-in before the river: our engine deals the river then settles; postflop-solver
        // folds that runout into one showdown terminal. Both average the same 44 rivers.
        if (allIn(state)) return { kind: "terminal", outcome: "showdown", folder: null, board: board(state), committed: committed(state) };
        return { kind: "chance", street: "river", board: board(state), committed: committed(state), cards: ranges.rivers };
      }
      return { kind: "player", player: state.actor!, street: state.street === 0 ? "turn" : "river", board: board(state),
        committed: committed(state), actions: turnV2Actions(request, state).map(native => ({ native, contract: contractAction(native) })) };
    },
    act: (state, action) => nextTurnV2Action(request, state, action),
    deal: (state, card) => nextTurnV2River(request, state, card),
    informationSet(state, player, hand) {
      const key = turnV2InformationKey(request, state, player, ranges.players[player].hands[hand]);
      return keys.has(key) ? key : null;
    },
    cardLeavesNoPair(_state, card) {
      const river = ranges.rivers.indexOf(card), own = ranges.players[0];
      if (river < 0) throw new Error(`${card} is not a turn v2 river`);
      return own.compatibleCounts.subarray((river + 1) * own.hands.length, (river + 2) * own.hands.length).every(n => n === 0);
    },
    informationSetKeys: () => game.index.informationSets.map(info => info.key),
    grade: policy => gradeOf(gradeVectorTurn(game, policy), "gradeVectorTurn"),
  };
}

// --- Tiny flop reference --------------------------------------------------------------------

export function flopReferenceRefereeEngine(options: { crossCheck?: boolean } = {}): RefereeEngine<FlopState, FlopAction> {
  const request = FLOP_REFERENCE_REQUEST, game = compileVectorFlop(request), ranges = game.ranges;
  const boardView = (turn: RiverCard | null, river: RiverCard | null) => ranges.boards[ranges.byCards.get(`${turn ?? "-"}/${river ?? "-"}`)!].view;
  const allIn = (state: FlopState) => request.stackBehind.some((stack, p) => stack === state.put[p]);
  const board = (state: FlopState): readonly RiverCard[] =>
    [...request.board, ...(state.turn ? [state.turn] : []), ...(state.river ? [state.river] : [])];
  const committed = (state: FlopState) => pair(state.put[0], state.put[1]);
  const keys = (() => {
    const found: string[] = [];
    game.states.forEach((state, n) => {
      if (game.kinds[n] !== FLOP_PLAYER) return;
      const player = state.actor!, own = boardView(state.turn, state.river).players[player];
      own.hands.forEach((hand, h) => { if (own.compatibleCounts[h]) found.push(flopInformationKey(request, state, player, hand)); });
    });
    return found;
  })();
  if (keys.length !== game.informationSets) throw new Error("Flop referee information-set count mismatch");
  return {
    name: "tiny flop reference (vector flop grader)",
    hands: [ranges.players[0].hands, ranges.players[1].hands],
    weights: [Array.from(ranges.players[0].weights), Array.from(ranges.players[1].weights)],
    root: () => initialFlopState(request),
    view(state): RefereeView<FlopAction> {
      if (state.phase === "terminal") {
        return { kind: "terminal", outcome: state.folded === null ? "showdown" : "fold", folder: state.folded, board: board(state), committed: committed(state) };
      }
      if (state.phase === "card") {
        if (allIn(state)) return { kind: "terminal", outcome: "showdown", folder: null, board: board(state), committed: committed(state) };
        return { kind: "chance", street: state.street === 0 ? "turn" : "river", board: board(state), committed: committed(state),
          cards: ranges.deck.filter(card => card !== state.turn) };
      }
      const closed = Math.min(...state.put);
      return { kind: "player", player: state.actor!, street: (["flop", "turn", "river"] as const)[state.street], board: board(state),
        committed: committed(state), actions: flopActions(state).map(native => ({ native, contract: native === "bet"
          ? { type: "bet" as const, to: nextFlopAction(request, state, "bet").put[state.actor!] - closed } : { type: native } })) };
    },
    act: (state, action) => nextFlopAction(request, state, action),
    deal: (state, card) => nextFlopCard(request, state, card),
    informationSet(state, player, hand) {
      const own = boardView(state.turn, state.river).players[player];
      return own.compatibleCounts[hand] ? flopInformationKey(request, state, player, own.hands[hand]) : null;
    },
    cardLeavesNoPair(state, card) {
      const view = state.street === 0 ? boardView(card, null) : boardView(state.turn, card);
      const own = view.players[0];
      return own.compatibleCounts.subarray(0, own.hands.length).every(n => n === 0);
    },
    informationSetKeys: () => keys,
    grade(policy: BehavioralStrategy<FlopAction>) {
      const vector = gradeOf(gradeVectorFlop(game, encodeFlopPolicy(game, policy)), "gradeVectorFlop");
      if (!options.crossCheck) return vector;
      const exact = gradeStrategy(createFlopReference(request), policy);
      const difference = Math.max(...[0, 1].flatMap(p => [Math.abs(exact.value[p] - vector.value[p]), Math.abs(exact.gains[p] - vector.gains[p])]));
      if (!(difference <= 1e-9)) throw new Error(`Flop graders disagree on the bridge policy by ${difference}`);
      return { ...vector, grader: "gradeVectorFlop + gradeStrategy (agree ≤ 1e-9)" };
    },
  };
}

// --- Registry --------------------------------------------------------------------------------

interface SavedArtifact {
  readonly value: readonly number[];
  readonly gains: readonly number[];
  readonly acceptance: { readonly maximumExploitability: number; readonly passed: boolean };
  readonly payloadHash: string;
}
function bounds(artifact: SavedArtifact, source: string): RefereeArtifactBounds {
  if (!artifact.acceptance.passed) throw new Error(`${source} did not pass its own acceptance`);
  return { value0: artifact.value[0], gains: pair(artifact.gains[0], artifact.gains[1]),
    maximumExploitability: artifact.acceptance.maximumExploitability, source };
}

export interface RefereeGame {
  readonly id: BridgeFixtureId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engines differ in state/action types
  readonly engine: () => RefereeEngine<any, any>;
  readonly bounds: RefereeArtifactBounds;
  readonly artifactPayloadHash: string;
}

export const REFEREE_GAMES: readonly RefereeGame[] = Object.freeze([
  { id: "referee-river-v3-demo", engine: riverV3RefereeEngine,
    bounds: bounds(riverV3Artifact as SavedArtifact, "configurable-river-v3.json"), artifactPayloadHash: riverV3Artifact.payloadHash },
  { id: "referee-turn-v2-dry-value", engine: () => turnV2RefereeEngine(TURN_V2_CORPUS.find(r => r.id === "turn-v2-dry-value")!),
    bounds: bounds(turnDryValueArtifact as SavedArtifact, "turn-v2-dry-value.json"), artifactPayloadHash: turnDryValueArtifact.payloadHash },
  { id: "referee-flop-reference", engine: () => flopReferenceRefereeEngine({ crossCheck: true }),
    bounds: bounds(flopReferenceArtifact as SavedArtifact, "heads-up-flop-v1.json"), artifactPayloadHash: flopReferenceArtifact.payloadHash },
]);

/**
 * Not a locked referee: a turn v2 game symmetric under clubs ↔ diamonds (board and both
 * ranges), so postflop-solver stores only one of each Xc/Xd river pair and serves the other
 * through a suit swap (`representative: false`). None of the three locked games has such a
 * symmetry, so this probe is what proves the adapter maps swapped cards to the real hands.
 */
export const ISOMORPHISM_PROBE_REQUEST: TurnV2Request = validateTurnV2Request({
  id: "bridge-isomorphism-probe", version: 2, board: ["Ks", "8h", "4s", "2h"],
  rangeText: ["AcKd AdKc AcAd QcJd QdJc 9c9d", "KcQc KdQd AcQd AdQc JcJd TcTd"], committedPerPlayer: 50, stackBehind: [100, 100],
  streets: [{ openingTargets: [25, 50], raiseTargets: [100], raiseLimit: 1, includeAllIn: false },
    { openingTargets: [25, 50], raiseTargets: [100], raiseLimit: 1, includeAllIn: false }],
});
export const ISOMORPHISM_PROBE_MAXIMUM_EXPLOITABILITY = 0.25;
export function isomorphismProbeSpot() {
  return bridgeSpotFromTurnV2(ISOMORPHISM_PROBE_REQUEST, "probe-turn-v2-suit-isomorphism",
    "bridge isomorphism probe (handcrafted clubs/diamonds-symmetric ranges, not preflop advice)");
}

