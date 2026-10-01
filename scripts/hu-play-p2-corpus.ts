/** Frozen selection rule: roots seed%32; parent family floor(seed/32)%4; size seed%5.
 * Selection uses only the existing P1 policy, never an off-tree solve's outcome or timing.
 */
import type { BridgeAction, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { actionToken, applyPublicEvent, sizedActionBounds } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import { leanRiverActions } from "../src/lib/hu-play/river-tree";
import { fnv1a } from "../src/lib/hu-play/rng";
import { nodePolicy, preparationKey } from "../src/lib/hu-play/sources/policy";
import { parseBridgeCombo } from "../src/lib/solver/bridge/contract";

export function makeRiverOffTreeCase(seed: number, root: HumanModelRequest, result: BridgeResultV1) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 200) throw new Error("P2 seeds are 0 through 199");
  preparationKey(root);
  const candidates: { request: HumanModelRequest; node: number; line: BridgeAction[] }[] = [];
  const visit = (request: HumanModelRequest, node: number, line: BridgeAction[]) => {
    const n = result.tree[node]; if (n.kind !== "player" || line.length > 2) return;
    if (!request.ranges.ai.entries.some(h => h.weight > 0) || !request.ranges.human.entries.some(h => h.weight > 0)) return;
    const joint = request.ranges.ai.entries.some(h => h.weight > 0 && request.ranges.human.entries.some(g =>
      g.weight > 0 && !parseBridgeCombo(h.combo).some(c => parseBridgeCombo(g.combo).includes(c))));
    if (!joint) return;
    const bounds = sizedActionBounds(request.publicState), menu = leanRiverActions(request.publicState);
    const forbidden = new Set(menu.flatMap(a => "to" in a ? [a.to] : []));
    if (bounds && bounds.max - bounds.min + 1 > forbidden.size) candidates.push({ request, node, line });
    const policy = nodePolicy(request, { player: n.player, hands: result.hands[n.player], actions: n.actions.map(e => e.action),
      rows: n.strategy, encoding: "float32", provenance: { source: "resolve", kind: "street-root", spotHash: result.spotHash,
        iterations: result.iterations, exploitabilityPctPot: result.exploitability.pctPot, precision: "float32",
        bridgeVersion: result.engine.bridgeVersion, engineCommit: result.engine.commit, degradation: 0 } });
    for (const e of n.actions) {
      const ai = n.player === request.aiSeat, range = ai ? request.ranges.ai : request.ranges.human;
      const changed = applyStrategy(range, h => policy.probability(e.action, h));
      visit({ ...request, publicState: applyPublicEvent(request.publicState, { kind: "action", player: n.player, action: e.action }),
        ranges: ai ? { ...request.ranges, ai: changed } : { ...request.ranges, human: changed } }, e.child, [...line, e.action]);
    }
  };
  visit(root, 0, []);
  const family = Math.floor(seed / 32) % 4;
  const matches = (line: BridgeAction[]) => family === 0 ? line.length === 0
    : family === 1 ? line.length === 1 && line[0].type === "check"
    : family === 2 ? line.length === 1 && line[0].type === "bet"
    : line.length === 2 && line[0].type === "bet" && line[1].type === "raise";
  const candidate = candidates.find(c => matches(c.line)) ?? candidates[0];
  if (!candidate) throw new Error(`No legal off-tree amount for frozen case ${seed}`);
  const { request: before, node, line } = candidate, aiSeat = (1 - before.publicState.toAct!) as 0 | 1;
  const request: HumanModelRequest = { ...before, aiSeat,
    ranges: aiSeat === before.aiSeat ? before.ranges : { ai: before.ranges.human, human: before.ranges.ai } };
  const bounds = sizedActionBounds(request.publicState)!, menu = leanRiverActions(request.publicState);
  const forbidden = new Set(menu.flatMap(a => "to" in a ? [a.to] : []));
  const u = fnv1a(`p2-size|${seed}`) / 2 ** 32;
  let to = [bounds.min, bounds.max, bounds.max - 1, bounds.min + Math.floor(u * (bounds.max - bounds.min + 1)),
    Math.floor((bounds.min + bounds.max) / 2)][seed % 5];
  to = Math.max(bounds.min, Math.min(bounds.max, to));
  if (forbidden.has(to)) {
    // A menu all-in is not an off-tree case. Choose the closest legal non-menu integer,
    // preferring the smaller on ties; record its actual category, never relabel it all-in.
    for (let d = 1; d <= forbidden.size + 1; d++) {
      const found = [to - d, to + d].find(x => x >= bounds.min && x <= bounds.max && !forbidden.has(x));
      if (found !== undefined) { to = found; break; }
    }
  }
  if (forbidden.has(to)) throw new Error("No non-menu amount found");
  const category = to === bounds.max ? "all-in" : to === bounds.min ? "minimum" : to === bounds.max - 1 ? "near-all-in" : "interior";
  return { seed, preferredFamily: family, usedPreferredFamily: matches(line), baselineNode: node, baselinePath: line.map(actionToken),
    category, request, actual: { type: bounds.type, to } as Extract<BridgeAction, { type: "bet" | "raise" }> };
}
