import type { FlopRangeContext } from "./query";
import type { FlopViewNode } from "./model";
import { inspectSavedFlopRiver } from "./river";
import { validateFlopRangeContext } from "./load";
import { flopActions, initialFlopState, nextFlopAction, nextFlopCard } from "../flop/rules";
import { parseRiverCombo } from "../../river/cards";

export interface FlopInspectionRequest { id: number; sourceHash: string; context: FlopRangeContext; node: number; nodes: FlopViewNode[] }
export type FlopInspectionReply = { id: number; sourceHash: string; node: number; type: "result"; nodes: FlopViewNode[];
  elapsedMs: number; compatibleDeals: number; publicStates: number; repeatedStates: number }
  | { id: number; sourceHash: string; node: number; type: "error"; message: string };
export function evaluateFlopInspection(request: FlopInspectionRequest): FlopInspectionReply {
  try {
    if (!Number.isSafeInteger(request.id) || request.id < 1 || !/^[0-9a-f]{64}$/.test(request.sourceHash)
      || !Array.isArray(request.nodes) || request.nodes.length > 500) throw new Error("Invalid river inspection request");
    validateFlopRangeContext(request.context);
    const hands = request.context.hands.map(r => r.map(parseRiverCombo)), liveBoards = new Map<string, boolean[][]>();
    for (const node of request.nodes) {
      if (!Number.isSafeInteger(node.id) || node.id < 0 || node.id >= 250000 || !Array.isArray(node.state.histories)
        || node.state.histories.length !== 3 || !Number.isInteger(node.state.street) || node.state.street < 0 || node.state.street > 2) throw new Error("Invalid inspection state");
      let replay = initialFlopState(request.context.request);
      for (let t = 0; t < 3; t++) {
        const history = node.state.histories[t];
        if (!Array.isArray(history) || history.length > 3 || t > node.state.street && history.length) throw new Error("Invalid inspection history");
        if (t > node.state.street) continue;
        if (t > 0) replay = nextFlopCard(request.context.request, replay, (t === 1 ? node.state.turn : node.state.river)!);
        for (const action of history) replay = nextFlopAction(request.context.request, replay, action);
      }
      for (const key of ["phase", "street", "turn", "river", "put", "actor", "folded"] as const)
        if (JSON.stringify(replay[key]) !== JSON.stringify(node.state[key])) throw new Error("Inspection state differs from its history");
      if (!Array.isArray(node.edges) || node.edges.length !== (replay.phase === "card" ? replay.street === 0 ? 49 : 48 : flopActions(replay).length)) throw new Error("Invalid inspection edges");
      if (replay.actor === null) { if (node.policy !== null) throw new Error("Unexpected inspection policy"); }
      else {
        const key = `${replay.turn}/${replay.river}`;
        if (!liveBoards.has(key)) liveBoards.set(key, hands.map((range, p) => range.map(h => !h.some(c => c === replay.turn || c === replay.river)
          && hands[1 - p].some(o => !o.some(c => h.includes(c) || c === replay.turn || c === replay.river)))));
        const live = liveBoards.get(key)![replay.actor];
        if (!Array.isArray(node.policy) || node.policy.length !== request.context.hands[replay.actor].length
          || node.policy.some((row, h) => !Array.isArray(row) || row.length !== 2 || row.some(p => !Number.isFinite(p) || p < 0 || p > 1)
            || Math.abs(row[0] + row[1] - (live[h] ? 1 : 0)) > 1e-12)) throw new Error("Invalid inspection policy");
      }
    }
    const started = performance.now(), nodes = new Map(request.nodes.map(n => [n.id, n])), current = nodes.get(request.node);
    if (nodes.size !== request.nodes.length || !current) throw new Error("Missing or duplicate river inspection node");
    for (const node of nodes.values()) {
      if (node.parent === null) { if (node.id !== 0) throw new Error("Invalid inspection root"); continue; }
      const parent = nodes.get(node.parent), edge = parent?.edges.find(e => e.node === node.id);
      if (!parent || !edge) throw new Error("Missing inspection ancestry");
      const expected = parent.state.phase === "card"
        ? nextFlopCard(request.context.request, parent.state, edge.label as NonNullable<typeof node.state.turn>)
        : nextFlopAction(request.context.request, parent.state, edge.label as Parameters<typeof nextFlopAction>[2]);
      for (const key of ["phase", "street", "turn", "river", "put", "actor", "folded", "histories"] as const)
        if (JSON.stringify(expected[key]) !== JSON.stringify(node.state[key])) throw new Error("Inspection ancestry differs from its public history");
    }
    const result = inspectSavedFlopRiver(request.context, current, nodes);
    return { id: request.id, sourceHash: request.sourceHash, node: request.node, type: "result", ...result, elapsedMs: performance.now() - started };
  } catch (error) { return { id: request?.id ?? -1, sourceHash: request?.sourceHash ?? "", node: request?.node ?? -1, type: "error", message: error instanceof Error ? error.message : String(error) }; }
}
