/** P2's final gate grades the actual exported strategy in float64. Raw upstream float32
 * scores remain unmodified, including tiny negative zero-sum cancellation residuals.
 * Neither the local target nor B2's locked cross-grader tolerance is enlarged.
 */
import { checkBridgeResult, type BridgeSpotV1 } from "../contract";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS } from "../referee";
import { gradeRiverHands } from "../river-hand-values";

export interface RiverPlayingQuality {
  readonly basis: "independent-river-best-response";
  readonly independentChips: number;
  readonly rawEngineChips: number;
  readonly comparisonToleranceChips: number;
}

export function requireRiverPlayingResult(raw: unknown, spot: BridgeSpotV1, hash: string) {
  if (spot.tree.mode !== "river-subgame-v1") throw new Error("Independent P2 quality gate requires a river subgame");
  const result = checkBridgeResult(raw, spot, hash), e = result.exploitability;
  const chips = Math.fround(e.chips), target = spot.startingPot * spot.solve.targetExploitabilityPctPot / 100;
  if (result.engine.precision !== "float32" || result.engine.threads !== 1 || result.engine.algorithm !== "discounted-cfr"
    || result.iterations < 0 || result.iterations > spot.solve.maxIterations || e.reached !== true || chips > target
    || e.target !== target || e.pctPot !== chips / spot.startingPot * 100
    || e.convention !== "half-sum-of-best-response-gains") throw new Error("River result did not meet the quality target and precision contract");
  const grade = gradeRiverHands(spot, result);
  if (Math.abs(grade.exploitability - chips) > BRIDGE_FLOAT32_TOLERANCE_CHIPS) throw new Error("Engine and independent river grades disagree beyond the locked chip tolerance");
  // In particular, a plausible engine score cannot hide a bad exported playing policy.
  if (grade.exploitability > target) throw new Error("Independent river strategy did not meet the play quality target");
  const quality: RiverPlayingQuality = { basis: "independent-river-best-response", independentChips: grade.exploitability,
    rawEngineChips: chips, comparisonToleranceChips: BRIDGE_FLOAT32_TOLERANCE_CHIPS };
  return { result, grade, quality };
}
