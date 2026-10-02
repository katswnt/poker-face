/** Supported human likelihood translation on the flop. It never changes actual chips. */
import type { BridgeAction } from "../solver/bridge/contract";
import type { HumanModelRequest } from "./hand";
import { illegalActionReason } from "./public-state";
import { pseudoHarmonicProbabilityA } from "./translation";
import { hasCompatibleAction } from "./sources/nested-river";
import { preparationKey, type NodePolicy } from "./sources/policy";

export function chooseFlopTranslation(request: HumanModelRequest, policy: NodePolicy, actual: BridgeAction, draw: number) {
  preparationKey(request);
  const p = request.publicState;
  if (p.street !== "flop" || p.toAct === request.aiSeat || policy.player !== p.toAct) throw new Error("Flop translation needs the human's parent");
  if ((actual.type !== "bet" && actual.type !== "raise") || Object.keys(actual).sort().join() !== "to,type") {
    throw new Error("Only a public sized action needs flop translation");
  }
  const illegal = illegalActionReason(p, actual); if (illegal) throw new Error("Illegal flop translation action: " + illegal);
  if (!(draw >= 0 && draw < 1)) throw new Error("Translation draw must be in [0,1)");
  const previous = Math.max(...p.streetPut), potAfterCall = p.pot + previous - p.streetPut[p.toAct!];
  const size = (action: BridgeAction) => "to" in action ? (action.to - previous) / potAfterCall : 0;
  const nonfold = policy.actions.filter(a => a.type !== "fold");
  const eligible = nonfold.filter(a => hasCompatibleAction(request, policy, a)).sort((a, b) => size(a) - size(b));
  if (!eligible.length) throw new Error("No positive compatible non-fold likelihood; a human posterior cannot be invented");
  const x = size(actual);
  let low = eligible[0], high = eligible.at(-1)!;
  if (x <= size(low)) high = low;
  else if (x >= size(high)) low = high;
  else { high = eligible.find(a => size(a) >= x)!; low = eligible[eligible.indexOf(high) - 1]; }
  const a = size(low), b = size(high), probabilityA = a === b ? 1 : pseudoHarmonicProbabilityA(a, b, x);
  const mappedTo = draw < probabilityA ? "a" as const : "b" as const;
  return { spotHash: policy.provenance.spotHash, x, a, b, probabilityA, mappedTo,
    mappedAction: structuredClone(mappedTo === "a" ? low : high), draw,
    mappingBasis: "increment-after-call" as const,
    omittedUnsupportedActions: nonfold.filter(action => !eligible.includes(action)) };
}
