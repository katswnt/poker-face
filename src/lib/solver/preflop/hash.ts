// Node-only hashing for preflop spots, realization tables and results (sha256 of canonical JSON:
// sorted keys, no whitespace, the helper every other solver artifact uses).
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import { validatePreflopSpot, validateRealizationTable, type PreflopSpotV1, type RealizationTableV1 } from "./contract";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const hashJson = (value: unknown) => sha256(canonicalSolverJson(value));
export const hashPreflopSpot = (spot: PreflopSpotV1) => hashJson(validatePreflopSpot(spot));
export const hashRealizationTable = (table: RealizationTableV1) => hashJson(validateRealizationTable(table));
