// Node-only checks that fail differently from the four-player solver and fast evaluator.
import riverArtifactData from "../river/artifacts/river-v1.json" with { type: "json" };
import {
  deserializeRiverStrategy,
  type RiverSolveArtifact,
} from "../river/artifact";
import { verifyRiverArtifactHash } from "../river/artifact-node";
import { riverCardObject, riverComboKey, type RiverCombo } from "../river/cards";
import { riverV1Game } from "../river/fixture";
import { gradeStrategy } from "../toy/best-response";
import noRaiseArtifactData from "./artifacts/three-player-river-v1.json" with { type: "json" };
import raisedArtifactData from "./artifacts/three-player-raised-river-v1.json" with { type: "json" };
import sidePotArtifactData from "./artifacts/three-player-side-pot-river-v1.json" with { type: "json" };
import twoSizeArtifactData from "./artifacts/three-player-two-size-river-v1.json" with { type: "json" };
import type { MultiwaySolveArtifact } from "./artifact";
import { verifyMultiwayArtifactHash } from "./artifact-node";
import {
  evaluateMultiwayStrategy,
  exhaustiveMultiwayBestResponse,
  informationSetMultiwayBestResponse,
} from "./best-response";
import {
  FOUR_PLAYER_RIVER_V1_SCENARIO,
  fourPlayerRiverV1Game,
} from "./four-player-fixture";
import {
  createFourPlayerRiverGame,
  fourPlayerRiverState,
  type FourPlayerRiverScenario,
  type FourPlayers,
} from "./four-player-river-game";
import { FOUR_PLAYER_TERMINAL_HISTORIES } from "./four-player-oracle";
import {
  adaptHeadsUpGame,
  adaptHeadsUpStrategy,
  buildMultiwayGameTreeIndex,
  uniformMultiwayStrategy,
  type MultiwayBehavioralStrategy,
  type MultiwayExtensiveFormGame,
} from "./game";
import type { RaisedRiverSolveArtifact } from "./raised-artifact";
import { verifyRaisedRiverArtifactHash } from "./raised-artifact-node";
import type { SidePotSolveArtifact } from "./side-pot-artifact";
import { verifySidePotArtifactHash } from "./side-pot-artifact-node";
import type { TwoSizeRiverSolveArtifact } from "./two-size-artifact";
import { verifyTwoSizeRiverArtifactHash } from "./two-size-artifact-node";
import { handScore } from "../../poker/eval";

export interface FourPlayerIndependentAudit {
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
  readonly seatPermutation: {
    readonly mappingOldSeatToNewSeat: readonly [2, 0, 3, 1];
    readonly dealsChecked: number;
    readonly terminalsChecked: number;
    readonly maximumProbabilityDifference: number;
    readonly maximumUtilityDifference: number;
  };
  readonly deadMoneyReduction: {
    readonly removedSeat: 3;
    readonly terminalsChecked: number;
    readonly deadChipsPerTerminal: 30;
    readonly maximumAwardDifference: number;
    readonly maximumUtilityDifference: number;
  };
  readonly headsUpAdapter: {
    readonly treeMatches: boolean;
    readonly maximumValueDifference: number;
    readonly maximumBestResponseDifference: number;
  };
  readonly priorArtifacts: {
    readonly noRaiseHashValid: boolean;
    readonly raisedHashValid: boolean;
    readonly twoSizeHashValid: boolean;
    readonly sidePotHashValid: boolean;
    readonly headsUpHashValid: boolean;
  };
}

let cachedAudit: FourPlayerIndependentAudit | null = null;

function oneDealGame() {
  const scenario: FourPlayerRiverScenario = {
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "four-player-river-one-deal-audit",
    ranges: [
      [FOUR_PLAYER_RIVER_V1_SCENARIO.ranges[0][2]],
      [FOUR_PLAYER_RIVER_V1_SCENARIO.ranges[1][1]],
      [FOUR_PLAYER_RIVER_V1_SCENARIO.ranges[2][2]],
      [FOUR_PLAYER_RIVER_V1_SCENARIO.ranges[3][3]],
    ],
  };
  return createFourPlayerRiverGame(scenario);
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
    if (!entry) throw new Error("Missing strategy in four-player hidden-information audit");
    return values.reduce(
      (sum, value, actionIndex) => sum + entry.probabilities[actionIndex] * value,
      0,
    );
  };
  return visit(game.initialState());
}

function asFour<T>(values: readonly T[]): FourPlayers<T> {
  if (values.length !== 4) throw new Error("Four-player independent audit expected four values");
  return [values[0], values[1], values[2], values[3]];
}

