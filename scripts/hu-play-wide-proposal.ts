/** Research-only candidate. The deployed client/Worker do not import this module. */
import { validateBridgeSpot, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { LEAN_SRP_TREE } from "../src/lib/solver/bridge/fixtures";
import { admitBrowserSolve, LIVE_LIMITS, parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";
import type { LiveEstimate } from "../src/lib/solver/bridge/live/model";
import type { WasmEnvironment } from "../src/lib/solver/bridge/wasm-admission";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

export const PLAY_PROPOSAL = Object.freeze({ version: 1, productionEnabled: false, scope: "lean-srp-street-roots-only",
  rangeHands: 640, stackPotRatio: 18, engineBytes: 32 * 1024 ** 2, exportBytes: 16 * 1024 ** 2,
  jsonBytes: 2 * 1024 ** 2, desktopBudgetBytes: 256 * 1024 ** 2, mobileBudgetBytes: 192 * 1024 ** 2,
  fixedOverheadBytes: LIVE_LIMITS.overheadBytes, timeoutMs: LIVE_LIMITS.timeoutMs, maxIterations: 1000 });

export function assessPlayProposal(input: BridgeSpotV1, estimate: LiveEstimate, preflightMemoryBytes: number, env: WasmEnvironment) {
  const spot = validateBridgeSpot(input);
  if (!spot.board.turn || spot.effectiveStack / spot.startingPot > PLAY_PROPOSAL.stackPotRatio) throw new Error("Proposal requires turn/river and stack/pot ≤18");
  if (spot.ranges.some(r => r.combos.length > PLAY_PROPOSAL.rangeHands)) throw new Error("Proposal range cap exceeded");
  if (spot.solve.compression !== "off" || spot.solve.exportScope !== "first-street"
    || spot.solve.maxIterations > PLAY_PROPOSAL.maxIterations || spot.solve.timeoutMs > PLAY_PROPOSAL.timeoutMs) throw new Error("Proposal requires bounded float32 first-street solving");
  const tree = { ...LEAN_SRP_TREE, flop: null, turn: spot.board.river ? null : LEAN_SRP_TREE.turn };
  if (canonicalSolverJson(spot.tree) !== canonicalSolverJson(tree)) throw new Error("Proposal accepts only the unchanged lean menu");
  if (new TextEncoder().encode(canonicalSolverJson(spot)).length > LIVE_LIMITS.inputBytes) throw new Error("Proposal input byte cap exceeded");
  const checked = parseLiveEstimate(JSON.stringify(estimate), spot, hashBridgeSpot(spot));
  const base = admitBrowserSolve(checked, env, preflightMemoryBytes);
  const desktop = ["desktop-chromium", "desktop-firefox", "desktop-safari"].includes(env.profile);
  const budgetBytes = Math.min(base.budgetBytes, desktop ? PLAY_PROPOSAL.desktopBudgetBytes : PLAY_PROPOSAL.mobileBudgetBytes);
  const fits = checked.estimatedBytes <= PLAY_PROPOSAL.engineBytes
    && checked.estimateExport.workingBytesEstimate <= PLAY_PROPOSAL.exportBytes
    && checked.estimateExport.jsonBytesUpperBound <= PLAY_PROPOSAL.jsonBytes;
  const ok = base.ok && fits && base.totalBytes <= budgetBytes;
  return { ...base, budgetBytes, ok, reason: ok ? "Fits the research play proposal; not production admission or physical-device certification."
    : "Outside the research play proposal; no production policy is enabled." };
}
