/** Unsafe-at-parent river re-solving. The public prior is held fixed, never the private deal.
 * No automatic fallback here: undefined posteriors are typed failures for the controller.
 */
import { parseBridgeCombo, type BridgeAction, type BridgeResultV1, type BridgeSpotV1 } from "../../solver/bridge/contract";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import { sha256 } from "../../solver/bridge/live/loader";
import { parseLiveSpot } from "../../solver/bridge/live/admission";
import { requireRiverPlayingResult } from "../../solver/bridge/live/river-quality";
import type { HumanModelRequest } from "../hand";
import { actionToken, applyPublicEvent } from "../public-state";
import { applyStrategy } from "../reach";
import { buildNestedRiverSpot, buildRiverResponseSpot } from "../river-tree";
import type { DecisionProvenance } from "../types";
import { nodePolicy, preparationKey, PreparedPolicySource, type NodePolicy } from "./policy";
import { type PublicSolve, type ResolvedTreeSnapshot } from "./resolved";

interface NestedRoot {
  request: HumanModelRequest; spot: BridgeSpotV1; result: BridgeResultV1; parentNode: number; provenance: DecisionProvenance;
}
export class ZeroSupportRiverAction extends Error {
  constructor() { super("The solved human model assigns this action zero compatible reach; a labelled translation fallback is required"); }
}
export class RiverSolveUnavailable extends Error {
  constructor(cause: unknown) { super("Bounded river solve unavailable", { cause }); }
}
export interface RiverTranslationInput {
  readonly spotHash: string; readonly x: number; readonly a: number; readonly b: number;
  readonly probabilityA: number; readonly mappedTo: "a" | "b";
  readonly reason: "zero-support" | "solve-unavailable"; readonly mappedAction: BridgeAction;
  readonly draw?: number; readonly mappingBasis?: "increment-after-call";
  readonly omittedUnsupportedActions?: readonly BridgeAction[];
}

export function hasCompatibleAction(request: HumanModelRequest, policy: NodePolicy, action: BridgeAction): boolean {
  const humans = request.ranges.human.entries.filter(h => h.weight > 0 && policy.probability(action, h.combo) > 0).map(h => parseBridgeCombo(h.combo));
  const ai = request.ranges.ai.entries.filter(h => h.weight > 0).map(h => parseBridgeCombo(h.combo));
  return humans.some(g => ai.some(h => !g.some(c => h.includes(c))));
}

function parentIndex(spot: BridgeSpotV1, result: BridgeResultV1): number {
  if (spot.tree.mode !== "river-subgame-v1") throw new Error("Nested source requires a river subgame");
  let id = 0;
  for (let i = 0; i < spot.tree.prefixLength; i++) {
    const n = result.tree[id];
    if (n.kind !== "player" || n.actions.length !== 1 || n.strategy[0].some(v => v !== 1)) throw new Error("Result does not preserve the forced public prefix");
    id = n.actions[0].child;
  }
  return id;
}

function locate(root: NestedRoot, request: HumanModelRequest): { id: number; policy: NodePolicy } {
  const key = preparationKey(request), p = request.publicState, base = root.request.publicState;
  if (request.aiSeat !== root.request.aiSeat || canonicalSolverJson(p.board) !== canonicalSolverJson(base.board)
    || canonicalSolverJson(p.events.slice(0, base.events.length)) !== canonicalSolverJson(base.events)) throw new Error("No nested root for this public line");
  let id = root.parentNode, expected = root.request;
  const policyAt = () => {
    const n = root.result.tree[id];
    if (n.kind !== "player" || n.street !== "river" || n.committed.some((v, i) => v !== expected.publicState.streetPut[i])
      || n.board.join() !== [...p.board.flop, p.board.turn, p.board.river].join()) throw new Error("Nested public node differs from actual chips or board");
    return nodePolicy(expected, { player: n.player, hands: root.result.hands[n.player], actions: n.actions.map(e => e.action),
      rows: n.strategy, encoding: "float32", provenance: root.provenance });
  };
  for (const event of p.events.slice(base.events.length)) {
    const n = root.result.tree[id], policy = policyAt();
    if (event.kind !== "action" || n.kind !== "player") throw new Error("Nested river cannot deal another card");
    const edge = n.actions.find(e => actionToken(e.action) === actionToken(event.action));
    if (!edge) throw new Error("Action is outside the prepared nested tree");
    const ai = event.player === request.aiSeat, range = ai ? expected.ranges.ai : expected.ranges.human;
    const changed = applyStrategy(range, h => policy.probability(event.action, h));
    expected = { ...expected, publicState: applyPublicEvent(expected.publicState, event),
      ranges: ai ? { ...expected.ranges, ai: changed } : { ...expected.ranges, human: changed } }; id = edge.child;
  }
  if (canonicalSolverJson(expected) !== key) throw new Error("Nested arriving reach differs from the actual played policy");
  return { id, policy: policyAt() };
}

