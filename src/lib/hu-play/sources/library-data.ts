/** Complete flop policy supplement. B4 remains unchanged; every old column must agree. */
import type { BridgeSpotV1 } from "../../solver/bridge/contract";
import { sha256 } from "../../solver/bridge/live/loader";
import { validateLibraryManifest, validateLibraryRef } from "../../solver/bridge/library/load";
import type { BridgeLibraryChunk, BridgeLibraryFileRef, BridgeLibraryManifest, BridgeLibrarySpot } from "../../solver/bridge/library/model";

export const PLAY_LIBRARY_PREFIX = "/solver-data/hu-play-v1/";
export interface PlayFlopNode {
  readonly path: string; readonly player: 0 | 1; readonly committed: readonly [number, number];
  readonly actions: readonly string[];
  /** Full actor hand list, in the original spot's order. Integers summing to 1000 per column. */
  readonly strategy: readonly (readonly number[])[];
  /** From-now deci-chips under the original saved policy; null is unavailable. */
  readonly actionEv: readonly (readonly (number | null)[])[];
}
export interface PlayFlopPolicy {
  readonly format: "poker-face-play-flop-policy"; readonly version: 1;
  readonly spotId: string; readonly spotHash: string; readonly libraryFlopSha256: string;
  readonly hands: readonly [readonly string[], readonly string[]];
  readonly strategyScale: 1000; readonly actionEvScale: 10;
  readonly nodes: readonly PlayFlopNode[];
}
export interface PlayLibraryManifest {
  readonly format: "poker-face-play-flop-library"; readonly version: 1;
  readonly libraryManifestSha256: string; readonly sourceSha256: string; readonly label: string;
  readonly spots: readonly (BridgeLibraryFileRef & { readonly id: string; readonly spotHash: string })[];
}
export interface PlayCatalog { readonly library: BridgeLibraryManifest; readonly supplement: PlayLibraryManifest }

function fail(message: string): never { throw new Error(`Invalid play library: ${message}`); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export function validatePlayFlop(input: unknown, entry: BridgeLibrarySpot, spot: BridgeSpotV1,
  original: BridgeLibraryChunk): PlayFlopPolicy {
  const v = input as PlayFlopPolicy;
  if (!v || typeof v !== "object" || v.format !== "poker-face-play-flop-policy" || v.version !== 1
    || v.spotId !== entry.id || v.spotHash !== entry.spotHash || spot.id !== entry.id
    || v.libraryFlopSha256 !== entry.chunks.flop.sha256 || v.strategyScale !== 1000 || v.actionEvScale !== 10
    || original.spotHash !== entry.spotHash || original.key !== "flop") fail("wrong flop source or format");
  if (!same(v.hands, spot.ranges.map(r => r.combos.map(h => h.combo)))) fail("hand order differs from saved ranges");
  if (!Array.isArray(v.nodes) || v.nodes.length !== original.nodes.length) fail("incomplete flop decisions");
  const seen = new Set<string>();
  for (const n of v.nodes) {
    if (!n || typeof n !== "object" || typeof n.path !== "string" || seen.has(n.path)) fail("duplicate or malformed node");
    seen.add(n.path);
    const old = original.nodes.find(o => o.path === n.path);
    if (!old || n.player !== old.player || !same(n.actions, old.actions) || !same(n.committed, old.committed)) fail("public node changed");
    const count = v.hands[n.player].length;
    if (!Array.isArray(n.strategy) || n.strategy.length !== old.actions.length
      || !Array.isArray(n.actionEv) || n.actionEv.length !== old.actions.length) fail("action rows differ");
    for (let a = 0; a < old.actions.length; a++) {
      const row = n.strategy[a], ev = n.actionEv[a];
      if (!Array.isArray(row) || row.length !== count || row.some(p => !Number.isSafeInteger(p) || p < 0 || p > 1000)) fail("invalid full strategy row");
      if (!Array.isArray(ev) || ev.length !== count || ev.some(x => x !== null && (!Number.isSafeInteger(x) || Math.abs(x) > 1e9))) fail("invalid action EV row");
      for (let i = 0; i < old.live[old.player].length; i++) {
        const h = old.live[old.player][i];
        if (row[h] !== old.strategy[a][i] || ev[h] !== old.actionEv[a][i]) fail("published B4 column changed");
      }
    }
    for (let h = 0; h < count; h++) if (n.strategy.reduce((sum: number, row: readonly number[]) => sum + row[h], 0) !== 1000) fail("strategy column does not sum to 1000");
  }
  return v;
}

export function validatePlayManifest(input: unknown, library: BridgeLibraryManifest, libraryHash: string): PlayLibraryManifest {
  const v = input as PlayLibraryManifest;
  if (!v || typeof v !== "object" || v.format !== "poker-face-play-flop-library" || v.version !== 1
    || v.libraryManifestSha256 !== libraryHash || !hash(v.sourceSha256)
    || typeof v.label !== "string" || v.label.length > 1000
    || !Array.isArray(v.spots) || v.spots.length !== 12 || library.spots.length !== 12) fail("wrong manifest or base library");
  const seen = new Set<string>();
  for (const r of v.spots) {
    const entry = library.spots.find(s => s.id === r.id);
    if (!entry || r.spotHash !== entry.spotHash || seen.has(r.id)) fail("wrong or duplicate spot");
    seen.add(r.id); validateLibraryRef(r, "play flop", PLAY_LIBRARY_PREFIX);
    if (r.url !== `${PLAY_LIBRARY_PREFIX}${r.id}/${r.sha256}/flop.json`) fail("not a content-addressed flop file");
  }
  return v;
}

/** Bounded streaming read. A forged Content-Length cannot cause an unbounded allocation. */
export async function readPlayJson(url: string, signal?: AbortSignal, fetcher: typeof fetch = fetch,
  ref?: BridgeLibraryFileRef): Promise<{ value: unknown; sha256: string }> {
  const limit = ref?.bytes ?? 1024 ** 2;
  if (ref) validateLibraryRef(ref, "play input", "/solver-data/");
  if (url !== ref?.url && url !== `${PLAY_LIBRARY_PREFIX}manifest.json` && url !== "/solver-data/bridge-v1/manifest.json") fail("unapproved URL");
  signal?.throwIfAborted();
  const response = await fetcher(url, { signal, cache: "no-cache", credentials: "same-origin", redirect: "error" });
  if (!response.ok || !response.body) throw new Error(`Could not load play policy (${response.status}). Retry when connected.`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) fail("file exceeds bounded size");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const digest = await sha256(bytes);
  signal?.throwIfAborted();
  if (ref && (ref.bytes !== length || ref.sha256 !== digest)) fail("file size or integrity mismatch");
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: digest };
}

export async function loadPlayCatalog(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlayCatalog> {
  const [base, extra] = await Promise.all([
    readPlayJson("/solver-data/bridge-v1/manifest.json", signal, fetcher),
    readPlayJson(`${PLAY_LIBRARY_PREFIX}manifest.json`, signal, fetcher),
  ]);
  const library = validateLibraryManifest(base.value);
  return { library, supplement: validatePlayManifest(extra.value, library, base.sha256) };
}
