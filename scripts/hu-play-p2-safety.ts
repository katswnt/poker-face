/** Prospectively defined P2 comparison: the old AI everywhere except below the actual bet.
 * These are derived profiles, NOT native solves or whole-game safety certificates.
 */
import assert from "node:assert/strict";
import { validateBridgeSpot, type BridgeAction, type BridgeExplicitNode, type BridgeResultNode,
  type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { gradeRiverProfile, type RiverProfile } from "../src/lib/solver/bridge/river-hand-values";
import { actionToken, applyPublicEvent } from "../src/lib/hu-play/public-state";
import type { HeadsUpPublicState } from "../src/lib/hu-play/types";
import { hasCompatibleAction } from "../src/lib/hu-play/sources/nested-river";
import { nodePolicy } from "../src/lib/hu-play/sources/policy";
import type { ResolvedTreeSnapshot } from "../src/lib/hu-play/sources/resolved";
import type { RiverOffTreeCase } from "./hu-play-p2-playing-case";

type PlayerNode = Extract<BridgeResultNode, { kind: "player" }>;
function player(profile: RiverProfile, id: number): PlayerNode {
  const n = profile.tree[id]; assert.equal(n.kind, "player"); return n as PlayerNode;
}
function prefixNodes(spot: BridgeSpotV1, profile: RiverProfile) {
  assert.equal(spot.tree.mode, "river-subgame-v1");
  const count = spot.tree.mode === "river-subgame-v1" ? spot.tree.prefixLength : -1;
  const prefix: PlayerNode[] = []; let at = 0;
  for (let i = 0; i < count; i++) { const n = player(profile, at); assert.equal(n.actions.length, 1); prefix.push(n); at = n.actions[0].child; }
  return { prefix, parent: at };
}
function projectedRows(source: RiverProfile, node: PlayerNode, hands: RiverProfile["hands"]) {
  const indices = hands[node.player].map(h => source.hands[node.player].indexOf(h));
  assert.ok(indices.every(i => i >= 0), "A composed policy must cover every positive parent hand");
  return node.strategy.map(row => indices.map(i => row[i]));
}
function copyTree(source: RiverProfile, root: number, hands: RiverProfile["hands"], prefix: readonly PlayerNode[] = [],
  onlyEdge?: { node: number; action: BridgeAction }): RiverProfile {
  const tree: BridgeResultNode[] = prefix.map((n, id) => ({ ...structuredClone(n), id,
    strategy: [hands[n.player].map(() => 1)], actions: [{ ...n.actions[0], child: id + 1 }] }));
  const copy = (from: number): number => {
    const old = source.tree[from], id = tree.length;
    assert.notEqual(old.kind, "chance"); tree.push({ ...structuredClone(old), id });
    if (old.kind === "player") {
      const rows = projectedRows(source, old, hands), forced = onlyEdge?.node === from;
      const edges = forced ? old.actions.filter(e => actionToken(e.action) === actionToken(onlyEdge.action)) : old.actions;
      assert.ok(edges.length > 0);
      tree[id] = { ...old, id, strategy: forced ? [hands[old.player].map(() => 1)] : rows,
        actions: edges.map(e => ({ ...e, child: copy(e.child) })) };
    }
    return id;
  };
  copy(root); return { hands: structuredClone(hands), tree };
}
function explicit(profile: RiverProfile, id = 0): BridgeExplicitNode {
  const n = profile.tree[id]; assert.notEqual(n.kind, "chance");
  if (n.kind === "terminal") return { kind: "terminal", outcome: n.outcome };
  assert.equal(n.kind, "player"); const p = n as PlayerNode;
  return { kind: "player", player: p.player, actions: p.actions.map(e => ({ action: e.action, next: explicit(profile, e.child) })) };
}
function withTree(spot: BridgeSpotV1, profile: RiverProfile, prefixLength: number, suffix: string) {
  return validateBridgeSpot({ ...spot, id: `${spot.id}-${suffix}`, tree: { mode: "river-subgame-v1", prefixLength, root: explicit(profile) } });
}
function size(action: BridgeAction, p: HeadsUpPublicState) {
  const previous = Math.max(...p.streetPut), afterCall = p.pot + previous - p.streetPut[p.toAct!];
  return "to" in action ? (action.to - previous) / afterCall : 0;
}

export function compareRiverPolicies(c: RiverOffTreeCase, expanded: { spot: BridgeSpotV1; result: BridgeResultV1 },
  previous: ResolvedTreeSnapshot, response: ResolvedTreeSnapshot) {
  const { spot, result } = expanded, ai = c.request.aiSeat, human = (1 - ai) as 0 | 1;
  const { prefix, parent } = prefixNodes(spot, result), expandedParent = player(result, parent);
  const oldParent = player(previous.result, previous.parentNode);
  assert.equal(expandedParent.player, human); assert.equal(oldParent.player, human);
  assert.equal(spot.startingPot, previous.spot.startingPot); assert.equal(spot.effectiveStack, previous.spot.effectiveStack);
  assert.deepEqual(expandedParent.committed, oldParent.committed);
  assert.deepEqual(spot.board, previous.spot.board); assert.deepEqual(spot.board, response.spot.board);
  const actualEdge = expandedParent.actions.find(e => actionToken(e.action) === actionToken(c.actual)); assert.ok(actualEdge);
  const actualNode = player(result, actualEdge.child), responseNode = player(response.result, response.parentNode);
  assert.equal(actualNode.player, ai); assert.equal(responseNode.player, ai);
  assert.deepEqual(actualNode.committed, responseNode.committed);
  // This audit's simple action mapping is valid only for one remaining AI decision.
  const assertNoLaterAi = (id: number) => {
    const n = result.tree[id]; assert.notEqual(n.kind, "chance");
    if (n.kind === "player") { assert.equal(n.player, human); n.actions.forEach(e => assertNoLaterAi(e.child)); }
  };
  actualNode.actions.forEach(e => assertNoLaterAi(e.child));
  const oldProfile = copyTree(previous.result, previous.parentNode, result.hands, prefix);
  const oldSpot = withTree(spot, oldProfile, prefix.length, "previous");
  const actual: RiverProfile = structuredClone({ hands: result.hands, tree: result.tree });
  const setAi = (to: PlayerNode, fromProfile: RiverProfile, from: PlayerNode) => {
    assert.equal(to.player, ai); assert.equal(from.player, ai);
    const rows = projectedRows(fromProfile, from, result.hands);
    Object.assign(to, { strategy: to.actions.map(e => {
      const at = from.actions.findIndex(f => actionToken(f.action) === actionToken(e.action)); assert.ok(at >= 0); return rows[at];
    }) });
    assert.equal(to.actions.length, from.actions.length);
  };
  const copyOldAi = (toId: number, oldId: number) => {
    const to = actual.tree[toId], old = previous.result.tree[oldId]; assert.equal(to.kind, old.kind);
    if (to.kind === "player" && old.kind === "player") {
      assert.equal(to.player, old.player); assert.deepEqual(to.committed, old.committed);
      if (to.player === ai) setAi(to, previous.result, old);
      assert.equal(to.actions.length, old.actions.length);
      for (const edge of to.actions) {
        const ref = old.actions.find(e => actionToken(e.action) === actionToken(edge.action)); assert.ok(ref); copyOldAi(edge.child, ref.child);
      }
    }
  };
  for (const e of expandedParent.actions) if (e.child !== actualEdge.child) {
    const old = oldParent.actions.find(f => actionToken(f.action) === actionToken(e.action)); assert.ok(old); copyOldAi(e.child, old.child);
  }
  setAi(player(actual, actualEdge.child), response.result, responseNode);
  const policy = nodePolicy(c.request, { player: human, hands: previous.result.hands[human], rows: oldParent.strategy,
    actions: oldParent.actions.map(e => e.action), encoding: "float32", provenance: { source: "resolve", kind: "street-root",
      spotHash: previous.result.spotHash, iterations: previous.result.iterations, exploitabilityPctPot: previous.result.exploitability.pctPot,
      precision: "float32", bridgeVersion: previous.result.engine.bridgeVersion, engineCommit: previous.result.engine.commit, degradation: 0 } });
  const candidates = oldParent.actions.filter(e => e.action.type !== "fold" && hasCompatibleAction(c.request, policy, e.action));
  const x = size(c.actual, c.request.publicState);
  candidates.sort((a, b) => Math.abs(size(a.action, c.request.publicState) - x) - Math.abs(size(b.action, c.request.publicState) - x)
    || size(a.action, c.request.publicState) - size(b.action, c.request.publicState));
  const nearest = candidates[0]; assert.ok(nearest, "No supported nearest-menu comparator");
  const virtual = previous.result.tree[nearest.child]; assert.notEqual(virtual.kind, "chance");
  const translated: RiverProfile = structuredClone(actual), to = player(translated, actualEdge.child);
  const rows = to.actions.map(() => result.hands[ai].map(() => 0));
  const mappedAi: { from: BridgeAction | "virtual-terminal"; to: BridgeAction }[] = [];
  const call = to.actions.findIndex(e => e.action.type === "call"); assert.ok(call >= 0);
  if (virtual.kind === "terminal") {
    rows[call].fill(1); mappedAi.push({ from: "virtual-terminal", to: to.actions[call].action });
  } else {
    assert.equal(virtual.kind, "player"); const v = virtual as PlayerNode; assert.equal(v.player, ai);
    const vp = applyPublicEvent(c.request.publicState, { kind: "action", player: human, action: nearest.action });
    const rp = applyPublicEvent(c.request.publicState, { kind: "action", player: human, action: c.actual });
    const oldRows = projectedRows(previous.result, v, result.hands);
    const totals = result.hands[ai].map((_, h) => {
      const col = oldRows.map(row => row[h]); assert.ok(col.every(p => p !== null && Number.isFinite(p) && p >= 0));
      const sum = (col as number[]).reduce((a, b) => a + b, 0); assert.ok(Math.abs(sum - 1) <= 1e-5); return sum;
    });
    v.actions.forEach((edge, a) => {
      let mapped = call;
      if (edge.action.type === "fold") mapped = to.actions.findIndex(e => e.action.type === "fold");
      else if ("to" in edge.action) {
        const target = size(edge.action, vp);
        const sized = to.actions.map((e, i) => ({ action: e.action, i })).filter(e => "to" in e.action)
          .sort((a, b) => Math.abs(size(a.action, rp) - target) - Math.abs(size(b.action, rp) - target) || size(a.action, rp) - size(b.action, rp));
        mapped = sized[0]?.i ?? call;
      }
      assert.ok(mapped >= 0); mappedAi.push({ from: edge.action, to: to.actions[mapped].action });
      oldRows[a].forEach((p, h) => { assert.ok(p !== null); rows[mapped][h] += p / totals[h]; });
    });
  }
  // nodePolicy plays normalized columns, not raw f32 export rows. Normalize before
  // mapping above and remove summation roundoff after several actions merge to one.
  result.hands[ai].forEach((_, h) => {
    const sum = rows.reduce((s, row) => s + row[h], 0); assert.ok(Math.abs(sum - 1) <= 1e-5);
    rows.forEach(row => { row[h] /= sum; });
  });
  Object.assign(to, { strategy: rows });
  const grades = { blueprint: gradeRiverProfile(oldSpot, oldProfile), actual: gradeRiverProfile(spot, actual), translated: gradeRiverProfile(spot, translated) };
  const forcedActual = copyTree(actual, 0, result.hands, [], { node: parent, action: c.actual });
  const forcedTranslated = copyTree(translated, 0, result.hands, [], { node: parent, action: c.actual });
  const forcedSpot = withTree(spot, forcedActual, prefix.length + 1, "forced-actual");
  const forced = { actual: gradeRiverProfile(forcedSpot, forcedActual), translated: gradeRiverProfile(forcedSpot, forcedTranslated),
    measure: "actual action forced; same parent-prior compatible deal measure, not a zero-support posterior" };
  const margins = result.hands[human].map((hand, i) => {
    const br = grades.actual.perHand[human].bestResponse[i], old = grades.blueprint.perHand[human].bestResponse[i], baseline = grades.translated.perHand[human].bestResponse[i];
    return { hand, newBestResponse: br, blueprintBestResponse: old, translatedBestResponse: baseline,
      versusBlueprint: br === null || old === null ? null : br - old,
      versusTranslated: br === null || baseline === null ? null : br - baseline };
  });
  return { expandedSpot: spot, profiles: { actual, translated, blueprint: oldProfile }, grades, forced, margins,
    aiValueDifference: grades.actual.value[ai] - grades.translated.value[ai],
    forcedActionAiValueDifference: forced.actual.value[ai] - forced.translated.value[ai],
    translation: { mappedHumanAction: nearest.action, convention: virtual.kind === "terminal" ? "terminal-call-through" : "old-response-policy", mappedAi } };
}
