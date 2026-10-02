/** Prospective P4 selection; only the already-published saved flop policies are read.
 * Fifty cases per parent family, cycling all 12 boards. No continuation solve or timing.
 */
import { parseBridgeCombo, type BridgeAction } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { actionToken, applyPublicEvent, initialPublicState, sizedActionBounds } from "../src/lib/hu-play/public-state";
import { applyStrategy, rangeFromBridge } from "../src/lib/hu-play/reach";
import { fnv1a } from "../src/lib/hu-play/rng";
import { loadLibraryPolicySource } from "../src/lib/hu-play/sources/library";
import type { PlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { preparationKey } from "../src/lib/hu-play/sources/policy";

type Family = "root" | "check" | "bet" | "raise";
export interface FlopOffTreeCase {
  seed: number; librarySpotId: string; family: Family;
  category: "minimum" | "all-in" | "near-all-in" | "interior";
  request: HumanModelRequest; actual: Extract<BridgeAction, { type: "bet" | "raise" }>;
  savedMenu: readonly BridgeAction[];
}
const families = ["root", "check", "bet", "raise"] as const;
function compatible(q: HumanModelRequest) {
  const a = q.ranges.ai.entries.filter(h => h.weight > 0).map(h => parseBridgeCombo(h.combo));
  const b = q.ranges.human.entries.filter(h => h.weight > 0).map(h => parseBridgeCombo(h.combo));
  return a.some(h => b.some(g => !h.some(c => g.includes(c))));
}

export async function buildFlopCorpus(catalog: PlayCatalog, fetcher: typeof fetch = fetch): Promise<FlopOffTreeCase[]> {
  if (catalog.library.spots.length !== 12) throw new Error("P4 corpus requires the unchanged 12 saved flops");
  const parents: { librarySpotId: string; families: Record<Family, { request: HumanModelRequest; menu: readonly BridgeAction[] }[]> }[] = [];
  for (const entry of catalog.library.spots) {
    const library = await loadLibraryPolicySource(catalog, entry.id, undefined, fetcher), spot = library.spot;
    const collected: (typeof parents)[number] = { librarySpotId: entry.id, families: { root: [], check: [], bet: [], raise: [] } };
    const visit = async (q: HumanModelRequest) => {
      const p = q.publicState;
      if (p.status !== "betting" || !compatible(q)) return;
      if (p.path.length > 5) throw new Error("Unexpected saved flop depth");
      await library.prepare(q); const policy = library.policy(q), last = p.events.at(-1);
      const family: Family = !last ? "root" : last.kind === "action" && last.action.type === "check" ? "check"
        : last.kind === "action" && last.action.type === "bet" ? "bet" : "raise";
      if (sizedActionBounds(p)) {
        const aiSeat = (1 - p.toAct!) as 0 | 1;
        collected.families[family].push({ request: { ...q, aiSeat,
          ranges: aiSeat === q.aiSeat ? q.ranges : { ai: q.ranges.human, human: q.ranges.ai } }, menu: policy.actions });
      }
      for (const action of policy.actions) {
        const side = p.toAct === q.aiSeat ? "ai" : "human";
        await visit({ ...q, publicState: applyPublicEvent(p, { kind: "action", player: p.toAct!, action }),
          ranges: { ...q.ranges, [side]: applyStrategy(q.ranges[side], h => policy.probability(action, h)) } });
      }
    };
    await visit({ publicState: initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack,
      minimumBet: 100, flop: spot.board.flop }), aiSeat: 1,
      ranges: { ai: rangeFromBridge(spot.ranges[1]), human: rangeFromBridge(spot.ranges[0]) } });
    if (families.some(f => !collected.families[f].length)) throw new Error("Saved flop lacks a supported prospective parent family");
    parents.push(collected);
  }
  const seen = new Set<string>(), cases: FlopOffTreeCase[] = [];
  for (let seed = 0; seed < 200; seed++) {
    const family = families[Math.floor(seed / 50)], within = seed % 50, board = parents[within % 12];
    const options = board.families[family], parent = options[Math.floor(within / 12) % options.length];
    const request = structuredClone(parent.request), bounds = sizedActionBounds(request.publicState)!;
    const forbidden = new Set(parent.menu.flatMap(a => "to" in a ? [a.to] : []));
    const u = fnv1a(`p4-size|${seed}`) / 2 ** 32;
    const to = [bounds.min, bounds.max, bounds.max - 1, bounds.min + 1 + Math.floor(u * (bounds.max - bounds.min - 2)),
      Math.floor((bounds.min + bounds.max) / 2)][within % 5];
    if (forbidden.has(to) || to < bounds.min || to > bounds.max) throw new Error("Prospective P4 size is not a legal non-menu action");
    const actual = { type: bounds.type, to }, key = preparationKey(request) + actionToken(actual);
    if (seen.has(key)) throw new Error("Prospective P4 corpus repeats a public-parent/action pair");
    seen.add(key);
    cases.push({ seed, librarySpotId: board.librarySpotId, family, request, actual, savedMenu: parent.menu,
      category: to === bounds.min ? "minimum" : to === bounds.max ? "all-in" : to === bounds.max - 1 ? "near-all-in" : "interior" });
  }
  return cases;
}
