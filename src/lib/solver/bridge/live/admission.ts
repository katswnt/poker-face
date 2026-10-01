import { validateBridgeSpot, type BridgeBetSize, type BridgeSpotV1 } from "../contract";
import { parseBridgeEstimate, wasmBudget, type WasmEnvironment } from "../wasm-admission";
import type { ExportReservation, LiveEstimate, LiveVerdict } from "./model";
import { PLAY_LIMITS, requireLiveProfile, validatePlaySpot, type LiveProfile } from "./play-profile";
import { validateRiverPlaySpot } from "./river-profile";

/** W2 engineering limits, not a hardware safety certificate. Offline scripts retain capacity. */
export const LIVE_LIMITS = Object.freeze({ inputBytes: 256 * 1024, rangeHands: 64, jsonDepth: 100,
  inputObjects: 10_000, maxIterations: 10_000, timeoutMs: 120_000, budgetBytes: 256 * 1024 ** 2,
  overheadBytes: 128 * 1024 ** 2, exportNodes: 100_000, jsonBytes: 32 * 1024 ** 2,
  chunkMs: 40, maxChunkIterations: 32, previewMs: 1000, cancelGraceMs: 250 });

export function parseLiveSpot(json: string, profile: LiveProfile = "teaching-v1"): BridgeSpotV1 {
  requireLiveProfile(profile);
  if (typeof json !== "string" || json.length > LIVE_LIMITS.inputBytes || new TextEncoder().encode(json).length > LIVE_LIMITS.inputBytes) {
    throw new Error("Browser spot input exceeds 256 KiB. Use the offline scripts for larger games.");
  }
  const raw: unknown = JSON.parse(json);
  // Bound recursion BEFORE the general contract validator and canonical serializer.
  const pending: [unknown, number][] = [[raw, 0]]; let objects = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (depth > LIVE_LIMITS.jsonDepth || ++objects > LIVE_LIMITS.inputObjects) throw new Error("Browser spot is too complex to preflight.");
    if (value && typeof value === "object") for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  const spot = validateBridgeSpot(raw);
  if (profile === "play-v1") return validatePlaySpot(spot);
  if (profile === "play-river-v1") return validateRiverPlaySpot(spot);
  if (spot.board.turn === null) throw new Error("Live flops use the saved library. Browser solving starts on the turn or river.");
  if (spot.ranges.some(r => r.combos.length > LIVE_LIMITS.rangeHands)) throw new Error("Browser preflight currently allows at most 64 hands per player.");
  if (spot.tree.mode === "river-subgame-v1") throw new Error("Forced river prefixes require the play-river-v1 profile.");
  if (spot.solve.compression !== "off") throw new Error("Browser solving currently requires compression off (the checked float32 path).");
  if (spot.solve.maxIterations > LIVE_LIMITS.maxIterations || spot.solve.timeoutMs > LIVE_LIMITS.timeoutMs) {
    throw new Error("Browser solves are limited to 10,000 iterations and 120 seconds.");
  }
  if (spot.tree.mode === "menu") {
    // The upstream ActionTree is built BEFORE the bridge prunes its raise cap. Bound those
    // raw trees too; a post-construction memory check cannot prevent an oversized preflight.
    if (spot.effectiveStack > 10 * spot.startingPot || spot.tree.maxRaisesPerStreet === null || spot.tree.maxRaisesPerStreet > 1) {
      throw new Error("Browser menus require stack/pot ≤ 10 and a raise limit of 0 or 1. Use offline solving otherwise.");
    }
    const size = (s: BridgeBetSize) => {
      if (s.kind === "allin" || (s.kind === "pot" && s.pct >= 25 && s.pct <= 200)
        || (s.kind === "prevBet" && s.multiple >= 2 && s.multiple <= 4)) return;
      throw new Error("Browser menus currently support 25–200% pot sizes, 2–4× raises and all-ins only.");
    };
    for (const street of [spot.tree.turn, spot.tree.river]) if (street) for (const menu of [street.oop, street.ip]) {
      if (menu.bet.length > 2 || menu.raise.length > 1) throw new Error("Browser menus allow two opening sizes and one raise size per player/street.");
      [...menu.bet, ...menu.raise].forEach(size);
    }
    if (spot.tree.riverDonk && spot.tree.riverDonk.length > 2) throw new Error("Browser menus allow at most two lead sizes.");
    spot.tree.riverDonk?.forEach(size);
    // Prevent threshold-added actions silently broadening the raw preflight construction.
    if (spot.tree.addAllInThreshold !== 0) throw new Error("Browser menus require addAllInThreshold = 0; list the all-in explicitly.");
  }
  return spot;
}

