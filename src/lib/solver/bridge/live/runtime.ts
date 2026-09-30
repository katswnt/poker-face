import { checkBridgeResult, type BridgeSpotV1 } from "../contract";
import { canonicalSolverJson } from "../../toy/artifact";
import { admitBrowserSolve, LIVE_LIMITS, parseLiveEstimate, parseLiveSpot } from "./admission";
import type { LiveCommand, LiveEngine, LiveEvent, LivePreview, LiveSession, LiveStatus } from "./model";

export interface LiveHost {
  emit(event: LiveEvent): void;
  now(): number;
  yield(): Promise<void>;
  hash(bytes: Uint8Array): Promise<string>;
  load(assetBase: string): Promise<LiveEngine>;
  close(): void;
}

export function parseLiveStatus(json: string, spot: BridgeSpotV1, previous = 0): LiveStatus {
  const s: LiveStatus = JSON.parse(json);
  if (!s || !Number.isSafeInteger(s.iterations) || s.iterations < previous || s.iterations > spot.solve.maxIterations
    || s.maxIterations !== spot.solve.maxIterations || s.target !== spot.startingPot * spot.solve.targetExploitabilityPctPot / 100
    || !Number.isSafeInteger(s.measuredAtIteration) || s.measuredAtIteration! < 0 || s.measuredAtIteration! > s.iterations
    || typeof s.exploitability !== "number" || !Number.isFinite(s.exploitability)
    || s.allocated !== true || typeof s.done !== "boolean" || s.failed !== false
    || !Number.isFinite(s.elapsedMs) || s.elapsedMs < 0
    || !Number.isSafeInteger(s.linearMemoryBytes) || s.linearMemoryBytes <= 0) throw new Error("Malformed solver status.");
  if (s.done !== (s.exploitability! <= s.target || s.iterations === s.maxIterations)
    || (s.done && s.measuredAtIteration !== s.iterations)) throw new Error("Inconsistent solver checkpoint.");
  return s;
}

function parsePreview(json: string, spot: BridgeSpotV1, iteration: number): LivePreview {
  const p: LivePreview = JSON.parse(json);
  if (!p || p.type !== "preview" || p.final !== false || p.iteration !== iteration
    || !Array.isArray(p.hands) || p.hands.join() !== spot.ranges[0].combos.map(h => h.combo).join()
    || !Array.isArray(p.engineActions) || !p.engineActions.length || p.engineActions.some(a => typeof a !== "string")
    || !Array.isArray(p.strategy) || p.strategy.length !== p.engineActions.length
    || p.strategy.some(row => !Array.isArray(row) || row.length !== p.hands.length
      || row.some(n => !Number.isFinite(n) || n < -1e-6 || n > 1 + 1e-6))) throw new Error("Malformed non-final preview.");
  for (let h = 0; h < p.hands.length; h++) if (Math.abs(p.strategy.reduce((s, row) => s + row[h], 0) - 1) > 1e-4) {
    throw new Error("Preview probabilities do not sum to one.");
  }
  return p;
}

