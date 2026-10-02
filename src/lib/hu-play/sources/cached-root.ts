/** Cached turn roots and unchanged bounded live misses/rivers. A hit is still an
 * approximate local solve; provenance distinguishes how the policy was delivered.
 */
import { sha256 } from "../../solver/bridge/live/loader";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import type { HumanModelRequest } from "../hand";
import type { DecisionProvenance } from "../types";
import { ResolvedPolicySource, type PublicSolve } from "./resolved";
import type { TurnPolicyCache, TurnCacheLookup } from "./turn-cache";

export class CachedPlayRootSource extends ResolvedPolicySource {
  private readonly evidence: Map<string, NonNullable<DecisionProvenance["cache"]>>;
  constructor(cache: TurnPolicyCache, live: PublicSolve, onLookup?: (lookup: TurnCacheLookup) => void) {
    const evidence = new Map<string, NonNullable<DecisionProvenance["cache"]>>();
    super(async (spot, signal) => {
      signal?.throwIfAborted();
      if (spot.board.river !== null) return live(spot, signal);
      const lookup = await cache.lookup(spot, signal); signal?.throwIfAborted(); onLookup?.(lookup);
      signal?.throwIfAborted();
      const result = lookup.kind === "hit" ? lookup.result : await live(spot, signal);
      const hash = await sha256(new TextEncoder().encode(canonicalSolverJson(spot))); signal?.throwIfAborted();
      evidence.set(hash, lookup.kind === "hit" ? { status: "hit", key: lookup.key, chunkSha256: lookup.chunkSha256 }
        : { status: "miss", key: lookup.key, reason: lookup.reason });
      // Detached historical policies retain their own evidence. Keep this lookup bounded
      // even when the controller is reused for many deals.
      while (evidence.size > 8) evidence.delete(evidence.keys().next().value!);
      return result;
    });
    this.evidence = evidence;
  }
  policy(request: HumanModelRequest) {
    const p = super.policy(request), cache = this.evidence.get(p.provenance.spotHash);
    return cache ? { ...p, provenance: { ...p.provenance, cache } } : p;
  }
}