export function parseLiveEstimate(raw: string, spot: BridgeSpotV1, hash: string): LiveEstimate {
  const value = JSON.parse(raw), parsed = parseBridgeEstimate(value);
  if (parsed.spotId !== spot.id || parsed.spotHash !== hash) throw new Error("Preflight belongs to a different spot.");
  if (parsed.memoryCapBytes !== spot.solve.memoryCapBytes || parsed.hands.some((n, p) => n !== spot.ranges[p].combos.length)) {
    throw new Error("Preflight ranges or memory cap differ from the request.");
  }
  const e = value.estimateExport as ExportReservation | undefined;
  if (!e || e.version !== 1 || e.basis !== "public-tree-upper-bound" || e.scope !== spot.solve.exportScope) {
    throw new Error("Missing versioned export reservation; refusing allocation.");
  }
  for (const k of ["nodes", "cells", "edges", "jsonBytesUpperBound", "workingBytesEstimate"] as const) {
    if (!Number.isSafeInteger(e[k]) || e[k] < 0) throw new Error(`Invalid export count ${k}.`);
  }
  if (e.nodes < 1 || e.jsonBytesUpperBound < 4096 || e.workingBytesEstimate < 8 * e.jsonBytesUpperBound) {
    throw new Error("Invalid export reservation.");
  }
  return { ...parsed, estimateExport: e };
}

export function admitBrowserSolve(estimate: LiveEstimate, environment: WasmEnvironment, preflightMemoryBytes: number,
  profile: LiveProfile = "teaching-v1"): LiveVerdict {
  requireLiveProfile(profile);
  if (!Number.isSafeInteger(preflightMemoryBytes) || preflightMemoryBytes < 0) throw new Error("Invalid preflight memory measurement.");
  const e = estimate.estimateExport;
  const desktop = ["desktop-chromium", "desktop-firefox", "desktop-safari"].includes(environment.profile);
  const profileBudget = profile !== "teaching-v1" ? (desktop ? PLAY_LIMITS.desktopBytes : PLAY_LIMITS.mobileBytes) : LIVE_LIMITS.budgetBytes;
  const budgetBytes = Math.min(profileBudget, wasmBudget(environment).bytes);
  // Measured WASM preflight high-water memory in addition to the fixed reservation. There
  // is intentional double-counting: never assume a freed game table shrinks linear memory.
  const overheadBytes = LIVE_LIMITS.overheadBytes + preflightMemoryBytes;
  const engineBytes = estimate.estimatedBytes, exportBytes = e.workingBytesEstimate;
  const totalBytes = engineBytes + exportBytes + overheadBytes;
  if (!Number.isSafeInteger(totalBytes)) throw new Error("Browser memory reservation overflow.");
  const numbers = { budgetBytes, totalBytes, engineBytes, exportBytes, overheadBytes };
  if (profile !== "teaching-v1" && (engineBytes > PLAY_LIMITS.engineBytes || exportBytes > PLAY_LIMITS.exportBytes
    || e.jsonBytesUpperBound > PLAY_LIMITS.jsonBytes)) {
    return { ...numbers, ok: false, reason: "This game exceeds the measured play profile's engine or export limit. No strategy storage allocated." };
  }
  if (e.nodes > LIVE_LIMITS.exportNodes || e.jsonBytesUpperBound > LIVE_LIMITS.jsonBytes) {
    return { ...numbers, ok: false, reason: "Result export is too large. Try first-street export, smaller ranges or the offline scripts. No strategy storage allocated." };
  }
  if (engineBytes > estimate.memoryCapBytes || totalBytes > budgetBytes) {
    return { ...numbers, ok: false, reason: "Storage plus export and overhead exceed the browser budget. No strategy storage allocated; preflight tables were built." };
  }
  return { ...numbers, ok: true, reason: "Within the conservative float32 reservation. This estimate is not a guarantee against a browser running out of memory." };
}
