// Aggregate range statistics of a preflop profile (spec §6), all in %.
//
// "Of all hands" stats are combo-weighted over the game's classes (6 / 4 / 12 combos per class,
// no conditioning on the opponent's action: the usual chart convention, e.g. "BTN opens 43%").
// "Of <range>" stats are weighted by the combos that reached the node on that line.
import type { PreflopAggregateStats } from "./contract";
import type { PreflopGame } from "./terminal";
import type { PreflopDecisionNode, PreflopProfile } from "./tree";

function node(game: PreflopGame, id: string): PreflopDecisionNode | null {
  const n = game.tree.byId.get(id);
  return n && n.kind === "decision" ? n : null;
}

function actionFreq(profile: PreflopProfile, n: PreflopDecisionNode, action: string): readonly number[] | null {
  const a = n.actions.indexOf(action);
  return a < 0 ? null : profile.get(n.id)![a];
}

/** Σ_h w_h · Π reach_h · Σ_actions freq_h / Σ_h w_h · Π reach_h, in %. */
function pct(game: PreflopGame, parts: readonly (readonly number[] | null)[], reach: readonly (readonly number[])[] = []): number {
  let num = 0, den = 0;
  for (let h = 0; h < game.n; h++) {
    let w = game.comboWeight[h];
    for (const r of reach) w *= r[h];
    den += w;
    let f = 0;
    for (const p of parts) if (p) f += p[h];
    num += w * f;
  }
  return den > 0 ? (100 * num) / den : 0;
}

export function aggregateStats(game: PreflopGame, profile: PreflopProfile): PreflopAggregateStats {
  const out: Record<string, number> = {};
  const { raises } = game.spot.menu;
  const root = game.tree.root;
  const openLabel = raises.length > 0 ? `r${raises[0]}` : null;
  const open = openLabel ? actionFreq(profile, root, openLabel) : null;
  const rootJam = actionFreq(profile, root, "jam");
  if (open) out.btnOpenPct = pct(game, [open]);
  if (rootJam) out.btnOpenJamPct = pct(game, [rootJam]);

  const vsJam = node(game, "jam");
  if (vsJam) out.bbCallVsJamPct = pct(game, [actionFreq(profile, vsJam, "call")]);

  if (!openLabel || !open) return out;
  const bb = node(game, openLabel)!;
  const bbFold = actionFreq(profile, bb, "fold")!;
  out.bbDefendPct = 100 - pct(game, [bbFold]);
  out.bbCallPct = pct(game, [actionFreq(profile, bb, "call")]);
  const threeLabel = raises.length > 1 ? `r${raises[1]}` : null;
  const threeBet = threeLabel ? actionFreq(profile, bb, threeLabel) : null;
  const bbJam = actionFreq(profile, bb, "jam");
  out.bb3betPct = pct(game, [threeBet, bbJam]);
  out.bbJamVsOpenPct = pct(game, [bbJam]);

  if (!threeLabel || !threeBet) return out;
  const btn = node(game, `${openLabel}/${threeLabel}`)!;
  const fourLabel = raises.length > 2 ? `r${raises[2]}` : null;
  const fourBet = fourLabel ? actionFreq(profile, btn, fourLabel) : null;
  const btnJam = actionFreq(profile, btn, "jam");
  out.btn4betOfOpenPct = pct(game, [fourBet, btnJam], [open]);
  out.btnJamVs3betOfOpenPct = pct(game, [btnJam], [open]);
  out.btnCallVs3betOfOpenPct = pct(game, [actionFreq(profile, btn, "call")], [open]);
  out.btnFoldVs3betOfOpenPct = pct(game, [actionFreq(profile, btn, "fold")], [open]);

  if (!fourLabel || !fourBet) return out;
  const bb4 = node(game, `${openLabel}/${threeLabel}/${fourLabel}`)!;
  out.bbJamVs4betOf3betPct = pct(game, [actionFreq(profile, bb4, "jam")], [threeBet]);
  out.bbCallVs4betOf3betPct = pct(game, [actionFreq(profile, bb4, "call")], [threeBet]);
  return out;
}
