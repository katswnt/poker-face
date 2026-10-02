/** P3 prospective sampling. First 200 DISTINCT turn roots from seeded production hands,
 * then one parent/amount per root. No new solve's outcome or time influences selection.
 */
import type { BridgeAction, BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { parseBridgeCombo } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import type { HumanModelRequest } from "../src/lib/hu-play/hand";
import { actionToken, applyPublicEvent, sizedActionBounds } from "../src/lib/hu-play/public-state";
import { applyStrategy } from "../src/lib/hu-play/reach";
import { leanTurnActions } from "../src/lib/hu-play/turn-tree";
import { fnv1a } from "../src/lib/hu-play/rng";
import { loadScriptedHand, playBotHand } from "../src/lib/hu-play/scripted";
import type { PlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { nodePolicy, preparationKey, PreparedPolicySource } from "../src/lib/hu-play/sources/policy";
import { buildPlaySpot, requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { buildNestedTurnSpot } from "../src/lib/hu-play/turn-tree";

export interface P3TurnRoot {
  seed: number; librarySpotId: string; request: HumanModelRequest; spot: BridgeSpotV1; spotHash: string;
}
export async function seededTurnRoots(catalog: PlayCatalog, count: number, fetcher: typeof fetch = fetch) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error("P3 freezes one to 200 distinct turn arrivals");
  const roots: P3TurnRoot[] = [], skipped: { seed: number; reason: "finished-on-flop" | "duplicate-public-root" }[] = [];
  const seen = new Set<string>();
  for (let seed = 0; roots.length < count && seed < 1000; seed++) {
    const dealt = await loadScriptedHand(catalog, seed, seed % 2 as 0 | 1, undefined, fetcher);
    const captured: HumanModelRequest[] = [];
    class FlopOnly extends PreparedPolicySource {
      async prepare(q: HumanModelRequest) {
        const key = preparationKey(q);
        if (q.publicState.street !== "flop") {
          if (q.publicState.street !== "turn" || q.publicState.streetActions !== 0) throw new Error("Expected first turn decision");
          captured.push(structuredClone(q)); throw new Error("P3 frozen arrival captured before solving");
        }
        await dealt.library.prepare(q); this.prepared = { key, policy: dealt.library.policy(q) };
      }
    }
    try { await playBotHand(dealt.state, new FlopOnly()); }
    catch (error) {
      if (captured.length !== 1 || !(error instanceof Error) || !error.message.includes("P3 frozen arrival captured before solving")) throw error;
    }
    if (!captured.length) { skipped.push({ seed, reason: "finished-on-flop" }); continue; }
    const request = captured[0], spot = buildPlaySpot(request), spotHash = hashBridgeSpot(spot);
    if (seen.has(spotHash)) { skipped.push({ seed, reason: "duplicate-public-root" }); continue; }
    seen.add(spotHash); roots.push({ seed, librarySpotId: dealt.library.entry.id, request, spot, spotHash });
  }
  if (roots.length !== count) throw new Error("The frozen first-1,000-seed cohort did not supply enough distinct turn roots");
  return { roots, skipped };
}

export function makeTurnOffTreeCase(seed: number, root: HumanModelRequest, result: BridgeResultV1) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 200) throw new Error("P3 case seeds are 0 through 199");
  preparationKey(root);
  if (root.publicState.street !== "turn" || root.publicState.streetActions !== 0) throw new Error("P3 selection requires a turn root");
  const candidates: { request: HumanModelRequest; node: number; line: BridgeAction[] }[] = [];
  const visit = (request: HumanModelRequest, node: number, line: BridgeAction[]) => {
    const n = result.tree[node]; if (n.kind !== "player" || n.street !== "turn" || line.length > 2) return;
    const joint = request.ranges.ai.entries.some(h => h.weight > 0 && request.ranges.human.entries.some(g =>
      g.weight > 0 && !parseBridgeCombo(h.combo).some(c => parseBridgeCombo(g.combo).includes(c))));
    if (!joint) return;
    const bounds = sizedActionBounds(request.publicState), menu = leanTurnActions(request.publicState);
    const forbidden = new Set(menu.flatMap(a => "to" in a ? [a.to] : []));
    if (bounds && bounds.max - bounds.min + 1 > forbidden.size) candidates.push({ request, node, line });
    const policy = nodePolicy(request, { player: n.player, hands: result.hands[n.player], actions: n.actions.map(e => e.action),
      rows: n.strategy, encoding: "float32", provenance: { source: "resolve", kind: "street-root", spotHash: result.spotHash,
        iterations: result.iterations, exploitabilityPctPot: result.exploitability.pctPot, precision: "float32",
        bridgeVersion: result.engine.bridgeVersion, engineCommit: result.engine.commit, degradation: 0 } });
    for (const e of n.actions) {
      const slot = n.player === request.aiSeat ? "ai" : "human";
      const changed = applyStrategy(request.ranges[slot], h => policy.probability(e.action, h));
      visit({ ...request, publicState: applyPublicEvent(request.publicState, { kind: "action", player: n.player, action: e.action }),
        ranges: { ...request.ranges, [slot]: changed } }, e.child, [...line, e.action]);
    }
  };
  visit(root, 0, []);
  const family = Math.floor(seed / 50); // 50 preassigned attempts for each parent family
  const matches = (line: BridgeAction[]) => family === 0 ? line.length === 0
    : family === 1 ? line.length === 1 && line[0].type === "check"
    : family === 2 ? line.length === 1 && line[0].type === "bet"
    : line.length === 2 && line[0].type === "bet" && line[1].type === "raise";
  const candidate = candidates.find(c => matches(c.line)) ?? candidates[0];
  if (!candidate) throw new Error(`No supported legal off-tree parent for frozen case ${seed}`);
  const { request: before, node, line } = candidate, aiSeat = (1 - before.publicState.toAct!) as 0 | 1;
  const request: HumanModelRequest = { ...before, aiSeat,
    ranges: aiSeat === before.aiSeat ? before.ranges : { ai: before.ranges.human, human: before.ranges.ai } };
  const bounds = sizedActionBounds(request.publicState)!, menu = leanTurnActions(request.publicState);
  const forbidden = new Set(menu.flatMap(a => "to" in a ? [a.to] : [])), u = fnv1a(`p3-size|${seed}`) / 2 ** 32;
  let to = [bounds.min, bounds.max, bounds.max - 1, bounds.min + Math.floor(u * (bounds.max - bounds.min + 1)),
    Math.floor((bounds.min + bounds.max) / 2)][seed % 5];
  to = Math.max(bounds.min, Math.min(bounds.max, to));
  if (forbidden.has(to)) for (let d = 1; d <= forbidden.size + 1; d++) {
    const found = [to - d, to + d].find(x => x >= bounds.min && x <= bounds.max && !forbidden.has(x));
    if (found !== undefined) { to = found; break; }
  }
  if (forbidden.has(to)) throw new Error("No non-menu amount found");
  const category = to === bounds.max ? "all-in" : to === bounds.min ? "minimum" : to === bounds.max - 1 ? "near-all-in" : "interior";
  return { seed, preferredFamily: family, usedPreferredFamily: matches(line), baselineNode: node, baselinePath: line.map(actionToken),
    category, request, actual: { type: bounds.type, to } as Extract<BridgeAction, { type: "bet" | "raise" }> };
}

