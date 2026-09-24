import { parseRiverCombo, riverHandScore } from "../../river/cards";
import { flopActions, nextFlopAction } from "../flop/rules";
import { reachedFlopDeals, type FlopRangeContext } from "./query";
import { FLOP_CONDITIONAL_MIN, type FlopViewNode } from "./model";

const stateKey = (node: FlopViewNode) => JSON.stringify([node.state.phase, node.state.street, node.state.turn, node.state.river,
  node.state.histories, node.state.put, node.state.actor, node.state.folded]);

/** Small exact river evaluation for a Worker. No compiler, CFR session, future-card guess or main-thread fallback. */
export function inspectSavedFlopRiver(scenario: FlopRangeContext, current: FlopViewNode, nodes: ReadonlyMap<number, FlopViewNode>) {
  if (current.state.street !== 2 || !current.state.turn || !current.state.river) throw new Error("River inspection needs both revealed cards");
  const subtree: FlopViewNode[] = [], seen = new Set<number>();
  const visit = (node: FlopViewNode) => {
    if (seen.has(node.id) || subtree.length >= 9 || node.state.street !== 2 || node.state.turn !== current.state.turn
      || node.state.river !== current.state.river || node.state.phase === "card") throw new Error("Invalid or excessive saved river subtree");
    seen.add(node.id); subtree.push(node);
    const actions = flopActions(node.state);
    if (node.edges.length !== actions.length) throw new Error("Saved river action menu differs");
    for (const [a, edge] of node.edges.entries()) {
      const child = nodes.get(edge.node);
      if (!child || child.parent !== node.id || edge.label !== actions[a]
        || stateKey(child) !== stateKey({ ...child, state: nextFlopAction(scenario.request, node.state, actions[a]) })) throw new Error("Saved river action transition differs");
      visit(child);
    }
  };
  visit(current);
  const deals = reachedFlopDeals(scenario, current, nodes), repeatedStates = deals.length * subtree.length;
  if (repeatedStates > 100000 || scenario.hands.some(r => r.length > 64)) throw new Error("River explanation exceeds the 100,000-state browser teaching limit");
  const ranks = scenario.hands.map(range => range.map(cards => {
    const hand = parseRiverCombo(cards); return hand.includes(current.state.turn!) || hand.includes(current.state.river!) ? 0
      : riverHandScore(hand, [...scenario.request.board, current.state.turn!, current.state.river!]);
  }));
  const index = new Map(subtree.map((n, i) => [n.id, i]));
  const reach = new Float64Array(subtree.length), value = new Float64Array(subtree.length), support = new Uint32Array(subtree.length);
  const handRows = subtree.map(n => Array.from({ length: n.state.actor === null ? 0 : scenario.hands[n.state.actor].length }, () => ({ reach: 0, support: 0, checkdown: 0, actions: [new Float64Array(6), new Float64Array(6)] })));
  const work = Array.from({ length: 5 }, () => new Float64Array(6));
  for (const pair of deals) {
    const win = Math.sign(ranks[0][pair.hands[0]] - ranks[1][pair.hands[1]]);
    const walk = (node: FlopViewNode, mass: number, depth: number): Float64Array => {
      const i = index.get(node.id)!, actor = node.state.actor, result = work[depth]; result.fill(0);
      if (node.state.phase === "terminal") {
        const sign = node.state.folded === null ? win : node.state.folded === 0 ? -1 : 1;
        result[0] = sign * (scenario.request.committedPerPlayer + Math.min(...node.state.put));
        result[node.state.folded === 0 ? 1 : node.state.folded === 1 ? 2 : win > 0 ? 3 : win === 0 ? 4 : 5] = 1;
      } else {
        const h = pair.hands[actor!], row = handRows[i][h]; row.reach += mass; row.support++;
        row.checkdown += mass * (actor === 0 ? (win + 1) / 2 : (1 - win) / 2);
        for (const [a, edge] of node.edges.entries()) {
          const probability = node.policy![h][a], child = walk(nodes.get(edge.node)!, mass * probability, depth + 1);
          for (let k = 0; k < 6; k++) { result[k] += probability * child[k]; row.actions[a][k] += mass * child[k]; }
        }
      }
      reach[i] += mass; value[i] += mass * result[0]; support[i]++; return result;
    };
    walk(current, pair.reach, 0);
  }
  const inspected = subtree.map((node, i): FlopViewNode => ({ ...node,
    summary: { reach: reach[i], support: support[i], value0: reach[i] > FLOP_CONDITIONAL_MIN ? value[i] / reach[i] : null },
    hands: handRows[i].flatMap((row, h) => !row.support ? [] : [{ hand: h, reach: row.reach,
      checkdownShare: row.reach > FLOP_CONDITIONAL_MIN ? row.checkdown / row.reach : null,
      actions: row.actions.map(sums => {
        const normalized = row.reach > FLOP_CONDITIONAL_MIN ? Array.from(sums, v => v / row.reach) : null;
        return { ev: normalized ? normalized[0] * (node.state.actor === 0 ? 1 : -1) : null,
          outcomes: normalized ? node.state.actor === 0 ? normalized.slice(1) : [normalized[2], normalized[1], normalized[5], normalized[4], normalized[3]] : null };
      }) }]) }));
  return { nodes: inspected, compatibleDeals: deals.length, publicStates: subtree.length, repeatedStates };
}
