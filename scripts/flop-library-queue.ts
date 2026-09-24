import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { atomicFlopWrite, FLOP_BINARY_LIMIT, readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";
import { FLOP_PRESETS } from "../src/lib/solver/postflop/flop-library/fixtures";
import { FLOP_LIBRARY_DIRECTORY, flopLibraryKey, flopLibraryRecipe, flopLibrarySourcePaths,
  readFlopLibrarySource, verifyFlopLibrarySource } from "../src/lib/solver/postflop/flop-library/source-node";
import { runFlopJob } from "./flop-runner";

export interface FlopQueueEntry { id: string; key: string; status: "pending" | "accepted" | "incomplete" | "failed";
  payloadHash?: string; policyHash?: string; iterations?: number; exploitability?: number; reason?: string }
export async function runFlopLibraryQueue(mode: "generate" | "check" | "reproduce", options: {
  resume?: boolean; signal?: AbortSignal; onStatus?: (entry: FlopQueueEntry) => void;
} = {}) {
  const locked = JSON.parse(readFileSync("tasks/saved-flop-library-input-hashes.json", "utf8"));
  const entries: FlopQueueEntry[] = FLOP_PRESETS.map(p => ({ id: p.request.id, key: flopLibraryKey(p), status: "pending" }));
  if (entries.some(e => locked[e.id] !== e.key) || Object.keys(locked).length !== entries.length) throw new Error("Locked flop library inputs changed");
  const reportPath = join(FLOP_LIBRARY_DIRECTORY, "queue.json");
  const report = () => canonicalSolverJson({ version: 1, jobs: entries }) + "\n";
  const save = () => { if (mode === "generate") { mkdirSync(FLOP_LIBRARY_DIRECTORY, { recursive: true }); atomicFlopWrite(reportPath, Buffer.from(report())); } };
  const accept = (entry: FlopQueueEntry, source: ReturnType<typeof readFlopLibrarySource>) => {
    Object.assign(entry, { status: "accepted", payloadHash: source.payloadHash, policyHash: source.policyHash,
      iterations: source.iterations, exploitability: source.grade.exploitability }); options.onStatus?.({ ...entry }); save();
  };
  save();
  // Intentionally sequential: no concurrency argument or shared-regret worker pool.
  for (const [index, preset] of FLOP_PRESETS.entries()) {
    const entry = entries[index], paths = flopLibrarySourcePaths(preset);
    try {
      options.signal?.throwIfAborted();
      const hasManifest = existsSync(paths.manifest), hasPolicy = existsSync(paths.policy);
      if (hasManifest !== hasPolicy) throw new Error("Incomplete source file pair; inspect it before continuing");
      if (mode !== "generate" || hasManifest) {
        const source = readFlopLibrarySource(preset);
        if (mode !== "reproduce") { accept(entry, source); continue; }
      }
      const checkpoint = mode === "generate" ? flopQueueCheckpointPaths(flopLibraryKey(preset), options.resume ?? false) : {};
      const recipe = flopLibraryRecipe(preset);
      const result = await runFlopJob(recipe, { ...checkpoint, signal: options.signal,
        onProgress: progress => { if (progress.stage !== "solving" || progress.iterations % 64 === 0) console.error(JSON.stringify({ scenario: preset.request.id, ...progress })); } });
      const manifest = JSON.parse(result.json), bytes = readFlopBinary(result.policyPath);
      if (manifest.acceptance?.passed !== true) {
        Object.assign(entry, { status: "incomplete", iterations: manifest.iterations, exploitability: manifest.exploitability, reason: "Iteration budget exhausted before the locked quality gate" });
        options.onStatus?.({ ...entry }); save(); continue;
      }
      const source = verifyFlopLibrarySource(preset, manifest, bytes);
      if (mode === "reproduce") {
        if (readFileSync(paths.manifest, "utf8") !== result.json || !gunzipSync(readFlopBinary(paths.policy), { maxOutputLength: FLOP_BINARY_LIMIT })
          .equals(gunzipSync(bytes, { maxOutputLength: FLOP_BINARY_LIMIT }))) throw new Error("Library source does not reproduce");
      } else {
        atomicFlopWrite(paths.policy, bytes, false); atomicFlopWrite(paths.manifest, Buffer.from(result.json), false);
      }
      accept(entry, source);
    } catch (error) {
      entry.status = "failed"; entry.reason = error instanceof Error ? error.message : String(error);
      options.onStatus?.({ ...entry }); save(); throw error; // Never work around a numerical/integrity failure.
    }
  }
  if (entries.some(e => e.status !== "accepted")) throw new Error("Flop library is incomplete; no complete catalog may be published");
  if (mode !== "generate" && readFileSync(reportPath, "utf8") !== report()) throw new Error("Library queue manifest differs");
  return entries;
}
export function flopQueueCheckpointPaths(key: string, resume: boolean, root = ".cache/flop-library") {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid flop cache key");
  const directory = join(root, key); mkdirSync(directory, { recursive: true });
  const existing = readdirSync(directory).filter(n => /^checkpoint-\d+\.gz$/.test(n)).map(n => Number(n.slice(11, -3))).sort((a, b) => a - b);
  const previous = existing.at(-1), next = (previous ?? 0) + 1;
  return { checkpointPath: join(directory, `checkpoint-${next}.gz`), resumePath: resume && previous !== undefined ? join(directory, `checkpoint-${previous}.gz`) : undefined };
}
