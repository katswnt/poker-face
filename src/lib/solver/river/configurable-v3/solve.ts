import type { ConfigurableRiverAction } from "../configurable/game";
import {
  configurableRiverDecisionFacts,
  type ConfigurableRiverDecisionFacts,
} from "../configurable/explain";
import { parseConfigurableRiverRange, type ParsedConfigurableRiverRange } from "../configurable/range";
import {
  solveCompiledFactorizedRiverCfr,
  type FactorizedRiverCfrOptions,
  type FactorizedRiverCfrResult,
} from "../factorized/cfr";
import { compileFactorizedRiverGame } from "../factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
  type FactorizedRiverStrategyGrade,
} from "../factorized/scorekeeper";
import type { RiverCard } from "../cards";
import {
  createConfigurableRiverV3Game,
  type ConfigurableRiverV3Game,
  type ConfigurableRiverV3Limits,
  type ConfigurableRiverV3Scenario,
} from "./game";

export interface ConfigurableRiverV3Request {
  readonly id: string;
  readonly board: readonly [RiverCard, RiverCard, RiverCard, RiverCard, RiverCard];
  readonly rangeText: readonly [string, string];
  readonly committed: readonly [number, number];
  readonly stackBehind: readonly [number, number];
  readonly openingBetSizes: readonly number[];
  readonly raiseToSizes: readonly number[];
  readonly maxRaises: 0 | 1 | 2;
}

export interface PreparedConfigurableRiverV3 {
  readonly scenario: ConfigurableRiverV3Scenario;
  readonly parsedRanges: readonly [ParsedConfigurableRiverRange, ParsedConfigurableRiverRange];
  readonly game: ConfigurableRiverV3Game;
}

export interface ConfigurableRiverV3SolveOptions extends FactorizedRiverCfrOptions {
  readonly limits?: Partial<ConfigurableRiverV3Limits>;
  readonly includeDecisionFacts?: boolean;
}

export interface ConfigurableRiverV3Solve {
  readonly prepared: PreparedConfigurableRiverV3;
  readonly game: ConfigurableRiverV3Game;
  readonly result: FactorizedRiverCfrResult;
  readonly grade: FactorizedRiverStrategyGrade;
  readonly actions: readonly ConfigurableRiverAction[];
  readonly decisions: readonly ConfigurableRiverDecisionFacts[] | null;
}

export const CONFIGURABLE_RIVER_V3_TEACHING_STATE_LIMIT = 100_000;

export function prepareConfigurableRiverV3(
  request: ConfigurableRiverV3Request,
  limits: Partial<ConfigurableRiverV3Limits> = {},
): PreparedConfigurableRiverV3 {
  const parsedRanges = [
    parseConfigurableRiverRange(request.rangeText[0], request.board),
    parseConfigurableRiverRange(request.rangeText[1], request.board),
  ] as const;
  const scenario: ConfigurableRiverV3Scenario = {
    id: request.id,
    version: 3,
    board: [...request.board],
    ranges: [parsedRanges[0].entries, parsedRanges[1].entries],
    committed: [...request.committed],
    stackBehind: [...request.stackBehind],
    positions: ["out-of-position", "in-position"],
    actionOrder: [0, 1],
    openingBetSizes: [...request.openingBetSizes],
    raiseToSizes: [...request.raiseToSizes],
    maxRaises: request.maxRaises,
  };
  return {
    scenario,
    parsedRanges,
    game: createConfigurableRiverV3Game(scenario, limits),
  };
}

/** Solve and independently grade one bounded v3 request. This does not write an artifact. */
export function solveConfigurableRiverV3(
  request: ConfigurableRiverV3Request,
  options: ConfigurableRiverV3SolveOptions,
): ConfigurableRiverV3Solve {
  const prepared = prepareConfigurableRiverV3(request, options.limits);
  if (
    options.includeDecisionFacts === true &&
    prepared.game.preflight.projectedFullStates > CONFIGURABLE_RIVER_V3_TEACHING_STATE_LIMIT
  ) {
    throw new Error(
      `River v3 all-decision teaching data projects ` +
      `${prepared.game.preflight.projectedFullStates} states; teaching limit is ` +
      CONFIGURABLE_RIVER_V3_TEACHING_STATE_LIMIT,
    );
  }
  const compiled = compileFactorizedRiverGame(prepared.game);
  const result = solveCompiledFactorizedRiverCfr(compiled, options);
  const grade = gradeFactorizedRiverStrategy(
    compileFactorizedRiverScorekeeper(compiled),
    result.averageStrategy,
  );
  const actions = [...new Set(compiled.publicActions.flat())];
  let decisions: readonly ConfigurableRiverDecisionFacts[] | null = null;
  if (options.includeDecisionFacts === true) {
    decisions = configurableRiverDecisionFacts(prepared.game, result.averageStrategy);
  }
  return { prepared, game: prepared.game, result, grade, actions, decisions };
}
