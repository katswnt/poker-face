/** Slow, independent oracle for COMPLETE small games. No engine EV/equity or cached
 * counterfactual values enter the calculation: enumerate compatible private pairs and
 * rivers, evaluate terminal payouts and the exported continuation, then average hidden
 * opponent hands BEFORE comparing choices. Never run this on the UI thread.
 */
import { parseBridgeCombo, validateBridgeSpot, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { gradeBridgeTurn } from "../src/lib/solver/bridge/turn-referee";
import { RIVER_DECK, riverHandScore, type RiverCard } from "../src/lib/solver/river/cards";

type Payload = { nodes: readonly { nodeId: number; actionEv: readonly (readonly (number | null)[])[] }[] };
type WithValues = BridgeResultV1 & { decisionValues?: Payload };

export function recomputeDecisionValues(input: BridgeSpotV1, result: BridgeResultV1) {
  const spot = validateBridgeSpot(input), nodes = result.tree;
  // A river has no later street: its first-street export is already complete.
  // The independent referee below still rejects missing children or terminals.
  if (!spot.board.turn || (!spot.board.river && spot.solve.exportScope !== "full")) throw new Error("Action-value oracle needs a complete turn/river game");
  if (result.hands[0].length * result.hands[1].length * nodes.length > 3_000_000) throw new Error("Tiny-game oracle work limit exceeded");
  // These referees independently check all boards, chance coverage and public chip
  // transitions, including forced prefixes, all-in runouts and returned uncalled bets.
  if (spot.board.river) gradeRiverHands(spot, result, "naive");
  else gradeBridgeTurn(spot, result, "naive");
  const hands = result.hands.map(range => range.map(parseBridgeCombo));
  const policy = nodes.map(n => n.kind === "player" ? n.actions.map((_, a) => n.strategy[a].map((p, h) => {
    const sum = n.strategy.reduce((s, row) => s + (row[h] ?? 0), 0);
    return sum > 0 ? (p ?? 0) / sum : 0;
  })) : []);
  const reach: number[][][] = nodes.map(() => [[], []]);
  const walkReach = (id: number, weights: number[][]) => {
    const n = nodes[id];
    reach[id] = weights.map((row, p) => row.map((w, h) => hands[p][h].some(c => n.board.includes(c)) ? 0 : w));
    if (n.kind === "player") n.actions.forEach((a, i) => walkReach(a.child,
      reach[id].map((row, p) => p === n.player ? row.map((w, h) => w * policy[id][i][h]) : row)));
    else if (n.kind === "chance") n.children.forEach(e => walkReach(e.child, reach[id]));
  };
  walkReach(0, spot.ranges.map(r => r.combos.map(h => h.weight)));
  const numerator = nodes.map(n => n.kind === "player" ? n.actions.map(() => new Float64Array(result.hands[n.player].length)) : []);
  const denominator = nodes.map(n => new Float64Array(n.kind === "player" ? result.hands[n.player].length : 0));
  let compatibleDeals = 0;
  for (let h0 = 0; h0 < hands[0].length; h0++) for (let h1 = 0; h1 < hands[1].length; h1++) {
    const privateCards = [...hands[0][h0], ...hands[1][h1]];
    if (new Set(privateCards).size !== 4) continue;
    compatibleDeals++;
    const indices = [h0, h1], values = new Float64Array(nodes.length).fill(NaN);
    const rankSigns = new Map<string, number>();
    const signAt = (board: readonly RiverCard[]) => {
      const key = board.join();
      let sign = rankSigns.get(key);
      if (sign === undefined) {
        sign = Math.sign(riverHandScore(hands[0][h0], board) - riverHandScore(hands[1][h1], board));
        rankSigns.set(key, sign);
      }
      return sign;
    };
    const evaluate = (id: number): number => {
      if (!Number.isNaN(values[id])) return values[id];
      const n = nodes[id];
      if (privateCards.some(c => n.board.includes(c))) throw new Error("Oracle visited blocked private pair");
      let value = 0;
      if (n.kind === "terminal") {
        if (n.outcome === "fold") value = (n.folder === 0 ? -1 : 1) * (spot.startingPot / 2 + n.committed[n.folder!]);
        else {
          const scale = spot.startingPot / 2 + Math.min(...n.committed);
          if (n.board.length === 5) value = signAt(n.board) * scale;
          else {
            const rivers = RIVER_DECK.filter(c => !n.board.includes(c) && !privateCards.includes(c));
            if (rivers.length !== 44) throw new Error("Incorrect all-in runout coverage");
            value = rivers.reduce((sum, card) => sum + signAt([...n.board, card]) * scale / 44, 0);
          }
        }
      } else if (n.kind === "chance") {
        const compatible = n.children.filter(e => !privateCards.includes(e.card));
        if (compatible.length !== 44) throw new Error("Incorrect explicit river coverage");
        value = compatible.reduce((sum, e) => sum + evaluate(e.child) / 44, 0);
      } else {
        // Evaluate even zero-frequency choices: a parent deviation can reach them.
        value = n.actions.reduce((sum, edge, a) => sum + policy[id][a][indices[n.player]] * evaluate(edge.child), 0);
      }
      values[id] = value;
      return value;
    };
    evaluate(0);
    for (const n of nodes) {
      if (n.kind !== "player" || privateCards.some(c => n.board.includes(c))) continue;
      const p = n.player, h = indices[p], opponentWeight = reach[n.id][1 - p][indices[1 - p]];
      if (!(reach[n.id][p][h] > 0) || !(opponentWeight > 0)) continue;
      denominator[n.id][h] += opponentWeight;
      n.actions.forEach((edge, a) => {
        const fromNow = (p === 0 ? 1 : -1) * evaluate(edge.child) + spot.startingPot / 2 + n.committed[p];
        numerator[n.id][a][h] += opponentWeight * fromNow;
      });
    }
  }
  return { compatibleDeals, nodes: nodes.flatMap(n => n.kind !== "player" ? [] : [{ nodeId: n.id,
    actionEv: numerator[n.id].map(row => Array.from(row, (value, h) => denominator[n.id][h] > 0 ? value / denominator[n.id][h] : null)) }]) };
}

/** The fixed referee-scale gate is NOT a universal bound on arbitrary pot sizes/low reaches. */
export function auditDecisionValues(spot: BridgeSpotV1, result: WithValues) {
  const expected = recomputeDecisionValues(spot, result), actual = result.decisionValues;
  if (!actual || actual.nodes.length !== expected.nodes.length) throw new Error("Decision value node coverage differs");
  let checkedCells = 0, nullCells = 0, maxAbsoluteError = 0;
  for (let i = 0; i < expected.nodes.length; i++) {
    const a = actual.nodes[i], e = expected.nodes[i];
    if (a.nodeId !== e.nodeId || a.actionEv.length !== e.actionEv.length) throw new Error("Decision value action/node order differs");
    e.actionEv.forEach((row, action) => {
      if (a.actionEv[action].length !== row.length) throw new Error("Decision value hand dimensions differ");
      row.forEach((value, h) => {
        const exported = a.actionEv[action][h];
        if (value === null || exported === null) {
          if (value !== exported) throw new Error(`Decision value reach mask differs at node ${e.nodeId}, action ${action}, hand ${h}: oracle ${value}, exported ${exported}`);
          nullCells++;
        } else {
          const error = Math.abs(exported - value);
          if (!Number.isFinite(exported) || error > 2e-4) throw new Error(`Decision value differs at node ${e.nodeId}, action ${action}, hand ${h}: oracle ${value}, exported ${exported}, error ${error}`);
          checkedCells++; maxAbsoluteError = Math.max(maxAbsoluteError, error);
        }
      });
    });
  }
  return { compatibleDeals: expected.compatibleDeals, playerNodes: expected.nodes.length, checkedCells, nullCells, maxAbsoluteError };
}
