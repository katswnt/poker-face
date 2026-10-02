/** Bounded, content-addressed first-street turn policies. No private decision inputs.
 * This is a cache of approximate solves for exact inputs, not a new solver or safety proof.
 */
import { POSTFLOP_SOLVER_COMMIT, type BridgeSpotV1, type BridgeResultV1 } from "../../solver/bridge/contract";
import { parseLiveSpot } from "../../solver/bridge/live/admission";
import { sha256 } from "../../solver/bridge/live/loader";
import { PLAY_LIMITS } from "../../solver/bridge/live/play-profile";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import { requirePlayingResult } from "./resolved";

export const TURN_CACHE_PREFIX = "/solver-data/hu-turn-v1/";
export const TURN_CACHE_LIMITS = Object.freeze({ entries: 12 * 4 * 49, fileBytes: PLAY_LIMITS.jsonBytes,
  manifestBytes: 1024 ** 2, warmEntries: 4 });
export interface TurnCacheIdentity {
  readonly engineCommit: string; readonly bridgeVersion: string; readonly sourceHash: string; readonly buildHash: string;
}
export interface TurnCacheRef {
  readonly key: string; readonly spotHash: string; readonly url: string; readonly bytes: number; readonly sha256: string;
}
export interface TurnCacheManifest {
  readonly format: "poker-face-turn-cache"; readonly version: 1; readonly identity: TurnCacheIdentity;
  readonly librarySha256: string; readonly supplementSha256: string; readonly entries: readonly TurnCacheRef[];
}
interface TurnCacheChunk {
  readonly format: "poker-face-turn-policy"; readonly version: 1; readonly identity: TurnCacheIdentity;
  readonly key: string; readonly spotHash: string; readonly result: BridgeResultV1;
}
export type TurnCacheLookup =
  | { readonly kind: "hit"; readonly key: string; readonly chunkSha256: string; readonly result: BridgeResultV1 }
  | { readonly kind: "miss"; readonly key: string; readonly reason: "not-listed" | "identity-mismatch" | "load-failed";
      readonly detail: string };

const bytesOf = (v: unknown) => new TextEncoder().encode(canonicalSolverJson(v) + "\n");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown, b: unknown) => canonicalSolverJson(a) === canonicalSolverJson(b);
function exact(v: unknown, keys: string[], label: string): void {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== keys.sort().join()) {
    throw new Error(`Invalid turn cache ${label} fields`);
  }
}
function checkIdentity(v: TurnCacheIdentity): void {
  exact(v, ["engineCommit", "bridgeVersion", "sourceHash", "buildHash"], "identity");
  if (v.engineCommit !== POSTFLOP_SOLVER_COMMIT || !hash(v.sourceHash) || !hash(v.buildHash)
    || typeof v.bridgeVersion !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v.bridgeVersion)) {
    throw new Error("Invalid turn cache engine identity");
  }
}
function cacheSpot(spot: BridgeSpotV1) {
  const checked = parseLiveSpot(canonicalSolverJson(spot), "play-v1");
  if (checked.board.river !== null) throw new Error("Turn cache requires an undealt river");
  return checked;
}
export async function turnCacheKey(spot: BridgeSpotV1, identity: TurnCacheIdentity): Promise<string> {
  checkIdentity(identity);
  return sha256(bytesOf({ format: "poker-face-turn-cache-key", version: 1, spot: cacheSpot(spot), identity }));
}

/** A cache must not hide a missing float32 column until that decision is reached. */
function checkPolicy(raw: unknown, spot: BridgeSpotV1, spotHash: string, identity: TurnCacheIdentity): BridgeResultV1 {
  const r = requirePlayingResult(raw, spot, spotHash), seen = new Set<number>();
  if (r.engine.bridgeVersion !== identity.bridgeVersion || r.counts.exportedNodes !== r.tree.length
    || bytesOf(r).length > TURN_CACHE_LIMITS.fileBytes) throw new Error("Turn cache result identity/size mismatch");
  const visit = (id: number) => {
    if (seen.has(id)) throw new Error("Turn cache policy is not a complete tree");
    seen.add(id); const n = r.tree[id];
    if (!same(n.board, [...spot.board.flop, spot.board.turn])) throw new Error("Turn cache exported a wrong street");
    if (n.kind === "player") {
      if (n.street !== "turn" || !n.actions.length) throw new Error("Incomplete turn decision");
      for (let h = 0; h < r.hands[n.player].length; h++) {
        const column = n.strategy.map(row => row[h]);
        if (column.some(p => p === null || !Number.isFinite(p) || p < 0 || p > 1)
          || Math.abs((column as number[]).reduce((s, p) => s + p, 0) - 1) > 1e-5) {
          throw new Error("Turn cache has a missing or invalid float32 policy column");
        }
      }
      for (const e of n.actions) visit(e.child);
    } else if (n.kind === "chance") {
      if (n.street !== "river" || n.truncated !== true || n.children.length) throw new Error("Turn cache must stop at the next street");
    } else if (n.kind !== "terminal") throw new Error("Unknown turn cache node kind");
  };
  visit(0);
  if (seen.size !== r.tree.length) throw new Error("Unreachable turn cache decisions");
  return r;
}