/** Complete prospective corpus only; a partial run is evidence, not a smaller success. */
export function buildTurnCorpus(roots: readonly P3TurnRoot[], baselines: readonly BridgeResultV1[]) {
  if (roots.length !== 200 || baselines.length !== 200) throw new Error("P3 requires exactly 200 frozen roots and baselines");
  if (new Set(roots.map(r => r.spotHash)).size !== 200) throw new Error("P3 requires 200 distinct public roots; duplicate roots found");
  const cases = roots.map((root, seed) => {
    if (canonicalSolverJson(buildPlaySpot(root.request)) !== canonicalSolverJson(root.spot)
      || hashBridgeSpot(root.spot) !== root.spotHash) throw new Error("Frozen baseline spot differs from its public root");
    const result = requirePlayingResult(baselines[seed], root.spot, root.spotHash);
    const c = makeTurnOffTreeCase(seed, root.request, result), spot = buildNestedTurnSpot(c.request, c.actual);
    return { ...c, rootIndex: seed, handSeed: root.seed, librarySpotId: root.librarySpotId,
      rootSpotHash: root.spotHash, spot, spotHash: hashBridgeSpot(spot) };
  });
  if (new Set(cases.map(c => preparationKey(c.request))).size !== 200 || new Set(cases.map(c => c.spotHash)).size !== 200) {
    throw new Error("P3 needs 200 distinct public parents and off-tree games");
  }
  for (let family = 0; family < 4; family++) if (!cases.some(c => c.preferredFamily === family && c.usedPreferredFamily)) {
    throw new Error(`No supported case for the preassigned P3 parent family ${family}`);
  }
  for (const category of ["minimum", "all-in", "near-all-in", "interior"]) if (!cases.some(c => c.category === category)) {
    throw new Error(`P3 frozen corpus lacks ${category} coverage`);
  }
  if (new Set(cases.map(c => c.request.aiSeat)).size !== 2) throw new Error("P3 must cover both AI seats");
  return cases;
}
