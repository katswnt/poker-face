/** Offline decomposition of saved-node rounding; never a publication validator. */
import assert from "node:assert/strict";
import type { BridgeResultV1, BridgeSliceNode } from "../contract";
import { encodeSliceNode, quantizeDistribution } from "../library/encode";
import { LIBRARY_TOLERANCES } from "../library/invariants";
import { EV_SCALE, REACH_SCALE, STRATEGY_SCALE } from "../library/model";

export interface ExportSample {
  readonly hands: BridgeResultV1["hands"];
  readonly parent: BridgeSliceNode;
  readonly children: readonly BridgeSliceNode[];
}
export const DIAGNOSTIC_PATH = "x b429 c 4c b995 c 3s";
export const RAW_SCREEN_CHIPS = .01;

export function selectExportSample(result: BridgeResultV1, path = DIAGNOSTIC_PATH): ExportSample {
  const nodes = result.slices!.nodes;
  assert.equal(new Set(nodes.map(n => n.path.join(" "))).size, nodes.length);
  const parent = nodes.find(n => n.path.join(" ") === path);
  assert.ok(parent, "diagnostic parent absent");
  const children = parent.actions.map(a => {
    const child = nodes.find(n => n.path.join(" ") === [...parent.path, a.token].join(" "));
    assert.ok(child, `missing child ${a.token}`); return child;
  });
  return { hands: result.hands, parent, children };
}

function validateSample({ hands, parent, children }: ExportSample) {
  const cards = (h: string) => [h.slice(0, 2), h.slice(2)];
  assert.equal(hands.length, 2);
  hands.forEach(list => {
    assert.ok(list.length > 0); assert.equal(new Set(list).size, list.length);
    list.forEach(h => { assert.match(h, /^([2-9TJQKA][cdhs]){2}$/); assert.notEqual(...cards(h) as [string, string]); });
  });
  assert.ok(parent.player === 0 || parent.player === 1);
  assert.equal(children.length, parent.actions.length); assert.ok(children.length > 0);
  assert.equal(new Set(parent.actions.map(a => a.token)).size, children.length);
  const opponent = 1 - parent.player;
  children.forEach((child, a) => {
    assert.deepEqual(child.path, [...parent.path, parent.actions[a].token]);
    assert.deepEqual(child.board, parent.board); assert.equal(child.street, parent.street);
    assert.equal(child.player, opponent);
    assert.equal(child.committed[opponent], parent.committed[opponent], "opponent payoff origin changed");
  });
  for (const node of [parent, ...children]) {
    assert.ok(node.player === 0 || node.player === 1); assert.ok(node.equity);
    const row = (r: readonly (number | null)[], length: number, nullable: boolean) => {
      assert.equal(r.length, length);
      r.forEach(v => assert.ok(v === null ? nullable : typeof v === "number" && Number.isFinite(v)));
    };
    assert.equal(node.strategy.length, node.actions.length); assert.equal(node.actionEv.length, node.actions.length);
    for (const p of [0, 1]) {
      row(node.ev[p], hands[p].length, true); row(node.reach[p], hands[p].length, false);
      row(node.equity![p], hands[p].length, true);
      node.reach[p].forEach((r, h) => {
        assert.ok(r >= 0 && r <= 1 + 1e-6);
        if (cards(hands[p][h]).some(c => node.board.includes(c as never))) assert.equal(r, 0);
      });
    }
    node.strategy.forEach(r => row(r, hands[node.player].length, true));
    node.actionEv.forEach(r => row(r, hands[node.player].length, true));
    hands[node.player].forEach((_, h) => {
      const col = node.strategy.map(r => r[h]);
      if (col.every(p => p === null)) { assert.equal(node.reach[node.player][h], 0); return; }
      col.forEach(p => assert.ok(p !== null && p >= 0 && p <= 1 + 1e-6));
      assert.ok(Math.abs(col.reduce<number>((s, p) => s + p!, 0) - 1) < 1e-4);
    });
  }
}

