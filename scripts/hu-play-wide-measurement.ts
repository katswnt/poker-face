/** Browser-safe research helpers. Never imported by the deployed Worker/page. */
import { validateBridgeSpot, type BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import type { MeasuredLiveEvent } from "./bridge-live-profile.worker";

export const WIDE_RESEARCH_LIMITS = Object.freeze({ ...LIVE_LIMITS, timeoutMs: 30 * 60_000 });

export function wideStudyHtml(assetBase: string) {
  if (!/^\/wasm\/[a-f0-9]{64}\/$/.test(assetBase)) throw new Error("Invalid study asset base");
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>P1 private full-range study</title>'
    + '<p>Private measurement harness — research only, not production admission or exact GTO.</p>'
    + `<p><a href="${assetBase}source/BUILD.txt">Exact engine source and build instructions (AGPL)</a> · `
    + `<a href="${assetBase}LICENSES.txt">Engine licenses</a></p>`
    + '<script type="module" src="/profile-page.mjs"></script></html>';
}

/** Allow only exact, prevalidated corpus requests on the private loopback study harness.
 * This bypasses the 64-hand/SPR parser gate ONLY there; the W2 memory reservation remains. */
export function createWideResearchParser(allowed: readonly string[]) {
  if (!allowed.length || allowed.length > 70 || new Set(allowed).size !== allowed.length) throw new Error("Empty, duplicate or oversized frozen allowlist");
  const checked = new Map(allowed.map(json => {
    if (new TextEncoder().encode(json).length > LIVE_LIMITS.inputBytes) throw new Error("Research input exceeds original byte cap");
    const spot = validateBridgeSpot(JSON.parse(json));
    if (spot.board.turn === null) throw new Error("Research only admits turn/river inputs");
    if (spot.ranges.some(r => r.combos.length > 1326) || spot.tree.mode !== "menu"
      || spot.solve.compression !== "off" || spot.solve.exportScope !== "first-street"
      || spot.solve.maxIterations > LIVE_LIMITS.maxIterations || spot.solve.timeoutMs > WIDE_RESEARCH_LIMITS.timeoutMs
      || spot.solve.memoryCapBytes > 4 * 1024 ** 3) throw new Error("Not a bounded full-range research input");
    return [json, spot] as const;
  }));
  return (json: string) => {
    const spot = checked.get(json);
    if (!spot) throw new Error("Request is not in the exact frozen research allowlist");
    return spot;
  };
}

export function mathProjection(result: BridgeResultV1) {
  const { timings, memory, ...math } = result; void timings; void memory;
  return { ...math, convergence: result.convergence.map(({ iteration, exploitability }) => ({ iteration, exploitability })) };
}

/** Engine clocks are integer milliseconds. These are rounding sensitivities, not CIs. */
export function timingRatio(nativeMs: number, wasmMs: number) {
  if (![nativeMs, wasmMs].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid engine timing");
  return { ratio: nativeMs > 0 ? wasmMs / nativeMs : null,
    quantizationLower: Math.max(0, wasmMs - 1) / (nativeMs + 1),
    quantizationUpper: nativeMs > 1 ? (wasmMs + 1) / (nativeMs - 1) : null };
}

/** Retain partial telemetry on failure; never turn an error/refusal into a timing pass. */
export function summarizeWideEvents(events: readonly MeasuredLiveEvent[], terminalElapsedMs: number) {
  const final = events.at(-1);
  if (!final || !["result", "error", "cancelled", "estimate"].includes(final.type)) throw new Error("Missing terminal event");
  if (!Number.isFinite(terminalElapsedMs) || terminalElapsedMs < 0) throw new Error("Invalid elapsed time");
  const estimate = events.find(e => e.type === "estimate");
  if (final.type === "estimate" && final.verdict.ok) throw new Error("Admitted estimate is not a terminal solve");
  const observations = events.flatMap(e => e.observedLinearMemoryBytes == null ? [] : [e.observedLinearMemoryBytes]);
  if (observations.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error("Invalid memory observation");
  const result = final.type === "result" ? final.result : null;
  return { status: final.type === "estimate" ? "refused" : final.type,
    error: final.type === "error" ? final.message : final.type === "estimate" ? final.verdict.reason : null,
    admitted: estimate?.type === "estimate" ? estimate.verdict.ok : null, terminalElapsedMs,
    peakLinearMemoryBytes: observations.length ? Math.max(...observations) : null,
    reservedTotalBytes: estimate?.type === "estimate" ? estimate.verdict.totalBytes : null,
    budgetBytes: estimate?.type === "estimate" ? estimate.verdict.budgetBytes : null,
    stages: events.flatMap(e => e.type === "progress" ? [{ stage: e.stage, elapsedMs: e.elapsedMs,
      linearMemoryBytes: e.observedLinearMemoryBytes ?? null }] : []),
    iterations: result?.iterations ?? null, exploitability: result?.exploitability ?? null,
    timings: result?.timings ?? null, exportedNodes: result?.counts.exportedNodes ?? null };
}
