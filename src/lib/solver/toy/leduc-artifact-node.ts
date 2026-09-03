// Node-only Leduc artifact hashing. Browser-facing consumers can import
// leduc-artifact.ts without pulling node:crypto into a client bundle.
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "./artifact";
import type { CfrSolveResult } from "./cfr";
import {
  createLeducSolveArtifactPayload,
  type LeducReferenceResult,
  type LeducSolveArtifact,
  type LeducSolveArtifactPayload,
} from "./leduc-artifact";
import type { LeducAction } from "./leduc";

function hashPayload(payload: LeducSolveArtifactPayload): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

export function createLeducSolveArtifact(
  result: CfrSolveResult<LeducAction>,
  reference: LeducReferenceResult,
): LeducSolveArtifact {
  const payload = createLeducSolveArtifactPayload(result, reference);
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyLeducArtifactHash(artifact: LeducSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload);
}
