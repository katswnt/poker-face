/** Translate a human likelihood, never the real pot. A subsequent bounded solve prices the
 * actual action. Zero-compatible-support references cannot define a posterior and are excluded.
 */
import type { BridgeAction } from "../solver/bridge/contract";
import type { HumanModelRequest } from "./hand";
import { illegalActionReason } from "./public-state";
import { pseudoHarmonicProbabilityA } from "./translation";
import { preparationKey, type NodePolicy } from "./sources/policy";
import { hasCompatibleAction } from "./sources/nested-river";

export function chooseTurnTranslation(request: HumanModelRequest, policy: NodePolicy, actual: BridgeAction, draw: number) {
  preparationKey(request);
  const p = request.publicState;
  if (p.street !== "turn" || p.toAct === request.aiSeat || policy.player !== p.toAct) throw new Error("Translation needs the human's turn parent");
  if (actual.type !== "bet" && actual.type !== "raise") throw new Error("Only sized actions need turn translation");
  if (Object.keys(actual).sort().join() !== "to,type") throw new Error("Unexpected actual-action fields");
  const illegal = illegalActionReason(p, actual); if (illegal) throw new Error(`Illegal translation action: ${illegal}`);
  if (!(draw >= 0 && draw < 1)) throw new Error("Translation draw must be in [0,1)");
  const previous = Math.max(...p.streetPut), potAfterCall = p.pot + previous - p.streetPut[p.toAct!];
  const size = (a: BridgeAction) => "to" in a ? (a.to - previous) / potAfterCall : 0;
  const eligible = policy.actions.filter(a => a.type !== "fold" && hasCompatibleAction(request, policy, a)).sort((a, b) => size(a) - size(b));
  if (!eligible.length) throw new Error("No positive-support non-fold translation exists; no human posterior can be invented");
  const x = size(actual);
  let low = eligible[0], high = eligible.at(-1)!;
  if (x <= size(low)) high = low;
  else if (x >= size(high)) low = high;
  else {
    high = eligible.find(a => size(a) >= x)!;
    low = eligible[eligible.indexOf(high) - 1];
  }
  const a = size(low), b = size(high), probabilityA = a === b ? 1 : pseudoHarmonicProbabilityA(a, b, x);
  const mappedTo = draw < probabilityA ? "a" as const : "b" as const;
  const spotHash = policy.provenance.source === "translation" && policy.provenance.responseSolve
    ? policy.provenance.responseSolve.spotHash : policy.provenance.spotHash;
  return { spotHash, x, a, b, probabilityA, mappedTo,
    mappedAction: mappedTo === "a" ? low : high, draw, mappingBasis: "increment-after-call" as const,
    omittedUnsupportedActions: policy.actions.filter(action => action.type !== "fold" && !hasCompatibleAction(request, policy, action)) };
}
