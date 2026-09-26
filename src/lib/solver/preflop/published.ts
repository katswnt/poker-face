// The published preflop spots (PF2, PF3), shared by scripts/solve-preflop.ts and the tests.
import { makeSpot, NO_RAKE, SIX_MAX_BTN_BB, V1_MENU, type PreflopRake, type RealizationTableV1 } from "./contract";
import { defaultRealizationTable } from "./realization";

/** Published solves run past the spec's 1 mbb/hand gate to 0.2 mbb/hand, so sensitivity rows sit above convergence noise. */
export const PUBLISHED_TARGET_EXPLOITABILITY = 0.0002;

export const PF2_LABEL = "PF2: 6-max BTN vs BB (SB folded), 100bb, default R";
export const PF3_LABEL = "PF3: 6-max BTN vs BB (SB folded), 100bb, R fitted from the B4 library";

export function pf2Spot(realization: RealizationTableV1 = defaultRealizationTable(), rake: PreflopRake = NO_RAKE, label = PF2_LABEL) {
  return makeSpot({ label, structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization, rake, solver: { targetExploitability: PUBLISHED_TARGET_EXPLOITABILITY } });
}

export function pf3Spot(table: RealizationTableV1, label = PF3_LABEL) {
  return makeSpot({ label, structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization: table, solver: { targetExploitability: PUBLISHED_TARGET_EXPLOITABILITY } });
}
