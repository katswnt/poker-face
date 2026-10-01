/** P2+ public preparation boundary. No private card is passed to a policy or Worker. */
import type { BridgeAction } from "../solver/bridge/contract";
import { advanceAsync, preparationRequest, type AdvanceOutcome, type AsyncDecisionSource } from "./async-hand";
import { applyHumanActionOnly, type HeadsUpHandState, type HumanModelRequest } from "./hand";
import { illegalActionReason } from "./public-state";

export interface PlayDecisionSource extends AsyncDecisionSource {
  prepareHumanAction(request: HumanModelRequest, action: BridgeAction, signal?: AbortSignal): Promise<unknown>;
}

/** Resolve the prospective action first. Cancellation/refusal cannot spend the human's chips
 * or multiply their likelihood. The pure reducer commits both once after preparation succeeds.
 */
export async function applyPlayHumanActionAsync(state: HeadsUpHandState, action: BridgeAction,
  source: PlayDecisionSource, signal?: AbortSignal): Promise<AdvanceOutcome> {
  if (state.result || state.public.status !== "betting" || state.public.toAct === state.config.aiSeat) throw new Error("It is not the human's turn");
  const illegal = illegalActionReason(state.public, action); if (illegal) throw new Error(illegal);
  try {
    signal?.throwIfAborted();
    await source.prepareHumanAction(preparationRequest(state), action, signal);
    signal?.throwIfAborted();
  } catch (e) {
    return { state, status: signal?.aborted ? "cancelled" : "unavailable",
      reason: signal?.aborted ? "Thinking cancelled before your bet was placed. Retry this decision."
        : e instanceof Error ? e.message : String(e) };
  }
  return advanceAsync(applyHumanActionOnly(state, action, source), source, signal);
}
