/** Frozen diagnostic games through production preparation. No private hand fields. */
import assert from "node:assert/strict";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import { actionToken } from "../src/lib/hu-play/public-state";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { loadP1WideRoots } from "./hu-play-wide-corpus";
import { probeLibraryPrefixes } from "./hu-play-library-probe";

export function gameProjection(spot: BridgeSpotV1) {
  const { solve, ...game } = spot; void solve; return game;
}

export function loadP1ProductionRoots() {
  const roots = loadP1WideRoots(), probe = probeLibraryPrefixes([...new Set(roots.map(r => r.seed))]);
  return roots.map(root => {
    const matches = probe.roots.filter(r => r.seed === root.seed && r.publicState.path.join(" ") === root.path.join(" "));
    assert.equal(matches.length, 1);
    const aiSeat = root.seed % 2 as 0 | 1;
    // The frozen finite game's exact float32 weights, NOT a claim to recover the original
    // unrounded double-precision reaches before the frozen spot was constructed.
    const request: HumanModelRequest = { publicState: matches[0].publicState, aiSeat,
      ranges: { ai: rangeFromBridge(root.spot.ranges[aiSeat]), human: rangeFromBridge(root.spot.ranges[1 - aiSeat]) } };
    const spot = buildPlaySpot(request);
    assert.deepEqual(gameProjection(spot), gameProjection(root.spot), "Production preparation changed the frozen game");
    return { ...root, request, playingSpot: spot };
  });
}

/** Compare only the complete first-street policy, not the unexported future policies.
 * Expanding rivers changes descendant IDs, so bind decisions by public action path. */
export function firstStreetProjection(result: BridgeResultV1) {
  const rows: unknown[] = [];
  const visit = (id: number, path: readonly string[]) => {
    const n = result.tree[id], common = { path, kind: n.kind, board: n.board, committed: n.committed };
    if (n.kind === "chance") { rows.push(common); return; }
    if (n.kind === "terminal") { rows.push({ ...common, outcome: n.outcome, folder: n.folder }); return; }
    rows.push({ ...common, player: n.player, street: n.street, strategy: n.strategy,
      actions: n.actions.map(e => ({ action: e.action, engineAction: e.engineAction })) });
    for (const e of n.actions) visit(e.child, [...path, actionToken(e.action)]);
  };
  visit(0, []);
  return { hands: result.hands, root: result.root, iterations: result.iterations, exploitability: result.exploitability, rows };
}
