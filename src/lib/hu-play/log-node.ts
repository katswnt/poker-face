// Node-only hand-log hashing (sorted-key JSON + sha256, like the bridge spot hash).
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../solver/toy/artifact";
import type { HuHandLogV1 } from "./types";

export function canonicalHandLogJson(log: HuHandLogV1): string {
  return canonicalSolverJson(log);
}

export function hashHandLog(log: HuHandLogV1): string {
  return createHash("sha256").update(canonicalHandLogJson(log)).digest("hex");
}