/** One job per Worker/instance, including estimates. No restarts inside a solve. */
export function createLiveRuntime(host: LiveHost) {
  let used = false, active: number | null = null, cancelled = false;
  async function run(command: Exclude<LiveCommand, { type: "cancel" }>) {
    const { id } = command, started = host.now();
    let session: LiveSession | undefined, safeToFree = true;
    const elapsed = () => Math.max(0, host.now() - started);
    const emit = (e: LiveEvent) => { if (!cancelled) host.emit(e); };
    const stage = (stage: Extract<LiveEvent, { type: "progress" }>["stage"], status: LiveStatus | null = null) =>
      emit({ type: "progress", id, stage, status, elapsedMs: elapsed() });
    let timeout: number = LIVE_LIMITS.timeoutMs;
    const check = () => {
      if (cancelled) throw new Error("cancelled");
      if (elapsed() > timeout) throw new Error("Browser solve timed out; no result published.");
    };
    const pause = async () => { await host.yield(); check(); };
    // Any exception inside WASM may be a trap/abort. Never call back into that instance.
    const wasm = <T,>(f: () => T): T => { try { return f(); } catch (error) { safeToFree = false; throw error; } };
    try {
      const spot = parseLiveSpot(command.spotJson); timeout = spot.solve.timeoutMs;
      const bytes = new TextEncoder().encode(canonicalSolverJson(spot)), hash = await host.hash(bytes); check();
      stage("loading"); const engine = await host.load(command.assetBase); check();
      stage("building"); await pause();
      session = wasm(() => engine.create(bytes)); check();
      const estimate = parseLiveEstimate(wasm(() => session!.estimate()), spot, hash);
      const verdict = admitBrowserSolve(estimate, command.environment, engine.memoryBytes());
      await pause(); emit({ type: "estimate", id, estimate, verdict, provenance: engine.provenance });
      if (command.type === "estimate" || !verdict.ok) return;
      const memoryCheck = () => {
        if (engine.memoryBytes() > verdict.budgetBytes) throw new Error("WASM memory exceeded the browser budget; job discarded.");
      };
      stage("allocating"); await pause();
      let status = parseLiveStatus(wasm(() => session!.allocate()), spot);
      memoryCheck(); check(); stage("solving", status);
      let chunk = 1, previewAt = -Infinity;
      while (!status.done) {
        await pause(); const before = host.now(), previous = status.iterations;
        status = parseLiveStatus(wasm(() => session!.step(chunk)), spot, previous);
        if (status.iterations <= previous || status.iterations > previous + chunk) throw new Error("Solver did not complete the requested iteration chunk.");
        const duration = Math.max(1, host.now() - before);
        chunk = Math.max(1, Math.min(LIVE_LIMITS.maxChunkIterations, Math.floor(chunk * LIVE_LIMITS.chunkMs / duration)));
        memoryCheck(); check(); stage("solving", status);
        if (host.now() - previewAt >= LIVE_LIMITS.previewMs) {
          const preview = parsePreview(wasm(() => session!.root_strategy()), spot, status.iterations);
          check(); emit({ type: "preview", id, preview }); previewAt = host.now();
        }
      }
      stage("exporting", status); await pause();
      const json = wasm(() => session!.finish()); memoryCheck(); check();
      if (json.length > estimate.estimateExport.jsonBytesUpperBound
        || new TextEncoder().encode(json).length > estimate.estimateExport.jsonBytesUpperBound) throw new Error("Export exceeded its reservation; result discarded.");
      stage("checking", status); await pause();
      const result = checkBridgeResult(JSON.parse(json), spot, hash);
      if (result.engine.precision !== "float32" || result.engine.threads !== 1 || result.engine.algorithm !== "discounted-cfr"
        || result.iterations !== status.iterations || result.exploitability.chips !== status.exploitability
        || result.counts.exportedNodes !== result.tree.length || result.tree.length > estimate.estimateExport.nodes
        || result.slices !== undefined) throw new Error("Final result does not match the completed session.");
      // A cancellation queued during synchronous export/check must beat result publication.
      await pause(); emit({ type: "result", id, result, elapsedMs: elapsed(), provenance: engine.provenance });
    } catch (error) {
      if (!cancelled) host.emit({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (safeToFree && session) { try { session.free(); } catch { /* instance will be destroyed */ } }
      if (cancelled) host.emit({ type: "cancelled", id, elapsedMs: elapsed(), hard: false });
      active = null; host.close();
    }
  }
  return {
    async handle(command: LiveCommand): Promise<void> {
      if (!command || !Number.isSafeInteger(command.id) || command.id < 1) return;
      if (command.type === "cancel") { if (command.id === active) cancelled = true; return; }
      if (command.type !== "estimate" && command.type !== "solve") return;
      if (used) return; // a single-use instance can never resume/reuse a retired session
      used = true; active = command.id; await run(command);
    },
  };
}
