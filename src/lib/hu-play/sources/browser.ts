/** Production browser path: one W2 Worker per public solve, with no Node/native fallback. */
import type { BridgeResultV1, BridgeSpotV1 } from "../../solver/bridge/contract";
import type { WasmEnvironment } from "../../solver/bridge/wasm-admission";
import type { LiveCommand, LiveEvent } from "../../solver/bridge/live/model";
import { createBrowserSolver } from "../../solver/bridge/live/browser";
import { parseLiveSpot } from "../../solver/bridge/live/admission";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import { ResolvedPolicySource } from "./resolved";

type Request = Omit<Exclude<LiveCommand, { type: "cancel" }>, "id">;
interface SolverClient { start(request: Request): number; cancel(): void; dispose(): void }
export interface BrowserResolveOptions {
  readonly assetBase: string; readonly environment: WasmEnvironment;
  readonly onEvent?: (event: LiveEvent) => void;
  /** Dependency injection for tests/harnesses; the app uses the actual W2 browser factory. */
  readonly createClient?: (emit: (event: LiveEvent) => void) => SolverClient;
}

export class BrowserPublicSolver {
  private active: { stop(error: Error): void; cancel(): void } | null = null;
  private disposed = false;
  constructor(private readonly options: BrowserResolveOptions) {}

  async solve(spot: BridgeSpotV1, signal?: AbortSignal): Promise<BridgeResultV1> {
    if (this.disposed) throw new Error("Browser play source is disposed");
    signal?.throwIfAborted();
    const spotJson = canonicalSolverJson(spot); parseLiveSpot(spotJson, "play-v1");
    this.active?.stop(new Error("Public solve superseded by a newer request"));
    return new Promise((resolve, reject) => {
      let done = false, client: SolverClient | undefined;
      const abort = () => client?.cancel();
      const finish = (error: Error | null, result?: BridgeResultV1) => {
        if (done) return; done = true;
        signal?.removeEventListener("abort", abort); client?.dispose();
        if (this.active === current) this.active = null;
        if (error) reject(error); else resolve(result!);
      };
      const current = { stop: (error: Error) => finish(error), cancel: abort };
      this.active = current;
      try {
        client = (this.options.createClient ?? createBrowserSolver)(event => {
          if (done) return;
          try {
            this.options.onEvent?.(event);
            if (event.type === "error") finish(new Error(event.message));
            else if (event.type === "cancelled") finish(new Error("Public solve cancelled; no playing policy published"));
            else if (event.type === "estimate" && !event.verdict.ok) finish(new Error(event.verdict.reason));
            else if (event.type === "result") finish(null, event.result);
          } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        });
        signal?.addEventListener("abort", abort, { once: true });
        client.start({ type: "solve", profile: "play-v1", spotJson,
          assetBase: this.options.assetBase, environment: this.options.environment });
        if (signal?.aborted) abort();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  cancel(): void { this.active?.cancel(); }
  dispose(): void { this.disposed = true; this.active?.stop(new Error("Browser play source disposed")); }
}

export class BrowserResolveSource extends ResolvedPolicySource {
  private readonly runner: BrowserPublicSolver;
  constructor(options: BrowserResolveOptions) {
    const runner = new BrowserPublicSolver(options); super((spot, signal) => runner.solve(spot, signal)); this.runner = runner;
  }
  cancel(): void { this.runner.cancel(); }
  dispose(): void { this.runner.dispose(); }
}
