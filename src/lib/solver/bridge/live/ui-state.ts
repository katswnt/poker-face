import type { BridgeResultV1, BridgeSpotV1 } from "../contract";
import type { LiveEngine, LiveEvent, LivePreview, LiveStatus } from "./model";
import { rootSummary, type RootSummary, type SavedLiveExample } from "./view";

export interface DisplayedResult { spot: BridgeSpotV1; summary: RootSummary; source: "saved" | "live";
  elapsedMs: number | null; provenance: LiveEngine["provenance"] | null; raw: BridgeResultV1 | null }
export interface LiveUiState {
  busy: "estimate" | "solve" | "cancelling" | null; elapsedMs: number; message: string; error: string | null;
  pending: { spot: BridgeSpotV1; json: string; mode: "estimate" | "solve" } | null;
  prepared: { spot: BridgeSpotV1; json: string; event: Extract<LiveEvent, { type: "estimate" }> } | null;
  progress: LiveStatus | null; preview: LivePreview | null; displayed: DisplayedResult;
}
export const displayExample = (example: SavedLiveExample): DisplayedResult => ({ spot: example.spot, summary: example.summary,
  source: "saved", elapsedMs: null, provenance: null, raw: null });
export const initialLiveUi = (example: SavedLiveExample): LiveUiState => ({ busy: null, elapsedMs: 0,
  message: "Saved example ready. No live solve has run.", error: null, pending: null, prepared: null,
  progress: null, preview: null, displayed: displayExample(example) });
type Action = { type: "edit" } | { type: "example"; example: SavedLiveExample } | { type: "tick"; elapsedMs: number }
  | { type: "cancel" } | { type: "start"; spot: BridgeSpotV1; json: string; mode: "estimate" | "solve" }
  | { type: "event"; event: LiveEvent };
const stages = { loading: "Loading the checked solver…", building: "Building game tables and estimating the result size…",
  allocating: "Allocating admitted strategy storage…", solving: "Solving in the background. You can cancel.",
  exporting: "Writing the completed strategy…", checking: "Checking the result before displaying it…" };
export function liveUiReducer(state: LiveUiState, action: Action): LiveUiState {
  switch (action.type) {
    case "edit": return { ...state, prepared: null, error: null, progress: null, preview: null,
      message: "Inputs changed. Check size again. The displayed result has not changed." };
    case "example": return { ...state, displayed: displayExample(action.example), message: "Saved example ready. This does not change your inputs." };
    case "tick": return state.busy ? { ...state, elapsedMs: action.elapsedMs } : state;
    case "cancel": return { ...state, busy: "cancelling", preview: null, message: "Cancelling. No partial result will be published." };
    case "start": return { ...state, busy: action.mode, pending: action, prepared: action.mode === "estimate" ? null : state.prepared,
      elapsedMs: 0, error: null, progress: null, preview: null, message: "Starting a fresh background Worker…",
      displayed: { ...state.displayed, raw: null } }; // drop any previous large downloadable tree
    case "event": {
      const event = action.event;
      if (!state.pending || !state.busy) return state;
      if (state.busy === "cancelling" && event.type !== "cancelled" && event.type !== "error") return state;
      if (event.type === "progress") return { ...state, progress: event.status, message: stages[event.stage] };
      if (event.type === "preview") return { ...state, preview: event.preview };
      if (event.type === "estimate") {
        const terminal = state.pending.mode === "estimate" || !event.verdict.ok;
        return { ...state, prepared: { spot: state.pending.spot, json: state.pending.json, event },
          busy: terminal ? null : state.busy, pending: terminal ? null : state.pending,
          message: event.verdict.ok ? "Size checked. Within the conservative browser reservation." : "Too large for this browser policy. Nothing was solved." };
      }
      if (event.type === "result") return { ...state, busy: null, pending: null, preview: null, elapsedMs: event.elapsedMs,
        displayed: { spot: state.pending.spot, summary: rootSummary(event.result), source: "live", elapsedMs: event.elapsedMs, provenance: event.provenance, raw: event.result },
        message: event.result.exploitability.reached ? "Solve complete. The requested quality target was reached." : "Iteration limit reached. The requested quality target was not reached." };
      if (event.type === "cancelled") return { ...state, busy: null, pending: null, preview: null, elapsedMs: event.elapsedMs,
        message: "Cancelled. No new result was saved; the previous completed result remains below." };
      return { ...state, busy: null, pending: null, preview: null, error: event.message,
        message: "The background task stopped. Check the error and retry, or use the saved example." };
    }
  }
}
