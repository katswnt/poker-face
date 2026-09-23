import { createRiverLabRuntime } from "./runtime";
import { riverComparisonPreflight } from "./comparison-input";
import { sameComparisonDecision, type RiverComparisonCommand, type RiverComparisonEvent } from "./comparison";
import { BROWSER_STATE_LIMIT, type RiverLabDecision, type RiverLabResult } from "./model";

export function createRiverComparisonRuntime(host: {
  emit(event: RiverComparisonEvent): void; now(): number; yield(): Promise<void>;
}) {
  let active: { id: number; cancelled: boolean; cancel: () => void } | null = null;
  async function handle(command: RiverComparisonCommand): Promise<void> {
    if (command.type === "cancel") {
      if (active?.id === command.id) { active.cancelled = true; active.cancel(); }
      return;
    }
    if (active) {
      host.emit({ type: "error", id: command.id, message: "Cancel the running comparison before starting another task." });
      return;
    }
    const start = host.now();
    const run = { id: command.id, cancelled: false, cancel: () => {} };
    active = run;
    let iterations = 0;
    const cancelled = () => {
      if (!run.cancelled) return false;
      host.emit({ type: "cancelled", id: run.id, iterations, elapsedMs: host.now() - start });
      return true;
    };
    try {
      if (command.type === "solve") host.emit({ type: "progress", id: run.id, phase: "preparing", iterations: 0,
        total: Number(command.anchor.input.iterations), elapsedMs: 0, quality: null });
      await host.yield();
      if (cancelled()) return;
      const { input, preflight } = riverComparisonPreflight(command.anchor, command.change);
      if (command.type === "preflight") {
        host.emit({ type: "preflight", id: run.id, preflight }); return;
      }
      if (!preflight.allowed) throw new Error(`Together these games have ${preflight.totalStates.toLocaleString("en-US")} equivalent states. The comparison limit is ${BROWSER_STATE_LIMIT.toLocaleString("en-US")}. Pin a smaller game or reduce the change.`);
      // Reuse the real resumable solve. No CFR, grade, or teaching workspace exists before the pair limit check.
      const output: { result: RiverLabResult | null; decision: RiverLabDecision | null; error: string | null } = {
        result: null, decision: null, error: null,
      };
      const runtime = createRiverLabRuntime({ now: host.now, yield: host.yield, emit: event => {
        if (event.type === "progress") {
          iterations = event.iterations;
          host.emit({ ...event, elapsedMs: host.now() - start });
        } else if (event.type === "error") output.error = Object.values(event.errors).join(" ");
        else if (event.type === "result") output.result = event.result;
        else if (event.type === "decision") output.decision = event.decision;
      } });
      run.cancel = () => { void runtime.handle({ type: "cancel", id: run.id }); };
      await runtime.handle({ type: "solve", id: run.id, input });
      if (cancelled()) return;
      if (output.error) throw new Error(output.error);
      if (!output.result) throw new Error("The changed solve did not produce a complete result.");
      const match = output.result.decisions.find(decision => sameComparisonDecision(command.anchor.decision, decision));
      // Await completion above before inspection: the underlying solver must first release its active task.
      await host.yield();
      if (cancelled()) return;
      if (match) await runtime.handle({ type: "inspect", id: run.id, source: "custom", key: match.informationSet });
      if (output.error) throw new Error(output.error);
      if (match && !output.decision) throw new Error("The matching decision could not be inspected.");
      await host.yield();
      if (cancelled()) return;
      host.emit({ type: "result", id: run.id, comparison: { change: { ...command.change },
        result: { ...output.result, elapsedMs: host.now() - start }, decision: output.decision } });
    } catch (error) {
      host.emit({ type: "error", id: run.id, message: error instanceof Error ? error.message : "The comparison failed. Try a smaller change." });
    } finally { if (active === run) active = null; }
  }
  return { handle };
}