export function diagnoseExport(sample: ExportSample) {
  validateSample(sample);
  const { parent, children, hands } = sample, actor = parent.player, opponent = (1 - actor) as 0 | 1;
  const saved = encodeSliceNode(parent), savedChildren = children.map(encodeSliceNode);
  const actorIndex = new Map(saved.live[actor].map((h, i) => [h, i]));
  const opponentIndex = new Map(saved.live[opponent].map((h, i) => [h, i]));
  const childIndex = savedChildren.map(c => new Map(c.live[opponent].map((h, i) => [h, i])));
  const quantizedStrategies = hands[actor].map((_, h) => parent.strategy.every(r => r[h] !== null)
    ? quantizeDistribution(parent.strategy.map(r => r[h]!)).map(p => p / STRATEGY_SCALE) : null);
  const rounded = (v: number | null) => v === null ? null : Math.round(v * EV_SCALE) / EV_SCALE;
  type Stage = "raw" | "reachOnly" | "strategyOnly" | "evOnly" | "saved";
  const rows = hands[opponent].flatMap((combo, h) => {
    if (parent.reach[opponent][h] === 0) return [];
    const cards = [combo.slice(0, 2), combo.slice(2)];
    const compatible = hands[actor].map((g, j) => ({ j, blocked: cards.includes(g.slice(0, 2)) || cards.includes(g.slice(2)) }))
      .filter(x => !x.blocked).map(x => x.j);
    const stage = (mode: Stage) => {
      const quantReach = mode === "reachOnly" || mode === "saved", quantStrategy = mode === "strategyOnly" || mode === "saved";
      const weights = parent.actions.map(() => 0); let mass = 0;
      for (const j of compatible) {
        const i = actorIndex.get(j);
        const r = quantReach ? (i === undefined ? 0 : saved.reach[actor][i] / REACH_SCALE * saved.reachMax[actor]) : parent.reach[actor][j];
        if (r === 0) continue;
        mass += r;
        weights.forEach((_, a) => { weights[a] += r * (quantStrategy ? quantizedStrategies[j]![a] : parent.strategy[a][j]!); });
      }
      const i = opponentIndex.get(h), quantEv = mode === "evOnly" || mode === "saved";
      const parentValue = mode === "saved" ? (i === undefined ? null : saved.ev[opponent][i] === null ? null : saved.ev[opponent][i]! / EV_SCALE)
        : quantEv ? rounded(parent.ev[opponent][h]) : parent.ev[opponent][h];
      const probabilities = weights.map(w => mass > 0 ? w / mass : null);
      let value = 0, scale = 0, available = mass > 0 && parentValue !== null;
      probabilities.forEach((p, a) => {
        if (p === null || p === 0) return;
        const k = childIndex[a].get(h);
        const v = mode === "saved" ? (k === undefined || savedChildren[a].ev[opponent][k] === null ? null : savedChildren[a].ev[opponent][k]! / EV_SCALE)
          : quantEv ? rounded(children[a].ev[opponent][h]) : children[a].ev[opponent][h];
        if (v === null) { available = false; return; }
        value += p * v; scale = Math.max(scale, Math.abs(v));
      });
      return { compatibleMass: mass, actionProbabilities: probabilities, parentValue,
        responseValue: available ? value : null, error: available ? Math.abs(value - parentValue!) : null,
        savedTolerance: LIBRARY_TOLERANCES.opponentEvChips + LIBRARY_TOLERANCES.opponentEvRelative * scale };
    };
    return [{ combo, hand: h, ownReach: parent.reach[opponent][h], savedLive: opponentIndex.has(h),
      omittedCompatibleMass: compatible.reduce((s, j) => s + (actorIndex.has(j) ? 0 : parent.reach[actor][j]), 0),
      raw: stage("raw"), reachOnly: stage("reachOnly"), strategyOnly: stage("strategyOnly"), evOnly: stage("evOnly"), saved: stage("saved") }];
  });
  const stages = ["raw", "reachOnly", "strategyOnly", "evOnly", "saved"] as const;
  return { path: parent.path.join(" "), actor, opponent, actions: parent.actions.map(a => a.token),
    hands: rows, summary: Object.fromEntries(stages.map(s => {
      const checked = rows.filter(r => r[s].error !== null);
      return [s, { checked: checked.length, unavailable: rows.length - checked.length,
        maxError: checked.length ? Math.max(...checked.map(r => r[s].error!)) : null }];
    })), rawScreenFailures: rows.filter(r => r.raw.error !== null && r.raw.error > RAW_SCREEN_CHIPS).length,
    savedFailures: rows.filter(r => r.saved.error !== null && r.saved.error > r.saved.savedTolerance).length };
}
