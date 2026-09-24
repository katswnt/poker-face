import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { flopDigest } from "../flop/artifact-node";
import { readFlopBinary } from "../flop/binary-node";
import { verifyFlopSource } from "../flop/verify-node";
import { validateVectorOptions } from "../vector/session";
import { FLOP_LIBRARY_RUN, FLOP_LIBRARY_VERSION, type FlopPreset } from "./fixtures";

export const FLOP_LIBRARY_DIRECTORY = "src/lib/solver/postflop/flop-library/artifacts";
export function flopLibraryRecipe(preset: FlopPreset) {
  return { request: preset.request, options: FLOP_LIBRARY_RUN, maximumExploitability: preset.request.committedPerPlayer * 2 * 0.0025,
    backend: "vector-flop", backendVersion: 1, rulesVersion: 1, libraryVersion: FLOP_LIBRARY_VERSION };
}
export const flopLibraryKey = (preset: FlopPreset) => flopDigest(flopLibraryRecipe(preset));
export function flopLibrarySourcePaths(preset: FlopPreset) {
  const base = preset.request.id === "flop-vector-wide-64" ? "src/lib/solver/postflop/flop/artifacts/flop-vector-wide-64"
    : join(FLOP_LIBRARY_DIRECTORY, flopLibraryKey(preset));
  return { manifest: `${base}.json`, policy: `${base}.policy.f64.gz` };
}
export function verifyFlopLibrarySource(preset: FlopPreset, input: unknown, bytes: Uint8Array) {
  const artifact = input as Record<string, unknown>, recipe = flopLibraryRecipe(preset);
  // The serialized engine options make the already-declared default vector kernel explicit.
  if (!artifact || flopDigest(artifact.request) !== flopDigest(recipe.request) || flopDigest(artifact.options) !== flopDigest(validateVectorOptions(recipe.options))
    || (artifact.acceptance as Record<string, unknown>)?.maximumExploitability !== recipe.maximumExploitability) throw new Error("Library source does not match its locked job identity");
  return verifyFlopSource(input, bytes);
}
export function readFlopLibrarySource(preset: FlopPreset) {
  const paths = flopLibrarySourcePaths(preset);
  if (statSync(paths.manifest).size > 65536) throw new Error("Library source manifest exceeds 64 KiB");
  return verifyFlopLibrarySource(preset, JSON.parse(readFileSync(paths.manifest, "utf8")), readFlopBinary(paths.policy));
}
