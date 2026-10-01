import { validateBridgeSpot, type BridgeAction, type BridgeSpotV1 } from "../../solver/bridge/contract";
import { libraryRangesFromSpot, validateLibraryChunk } from "../../solver/bridge/library/load";
import { chunkKeyForNode, type BridgeLibraryChunk, type BridgeLibrarySpot } from "../../solver/bridge/library/model";
import { parseActionToken } from "../../solver/bridge/library/query";
import type { HumanModelRequest } from "../hand";
import { readPlayJson, validatePlayFlop, type PlayCatalog, type PlayFlopPolicy } from "./library-data";
import { nodePolicy, preparationKey, PreparedPolicySource } from "./policy";

function fromToken(token: string): BridgeAction {
  const a = parseActionToken(token);
  return a.kind === "bet" || a.kind === "raise" ? { type: a.kind, to: a.to! } : { type: a.kind };
}

export class LibraryPolicySource extends PreparedPolicySource {
  private saved = new Map<string, BridgeLibraryChunk>();
  constructor(readonly entry: BridgeLibrarySpot, readonly spot: BridgeSpotV1, private readonly flop: PlayFlopPolicy,
    private readonly fetcher: typeof fetch = fetch) { super(); }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    if (this.prepared?.key === key) return;
    const p = request.publicState;
    if (p.flop.join() !== this.spot.board.flop.join() || p.startingPot !== this.spot.startingPot
      || p.startingStack !== this.spot.effectiveStack) throw new Error("Saved policy belongs to a different formation");
    const path = p.path.join(" ");
    const provenance = { source: "library" as const, spotHash: this.entry.spotHash, librarySpotId: this.entry.id,
      ladder: { rung: "library" as const, prunedMass: [0, 0] as const, profile: null, policyEncoding: "per-mille" as const } };
    if (p.street === "flop") {
      const n = this.flop.nodes.find(n => n.path === path);
      if (!n || n.committed.some((v, i) => v !== p.closed + p.streetPut[i])) throw new Error("No exact saved flop decision");
      const policy = nodePolicy(request, { player: n.player, hands: this.flop.hands[n.player], actions: n.actions.map(fromToken),
        rows: n.strategy, encoding: "per-mille", provenance,
        actionEvRows: n.actionEv.map(row => row.map(v => v === null ? null : v / 10)) });
      signal?.throwIfAborted(); this.prepared = { key, policy }; return;
    }
    const board = [...p.board.flop, p.board.turn!, ...(p.board.river ? [p.board.river] : [])];
    const chunkKey = chunkKeyForNode({ street: p.street, board, path });
    const ref = this.entry.chunks[chunkKey]; if (!ref) throw new Error("No saved policy for this board; a live solve is required");
    if (!this.saved.has(chunkKey)) {
      const read = await readPlayJson(ref.url, signal, this.fetcher, ref);
      const chunk = validateLibraryChunk(read.value, this.entry, chunkKey, libraryRangesFromSpot(this.spot, this.entry));
      signal?.throwIfAborted(); this.saved.set(chunkKey, chunk);
    }
    const n = this.saved.get(chunkKey)!.nodes.find(n => n.path === path);
    if (!n || n.committed.some((v, i) => v !== p.closed + p.streetPut[i])) throw new Error("No exact saved decision on this line");
    const policy = nodePolicy(request, { player: n.player, hands: n.live[n.player].map(h => this.spot.ranges[n.player].combos[h].combo),
      actions: n.actions.map(fromToken), rows: n.strategy, encoding: "per-mille", provenance,
      actionEvRows: n.actionEv.map(row => row.map(v => v === null ? null : v / 10)) });
    signal?.throwIfAborted(); this.prepared = { key, policy };
  }
}

export async function loadLibraryPolicySource(catalog: PlayCatalog, id: string, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<LibraryPolicySource> {
  const entry = catalog.library.spots.find(s => s.id === id), supplement = catalog.supplement.spots.find(s => s.id === id);
  if (!entry || !supplement) throw new Error("Unknown saved flop");
  const [spotRead, oldRead, extraRead] = await Promise.all([entry.spot, entry.chunks.flop, supplement]
    .map(ref => readPlayJson(ref.url, signal, fetcher, ref)));
  const spot = validateBridgeSpot(spotRead.value);
  const old = validateLibraryChunk(oldRead.value, entry, "flop", libraryRangesFromSpot(spot, entry));
  const flop = validatePlayFlop(extraRead.value, entry, spot, old);
  signal?.throwIfAborted();
  return new LibraryPolicySource(entry, spot, flop, fetcher);
}
