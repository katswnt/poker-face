/** Frozen before P5 measurement; no seed filtering, private AI cards or quality feedback. */
import type { BridgeAction } from "../src/lib/solver/bridge/contract";
import type { PlayView } from "../src/lib/hu-play/ui-controller";
import { actionToken, illegalActionReason, sizedActionBounds } from "../src/lib/hu-play/public-state";

export const P5_UI_CORPUS = Object.freeze({
  format: "poker-face-p5-ui-corpus", version: 1,
  cases: Array.from({length: 200}, (_, seed) => ({seed, humanSeat: (1 - seed % 2) as 0 | 1})),
  rule: "seed modulo 5: first human flop all-in; first human flop 43% pot + 1 chip; first human turn 37% pot + 1; first human river 61% pot + 1; passive. Size constrained only by real legal bounds, shifted one chip off any exact menu match when legal. Otherwise prefer positive-probability check/call for the human's own hand; if absent choose its highest-frequency policy action. If that hand has no model column, use legal check/call. No post-failure reselection.",
});

export function p5HumanAction(view: PlayView): BridgeAction {
  if (view.phase !== "human" || !view.hand) throw new Error("Script needs a human decision");
  const h = view.hand, s = h.public, key = s.path.join(" ") || "root";
  const d = view.decisions.find(o => o.key === key), policy = d?.strategy;
  const bounds = sizedActionBounds(s), family = h.seed % 5;
  const target = ["flop", "flop", "turn", "river", "none"][family];
  const lastCard = s.events.findLastIndex(e => e.kind === "card");
  const firstHuman = !s.events.slice(lastCard + 1).some(e => e.kind === "action" && e.player === h.humanSeat);
  if (bounds && s.street === target && firstHuman) {
    let to = family === 0 ? bounds.max : Math.max(bounds.min,
      Math.min(bounds.max, Math.floor(s.pot * [1, .43, .37, .61, 0][family]) + 1));
    const matches = (n: number) => policy?.some(row => actionToken(row.action) === `${bounds.type === "bet" ? "b" : "r"}${n}`);
    if (family !== 0 && matches(to)) {
      if (to < bounds.max && !matches(to + 1)) to++;
      else if (to > bounds.min && !matches(to - 1)) to--;
    }
    return {type: bounds.type, to};
  }
  const passive: BridgeAction = {type: Math.max(...s.streetPut) > s.streetPut[h.humanSeat] ? "call" : "check"};
  if (!policy || policy.some(row => actionToken(row.action) === actionToken(passive) && row.probability > 0)) return passive;
  const best = [...policy].sort((a, b) => b.probability - a.probability)[0];
  if (!best || best.probability <= 0 || illegalActionReason(s, best.action)) throw new Error("Frozen human script has no legal supported action");
  return best.action;
}