export async function createTurnCacheChunk(spot: BridgeSpotV1, result: BridgeResultV1, identity: TurnCacheIdentity) {
  const snapshot = cacheSpot(spot), engine = structuredClone(identity); checkIdentity(engine);
  const spotHash = await sha256(new TextEncoder().encode(canonicalSolverJson(snapshot)));
  const key = await turnCacheKey(snapshot, engine);
  const chunk: TurnCacheChunk = { format: "poker-face-turn-policy", version: 1, identity: engine, key, spotHash,
    result: checkPolicy(result, snapshot, spotHash, engine) };
  const bytes = bytesOf(chunk);
  if (bytes.length > TURN_CACHE_LIMITS.fileBytes) throw new Error("Turn cache chunk exceeds its byte cap");
  const digest = await sha256(bytes);
  const ref: TurnCacheRef = { key, spotHash, url: `${TURN_CACHE_PREFIX}${digest}/policy.json`, bytes: bytes.length, sha256: digest };
  return { bytes, ref };
}

export function validateTurnCacheManifest(input: unknown): TurnCacheManifest {
  exact(input, ["format", "version", "identity", "librarySha256", "supplementSha256", "entries"], "manifest");
  const v = input as TurnCacheManifest;
  if (v.format !== "poker-face-turn-cache" || v.version !== 1) throw new Error("Wrong turn cache format/version");
  checkIdentity(v.identity);
  if (!hash(v.librarySha256) || !hash(v.supplementSha256) || !Array.isArray(v.entries)
    || v.entries.length > TURN_CACHE_LIMITS.entries || bytesOf(v).length > TURN_CACHE_LIMITS.manifestBytes) {
    throw new Error("Invalid or oversized turn cache manifest");
  }
  const seen = new Set<string>();
  for (const r of v.entries) {
    exact(r, ["key", "spotHash", "url", "bytes", "sha256"], "reference");
    if (!hash(r.key) || !hash(r.spotHash) || !hash(r.sha256) || !Number.isSafeInteger(r.bytes)
      || r.bytes < 1 || r.bytes > TURN_CACHE_LIMITS.fileBytes) throw new Error("Invalid turn cache reference");
    if (seen.has(r.key)) throw new Error("Duplicate turn cache key"); seen.add(r.key);
    if (r.url !== `${TURN_CACHE_PREFIX}${r.sha256}/policy.json`) throw new Error("Turn cache URL is not content-addressed");
  }
  return structuredClone(v);
}

async function readBytes(url: string, limit: number, signal: AbortSignal | undefined, fetcher: typeof fetch) {
  signal?.throwIfAborted();
  const response = await fetcher(url, { signal, credentials: "same-origin", redirect: "error", cache: "no-cache" });
  if (!response.ok || !response.body) throw new Error(`Turn cache unavailable (${response.status})`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new Error("Turn cache exceeds bounded size"); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export class TurnPolicyCache {
  private readonly manifest: TurnCacheManifest;
  private readonly identity: TurnCacheIdentity;
  private readonly refs: Map<string, TurnCacheRef>;
  private readonly warm = new Map<string, Uint8Array>();
  constructor(manifest: unknown, identity: TurnCacheIdentity, private readonly fetcher: typeof fetch = fetch) {
    this.manifest = validateTurnCacheManifest(manifest); checkIdentity(identity); this.identity = structuredClone(identity);
    this.refs = new Map(this.manifest.entries.map(r => [r.key, r]));
  }
  async lookup(spot: BridgeSpotV1, signal?: AbortSignal): Promise<TurnCacheLookup> {
    signal?.throwIfAborted(); const snapshot = cacheSpot(spot), key = await turnCacheKey(snapshot, this.identity);
    signal?.throwIfAborted();
    if (!same(this.manifest.identity, this.identity)) return { kind: "miss", key, reason: "identity-mismatch", detail: "Different engine or bridge build" };
    const ref = this.refs.get(key);
    if (!ref) return { kind: "miss", key, reason: "not-listed", detail: "This exact public turn root was not warmed" };
    try {
      const bytes = this.warm.get(key) ?? await readBytes(ref.url, ref.bytes, signal, this.fetcher);
      if (bytes.length !== ref.bytes || await sha256(bytes) !== ref.sha256) throw new Error("Turn cache file integrity mismatch");
      signal?.throwIfAborted();
      const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as TurnCacheChunk;
      exact(v, ["format", "version", "identity", "key", "spotHash", "result"], "chunk");
      const spotHash = await sha256(new TextEncoder().encode(canonicalSolverJson(snapshot)));
      if (v.format !== "poker-face-turn-policy" || v.version !== 1 || v.key !== key || v.spotHash !== spotHash
        || ref.spotHash !== spotHash || !same(v.identity, this.identity)) throw new Error("Turn cache chunk identity mismatch");
      const result = checkPolicy(v.result, snapshot, spotHash, this.identity);
      signal?.throwIfAborted();
      this.warm.delete(key); this.warm.set(key, bytes);
      while (this.warm.size > TURN_CACHE_LIMITS.warmEntries) this.warm.delete(this.warm.keys().next().value!);
      return { kind: "hit", key, chunkSha256: ref.sha256, result };
    } catch (error) {
      signal?.throwIfAborted();
      return { kind: "miss", key, reason: "load-failed", detail: error instanceof Error ? error.message : "Turn cache validation failed" };
    }
  }
}

/** The manifest itself is addressed by its SHA-256, supplied by the generated deployment. */
export async function loadTurnPolicyCache(manifestSha256: string, identity: TurnCacheIdentity,
  signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<TurnPolicyCache> {
  if (!hash(manifestSha256)) throw new Error("Invalid turn cache manifest hash"); checkIdentity(identity);
  const bytes = await readBytes(`${TURN_CACHE_PREFIX}${manifestSha256}/manifest.json`, TURN_CACHE_LIMITS.manifestBytes, signal, fetcher);
  if (await sha256(bytes) !== manifestSha256) throw new Error("Turn cache manifest integrity mismatch");
  signal?.throwIfAborted();
  return new TurnPolicyCache(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), identity, fetcher);
}
