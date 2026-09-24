import { parseRiverCombo } from "../../river/cards";
import { FLOP_CONDITIONAL_MIN, type FlopHandFacts, type FlopScenario, type FlopViewNode } from "./model";

export interface ReachedFlopDeal { hands: readonly [number, number]; reach: number }
export type FlopRangeContext = Pick<FlopScenario, "request" | "hands" | "weights">;
/** Both hands stay unknown for public navigation. Inspecting a hand is a later query. */
export function reachedFlopDeals(scenario: FlopRangeContext, current: FlopViewNode, nodes: ReadonlyMap<number, FlopViewNode>): ReachedFlopDeal[] {
  const ancestry: { parent: FlopViewNode; action: number }[] = [], seen = new Set<number>(); let child = current;
  while (child.parent !== null) {
    if (seen.has(child.id) || seen.size > 16) throw new Error("Invalid saved history"); seen.add(child.id);
    const parent = nodes.get(child.parent), action = parent?.edges.findIndex(e => e.node === child.id) ?? -1;
    if (!parent || action < 0) throw new Error("Saved history is missing its ancestry");
    ancestry.push({ parent, action }); child = parent;
  }
  if (child.id !== 0) throw new Error("Saved history does not start at the root");
  const hands = scenario.hands.map(range => range.map(parseRiverCombo)), pairs: ReachedFlopDeal[] = [];
  const board = [current.state.turn, current.state.river]; let total = 0;
  for (const [a, left] of hands[0].entries()) for (const [b, right] of hands[1].entries()) {
    if (left.some(c => right.includes(c))) continue;
    const weight = scenario.weights[0][a] * scenario.weights[1][b]; total += weight;
    if ([...left, ...right].some(c => board.includes(c))) continue;
    const pair = [a, b] as const; let reach = weight;
    for (const { parent, action } of ancestry) {
      if (parent.state.phase === "card") reach /= parent.state.street === 0 ? 45 : 44;
      else if (parent.policy && parent.state.actor !== null) reach *= parent.policy[pair[parent.state.actor]][action];
      else throw new Error("Invalid saved action ancestry");
    }
    pairs.push({ hands: pair, reach });
  }
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("Saved ranges have no compatible root mass");
  return pairs.map(p => ({ hands: p.hands, reach: p.reach / total }));
}

export function flopHandDetails(scenario: FlopScenario, node: FlopViewNode, hand: FlopHandFacts,
  nodes: ReadonlyMap<number, FlopViewNode>, pairs = reachedFlopDeals(scenario, node, nodes)) {
  const actor = node.state.actor; if (actor === null || !node.policy) throw new Error("Not a saved decision");
  const other = 1 - actor, matching = pairs.filter(p => p.hands[actor] === hand.hand), reach = matching.reduce((s, p) => s + p.reach, 0);
  if (Math.abs(reach - hand.reach) > 1e-12) throw new Error("Saved conditional reach differs from its history");
  const known = reach > FLOP_CONDITIONAL_MIN, opponent = known ? Array<number>(scenario.hands[other].length).fill(0) : null;
  if (opponent) for (const pair of matching) opponent[pair.hands[other]] += pair.reach / reach;
  const actions = hand.actions.map((fact, a) => {
    const next = nodes.get(node.edges[a].node), immediate = next?.state.phase === "play" && next.state.actor === other;
    const responses = immediate ? next.edges.map((edge, r) => {
      const weights = opponent?.map((w, h) => w * next.policy![h][r]) ?? null;
      const probability = weights?.reduce((s, w) => s + w, 0) ?? null;
      return { action: edge.label, probability, opponent: probability !== null && probability > FLOP_CONDITIONAL_MIN ? weights!.map(w => w / probability) : null };
    }) : [];
    const showdown = fact.outcomes ? fact.outcomes[2] + fact.outcomes[3] + fact.outcomes[4] : 0;
    return { ...fact, label: node.edges[a].label, frequency: node.policy![hand.hand][a],
      evFromNow: fact.ev === null ? null : fact.ev + scenario.request.committedPerPlayer + node.state.put[actor],
      gap: fact.ev === null ? null : Math.max(...hand.actions.map(a => a.ev!)) - fact.ev,
      showdownShare: fact.outcomes && showdown > FLOP_CONDITIONAL_MIN ? (fact.outcomes[2] + fact.outcomes[3] / 2) / showdown : null,
      // No immediate fold choice has probability zero, not an unknown value.
      // Truly unsupported conditionals (off-path/tiny reach) remain unavailable.
      foldNext: known ? responses.find(r => r.action === "fold")?.probability ?? 0 : null, responses };
  });
  return { opponent, actions };
}

export function flopCallPrice(scenario: FlopScenario, node: FlopViewNode) {
  const actor = node.state.actor;
  if (actor === null) return { cost: 0, potAfterCall: 0, share: null };
  const cost = Math.min(Math.max(0, node.state.put[1 - actor] - node.state.put[actor]), scenario.request.stackBehind[actor] - node.state.put[actor]);
  const potAfterCall = 2 * (scenario.request.committedPerPlayer + Math.min(node.state.put[actor] + cost, node.state.put[1 - actor]));
  return { cost, potAfterCall, share: cost > 0 ? cost / potAfterCall : null };
}
