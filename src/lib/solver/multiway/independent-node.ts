// Node-only independent checks used while generating the multiway artifact.
import riverArtifactData from "../river/artifacts/river-v1.json" with { type: "json" };
import { deserializeRiverStrategy, type RiverSolveArtifact } from "../river/artifact";
import { verifyRiverArtifactHash } from "../river/artifact-node";
import { riverV1Game } from "../river/fixture";
import { gradeStrategy } from "../toy/best-response";
import {
  evaluateMultiwayStrategy,
  exhaustiveMultiwayBestResponse,
  informationSetMultiwayBestResponse,
} from "./best-response";
import {
  adaptHeadsUpGame,
  adaptHeadsUpStrategy,
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
} from "./game";
import { MULTIWAY_RIVER_V1_SCENARIO, multiwayRiverV1Game } from "./fixture";
import { createMultiwayRiverGame, type MultiwayRiverScenario } from "./river-game";

export interface MultiwayIndependentAudit {
  readonly reducedBestResponse: {
    readonly game: string;
    readonly compatibleDeals: number;
    readonly maximumValueDifference: number;
    readonly pureStrategiesChecked: readonly number[];
  };
  readonly hiddenInformationBoundary: {
    readonly profile: "uniform";
    readonly player: 0;
    readonly honestBestResponseValue: number;
    readonly cheatingStatewiseValue: number;
    readonly cheatingAdvantage: number;
  };
  readonly headsUpAdapter: {
    readonly game: "river-holdem-v1";
    readonly committedPayloadHash: string;
    readonly pinnedReferenceCommit: string;
    readonly committedArtifactHashValid: boolean;
    readonly treeCountsMatch: boolean;
    readonly maximumValueDifference: number;
    readonly maximumBestResponseDifference: number;
  };
}

function reducedGame() {
  const scenario: MultiwayRiverScenario = {
    ...MULTIWAY_RIVER_V1_SCENARIO,
    id: "three-player-river-reduced-audit",
    ranges: [
      [MULTIWAY_RIVER_V1_SCENARIO.ranges[0][2], MULTIWAY_RIVER_V1_SCENARIO.ranges[0][4]],
      MULTIWAY_RIVER_V1_SCENARIO.ranges[1].slice(0, 2),
      [MULTIWAY_RIVER_V1_SCENARIO.ranges[2][1], MULTIWAY_RIVER_V1_SCENARIO.ranges[2][2]],
    ],
  };
  return createMultiwayRiverGame(scenario);
}

function cheatingResponseValue<State, Action extends string, ChanceOutcome>(
  game: MultiwayExtensiveFormGame<State, Action, ChanceOutcome>,
  strategy: MultiwayBehavioralStrategy<Action>,
  player: number,
): number {
  const visit = (state: State): number => {
    const node = game.node(state);
    if (node.kind === "terminal") return node.utility[player];
    if (node.kind === "chance") {
      return node.outcomes.reduce(
        (sum, edge) => sum + edge.probability * visit(game.nextChance(state, edge.outcome)),
        0,
      );
    }
    const actionValues = node.actions.map(action => visit(game.nextAction(state, action)));
    if (node.player === player) return Math.max(...actionValues);
    const entry = strategy.get(game.informationSet(state, node.player));
    if (!entry) throw new Error(`Missing strategy at a cheating-audit state`);
    return actionValues.reduce(
      (sum, value, actionIndex) => sum + entry.probabilities[actionIndex] * value,
      0,
    );
  };
  return visit(game.initialState());
}

export function auditMultiwayIndependentChecks(): MultiwayIndependentAudit {
  const reduced = reducedGame();
  const reducedIndex = buildMultiwayGameTreeIndex(reduced);
  const reducedStrategy = uniformMultiwayStrategy(reducedIndex);
  let maximumValueDifference = 0;
  const pureStrategiesChecked: number[] = [];
  for (let player = 0; player < 3; player += 1) {
    const scalable = informationSetMultiwayBestResponse(reduced, reducedStrategy, player, reducedIndex);
    const exhaustive = exhaustiveMultiwayBestResponse(reduced, reducedStrategy, player, reducedIndex);
    maximumValueDifference = Math.max(maximumValueDifference, Math.abs(scalable.value - exhaustive.value));
    pureStrategiesChecked.push(exhaustive.pureStrategiesChecked ?? 0);
  }

  const mainIndex = buildMultiwayGameTreeIndex(multiwayRiverV1Game);
  const uniform = uniformMultiwayStrategy(mainIndex);
  const honest = informationSetMultiwayBestResponse(multiwayRiverV1Game, uniform, 0, mainIndex).value;
  const cheating = cheatingResponseValue(multiwayRiverV1Game, uniform, 0);

  const artifact = riverArtifactData as unknown as RiverSolveArtifact;
  const headsUpStrategy = deserializeRiverStrategy(artifact.strategy);
  const headsUpGrade = gradeStrategy(riverV1Game, headsUpStrategy);
  const adaptedGame = adaptHeadsUpGame(riverV1Game);
  const adaptedStrategy = adaptHeadsUpStrategy(headsUpStrategy);
  const adaptedIndex = buildMultiwayGameTreeIndex(adaptedGame);
  const adaptedValue = evaluateMultiwayStrategy(adaptedGame, adaptedStrategy, adaptedIndex);
  const valueDifferences = adaptedValue.map((value, player) => Math.abs(value - headsUpGrade.value[player]));
  const responseDifferences = [0, 1].map(player => {
    const response = informationSetMultiwayBestResponse(adaptedGame, adaptedStrategy, player, adaptedIndex);
    return Math.abs(response.value - headsUpGrade.bestResponses[player].value);
  });

  return {
    reducedBestResponse: {
      game: reduced.id,
      compatibleDeals: reduced.deals.length,
      maximumValueDifference,
      pureStrategiesChecked,
    },
    hiddenInformationBoundary: {
      profile: "uniform",
      player: 0,
      honestBestResponseValue: honest,
      cheatingStatewiseValue: cheating,
      cheatingAdvantage: cheating - honest,
    },
    headsUpAdapter: {
      game: "river-holdem-v1",
      committedPayloadHash: artifact.payloadHash,
      pinnedReferenceCommit: artifact.reference.commit,
      committedArtifactHashValid: verifyRiverArtifactHash(artifact),
      treeCountsMatch:
        adaptedIndex.totalStates === artifact.tree.totalStates &&
        adaptedIndex.informationSets.length === artifact.tree.informationSets,
      maximumValueDifference: Math.max(...valueDifferences),
      maximumBestResponseDifference: Math.max(...responseDifferences),
    },
  };
}
