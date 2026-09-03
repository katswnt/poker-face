// Node-only artifact hashing. Browser-facing consumers can import artifact.ts without
// pulling node:crypto into a client bundle.
import { createHash } from "node:crypto";
import {
  canonicalKuhnJson,
  createKuhnSolveArtifactPayload,
  type KuhnSolveArtifact,
  type KuhnSolveArtifactPayload,
} from "./artifact";
import type { CfrSolveResult } from "./cfr";
import type { KuhnAction } from "./kuhn";

function hashPayload(payload: KuhnSolveArtifactPayload): string {
  return createHash("sha256").update(canonicalKuhnJson(payload)).digest("hex");
}

export function createKuhnSolveArtifact(
  result: CfrSolveResult<KuhnAction>,
): KuhnSolveArtifact {
  const payload = createKuhnSolveArtifactPayload(result);
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyKuhnArtifactHash(artifact: KuhnSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload);
}
