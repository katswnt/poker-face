// Node-only spot hashing. Browser-facing consumers import contract.ts without node:crypto.
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import { validateBridgeSpot, type BridgeSpotV1 } from "./contract";

/**
 * The exact bytes handed to the native bridge: sorted-key JSON, no whitespace. The bridge
 * hashes the file it reads, so its reported spotHash equals hashBridgeSpot(spot).
 */
export function canonicalBridgeSpotJson(spot: BridgeSpotV1): string {
  return canonicalSolverJson(validateBridgeSpot(spot));
}

export function hashBridgeSpot(spot: BridgeSpotV1): string {
  return createHash("sha256").update(canonicalBridgeSpotJson(spot)).digest("hex");
}
