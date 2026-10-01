/** P1-only bounds calibrated in heads-up-play-p1-wide-feasibility.md.
 * This is not permission for arbitrary 640-hand menus, or a physical-phone certificate.
 * No Node/React imports: the same checks run before Worker creation and inside the Worker.
 */
import type { BridgeBoard, BridgeMenuTree, BridgeSpotV1, BridgeStreetMenu } from "../contract";
import { canonicalSolverJson } from "../../toy/artifact";

export type LiveProfile = "teaching-v1" | "play-v1";
export const PLAY_LIMITS = Object.freeze({
  rangeHands: 640, stackPotRatio: 18, maxIterations: 1000, timeoutMs: 120_000,
  targetPctPot: .3, engineBytes: 32 * 1024 ** 2, exportBytes: 16 * 1024 ** 2,
  jsonBytes: 2 * 1024 ** 2, desktopBytes: 256 * 1024 ** 2, mobileBytes: 192 * 1024 ** 2,
});

export function requireLiveProfile(profile: unknown): asserts profile is LiveProfile {
  if (profile !== "teaching-v1" && profile !== "play-v1") throw new Error("Unknown browser solver profile.");
}

/** Exact continuation of the existing lean SRP menu; fresh objects prevent shared mutation. */
export function playTree(board: BridgeBoard): BridgeMenuTree {
  const menu = (oop: number[], ip: number[]): BridgeStreetMenu => ({
    oop: { bet: oop.map(pct => ({ kind: "pot", pct })), raise: [{ kind: "pot", pct: 60 }] },
    ip: { bet: ip.map(pct => ({ kind: "pot", pct })), raise: [{ kind: "pot", pct: 60 }] },
  });
  return { mode: "menu", flop: null, turn: board.river === null ? menu([66], [66]) : null,
    river: menu([50, 100], [66]), turnDonk: null, riverDonk: null, addAllInThreshold: 0,
    forceAllInThreshold: .2, mergingThreshold: 0, maxRaisesPerStreet: 1 };
}

export function validatePlaySpot(spot: BridgeSpotV1): BridgeSpotV1 {
  if (spot.board.turn === null || spot.ranges.some(r => r.combos.length > PLAY_LIMITS.rangeHands)) {
    throw new Error("Play v1 requires a turn or river and at most 640 hands per player.");
  }
  if (spot.effectiveStack > PLAY_LIMITS.stackPotRatio * spot.startingPot) {
    throw new Error("Play v1 requires stack/pot ≤ 18.");
  }
  if (canonicalSolverJson(spot.tree) !== canonicalSolverJson(playTree(spot.board))) {
    throw new Error("Play v1 allows only the measured lean turn/river menu.");
  }
  if (spot.solve.compression !== "off" || spot.solve.exportScope !== "first-street"
    || spot.solve.targetExploitabilityPctPot !== PLAY_LIMITS.targetPctPot
    || spot.solve.maxIterations > PLAY_LIMITS.maxIterations || spot.solve.timeoutMs > PLAY_LIMITS.timeoutMs) {
    throw new Error("Play v1 requires float32, first-street export, the 0.3%-pot target, at most 1,000 iterations and 120 seconds.");
  }
  return spot;
}
