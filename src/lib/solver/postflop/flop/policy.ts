import type { BehavioralStrategy } from "../../toy/game";
import { FLOP_PLAYER, type VectorFlop } from "./compiled";
import { flopActions, flopInformationKey } from "./rules";
export function validateFlopPolicy(game: VectorFlop, policy: Float64Array) {
  if (!(policy instanceof Float64Array) || policy.length !== game.preflight.actionSlots) throw new Error("Flop policy dimensions differ");
  for (let n = 0; n < game.kinds.length; n++) {
    if (game.kinds[n] !== FLOP_PLAYER) continue;
    const own = game.ranges.boards[game.boards[n]].view.players[game.players[n]];
    for (let h = 0; h < own.hands.length; h++) {
      const start = game.actionStarts[n] + 2 * h, a = policy[start], b = policy[start + 1];
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a > 1 || b > 1
        || (own.compatibleCounts[h] ? Math.abs(a + b - 1) > 1e-12 : a !== 0 || b !== 0)) throw new Error("Flop policy contains invalid probabilities or padding");
    }
  }
}

/** Oracle-only string mapping. Wide policies stay numeric. */
export function decodeFlopPolicy(game: VectorFlop, policy: Float64Array): BehavioralStrategy<"check" | "bet" | "fold" | "call"> {
  if (game.informationSets > 250000) throw new Error("Readable flop policy adapter exceeds 250,000 information sets");
  validateFlopPolicy(game, policy);
  const result = new Map();
  for (let n = 0; n < game.kinds.length; n++) {
    if (game.kinds[n] !== FLOP_PLAYER) continue;
    const p = game.players[n] as 0 | 1, own = game.ranges.boards[game.boards[n]].view.players[p];
    for (let h = 0; h < own.hands.length; h++) {
      if (!own.compatibleCounts[h]) continue;
      const s = game.actionStarts[n] + 2 * h;
      result.set(flopInformationKey(game.request, game.states[n], p, own.hands[h]), { actions: flopActions(game.states[n]), probabilities: [policy[s], policy[s + 1]] });
    }
  }
  return result;
}
export function encodeFlopPolicy(game: VectorFlop, policy: BehavioralStrategy<"check" | "bet" | "fold" | "call">) {
  if (game.informationSets > 250000 || policy.size !== game.informationSets) throw new Error("Readable flop policy dimensions differ");
  const result = new Float64Array(game.preflight.actionSlots);
  for (let n = 0; n < game.kinds.length; n++) {
    if (game.kinds[n] !== FLOP_PLAYER) continue;
    const p = game.players[n] as 0 | 1, own = game.ranges.boards[game.boards[n]].view.players[p];
    for (let h = 0; h < own.hands.length; h++) {
      if (!own.compatibleCounts[h]) continue;
      const key = flopInformationKey(game.request, game.states[n], p, own.hands[h]), row = policy.get(key), actions = flopActions(game.states[n]);
      if (!row || row.actions.join() !== actions.join() || row.probabilities.length !== 2) throw new Error("Flop policy information/action mismatch");
      result.set(row.probabilities, game.actionStarts[n] + 2 * h);
    }
  }
  validateFlopPolicy(game, result); return result;
}