function dealKey(hands: FourPlayers<RiverCombo>): string {
  return hands.map(riverComboKey).join("|");
}

function auditSeatPermutation(): FourPlayerIndependentAudit["seatPermutation"] {
  const mapping = [2, 0, 3, 1] as const;
  const move = <T>(values: FourPlayers<T>): FourPlayers<T> => {
    const moved: T[] = Array.from({ length: 4 });
    values.forEach((value, oldSeat) => { moved[mapping[oldSeat]] = value; });
    return asFour(moved);
  };
  const permuted = createFourPlayerRiverGame({
    ...FOUR_PLAYER_RIVER_V1_SCENARIO,
    id: "four-player-river-seat-permutation-audit",
    ranges: move(FOUR_PLAYER_RIVER_V1_SCENARIO.ranges),
    committed: move(FOUR_PLAYER_RIVER_V1_SCENARIO.committed),
    stackBehind: move(FOUR_PLAYER_RIVER_V1_SCENARIO.stackBehind),
    positions: move(FOUR_PLAYER_RIVER_V1_SCENARIO.positions),
    actionOrder: asFour(FOUR_PLAYER_RIVER_V1_SCENARIO.actionOrder.map(oldSeat =>
      mapping[oldSeat])),
  });
  const permutedDeals = new Map(permuted.deals.map(deal => [
    dealKey(deal.outcome.hands),
    deal.probability,
  ]));
  let maximumProbabilityDifference = 0;
  let maximumUtilityDifference = 0;
  let terminalsChecked = 0;
  for (const deal of fourPlayerRiverV1Game.deals) {
    const hands = move(deal.outcome.hands);
    const probability = permutedDeals.get(dealKey(hands));
    if (probability === undefined) throw new Error("Seat permutation omitted a compatible deal");
    maximumProbabilityDifference = Math.max(
      maximumProbabilityDifference,
      Math.abs(deal.probability - probability),
    );
    for (const history of FOUR_PLAYER_TERMINAL_HISTORIES) {
      const original = fourPlayerRiverV1Game.settlement(
        fourPlayerRiverState(fourPlayerRiverV1Game, deal.outcome.hands, history),
      );
      const changed = permuted.settlement(fourPlayerRiverState(permuted, hands, history));
      for (let oldSeat = 0; oldSeat < 4; oldSeat += 1) {
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(original.utility[oldSeat] - changed.utility[mapping[oldSeat]]),
        );
      }
      terminalsChecked += 1;
    }
  }
  return {
    mappingOldSeatToNewSeat: mapping,
    dealsChecked: fourPlayerRiverV1Game.deals.length,
    terminalsChecked,
    maximumProbabilityDifference,
    maximumUtilityDifference,
  };
}

function slowWinners(hands: FourPlayers<RiverCombo>, active: readonly number[]): readonly number[] {
  if (active.length === 1) return active;
  const board = FOUR_PLAYER_RIVER_V1_SCENARIO.board.map(riverCardObject);
  const scores = active.map(player => ({
    player,
    score: handScore(hands[player].map(riverCardObject), board),
  }));
  const best = Math.max(...scores.map(result => result.score));
  return scores.filter(result => result.score === best).map(result => result.player);
}

function auditDeadMoneyReduction(): FourPlayerIndependentAudit["deadMoneyReduction"] {
  let terminalsChecked = 0;
  let maximumAwardDifference = 0;
  let maximumUtilityDifference = 0;
  for (const deal of fourPlayerRiverV1Game.deals) {
    for (const history of FOUR_PLAYER_TERMINAL_HISTORIES) {
      const state = fourPlayerRiverState(fourPlayerRiverV1Game, deal.outcome.hands, history);
      if (state.public.active[3]) continue;
      const actual = fourPlayerRiverV1Game.settlement(state);
      if (actual.contributions[3] !== 30) {
        throw new Error("Removed four-player seat contributed more than the locked dead money");
      }
      const active = [0, 1, 2].filter(player => state.public.active[player]);
      const winners = slowWinners(deal.outcome.hands, active);
      const referenceAwards = [0, 1, 2, 3].map(player =>
        winners.includes(player) ? actual.pot / winners.length : 0);
      for (let player = 0; player < 4; player += 1) {
        const referenceUtility = referenceAwards[player] - actual.contributions[player];
        maximumAwardDifference = Math.max(
          maximumAwardDifference,
          Math.abs(referenceAwards[player] - actual.awards[player]),
        );
        maximumUtilityDifference = Math.max(
          maximumUtilityDifference,
          Math.abs(referenceUtility - actual.utility[player]),
        );
      }
      terminalsChecked += 1;
    }
  }
  return {
    removedSeat: 3,
    terminalsChecked,
    deadChipsPerTerminal: 30,
    maximumAwardDifference,
    maximumUtilityDifference,
  };
}

