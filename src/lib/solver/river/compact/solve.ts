import { gradeStrategy, type StrategyGrade } from "../../toy/best-response";
import type { ConfigurableRiverDecisionFacts } from "../configurable/explain";
import { configurableRiverDecisionFacts } from "../configurable/explain";
import type {
  ConfigurableRiverAction,
  ConfigurableRiverGame,
  ConfigurableRiverLimits,
} from "../configurable/game";
import {
  prepareConfigurableRiver,
  type ConfigurableRiverRequest,
  type PreparedConfigurableRiver,
} from "../configurable/solve";
import {
  solveCompactCfr,
  type CompactCfrOptions,
  type CompactCfrSolveResult,
} from "./cfr";

/**
 * A conservative first increase over configurable v2's 500-deal ceiling.
 *
 * The state ceiling remains unchanged. The compact engine earns more private-hand pairs
 * by using less storage per state; it does not remove the preflight guard.
 */
export const COMPACT_CONFIGURABLE_RIVER_LIMITS: ConfigurableRiverLimits = {
  maxRangeEntriesPerPlayer: 128,
  maxCompatibleDeals: 2_000,
  maxProjectedStates: 50_000,
};

export interface CompactConfigurableRiverOptions extends CompactCfrOptions {
  readonly includeDecisionFacts?: boolean;
}

export interface CompactConfigurableRiverSolve {
  readonly prepared: PreparedConfigurableRiver;
  readonly game: ConfigurableRiverGame;
  readonly result: CompactCfrSolveResult<ConfigurableRiverAction>;
  readonly grade: StrategyGrade<ConfigurableRiverAction>;
  readonly decisions: readonly ConfigurableRiverDecisionFacts[] | null;
}

/** Parse, preflight, solve, and independently grade one bounded compact river request. */
export function solveCompactConfigurableRiver(
  request: ConfigurableRiverRequest,
  options: CompactConfigurableRiverOptions,
): CompactConfigurableRiverSolve {
  const prepared = prepareConfigurableRiver(request, COMPACT_CONFIGURABLE_RIVER_LIMITS);
  const result = solveCompactCfr(prepared.game, options);
  const grade = gradeStrategy(prepared.game, result.averageStrategy, result.index);
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
