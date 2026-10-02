/** Preserve raw float32 scores. A negative residual is admissible only for a complete
 * terminal-only turn policy independently graded within B2's unchanged chip tolerance.
 * Ordinary first-street strategies retain the existing nonnegative engine-score gate.
 */
import { checkBridgeResult, type BridgeSpotV1 } from "../contract";
import { BRIDGE_FLOAT32_TOLERANCE_CHIPS } from "../referee";
import { gradeTerminalTurnExport } from "../turn-referee";
import { requirePlayingResult } from "../../../hu-play/sources/resolved";

export interface TerminalTurnPlayingQuality {
  readonly basis: "independent-terminal-turn-best-response";
  readonly independentChips: number;
  readonly rawEngineChips: number;
  readonly comparisonToleranceChips: number;
}
export function requireTurnPlayingResult(raw: unknown, spot: BridgeSpotV1, hash: string) {
  if (spot.tree.mode !== "turn-subgame-v1") throw new Error("P3 quality requires a turn subgame");
  const result = checkBridgeResult(raw, spot, hash), e = result.exploitability;
  const chips = Math.fround(e.chips), target = spot.startingPot * spot.solve.targetExploitabilityPctPot / 100;
  if (chips >= 0) return { result: requirePlayingResult(result, spot, hash), quality: null, exploitabilityPctPot: e.pctPot };
  if (result.engine.precision !== "float32" || result.engine.threads !== 1 || result.engine.algorithm !== "discounted-cfr"
    || result.iterations < 0 || result.iterations > spot.solve.maxIterations || e.reached !== true || chips > target
    || e.target !== target || e.pctPot !== chips / spot.startingPot * 100
    || e.convention !== "half-sum-of-best-response-gains") throw new Error("Turn result did not meet the quality target and precision contract");
  const grade = gradeTerminalTurnExport(spot, result);
  if (Math.abs(grade.exploitability - chips) > BRIDGE_FLOAT32_TOLERANCE_CHIPS) throw new Error("Engine and independent turn grades disagree beyond the locked chip tolerance");
  if (grade.exploitability > target) throw new Error("Independent terminal turn policy did not meet the play quality target");
  const quality: TerminalTurnPlayingQuality = { basis: "independent-terminal-turn-best-response", independentChips: grade.exploitability,
    rawEngineChips: chips, comparisonToleranceChips: BRIDGE_FLOAT32_TOLERANCE_CHIPS };
  return { result, quality, exploitabilityPctPot: grade.exploitabilityPctPot };
}
