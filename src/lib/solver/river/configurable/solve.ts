import { gradeStrategy, type StrategyGrade } from "../../toy/best-response";
import { solveCfr, type CfrSolveResult } from "../../toy/cfr";
import type { RiverCard } from "../cards";
import {
  configurableRiverDecisionFacts,
  type ConfigurableRiverDecisionFacts,
} from "./explain";
import {
  createConfigurableRiverGame,
  type ConfigurableRiverAction,
  type ConfigurableRiverGame,
  type ConfigurableRiverLimits,
  type ConfigurableRiverScenario,
} from "./game";
import {
  parseConfigurableRiverRange,
  type ParsedConfigurableRiverRange,
} from "./range";

export interface ConfigurableRiverRequest {
  readonly id: string;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard, RiverCard];
  readonly rangeText: readonly [string, string];
  readonly committed: readonly [number, number];
  readonly stackBehind: readonly [number, number];
  readonly openingBetSizes: readonly number[];
  readonly raiseToSizes: readonly number[];
}

export interface PreparedConfigurableRiver {
  readonly scenario: ConfigurableRiverScenario;
  readonly parsedRanges: readonly [ParsedConfigurableRiverRange, ParsedConfigurableRiverRange];
  readonly game: ConfigurableRiverGame;
}

export interface ConfigurableRiverSolveOptions {
  readonly iterations: number;
  readonly checkpointIterations?: readonly number[];
  readonly limits?: Partial<ConfigurableRiverLimits>;
  readonly includeDecisionFacts?: boolean;
}

export interface ConfigurableRiverSolve {
  readonly game: ConfigurableRiverGame;
  readonly parsedRanges: readonly [ParsedConfigurableRiverRange, ParsedConfigurableRiverRange];
  readonly result: CfrSolveResult<ConfigurableRiverAction>;
  readonly grade: StrategyGrade<ConfigurableRiverAction>;
  readonly decisions: readonly ConfigurableRiverDecisionFacts[] | null;
}

/** Parse learner-friendly range text and return the exact finite game before solving it. */
export function prepareConfigurableRiver(
  request: ConfigurableRiverRequest,
  limits: Partial<ConfigurableRiverLimits> = {},
): PreparedConfigurableRiver {
  const parsedRanges = [
    parseConfigurableRiverRange(request.rangeText[0], request.board),
    parseConfigurableRiverRange(request.rangeText[1], request.board),
  ] as const;
  const scenario: ConfigurableRiverScenario = {
    id: request.id,
    version: 2,
    board: [...request.board],
    ranges: [parsedRanges[0].entries, parsedRanges[1].entries],
    committed: [...request.committed],
    stackBehind: [...request.stackBehind],
    positions: ["out-of-position", "in-position"],
    actionOrder: [0, 1],
    openingBetSizes: [...request.openingBetSizes],
    raiseToSizes: [...request.raiseToSizes],
    maxRaises: 1,
  };
  return {
    scenario,
    parsedRanges,
    game: createConfigurableRiverGame(scenario, limits),
  };
}

/** Solve and independently grade one bounded request. This never writes an artifact. */
export function solveConfigurableRiver(
  request: ConfigurableRiverRequest,
  options: ConfigurableRiverSolveOptions,
): ConfigurableRiverSolve {
  const prepared = prepareConfigurableRiver(request, options.limits);
  const result = solveCfr(prepared.game, {
    iterations: options.iterations,
    checkpointIterations: options.checkpointIterations,
  });
  const grade = gradeStrategy(prepared.game, result.averageStrategy, result.index);
  return {
    game: prepared.game,
    parsedRanges: prepared.parsedRanges,
    result,
    grade,
    decisions: options.includeDecisionFacts === false
      ? null
      : configurableRiverDecisionFacts(prepared.game, result.averageStrategy),
  };
}
