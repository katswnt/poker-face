import { writeFile } from "node:fs/promises";
import { solvePushFold } from "../src/lib/solver/pushfold.ts";

// The earlier 1,200-round charts had a small overall strategy gap, but individual
// borderline-hand frequencies were still moving. Twenty thousand rounds keeps the
// remaining strategy gap below 0.0005 bb at every depth. The input equity matrix is exact
// (scripts/build-equity-matrix.ts) and ranges are weighted with card removal.
const rounds = 20_000;
const tolerance = 0.0005;
const depths = Array.from({ length: 37 }, (_, index) => 2 + index * 0.5);
const round = (value, places = 8) => Number(value.toFixed(places));

const solutions = Object.fromEntries(depths.map(stack => {
  const solution = solvePushFold(stack, { rounds, tolerance });
  return [stack.toFixed(1), {
    ...solution,
    sbShove: solution.sbShove.map(value => round(value, 6)),
    bbCall: solution.bbCall.map(value => round(value, 6)),
    sbShovePct: round(solution.sbShovePct, 6),
    bbCallPct: round(solution.bbCallPct, 6),
    nashGap: round(solution.nashGap),
    sbImprovement: round(solution.sbImprovement),
    bbImprovement: round(solution.bbImprovement),
  }];
}));

const values = Object.values(solutions);
const output = {
  meta: {
    description: "Precomputed strategies for the simplified heads-up shove-or-fold model.",
    depths,
    rounds,
    tolerance,
    matrixSamples: values[0]?.matrixSamples ?? 0,
    matrixMethod: "exact",
    cardRemoval: values.every(solution => solution.cardRemoval),
    maxNashGap: round(Math.max(...values.map(solution => solution.nashGap))),
    allConverged: values.every(solution => solution.converged),
  },
  solutions,
};

await writeFile(
  new URL("../src/lib/solver/pushfold-solutions.json", import.meta.url),
  `${JSON.stringify(output)}\n`,
  "utf8",
);