function auditHeadsUpAdapter(): FourPlayerIndependentAudit["headsUpAdapter"] {
  const artifact = riverArtifactData as unknown as RiverSolveArtifact;
  const originalStrategy = deserializeRiverStrategy(artifact.strategy);
  const originalGrade = gradeStrategy(riverV1Game, originalStrategy);
  const adaptedGame = adaptHeadsUpGame(riverV1Game);
  const adaptedStrategy = adaptHeadsUpStrategy(originalStrategy);
  const adaptedIndex = buildMultiwayGameTreeIndex(adaptedGame);
  const adaptedValue = evaluateMultiwayStrategy(adaptedGame, adaptedStrategy, adaptedIndex);
  let maximumValueDifference = 0;
  let maximumBestResponseDifference = 0;
  for (let player = 0; player < 2; player += 1) {
    maximumValueDifference = Math.max(
      maximumValueDifference,
      Math.abs(adaptedValue[player] - originalGrade.value[player]),
    );
    const response = informationSetMultiwayBestResponse(adaptedGame, adaptedStrategy, player, adaptedIndex);
    maximumBestResponseDifference = Math.max(
      maximumBestResponseDifference,
      Math.abs(response.value - originalGrade.bestResponses[player].value),
    );
  }
  return {
    treeMatches: adaptedIndex.totalStates === artifact.tree.totalStates &&
      adaptedIndex.informationSets.length === artifact.tree.informationSets,
    maximumValueDifference,
    maximumBestResponseDifference,
  };
}

export function auditFourPlayerIndependentChecks(): FourPlayerIndependentAudit {
  if (cachedAudit) return cachedAudit;
  const reduced = oneDealGame();
  const reducedIndex = buildMultiwayGameTreeIndex(reduced);
  const uniformReduced = uniformMultiwayStrategy(reducedIndex);
  let maximumValueDifference = 0;
  const pureStrategiesChecked: number[] = [];
  for (let player = 0; player < 4; player += 1) {
    const scalable = informationSetMultiwayBestResponse(reduced, uniformReduced, player, reducedIndex);
    const exhaustive = exhaustiveMultiwayBestResponse(reduced, uniformReduced, player, reducedIndex);
    maximumValueDifference = Math.max(maximumValueDifference, Math.abs(scalable.value - exhaustive.value));
    pureStrategiesChecked.push(exhaustive.pureStrategiesChecked ?? 0);
  }
  if (pureStrategiesChecked.some(count => count !== 256)) {
    throw new Error(`Unexpected four-player pure-strategy counts ${pureStrategiesChecked.join(",")}`);
  }

  const mainIndex = buildMultiwayGameTreeIndex(fourPlayerRiverV1Game);
  const uniform = uniformMultiwayStrategy(mainIndex);
  const honest = informationSetMultiwayBestResponse(fourPlayerRiverV1Game, uniform, 0, mainIndex).value;
  const cheating = cheatingResponseValue(fourPlayerRiverV1Game, uniform, 0);

  const noRaiseArtifact = noRaiseArtifactData as unknown as MultiwaySolveArtifact;
  const raisedArtifact = raisedArtifactData as unknown as RaisedRiverSolveArtifact;
  const twoSizeArtifact = twoSizeArtifactData as unknown as TwoSizeRiverSolveArtifact;
  const sidePotArtifact = sidePotArtifactData as unknown as SidePotSolveArtifact;
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
    seatPermutation: auditSeatPermutation(),
    deadMoneyReduction: auditDeadMoneyReduction(),
    headsUpAdapter: auditHeadsUpAdapter(),
    priorArtifacts: {
      noRaiseHashValid: verifyMultiwayArtifactHash(noRaiseArtifact),
      raisedHashValid: verifyRaisedRiverArtifactHash(raisedArtifact),
      twoSizeHashValid: verifyTwoSizeRiverArtifactHash(twoSizeArtifact),
      sidePotHashValid: verifySidePotArtifactHash(sidePotArtifact),
      headsUpHashValid: verifyRiverArtifactHash(headsUpArtifact),
    },
  };
  return cachedAudit;
}
