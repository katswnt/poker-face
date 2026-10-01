/** Shared native/browser policy adapter. The injected solver sees only a complete public spot. */
import { checkBridgeResult, type BridgeResultV1, type BridgeSpotV1 } from "../../solver/bridge/contract";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import { sha256 } from "../../solver/bridge/live/loader";
import { parseLiveSpot } from "../../solver/bridge/live/admission";
import { PLAY_LIMITS, playTree } from "../../solver/bridge/live/play-profile";
import type { HumanModelRequest } from "../hand";
import { actionToken, applyPublicEvent, isStreetRoot } from "../public-state";
import { applyStrategy } from "../reach";
import { buildResolveSpot } from "../resolve-spot";
import type { DecisionProvenance } from "../types";
import { nodePolicy, preparationKey, PreparedPolicySource } from "./policy";

export type PublicSolve = (spot: BridgeSpotV1, signal?: AbortSignal) => Promise<BridgeResultV1>;
interface ResolvedRoot {
  request: HumanModelRequest; key: string; spot: BridgeSpotV1; result: BridgeResultV1; provenance: DecisionProvenance;
}
export interface ResolvedTreeSnapshot {
  readonly rootRequest: HumanModelRequest;
  readonly spot: BridgeSpotV1;
  readonly result: BridgeResultV1;
  readonly parentNode: number;
}

export function buildPlaySpot(request: HumanModelRequest): BridgeSpotV1 {
  preparationKey(request);
  const spot = buildResolveSpot({ ...request, tree: playTree(request.publicState.board), minimumRelativeReach: 0,
    solve: { targetExploitabilityPctPot: PLAY_LIMITS.targetPctPot, maxIterations: PLAY_LIMITS.maxIterations,
      timeoutMs: PLAY_LIMITS.timeoutMs, memoryCapBytes: PLAY_LIMITS.desktopBytes, compression: "off", exportScope: "first-street" } });
  // Full means every positive arriving hand, including very small reaches. Do not silently
  // drop a float32-underflowed hand and still advertise 100% retention.
  const bySeat = request.aiSeat === 0 ? [request.ranges.ai, request.ranges.human] : [request.ranges.human, request.ranges.ai];
  for (const p of [0, 1]) if (bySeat[p].entries.filter(h => h.weight > 0).length !== spot.ranges[p].combos.length) {
    throw new Error("Full-range play would lose a positive hand during float32 normalization");
  }
  return parseLiveSpot(canonicalSolverJson(spot), "play-v1");
}

export function requirePlayingResult(raw: unknown, spot: BridgeSpotV1, spotHash: string): BridgeResultV1 {
  const r = checkBridgeResult(raw, spot, spotHash), e = r.exploitability;
  const chips = Math.fround(e.chips), target = spot.startingPot * spot.solve.targetExploitabilityPctPot / 100;
  if (r.engine.precision !== "float32" || r.engine.threads !== 1 || r.engine.algorithm !== "discounted-cfr"
    || r.iterations < 0 || r.iterations > spot.solve.maxIterations || e.reached !== true || chips < 0 || chips > target
    || e.target !== target || e.pctPot !== chips / spot.startingPot * 100
    || e.convention !== "half-sum-of-best-response-gains") throw new Error("Result did not meet the play quality target and precision contract");
  return r;
}

export class ResolvedPolicySource extends PreparedPolicySource {
  private root: ResolvedRoot | null = null;
  private generation = 0;
  constructor(private readonly solve: PublicSolve) { super(); }

  /** Detached public evidence for P2's translation/safety comparison. No private decision
   * request is accepted, and only the exact currently prepared river may inspect its tree.
   */
  publicTree(request: HumanModelRequest): ResolvedTreeSnapshot {
    this.policy(request);
    if (!this.root || request.publicState.street !== "river") throw new Error("A prepared river is required");
    let parentNode = 0;
    for (const event of request.publicState.events.slice(this.root.request.publicState.events.length)) {
      const n = this.root.result.tree[parentNode];
      if (event.kind !== "action" || n.kind !== "player") throw new Error("Invalid prepared river path");
      const edge = n.actions.find(e => actionToken(e.action) === actionToken(event.action));
      if (!edge) throw new Error("No prepared river action"); parentNode = edge.child;
    }
    return structuredClone({ rootRequest: this.root.request, spot: this.root.spot, result: this.root.result, parentNode });
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    if (this.prepared?.key === key) return;
    const generation = ++this.generation;
    // Snapshot public input before any await; callers cannot mutate an in-flight solve's key.
    const snapshot = structuredClone(request);
    let root = this.root;
    if (isStreetRoot(snapshot.publicState) && root?.key !== key) {
      const spot = buildPlaySpot(snapshot), hash = await sha256(new TextEncoder().encode(canonicalSolverJson(spot)));
      signal?.throwIfAborted();
      const result = requirePlayingResult(await this.solve(spot, signal), spot, hash);
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new Error("A newer public decision superseded this solve");
      root = { request: snapshot, key, spot, result, provenance: { source: "resolve", kind: "street-root", spotHash: hash,
        iterations: result.iterations, exploitabilityPctPot: result.exploitability.pctPot, precision: "float32",
        bridgeVersion: result.engine.bridgeVersion, engineCommit: result.engine.commit, degradation: 0,
        ladder: { rung: "full", prunedMass: [0, 0], profile: "play-v1", policyEncoding: "float32-renormalized" } } };
    }
    if (!root) throw new Error("Prepare the street root before inspecting a later decision");
    const p = snapshot.publicState, base = root.request.publicState;
    if (snapshot.aiSeat !== root.request.aiSeat || canonicalSolverJson(p.board) !== canonicalSolverJson(base.board)
      || canonicalSolverJson(p.events.slice(0, base.events.length)) !== canonicalSolverJson(base.events)) {
      throw new Error("No prepared street root for this public line");
    }
    let at = 0, expected = root.request;
    const policyAt = () => {
      const n = root!.result.tree[at];
      if (!n || n.kind !== "player" || n.street !== expected.publicState.street
        || n.board.join() !== [...p.board.flop, p.board.turn, p.board.river].filter(Boolean).join()
        || n.committed.some((c, i) => c !== expected.publicState.streetPut[i])) throw new Error("Resolved public node does not match actual chip state");
      return nodePolicy(expected, { player: n.player, hands: root!.result.hands[n.player], actions: n.actions.map(a => a.action),
        rows: n.strategy, encoding: "float32", provenance: root!.provenance });
    };
    for (const event of p.events.slice(base.events.length)) {
      if (event.kind !== "action") throw new Error("Prepare a new root after a board card");
      const policy = policyAt(), n = root.result.tree[at];
      if (n.kind !== "player") throw new Error("Not a resolved player node");
      const edge = n.actions.find(a => actionToken(a.action) === actionToken(event.action));
      if (!edge) throw new Error("Action is outside the current solved tree");
      const ai = event.player === snapshot.aiSeat;
      const incoming = ai ? expected.ranges.ai : expected.ranges.human;
      const changed = applyStrategy(incoming, combo => policy.probability(event.action, combo));
      expected = { ...expected, publicState: applyPublicEvent(expected.publicState, event),
        ranges: ai ? { ...expected.ranges, ai: changed } : { ...expected.ranges, human: changed } };
      at = edge.child;
    }
    if (canonicalSolverJson(expected) !== key) throw new Error("Arriving reach or public state differs from the policy actually played");
    const policy = policyAt();
    signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("A newer public decision superseded this preparation");
    this.root = root; this.prepared = { key, policy };
  }
}
