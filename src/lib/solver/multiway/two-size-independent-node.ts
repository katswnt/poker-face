// Node-only independent checks used while generating the two-size artifact.
import riverArtifactData from "../river/artifacts/river-v1.json" with { type: "json" };
import type { RiverSolveArtifact } from "../river/artifact";
import { verifyRiverArtifactHash } from "../river/artifact-node";
import noRaiseArtifactData from "./artifacts/three-player-river-v1.json" with { type: "json" };
import raisedArtifactData from "./artifacts/three-player-raised-river-v1.json" with { type: "json" };
import type { MultiwaySolveArtifact } from "./artifact";
import { verifyMultiwayArtifactHash } from "./artifact-node";
import {
  exhaustiveMultiwayBestResponse,
  informationSetMultiwayBestResponse,
} from "./best-response";
import {
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
} from "./game";
import type { RaisedRiverSolveArtifact } from "./raised-artifact";
import { verifyRaisedRiverArtifactHash } from "./raised-artifact-node";
import { TWO_SIZE_RIVER_V1_SCENARIO, twoSizeRiverV1Game } from "./two-size-fixture";
import {
  createTwoSizeRiverGame,
  type TwoSizeRiverScenario,
} from "./two-size-river-game";

export interface TwoSizeRiverIndependentAudit {
  readonly reducedBestResponse: {
    readonly game: string;
    readonly compatibleDeals: 1;
    readonly profile: "uniform";
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
  readonly priorArtifacts: {
    readonly noRaisePayloadHash: string;
    readonly noRaiseHashValid: boolean;
    readonly raisedPayloadHash: string;
    readonly raisedHashValid: boolean;
    readonly headsUpPayloadHash: string;
    readonly headsUpHashValid: boolean;
  };
}

let cachedAudit: TwoSizeRiverIndependentAudit | null = null;

function oneDealGame() {
  const scenario: TwoSizeRiverScenario = {
    ...TWO_SIZE_RIVER_V1_SCENARIO,
    id: "three-player-two-size-river-one-deal-audit",
    ranges: [
      [TWO_SIZE_RIVER_V1_SCENARIO.ranges[0][2]],
      [TWO_SIZE_RIVER_V1_SCENARIO.ranges[1][1]],
      [TWO_SIZE_RIVER_V1_SCENARIO.ranges[2][2]],
    ],
  };
  return createTwoSizeRiverGame(scenario);
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
    const values = node.actions.map(action => visit(game.nextAction(state, action)));
    if (node.player === player) return Math.max(...values);
    const entry = strategy.get(game.informationSet(state, node.player));
    if (!entry) throw new Error("Missing strategy in two-size hidden-information audit");
    return values.reduce(
      (sum, value, actionIndex) => sum + entry.probabilities[actionIndex] * value,
      0,
    );
  };
  return visit(game.initialState());
}

export function auditTwoSizeRiverIndependentChecks(): TwoSizeRiverIndependentAudit {
  if (cachedAudit) return cachedAudit;
  const reduced = oneDealGame();
  const reducedIndex = buildMultiwayGameTreeIndex(reduced);
  const reducedStrategy = uniformMultiwayStrategy(reducedIndex);
  let maximumValueDifference = 0;
  const pureStrategiesChecked: number[] = [];
  for (let player = 0; player < 3; player += 1) {
    const scalable = informationSetMultiwayBestResponse(
      reduced,
      reducedStrategy,
      player,
      reducedIndex,
    );
    const exhaustive = exhaustiveMultiwayBestResponse(
      reduced,
      reducedStrategy,
      player,
      reducedIndex,
    );
    maximumValueDifference = Math.max(
      maximumValueDifference,
      Math.abs(scalable.value - exhaustive.value),
    );
    pureStrategiesChecked.push(exhaustive.pureStrategiesChecked ?? 0);
  }

  const mainIndex = buildMultiwayGameTreeIndex(twoSizeRiverV1Game);
  const uniform = uniformMultiwayStrategy(mainIndex);
  const honest = informationSetMultiwayBestResponse(twoSizeRiverV1Game, uniform, 0, mainIndex).value;
  const cheating = cheatingResponseValue(twoSizeRiverV1Game, uniform, 0);

  const noRaiseArtifact = noRaiseArtifactData as unknown as MultiwaySolveArtifact;
  const raisedArtifact = raisedArtifactData as unknown as RaisedRiverSolveArtifact;
  const headsUpArtifact = riverArtifactData as unknown as RiverSolveArtifact;
  cachedAudit = {
    reducedBestResponse: {
      game: reduced.id,
      compatibleDeals: 1,
      profile: "uniform",
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
    priorArtifacts: {
      noRaisePayloadHash: noRaiseArtifact.payloadHash,
      noRaiseHashValid: verifyMultiwayArtifactHash(noRaiseArtifact),
      raisedPayloadHash: raisedArtifact.payloadHash,
      raisedHashValid: verifyRaisedRiverArtifactHash(raisedArtifact),
      headsUpPayloadHash: headsUpArtifact.payloadHash,
      headsUpHashValid: verifyRiverArtifactHash(headsUpArtifact),
    },
  };
  return cachedAudit;
}
