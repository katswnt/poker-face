import { createFactorizedRiverCfrSession } from "../factorized/cfr";
import { compileFactorizedRiverGame } from "../factorized/game";
import { compileFactorizedRiverScorekeeper, gradeFactorizedRiverStrategy } from "../factorized/scorekeeper";
import { riverLabExample } from "./example";
import { RiverLabInputError, riverLabPreflight } from "./input";
import { AVERAGING_DELAY, BROWSER_STATE_LIMIT, type RiverLabCommand, type RiverLabEvent,
  type RiverLabQuality, type RiverLabResult } from "./model";
import { createRiverLabContext, inspectRiverLabDecision, riverLabDecisionMenu, type RiverLabContext } from "./teaching";

export interface RiverLabRuntimeHost {
  emit(event: RiverLabEvent): void;
  now(): number;
  yield(): Promise<void>;
}

/** Small worker boundary; the injected scheduler makes cancellation and chunking testable. */
export function createRiverLabRuntime(host: RiverLabRuntimeHost) {
  let active: { id: number; cancelled: boolean } | null = null;
  let custom: RiverLabContext | null = null;
  let example: RiverLabContext | null = null;

  async function handle(command: RiverLabCommand): Promise<void> {
    if (command.type === "cancel") {
      if (active?.id === command.id) active.cancelled = true;
      return;
    }
    if (active) {
      host.emit({ type: "error", id: command.id, errors: { form: "Cancel the running solve before starting another task." } });
      return;
    }
    const start = host.now();
    try {
      if (command.type === "inspect") {
        if (command.source === "example") example ??= riverLabExample().context;
        const context = command.source === "example" ? example : custom;
        if (!context) throw new Error("Run a custom solve before inspecting it.");
        host.emit({ type: "decision", id: command.id, decision: inspectRiverLabDecision(context, command.key) });
        return;
      }
      if (command.type === "preflight") {
        host.emit({ type: "preflight", id: command.id, preflight: riverLabPreflight(command.input).preflight });
        return;
      }
      const run = { id: command.id, cancelled: false };
      active = run;
      let completed = 0;
      let quality: RiverLabQuality | null = null;
      const progress = (phase: Extract<RiverLabEvent, { type: "progress" }>["phase"], total: number) => {
        host.emit({ type: "progress", id: run.id, phase, iterations: completed, total,
          elapsedMs: host.now() - start, quality });
      };
      const cancelled = () => {
        if (!run.cancelled) return false;
        host.emit({ type: "cancelled", id: run.id, iterations: completed, elapsedMs: host.now() - start });
        return true;
      };
      progress("preparing", Number(command.input.iterations));
      await host.yield();
      if (cancelled()) return;
      const { prepared, request, iterations, preflight } = riverLabPreflight(command.input);
      if (!preflight.allowed) {
        throw new RiverLabInputError({ form: `This game has ${preflight.counts.projectedFullStates.toLocaleString("en-US")} equivalent states. The browser limit is ${BROWSER_STATE_LIMIT.toLocaleString("en-US")}. Use smaller ranges or fewer sizes, or the local v3 script.` });
      }
      // Enforced before allocating solver, scorekeeper, or teaching state, including direct commands.
      const compiled = compileFactorizedRiverGame(prepared.game);
      const scorekeeper = compileFactorizedRiverScorekeeper(compiled);
      const session = createFactorizedRiverCfrSession(compiled,
        { iterations, algorithm: "cfr-plus", averagingDelay: AVERAGING_DELAY });
      let nextGrade = 100;
      while (!session.done) {
        await host.yield();
        if (cancelled()) return;
        const chunkStart = host.now();
        let chunk = 0;
        do {
          session.advance(1);
          chunk += 1;
        } while (!session.done && chunk < 16 && host.now() - chunkStart < 16);
        completed = session.iterations;
        progress("solving", iterations);
        if (completed >= nextGrade || session.done) {
          progress("grading", iterations);
          await host.yield();
          if (cancelled()) return;
          const grade = gradeFactorizedRiverStrategy(scorekeeper, session.snapshot().averageStrategy);
          quality = { iteration: completed, value: grade.value, gains: grade.gains, exploitability: grade.exploitability };
          nextGrade = completed + 100;
          progress("solving", iterations);
        }
      }
      progress("explaining", iterations);
      await host.yield();
      if (cancelled()) return;
      const context = createRiverLabContext(prepared.game, session.snapshot().averageStrategy);
      // Yield once more so a queued cancellation cannot accidentally publish a completed result.
      await host.yield();
      if (cancelled()) return;
      if (!quality) throw new Error("Missing independent grade.");
      const result: RiverLabResult = {
        source: "custom", request, preflight, quality, elapsedMs: host.now() - start,
        decisions: riverLabDecisionMenu(context.decisions),
        initialDecision: inspectRiverLabDecision(context, context.decisions.find(decision => !decision.offPath)!.informationSet),
        provenance: null,
      };
      custom = context;
      host.emit({ type: "result", id: run.id, result });
    } catch (error) {
      host.emit({ type: "error", id: command.id, errors: error instanceof RiverLabInputError
        ? error.errors : { form: error instanceof Error ? error.message : "The river task failed. Try the small example." } });
    } finally {
      if (active?.id === command.id) active = null;
    }
  }
  return { handle };
}
