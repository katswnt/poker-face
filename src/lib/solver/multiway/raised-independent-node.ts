// Node-only independent checks used while generating the raised multiway artifact.
import riverArtifactData from "../river/artifacts/river-v1.json" with { type: "json" };
import type { RiverSolveArtifact } from "../river/artifact";
import { verifyRiverArtifactHash } from "../river/artifact-node";
import stageOneArtifactData from "./artifacts/three-player-river-v1.json" with { type: "json" };
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
import { RAISED_RIVER_V1_SCENARIO, raisedRiverV1Game } from "./raised-fixture";
import {
  createRaisedRiverGame,
  type RaisedRiverAction,
  type RaisedRiverScenario,
} from "./raised-river-game";

export interface RaisedRiverIndependentAudit {
  readonly reducedBestResponse: {
    readonly game: string;
    readonly compatibleDeals: 1;
    readonly profilesChecked: 3;
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
    readonly stageOnePayloadHash: string;
    readonly stageOneHashValid: boolean;
    readonly headsUpPayloadHash: string;
    readonly headsUpHashValid: boolean;
  };
}

let cachedAudit: RaisedRiverIndependentAudit | null = null;

function oneDealGame() {
  const scenario: RaisedRiverScenario = {
    ...RAISED_RIVER_V1_SCENARIO,
    id: "three-player-raised-river-one-deal-audit",
    ranges: [
      [RAISED_RIVER_V1_SCENARIO.ranges[0][2]],
      [RAISED_RIVER_V1_SCENARIO.ranges[1][1]],
      [RAISED_RIVER_V1_SCENARIO.ranges[2][2]],
    ],
  };
  return createRaisedRiverGame(scenario);
}

function hash(value: string): number {
  return [...value].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
}

function comparisonProfiles(
  uniform: MultiwayBehavioralStrategy<RaisedRiverAction>,
): readonly MultiwayBehavioralStrategy<RaisedRiverAction>[] {
  const generated = [17, 313].map(seed => new Map([...uniform].map(([key, entry]) => {
    const weights = entry.actions.map((_, actionIndex) =>
      ((hash(key) + seed * (actionIndex + 1) * 137) % 900) + 50);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return [key, {
      actions: [...entry.actions],
      probabilities: weights.map(weight => weight / total),
    }] as const;
  })));
  return [uniform, ...generated];
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
    if (!entry) throw new Error("Missing strategy in raised hidden-information audit");
    return actionValues.reduce(
      (sum, value, actionIndex) => sum + entry.probabilities[actionIndex] * value,
      0,
    );
  };
  return visit(game.initialState());
}

export function auditRaisedRiverIndependentChecks(): RaisedRiverIndependentAudit {
  if (cachedAudit) return cachedAudit;
  const reduced = oneDealGame();
  const reducedIndex = buildMultiwayGameTreeIndex(reduced);
  const uniform = uniformMultiwayStrategy(reducedIndex);
  let maximumValueDifference = 0;
  const pureStrategiesChecked = [0, 0, 0];
  for (const profile of comparisonProfiles(uniform)) {
    for (let player = 0; player < 3; player += 1) {
      const scalable = informationSetMultiwayBestResponse(reduced, profile, player, reducedIndex);
      const exhaustive = exhaustiveMultiwayBestResponse(reduced, profile, player, reducedIndex);
      maximumValueDifference = Math.max(
        maximumValueDifference,
        Math.abs(scalable.value - exhaustive.value),
      );
      pureStrategiesChecked[player] = exhaustive.pureStrategiesChecked ?? 0;
    }
  }

  const mainIndex = buildMultiwayGameTreeIndex(raisedRiverV1Game);
  const mainUniform = uniformMultiwayStrategy(mainIndex);
  const honest = informationSetMultiwayBestResponse(
    raisedRiverV1Game,
    mainUniform,
    0,
    mainIndex,
  ).value;
  const cheating = cheatingResponseValue(raisedRiverV1Game, mainUniform, 0);

  const stageOneArtifact = stageOneArtifactData as unknown as MultiwaySolveArtifact;
  const headsUpArtifact = riverArtifactData as unknown as RiverSolveArtifact;
  cachedAudit = {
    reducedBestResponse: {
      game: reduced.id,
      compatibleDeals: 1,
      profilesChecked: 3,
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
      stageOnePayloadHash: stageOneArtifact.payloadHash,
      stageOneHashValid: verifyMultiwayArtifactHash(stageOneArtifact),
      headsUpPayloadHash: headsUpArtifact.payloadHash,
      headsUpHashValid: verifyRiverArtifactHash(headsUpArtifact),
    },
  };
  return cachedAudit;
}
