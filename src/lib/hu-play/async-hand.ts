/** Async shell around the P0 pure reducer. Solving sees public requests, never the deal. */
import type { BridgeAction } from "../solver/bridge/contract";
import { advanceChance, applyAiDecision, applyHumanActionOnly, type DecisionSource, type HeadsUpHandState,
  type HumanModelRequest } from "./hand";

export interface AsyncDecisionSource extends DecisionSource {
  prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void>;
}
export interface AdvanceOutcome {
  readonly state: HeadsUpHandState;
  readonly status: "human" | "complete" | "cancelled" | "unavailable";
  readonly reason?: string;
}

export function preparationRequest(state: HeadsUpHandState): HumanModelRequest {
  return { publicState: state.public, aiSeat: state.config.aiSeat, ranges: state.ranges };
}

async function prepare(state: HeadsUpHandState, source: AsyncDecisionSource, signal?: AbortSignal): Promise<AdvanceOutcome | null> {
  try {
    signal?.throwIfAborted();
    await source.prepare(preparationRequest(state), signal);
    signal?.throwIfAborted();
    return null;
  } catch (error) {
    return { state, status: signal?.aborted ? "cancelled" : "unavailable",
      reason: signal?.aborted ? "Thinking cancelled. The pending decision can be retried."
        : error instanceof Error ? error.message : String(error) };
  }
}

/** Returns the latest valid state even if a subsequent public decision could not be prepared. */
export async function advanceAsync(state: HeadsUpHandState, source: AsyncDecisionSource, signal?: AbortSignal): Promise<AdvanceOutcome> {
  let current = state;
  for (let guard = 0; guard < 200; guard++) {
    if (signal?.aborted) return { state: current, status: "cancelled", reason: "Thinking cancelled. Retry this decision." };
    current = advanceChance(current);
    if (current.result) return { state: current, status: "complete" };
    const failed = await prepare(current, source, signal); if (failed) return failed;
    if (current.public.toAct !== current.config.aiSeat) return { state: current, status: "human" };
    current = applyAiDecision(current, source);
  }
  throw new Error("Asynchronous hand exceeded the reducer's action bound");
}

export async function applyHumanActionAsync(state: HeadsUpHandState, action: BridgeAction,
  source: AsyncDecisionSource, signal?: AbortSignal): Promise<AdvanceOutcome> {
  if (state.result || state.public.status !== "betting" || state.public.toAct === state.config.aiSeat) {
    throw new Error("It is not the human's turn");
  }
  const failed = await prepare(state, source, signal); if (failed) return failed;
  return advanceAsync(applyHumanActionOnly(state, action, source), source, signal);
}
