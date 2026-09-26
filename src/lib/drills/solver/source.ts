// Async question source for solver-backed decisions. Loads the bridge library lazily through the
// audited loader (every file checked against its manifest bytes + sha256 and schema-validated),
// caches what it loaded in memory so answered chunks keep working offline, and never substitutes
// data: a failed or corrupted load is an error the page shows with a retry.
import {
  BridgeLibraryError, loadLibraryChunk, loadLibraryManifest, loadLibraryRanges,
} from "@/lib/solver/bridge/library/load";
import { chunkKeyForNode, type BridgeLibraryChunk, type BridgeLibraryManifest, type BridgeLibraryRanges, type BridgeLibrarySpot } from "@/lib/solver/bridge/library/model";
import { findLibraryNode } from "@/lib/solver/bridge/library/query";
import { questionRng } from "../rng";
import type { Level, Question } from "../types";
import { MAX_CHUNK_ATTEMPTS, buildSolverQuestion, eligibleHands, eligibleNodes, pickFromEligible, planChunk, type EligibleNode } from "./build";
import { parseSolverKey, streetOfPath } from "./tree";

/** The library data a saved review key pointed to is gone (e.g. a regenerated library). */
export class SolverKeyError extends Error {
  override name = "SolverKeyError";
}

export interface SolverSource {
  /** Fresh question: a pure function of (seed, level) and the library contents. */
  generate(seed: number, level: Level): Promise<Question>;
  /** Review: rebuild exactly the saved spot + node + hand. */
  fromKey(key: string, seed: number, level: Level): Promise<Question>;
  manifest(): Promise<BridgeLibraryManifest>;
}

export interface SolverSourceOptions {
  /** Injected for tests; defaults to the browser's fetch. */
  readonly fetcher?: typeof fetch;
}

const friendly = (error: unknown): Error => {
  if (error instanceof BridgeLibraryError || error instanceof SolverKeyError) return error;
  return new BridgeLibraryError("Could not load saved spot data. Check your connection and retry.");
};

export function createSolverSource(options: SolverSourceOptions = {}): SolverSource {
  const base: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  // Hash-verified files may come from the HTTP cache (offline after a first load); if a cached
  // copy fails verification, fetch once more from the network.
  const cached: typeof fetch = (input, init) => base(input, { ...init, cache: "force-cache" });
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    let hit = memo.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = make().catch(error => { memo.delete(key); throw friendly(error); });
      memo.set(key, hit);
    }
    return hit;
  };
  const verified = async <T>(load: (f: typeof fetch) => Promise<T>): Promise<T> => {
    try {
      return await load(cached);
    } catch (error) {
      if (error instanceof BridgeLibraryError && !/\(\d+\)/.test(error.message)) return load(base);
      throw error;
    }
  };

  const manifest = () => once("manifest", async () => {
    try {
      return await loadLibraryManifest(undefined, base);
    } catch (error) {
      if (error instanceof BridgeLibraryError && /invalid|too large/.test(error.message)) throw error;
      return loadLibraryManifest(undefined, cached);
    }
  });
  const ranges = (spot: BridgeLibrarySpot) => once(`ranges:${spot.id}`, () => verified(f => loadLibraryRanges(spot, undefined, f)));
  const chunk = (spot: BridgeLibrarySpot, key: string, r: BridgeLibraryRanges) =>
    once(`chunk:${spot.id}:${key}`, () => verified(f => loadLibraryChunk(spot, key, r, undefined, f)));
  const eligibleIn = new Map<string, EligibleNode[]>();
  const eligible = (spot: BridgeLibrarySpot, key: string, c: BridgeLibraryChunk, r: BridgeLibraryRanges, startingPot: number) => {
    const id = `${spot.id}:${key}`;
    let list = eligibleIn.get(id);
    if (!list) { list = eligibleNodes(c, r, startingPot); eligibleIn.set(id, list); }
    return list;
  };

  return {
    manifest,
    async generate(seed, level) {
      const m = await manifest();
      const rng = questionRng("solver", seed >>> 0, level);
      const spot = m.spots[Math.floor(rng() * m.spots.length)];
      const r = await ranges(spot);
      let pool: EligibleNode[] = [];
      for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS && !pool.length; attempt += 1) {
        const key = planChunk(rng, spot, level);
        pool = eligible(spot, key, await chunk(spot, key, r), r, m.formation.startingPot);
      }
      if (!pool.length) pool = eligible(spot, "flop", await chunk(spot, "flop", r), r, m.formation.startingPot);
      const { node, row } = pickFromEligible(rng, pool);
      return buildSolverQuestion({ manifest: m, spot, ranges: r, node, row, seed: seed >>> 0, level });
    },
    async fromKey(key, seed, level) {
      const parsed = parseSolverKey(key);
      if (!parsed) throw new SolverKeyError("This saved question has an unreadable key.");
      const m = await manifest();
      const spot = m.spots.find(s => s.id === parsed.spotId);
      if (!spot) throw new SolverKeyError("This saved question's spot is no longer in the library.");
      const { street, board } = streetOfPath(spot.flop, parsed.path);
      const chunkKey = chunkKeyForNode({ street, board, path: parsed.path });
      if (!spot.chunks[chunkKey]) throw new SolverKeyError("This saved question's line is no longer in the library.");
      const r = await ranges(spot);
      const node = findLibraryNode(await chunk(spot, chunkKey, r), parsed.path === "" ? [] : parsed.path.split(" "));
      const hand = r.hands[node?.player ?? 0].indexOf(parsed.combo);
      const row = node ? node.live[node.player].indexOf(hand) : -1;
      if (!node || row < 0 || !eligibleHands(node, m.formation.startingPot).includes(row)) throw new SolverKeyError("This saved question's hand is no longer in the library.");
      return buildSolverQuestion({ manifest: m, spot, ranges: r, node, row, seed: seed >>> 0, level });
    },
  };
}