export class NestedRiverSource extends PreparedPolicySource {
  private root: NestedRoot | null = null;
  private generation = 0;
  constructor(private readonly solve: PublicSolve) { super(); }

  private async run(spot: BridgeSpotV1, signal?: AbortSignal) {
    try { return await this.solve(spot, signal); }
    catch (error) { signal?.throwIfAborted(); throw new RiverSolveUnavailable(error); }
  }

  async prepareOffTree(request: HumanModelRequest, actual: BridgeAction, signal?: AbortSignal): Promise<void> {
    preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), action = structuredClone(actual);
    const spot = buildNestedRiverSpot(snapshot, action), json = canonicalSolverJson(spot);
    parseLiveSpot(json, "play-river-v1");
    const hash = await sha256(new TextEncoder().encode(json)); signal?.throwIfAborted();
    const { result, grade, quality } = requireRiverPlayingResult(await this.run(spot, signal), spot, hash); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Nested solve superseded by a newer preparation");
    const root: NestedRoot = { request: snapshot, spot, result, parentNode: parentIndex(spot, result),
      provenance: { source: "resolve", kind: "nested", spotHash: hash, iterations: result.iterations,
        exploitabilityPctPot: grade.exploitabilityPctPot, quality, precision: "float32", bridgeVersion: result.engine.bridgeVersion,
        engineCommit: result.engine.commit, degradation: 0,
        ladder: { rung: "full", prunedMass: [0, 0], profile: "play-river-v1", policyEncoding: "float32-renormalized" } } };
    const policy = locate(root, snapshot).policy;
    if (!hasCompatibleAction(snapshot, policy, action)) throw new ZeroSupportRiverAction();
    // Validate the imminent AI decision BEFORE committing the human action to the reducer.
    locate(root, { ...snapshot, publicState: applyPublicEvent(snapshot.publicState,
      { kind: "action", player: snapshot.publicState.toAct!, action }), ranges: { ...snapshot.ranges,
      human: applyStrategy(snapshot.ranges.human, h => policy.probability(action, h)) } });
    this.root = root; this.prepared = { key: preparationKey(snapshot), policy };
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted(); ++this.generation;
    if (this.prepared?.key === key) return;
    if (!this.root) throw new Error("Prepare an off-tree river parent first");
    const { policy } = locate(this.root, request);
    this.prepared = { key, policy };
  }

  async prepareTranslatedResponse(request: HumanModelRequest, translation: RiverTranslationInput, signal?: AbortSignal): Promise<void> {
    preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), mapping = structuredClone(translation);
    if (!/^[a-f0-9]{64}$/.test(mapping.spotHash) || ![mapping.x, mapping.a, mapping.b, mapping.probabilityA].every(Number.isFinite)
      || mapping.x < 0 || mapping.a < 0 || mapping.b < mapping.a || mapping.probabilityA < 0 || mapping.probabilityA > 1) {
      throw new Error("Invalid public translation provenance");
    }
    const spot = buildRiverResponseSpot(snapshot), json = canonicalSolverJson(spot);
    parseLiveSpot(json, "play-river-v1");
    const hash = await sha256(new TextEncoder().encode(json)); signal?.throwIfAborted();
    const { result, grade, quality } = requireRiverPlayingResult(await this.run(spot, signal), spot, hash); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Translated response superseded by a newer preparation");
    const root: NestedRoot = { request: snapshot, spot, result, parentNode: parentIndex(spot, result),
      provenance: { ...mapping, source: "translation",
        responseSolve: { spotHash: hash, iterations: result.iterations, exploitabilityPctPot: grade.exploitabilityPctPot, quality,
          bridgeVersion: result.engine.bridgeVersion, engineCommit: result.engine.commit, precision: "float32" },
        ladder: { rung: "translation", prunedMass: [0, 0], profile: "play-river-v1", policyEncoding: "float32-renormalized" } } };
    const policy = locate(root, snapshot).policy;
    this.root = root; this.prepared = { key: preparationKey(snapshot), policy };
  }

  publicTree(request: HumanModelRequest): ResolvedTreeSnapshot {
    this.policy(request); if (!this.root) throw new Error("No nested root");
    return structuredClone({ rootRequest: this.root.request, spot: this.root.spot,
      result: this.root.result, parentNode: locate(this.root, request).id });
  }
}
