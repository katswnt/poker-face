import solutionData from "./pushfold-solutions.json";
import type { PushFoldSolution } from "./pushfold";

export const SOLUTION_META = solutionData.meta;

export function getPushFoldSolution(stack: number): PushFoldSolution {
  const clamped = Math.min(20, Math.max(2, Math.round(stack * 2) / 2));
  const key = clamped.toFixed(1) as keyof typeof solutionData.solutions;
  return solutionData.solutions[key] as PushFoldSolution;
}
