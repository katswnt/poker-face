import { solveCfr, type CfrOptions } from "../toy/cfr";
import { gradeStrategy } from "../toy/best-response";
import { createTurnGame, TURN_LIMITS, type TurnRequest } from "./game";

export function solveTurn(request: TurnRequest, options: CfrOptions) {
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1 || options.iterations > TURN_LIMITS.iterations) {
    throw new Error(`Turn iterations must be between 1 and ${TURN_LIMITS.iterations}`);
  }
  if ((options.checkpointIterations?.length ?? 0) > 16) throw new Error("Turn solve permits at most 16 saved checkpoints");
  const game = createTurnGame(request);
  const result = solveCfr(game, options);
  const grade = gradeStrategy(game, result.averageStrategy, result.index);
  return { game, result, grade };
}
