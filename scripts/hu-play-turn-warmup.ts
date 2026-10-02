/** Prospective P3 coverage: all public turn cards after every unraised common flop line.
 * No seeds, dealt hands, timing results, or observed cache misses select these inputs.
 */
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { RIVER_DECK, type RiverCard } from "../src/lib/solver/river/cards";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { actionToken, applyPublicEvent, initialPublicState } from "../src/lib/hu-play/public-state";
import { applyStrategy, rangeFromBridge, removeCard } from "../src/lib/hu-play/reach";
import { loadLibraryPolicySource } from "../src/lib/hu-play/sources/library";
import type { PlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";

export type CommonTurnRoot = {
  readonly librarySpotId: string; readonly flopPath: readonly string[]; readonly turn: RiverCard;
} & (
  | { readonly status: "ready"; readonly request: HumanModelRequest; readonly spot: BridgeSpotV1; readonly spotHash: string }
  | { readonly status: "unsupported"; readonly reason: string }
);

export async function commonTurnRoots(catalog: PlayCatalog, fetcher: typeof fetch = fetch): Promise<CommonTurnRoot[]> {
  const roots: CommonTurnRoot[] = [];
  for (const entry of catalog.library.spots) {
    const source = await loadLibraryPolicySource(catalog, entry.id, undefined, fetcher);
    const request: HumanModelRequest = { publicState: initialPublicState({ flop: source.spot.board.flop,
      startingPot: source.spot.startingPot, startingStack: source.spot.effectiveStack, minimumBet: 100 }), aiSeat: 0,
      ranges: { ai: rangeFromBridge(source.spot.ranges[0]), human: rangeFromBridge(source.spot.ranges[1]) } };
    const walk = async (q: HumanModelRequest) => {
      const p = q.publicState;
      if (p.status === "chance") {
        for (const turn of RIVER_DECK.filter(c => !p.flop.includes(c))) {
          const common = { librarySpotId: entry.id, flopPath: [...p.path], turn };
          try {
            const next = { ...q, publicState: applyPublicEvent(p, { kind: "card", street: "turn", card: turn }),
              ranges: { ai: removeCard(q.ranges.ai, turn), human: removeCard(q.ranges.human, turn) } };
            const spot = buildPlaySpot(next);
            roots.push({ ...common, status: "ready", request: next, spot, spotHash: hashBridgeSpot(spot) });
          } catch (error) {
            roots.push({ ...common, status: "unsupported", reason: error instanceof Error ? error.message : String(error) });
          }
        }
        return;
      }
      if (p.status !== "betting" || p.street !== "flop") throw new Error("A common flop line unexpectedly ended before the turn");
      await source.prepare(q); const policy = source.policy(q), player = p.toAct!;
      for (const action of policy.actions) {
        if (action.type === "fold" || action.type === "raise") continue;
        const slot = player === q.aiSeat ? "ai" : "human";
        const next = { ...q, publicState: applyPublicEvent(p, { kind: "action", player, action }),
          ranges: { ...q.ranges, [slot]: applyStrategy(q.ranges[slot], hand => policy.probability(action, hand)) } };
        if (!next.ranges[slot].entries.some(h => h.weight > 0)) {
          // Preserve each intended board/line even when no posterior exists.
          for (const turn of RIVER_DECK.filter(c => !p.flop.includes(c))) {
            roots.push({ librarySpotId: entry.id, flopPath: [...p.path, actionToken(action)], turn,
              status: "unsupported", reason: "The common flop action has no positive modelled reach" });
          }
        } else await walk(next);
      }
    };
    await walk(request);
  }
  return roots;
}
