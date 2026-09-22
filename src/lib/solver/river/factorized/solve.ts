import type { ConfigurableRiverDecisionFacts } from "../configurable/explain";
import { configurableRiverDecisionFacts } from "../configurable/explain";
import type {
  ConfigurableRiverGame,
  ConfigurableRiverLimits,
} from "../configurable/game";
import {
  prepareConfigurableRiver,
  type ConfigurableRiverRequest,
  type PreparedConfigurableRiver,
} from "../configurable/solve";
import {
  solveCompiledFactorizedRiverCfr,
  type FactorizedRiverCfrOptions,
  type FactorizedRiverCfrResult,
} from "./cfr";
import { compileFactorizedRiverGame } from "./game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
  type FactorizedRiverStrategyGrade,
} from "./scorekeeper";

/** Finite first step: more deals, but still an exact river-only abstraction. */
export const FACTORIZED_CONFIGURABLE_RIVER_LIMITS: ConfigurableRiverLimits = {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 10_000,
  maxProjectedStates: 250_000,
};

export interface FactorizedConfigurableRiverOptions extends FactorizedRiverCfrOptions {
  readonly includeDecisionFacts?: boolean;
}

export interface FactorizedConfigurableRiverSolve {
  readonly prepared: PreparedConfigurableRiver;
  readonly game: ConfigurableRiverGame;
  readonly result: FactorizedRiverCfrResult;
  readonly grade: FactorizedRiverStrategyGrade;
  readonly decisions: readonly ConfigurableRiverDecisionFacts[] | null;
}

/** Parse, preflight, solve, and grade one bounded factorized river request. */
export function solveFactorizedConfigurableRiver(
  request: ConfigurableRiverRequest,
  options: FactorizedConfigurableRiverOptions,
): FactorizedConfigurableRiverSolve {
  const prepared = prepareConfigurableRiver(request, FACTORIZED_CONFIGURABLE_RIVER_LIMITS);
  const compiled = compileFactorizedRiverGame(prepared.game);
  const result = solveCompiledFactorizedRiverCfr(compiled, options);
  const grade = gradeFactorizedRiverStrategy(
    compileFactorizedRiverScorekeeper(compiled),
    result.averageStrategy,
  );
  return {
    prepared,
    game: prepared.game,
    result,
    grade,
    decisions: options.includeDecisionFacts === false
      ? null
      : configurableRiverDecisionFacts(prepared.game, result.averageStrategy),
  };
}
