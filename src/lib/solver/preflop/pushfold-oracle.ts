// PF1: the all-in-only heads-up game must reproduce pushfold.ts (spec §9 PF1, §5 cross-check 2).
//
// The `hu` structure with the jam/fold menu has no flop terminals, so R is irrelevant. Our
// solution is compared with the saved push/fold solution at the same depth and graded by
// pushfold.ts's own best-response functions (not by grader.ts).
import pushfoldSolutions from "../pushfold-solutions.json";
import { bbBestResponse, sbBestResponse, sbPayoff } from "../pushfold";
import { huStructure, JAM_FOLD_MENU, makeSpot, type RealizationTableV1 } from "./contract";
import { defaultRealizationTable } from "./realization";
import { solvePreflop } from "./solve";

interface SavedPushFold { stack: number; sbShove: number[]; bbCall: number[]; sbShovePct: number; bbCallPct: number }
const SAVED = (pushfoldSolutions as unknown as { solutions: Record<string, SavedPushFold> }).solutions;

export const PUSHFOLD_DEPTHS: readonly number[] = Object.values(SAVED).map(s => s.stack).sort((a, b) => a - b);

export function savedPushFold(stack: number): SavedPushFold {
  const s = SAVED[stack.toFixed(1)];
  if (!s) throw new Error(`no saved push/fold solution at ${stack}bb`);
  return s;
}

export interface PushFoldComparison {
  readonly stack: number;
  readonly iterations: number;
  readonly exploitability: number;
  readonly value: number;
  readonly pushfoldValue: number;
  readonly valueDiff: number;
  /** Nash gap of OUR strategies measured by pushfold.ts's sbBestResponse / bbBestResponse / sbPayoff. */
  readonly pushfoldNashGap: number;
  readonly shovePct: number;
  readonly pushfoldShovePct: number;
  readonly callPct: number;
  readonly pushfoldCallPct: number;
  /** Classes whose frequency differs by > 0.05, with our EV gap between the two actions (bb). */
  readonly differing: readonly { readonly hand: string; readonly node: "shove" | "call"; readonly ours: number; readonly pushfold: number; readonly evGap: number }[];
  readonly shove: readonly number[];
  readonly call: readonly number[];
}

export function huJamFoldSpot(stack: number, realization: RealizationTableV1 = defaultRealizationTable(), targetExploitability = 1e-6) {
  return makeSpot({
    label: `PF1 heads-up jam/fold ${stack}bb`, structure: huStructure(stack), menu: JAM_FOLD_MENU, realization,
    solver: { targetExploitability, checkEvery: 100, maxIterations: 100_000 },
  });
}

export function comparePushFold(stack: number, realization?: RealizationTableV1): PushFoldComparison {
  const { result } = solvePreflop(huJamFoldSpot(stack, realization));
  const saved = savedPushFold(stack);
  const root = result.strategy[""], vsJam = result.strategy["jam"];
  const shove = root.freq[root.actions.indexOf("jam")], call = vsJam.freq[vsJam.actions.indexOf("call")];
  const pushfoldValue = sbPayoff(saved.sbShove, saved.bbCall, stack, 0.5, 1) - stack;
  const profile = sbPayoff([...shove], [...call], stack, 0.5, 1);
  const sbGain = sbPayoff(sbBestResponse([...call], stack, 0.5, 1), [...call], stack, 0.5, 1) - profile;
  const bbGain = profile - sbPayoff([...shove], bbBestResponse([...shove], stack, 1), stack, 0.5, 1);
  const differing: PushFoldComparison["differing"][number][] = [];
  result.classes.forEach((hand, h) => {
    const rows: [("shove" | "call"), typeof root, number, number][] = [["shove", root, shove[h], saved.sbShove[h]], ["call", vsJam, call[h], saved.bbCall[h]]];
    for (const [node, strategy, ours, theirs] of rows) {
      if (Math.abs(ours - theirs) <= 0.05) continue;
      const ev = strategy.actionEv;
      const a = ev[0][h], b = ev[1][h];
      differing.push({ hand, node, ours, pushfold: theirs, evGap: a === null || b === null ? NaN : Math.abs(a - b) });
    }
  });
  return {
    stack, iterations: result.iterations, exploitability: result.grade.exploitability,
    value: result.grade.value[0], pushfoldValue, valueDiff: result.grade.value[0] - pushfoldValue,
    pushfoldNashGap: Math.max(0, sbGain) + Math.max(0, bbGain),
    shovePct: result.stats.btnOpenJamPct, pushfoldShovePct: saved.sbShovePct,
    callPct: result.stats.bbCallVsJamPct, pushfoldCallPct: saved.bbCallPct,
    differing, shove, call,
  };
}
