/** Node-only test/development source. Never imported by the browser source or a route. */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BRIDGE_BINARY, runBridgeSpot, type BridgeRun } from "../../../../scripts/bridge-runner";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../../solver/bridge/contract-node";
import type { BridgeSpotV1 } from "../../solver/bridge/contract";
import { admitBrowserSolve, parseLiveEstimate, parseLiveSpot } from "../../solver/bridge/live/admission";
import type { LiveEstimate, LiveVerdict } from "../../solver/bridge/live/model";
import type { WasmEnvironment } from "../../solver/bridge/wasm-admission";
import { ResolvedPolicySource } from "./resolved";

const execute = promisify(execFile);
export interface NativeResolveOptions {
  readonly binary?: string;
  readonly environment?: WasmEnvironment;
  readonly onEstimate?: (spot: BridgeSpotV1, estimate: LiveEstimate, verdict: LiveVerdict) => void;
  readonly onResult?: (spot: BridgeSpotV1, run: BridgeRun) => void;
}

/** Estimate only; cancellation/timeout kill this process before any solve is started. */
export async function estimatePlayNative(spot: BridgeSpotV1, signal?: AbortSignal, binary = BRIDGE_BINARY,
  profile: "play-v1" | "play-river-v1" | "play-turn-v1" = "play-v1"): Promise<LiveEstimate> {
  signal?.throwIfAborted();
  const json = canonicalBridgeSpotJson(spot); parseLiveSpot(json, profile);
  const directory = mkdtempSync(join(tmpdir(), "poker-play-estimate-")), path = join(directory, "spot.json");
  try {
    writeFileSync(path, json, { flag: "wx" });
    const { stdout } = await execute(binary, ["estimate", path], { signal, timeout: Math.min(60000, spot.solve.timeoutMs),
      maxBuffer: 1024 ** 2, env: { ...process.env, RAYON_NUM_THREADS: "1" } });
    signal?.throwIfAborted();
    return parseLiveEstimate(stdout, spot, hashBridgeSpot(spot));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export class NativeResolveSource extends ResolvedPolicySource {
  constructor(options: NativeResolveOptions = {}) {
    super((spot, signal) => solveNativePlay(spot, options, signal));
  }
}

/** Raw bounded run; the policy adapters separately enforce reached quality/precision.
 * Native has no WASM high-water observation: its zero below is NOT a browser certificate.
 */
export async function solveNativePlay(spot: BridgeSpotV1, options: NativeResolveOptions = {}, signal?: AbortSignal,
  profile: "play-v1" | "play-river-v1" | "play-turn-v1" = "play-v1") {
  const estimate = await estimatePlayNative(spot, signal, options.binary, profile);
  const verdict = admitBrowserSolve(estimate, options.environment ?? { profile: "unknown" }, 0, profile);
  options.onEstimate?.(spot, estimate, verdict);
  if (!verdict.ok) throw new Error(verdict.reason);
  const run = await runBridgeSpot(spot, { threads: 1, signal, binary: options.binary });
  signal?.throwIfAborted(); options.onResult?.(spot, run);
  return run.result;
}
