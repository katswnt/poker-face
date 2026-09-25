// Runs the native postflop-solver bridge on one contract-v1 spot, following the flop runner
// pattern: child process, wall-clock timeout, sampled RSS budget, cancellation, and no
// partial results (the result is read only after a clean exit and a structural check).
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkBridgeResult, validateBridgeSpot, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";

export const BRIDGE_BINARY = resolve(process.env.SOLVER_BRIDGE_BIN
  ?? new URL("../native/solver-bridge/target/release/solver-bridge", import.meta.url).pathname);
/** Engine estimate excludes allocator slack, the export and the process itself. */
export const BRIDGE_RSS_HEADROOM_BYTES = 512 * 1024 ** 2;
const MAX_RESULT_BYTES = 2 * 1024 ** 3;

export interface BridgeProgress {
  readonly type: "progress";
  readonly stage: "building" | "allocating" | "solving" | "exporting";
  readonly elapsedMs: number;
  readonly iteration?: number;
  readonly exploitability?: number;
  readonly [key: string]: unknown;
}

export interface BridgeRun {
  readonly result: BridgeResultV1;
  readonly spotHash: string;
  readonly elapsedMs: number;
  readonly sampledPeakRssBytes: number;
  readonly rssLimitBytes: number;
}

export async function runBridgeSpot(input: BridgeSpotV1, options: {
  timeoutMs?: number; signal?: AbortSignal; threads?: number; rssLimitBytes?: number;
  onProgress?: (progress: BridgeProgress) => void; binary?: string;
} = {}): Promise<BridgeRun> {
  const started = performance.now();
  const spot = validateBridgeSpot(input), spotHash = hashBridgeSpot(spot);
  const timeoutMs = Math.min(options.timeoutMs ?? spot.solve.timeoutMs, spot.solve.timeoutMs + 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Bridge timeout must be a positive whole number of ms");
  const rssLimitBytes = options.rssLimitBytes ?? spot.solve.memoryCapBytes + BRIDGE_RSS_HEADROOM_BYTES;
  if (options.threads !== undefined && (!Number.isSafeInteger(options.threads) || options.threads < 1)) throw new Error("Invalid thread count");
  const binary = options.binary ?? BRIDGE_BINARY;
  if (!existsSync(binary)) throw new Error(`solver-bridge binary not found at ${binary}; run npm run build:bridge`);
  if (options.signal?.aborted) throw new Error("Bridge job cancelled before start");

  const directory = mkdtempSync(join(tmpdir(), "poker-bridge-job-"));
  const spotPath = join(directory, "spot.json"), outPath = join(directory, "result.json");
  // The bridge hashes these exact bytes, so result.spotHash must equal spotHash.
  writeFileSync(spotPath, canonicalBridgeSpotJson(spot));
  const args = ["solve", spotPath, "--out", outPath, ...(options.threads ? ["--threads", String(options.threads)] : [])];

  try {
    return await new Promise<BridgeRun>((resolveRun, reject) => {
      const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
      let settled = false, polling = false, buffered = "", lastError = "", diagnostics = "", sampledPeakRssBytes = 0;
      const cleanup = () => { clearInterval(sampler); clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); };
      const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); child.kill("SIGKILL"); reject(error); };
      const cancel = () => fail(new Error("Bridge job cancelled; no result published"));
      const timer = setTimeout(() => fail(new Error(`Bridge job timed out after ${timeoutMs} ms; no result published`)), timeoutMs);
      const sampler = setInterval(() => {
        if (settled || polling || !child.pid) return; polling = true;
        execFile("ps", ["-o", "rss=", "-p", String(child.pid)], (error, stdout) => {
          polling = false; if (settled || error) return; // The process may have just exited.
          const rss = Number(stdout.trim()) * 1024;
          if (!Number.isFinite(rss) || rss <= 0) return;
          sampledPeakRssBytes = Math.max(sampledPeakRssBytes, rss);
          if (rss > rssLimitBytes) fail(new Error(`Bridge sampled RSS ${rss} exceeds budget ${rssLimitBytes}`));
        });
      }, 200);
      options.signal?.addEventListener("abort", cancel, { once: true });
      child.on("error", fail);
      child.stderr!.on("data", data => {
        buffered += String(data);
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          let message: { type?: string; message?: string };
          try { message = JSON.parse(line); } catch { diagnostics = (diagnostics + line + "\n").slice(-4096); continue; }
          if (message.type === "error") lastError = String(message.message);
          else if (message.type === "progress") {
            try { options.onProgress?.(message as BridgeProgress); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
          }
        }
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        if (code !== 0 || signal) { fail(new Error(`solver-bridge failed (${code ?? signal}): ${lastError || diagnostics || "no message"}`)); return; }
        try {
          if (statSync(outPath).size > MAX_RESULT_BYTES) throw new Error("Bridge result exceeds 2 GiB");
          const result = checkBridgeResult(JSON.parse(readFileSync(outPath, "utf8")), spot, spotHash);
          settled = true; cleanup();
          resolveRun({ result, spotHash, elapsedMs: performance.now() - started, sampledPeakRssBytes, rssLimitBytes });
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
      if (options.signal?.aborted) cancel();
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
