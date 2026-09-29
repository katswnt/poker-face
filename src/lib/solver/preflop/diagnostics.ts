// Read-only diagnostics for the PF3 model. These do not change payoffs, fit targets or policies.
import { DISJOINT } from "../comboCounts";
import { HANDS, handIndex } from "../hands";
import type { PreflopResultV1, RealizationPosition } from "./contract";
import { matrixEquityVsRange, modelShare, type ClassFitRow, type RealizationFit } from "./realization-fit";

/** Residuals against the ORIGINAL targets as well as the adjusted targets used for stopping. */
export function fitResiduals(fit: Pick<RealizationFit, "rows">, position: RealizationPosition) {
  const rows = fit.rows[position];
  const max = (f: (row: ClassFitRow) => number) => Math.max(0, ...rows.map(f));
  return {
    classes: rows.length,
    measuredClasses: rows.filter(r => r.source === "measured").length,
    bucketClasses: rows.filter(r => r.source === "bucket").length,
    defaultClasses: rows.filter(r => r.source === "default").length,
    measuredSharesAboveOne: rows.filter(r => r.measuredShare !== null && r.measuredShare > 1).map(r => r.hand),
    originalTargetsAboveOne: rows.filter(r => r.baseTargetShare > 1).map(r => r.hand),
    pinnedClasses: rows.filter(r => r.pinned).length,
    maxOriginalTargetError: max(r => Math.abs(r.modelShare - r.baseTargetShare)),
    maxAdjustedTargetErrorUnpinned: max(r => r.pinned ? 0 : Math.abs(r.modelShare - r.targetShare)),
    worstOriginalTargets: [...rows].sort((a, b) => Math.abs(b.modelShare - b.baseTargetShare) - Math.abs(a.modelShare - a.baseTargetShare))
      .slice(0, 5).map(r => ({ hand: r.hand, source: r.source, measuredShare: r.measuredShare,
        originalTarget: r.baseTargetShare, adjustedTarget: r.targetShare, achieved: r.modelShare, pinned: r.pinned })),
  };
}

function openingRange(result: PreflopResultV1): readonly number[] {
  const root = result.strategy[""];
  const open = root?.actions.indexOf("r2.5") ?? -1;
  if (result.classes.length !== HANDS.length || open < 0 || !result.strategy["r2.5"]) {
    throw new Error("diagnostic needs the full-class 2.5bb-open fixture");
  }
  if (result.classes.some((label, i) => label !== HANDS[i].label)) throw new Error("diagnostic class order differs");
  return root.freq[open];
}

/** Separate the chart convention from actual blocker-conditioned defence after a BTN open. */
export function defenceCoverage(result: PreflopResultV1, fit: Pick<RealizationFit, "rows">) {
  const open = openingRange(result), node = result.strategy["r2.5"], fold = node.actions.indexOf("fold"), call = node.actions.indexOf("call");
  if (fold < 0 || call < 0) throw new Error("diagnostic needs fold and call actions");
  const sourceByHand = new Map(fit.rows.oop.map(r => [r.hand, r.source]));
  const groups = { measured: { classes: 0, combos: 0, defendingCombos: 0, callingCombos: 0 },
    bucket: { classes: 0, combos: 0, defendingCombos: 0, callingCombos: 0 },
    default: { classes: 0, combos: 0, defendingCombos: 0, callingCombos: 0 } };
  let numerator = 0, denominator = 0, chartDefend = 0;
  for (let h = 0; h < HANDS.length; h++) {
    const source = sourceByHand.get(HANDS[h].label);
    if (!source) throw new Error(`missing source for ${HANDS[h].label}`);
    const g = groups[source], weight = HANDS[h].weight, defend = 1 - node.freq[fold][h];
    g.classes++; g.combos += weight; g.defendingCombos += weight * defend; g.callingCombos += weight * node.freq[call][h];
    chartDefend += weight * defend;
    const mass = open.reduce((sum, p, k) => sum + DISJOINT[k][h] * p, 0);
    numerator += mass * defend; denominator += mass;
  }
  if (denominator === 0) throw new Error("BTN never opens");
  return { chartDefendPct: 100 * chartDefend / 1326, conditionalDefendPct: 100 * numerator / denominator,
    unmeasuredShareOfDefendingCombosPct: 100 * (groups.bucket.defendingCombos + groups.default.defendingCombos) / chartDefend, groups };
}

/** Trace the CALL versus FOLD margin independently of CFR traversal for the locked no-rake SRP. */
export function bbCallTrace(result: PreflopResultV1, hand: string) {
  const open = openingRange(result), c = handIndex(hand), { structure, rake, realization } = result.spot;
  if (rake.pct !== 0 || structure.posted[1] !== 1 || structure.posted[0] !== 0 || structure.dead !== 0.5) {
    throw new Error("call trace needs no rake, BTN posted 0, BB posted 1, dead SB 0.5");
  }
  const share = modelShare("oop", c, open, realization.ip.srp, realization.oop.srp);
  const potAfterCall = 5.5, extraCall = 1.5;
  const node = result.strategy["r2.5"], call = node.actions.indexOf("call"), fold = node.actions.indexOf("fold");
  const callEv = node.actionEv[call][c], foldEv = node.actionEv[fold][c];
  if (callEv === null || foldEv === null) throw new Error("call trace is unreachable");
  return { hand, matrixEquityVsOpeningRange: matrixEquityVsRange(c, open), modeledShare: share,
    breakEvenShare: extraCall / potAfterCall, callMinusFoldBb: potAfterCall * share - extraCall,
    savedCallMinusFoldBb: callEv - foldEv, callFrequency: node.freq[call][c], foldFrequency: node.freq[fold][c] };
}

/** A ratio adjustment is not generally an unbiased correction for a nonrepresentative flop sample. */
export function ratioAdjustmentCounterexample() {
  // Two equally likely boards: equity 0.2 / 0.8, from-now payoff divided by starting pot 0.1 / 1.2.
  // Observing only the second board gives R=1.5. Multiplying by the true mean equity does NOT
  // recover the true mean payoff. Payoff > pot is possible because later betting adds chips.
  const trueMeanEquity = (0.2 + 0.8) / 2, trueMeanShare = (0.1 + 1.2) / 2;
  const adjustedShare = (1.2 / 0.8) * trueMeanEquity;
  return { trueMeanEquity, trueMeanShare, adjustedShare, bias: adjustedShare - trueMeanShare };
}
