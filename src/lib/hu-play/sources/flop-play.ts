/** Saved-flop translation. Real chips and public reach are never replaced by saved prices.
 * This adapter is an exploitable approximation, not a live flop solve or safe re-solve.
 */
import { mulberry32 } from "../../poker/equity";
import type { BridgeAction } from "../../solver/bridge/contract";
import { canonicalSolverJson } from "../../solver/toy/artifact";
import { projectFlopMenu, type FlopProjectionGroup } from "../flop-projection";
import { chooseFlopTranslation } from "../flop-translation";
import type { HumanModelRequest } from "../hand";
import { actionToken, applyPublicEvent, illegalActionReason, initialPublicState } from "../public-state";
import { applyStrategy, rangeFromBridge } from "../reach";
import { fnv1a } from "../rng";
import type { DecisionProvenance, HeadsUpPublicState } from "../types";
import type { LibraryPolicySource } from "./library";
import { hasCompatibleAction } from "./nested-river";
import { nodePolicy, preparationKey, PreparedPolicySource, type NodePolicy } from "./policy";

type Mapping = ReturnType<typeof chooseFlopTranslation>;
export interface FlopDescription {
  readonly version: 1;
  readonly savedPath: readonly string[];
  readonly actualPath: readonly string[];
  readonly mappings: readonly { readonly path: readonly string[]; readonly actual: BridgeAction; readonly mapping: Mapping }[];
  readonly projections: readonly FlopProjectionGroup[];
  readonly passiveContinuation: boolean;
}
export type FlopTranslationProvenance = Extract<DecisionProvenance, { source: "translation" }> & { readonly flop: FlopDescription };
interface Cursor {
  request: HumanModelRequest;
  saved: HeadsUpPublicState;
  mappings: FlopDescription["mappings"];
}
interface Located { cursor: Cursor; policy: NodePolicy; description: FlopDescription }
interface Selection { group: FlopProjectionGroup; mapping?: Mapping }

function validateAction(request: HumanModelRequest, action: BridgeAction) {
  const sized = action.type === "bet" || action.type === "raise";
  if (Object.keys(action).sort().join() !== (sized ? "to,type" : "type")) throw new Error("Unexpected public flop action fields");
  const illegal = illegalActionReason(request.publicState, action); if (illegal) throw new Error(illegal);
}

export class FlopPlaySource extends PreparedPolicySource {
  private generation = 0;
  private detail: FlopDescription | null = null;
  private pending: { key: string; action: string; likelihood: (hand: string) => number } | null = null;
  constructor(private readonly library: LibraryPolicySource, private readonly handSeed: number) {
    super(); if (!Number.isSafeInteger(handSeed)) throw new Error("Flop translation seed must be an integer");
  }

  private async policyAt(cursor: Cursor, check: () => void, signal?: AbortSignal): Promise<Located> {
    check();
    const q = cursor.request, real = q.publicState, saved = cursor.saved;
    const passive = saved.status === "chance";
    let groups: FlopProjectionGroup[], old: NodePolicy | undefined;
    if (passive) {
      if (real.toAct !== q.aiSeat) throw new Error("Passive saved-street extension is only an AI response");
      const action: BridgeAction = { type: Math.max(...real.streetPut) > real.streetPut[real.toAct!] ? "call" : "check" };
      groups = [{ action, saved: [], representative: action }];
    } else {
      const virtual = { ...q, publicState: saved };
      await this.library.prepare(virtual, signal); check(); old = this.library.policy(virtual);
      groups = projectFlopMenu(real, saved, old.actions);
    }
    const description: FlopDescription = { version: 1, savedPath: saved.path, actualPath: real.path,
      mappings: cursor.mappings, projections: groups, passiveContinuation: passive };
    if (old && !cursor.mappings.length && canonicalSolverJson(real) === canonicalSolverJson(saved)) {
      return { cursor, policy: old, description }; // preserve original numbers, provenance and log bytes
    }
    const mapping = cursor.mappings.at(-1)?.mapping;
    if (!mapping) throw new Error("Different saved flop path has no public translation provenance");
    const provenance: FlopTranslationProvenance = { ...mapping, source: "translation", flop: structuredClone(description),
      ladder: { rung: "translation", prunedMass: [0, 0], profile: null, policyEncoding: "per-mille" } };
    const hands = (real.toAct === q.aiSeat ? q.ranges.ai : q.ranges.human).entries.map(h => h.combo);
    const rows = groups.map(g => hands.map(h => passive ? 1000 : g.saved.reduce((sum, a) => {
      const value = old!.probability(a, h) * 1000, integer = Math.round(value);
      if (Math.abs(value - integer) > 1e-9) throw new Error("Saved flop policy is not per-mille encoded");
      return sum + integer;
    }, 0)));
    // Integer summation preserves all collision mass without producing 1 + floating-point slack.
    const policy = nodePolicy(q, { player: real.toAct!, actions: groups.map(g => g.action), hands, rows,
      encoding: "per-mille", provenance }); // deliberately no saved EVs at translated prices
    return { cursor, policy, description };
  }

  private select(node: Located, action: BridgeAction): Selection {
    const q = node.cursor.request; validateAction(q, action);
    const direct = node.description.projections.find(g => actionToken(g.action) === actionToken(action));
    if (q.publicState.toAct === q.aiSeat) {
      if (!direct) throw new Error("AI action is outside its actual projected policy");
      return { group: direct };
    }
    if (direct && (action.type === "fold" || hasCompatibleAction(q, node.policy, action))) return { group: direct };
    if (action.type !== "bet" && action.type !== "raise") throw new Error("No supported nonterminal human flop likelihood; a posterior cannot be invented");
    const draw = mulberry32(fnv1a(`hu-flop-translation|${this.handSeed >>> 0}|${q.publicState.path.join(",")}|${actionToken(action)}`))();
    const mapping = chooseFlopTranslation(q, node.policy, action, draw);
    const group = node.description.projections.find(g => actionToken(g.action) === actionToken(mapping.mappedAction));
    if (!group) throw new Error("Missing projected translation reference");
    return { group, mapping };
  }

  private step(node: Located, actual: BridgeAction, selection: Selection): Cursor {
    const { cursor, policy } = node, q = cursor.request, actor = q.publicState.toAct!;
    const side = actor === q.aiSeat ? "ai" : "human";
    const request = { ...q, publicState: applyPublicEvent(q.publicState, { kind: "action", player: actor, action: actual }),
      ranges: { ...q.ranges, [side]: applyStrategy(q.ranges[side], h => policy.probability(selection.group.action, h)) } };
    const saved = cursor.saved.status === "chance" ? cursor.saved : applyPublicEvent(cursor.saved,
      { kind: "action", player: actor, action: selection.group.representative });
    const mappings = selection.mapping ? [...cursor.mappings,
      { path: q.publicState.path, actual: structuredClone(actual), mapping: selection.mapping }] : cursor.mappings;
    return { request, saved, mappings };
  }

  private async locate(request: HumanModelRequest, check: () => void, signal?: AbortSignal): Promise<Located> {
    const key = preparationKey(request), p = request.publicState, spot = this.library.spot;
    if (p.street !== "flop") throw new Error("Flop adapter cannot inspect later streets or runouts");
    const root = initialPublicState({ startingPot: spot.startingPot, startingStack: spot.effectiveStack,
      minimumBet: 100, flop: spot.board.flop });
    let cursor: Cursor = { saved: root, mappings: [], request: { publicState: root, aiSeat: request.aiSeat,
      ranges: { ai: rangeFromBridge(spot.ranges[request.aiSeat]), human: rangeFromBridge(spot.ranges[1 - request.aiSeat]) } } };
    for (const event of p.events) {
      if (event.kind !== "action" || event.player !== cursor.request.publicState.toAct) throw new Error("Invalid public flop history");
      const node = await this.policyAt(cursor, check, signal);
      cursor = this.step(node, event.action, this.select(node, event.action));
    }
    if (canonicalSolverJson(cursor.request) !== key) throw new Error("Flop arriving reach or chips differ from the actual played policy");
    return this.policyAt(cursor, check, signal);
  }

  private checkpoint(generation: number, signal?: AbortSignal) {
    return () => { signal?.throwIfAborted(); if (generation !== this.generation) throw new Error("Flop preparation superseded"); };
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const check = this.checkpoint(++this.generation, signal); this.pending = null;
    if (this.prepared?.key === key) return;
    const node = await this.locate(structuredClone(request), check, signal); check();
    this.prepared = { key, policy: node.policy }; this.detail = structuredClone(node.description);
  }

  async prepareHumanAction(request: HumanModelRequest, action: BridgeAction, signal?: AbortSignal): Promise<"on-tree" | "translation"> {
    const key = preparationKey(request); signal?.throwIfAborted(); validateAction(request, action);
    if (request.publicState.toAct === request.aiSeat) throw new Error("It is not the human's flop decision");
    const check = this.checkpoint(++this.generation, signal); this.pending = null;
    const actual = structuredClone(action), node = await this.locate(structuredClone(request), check, signal);
    const selection = this.select(node, actual), next = this.step(node, actual, selection);
    // Validate the imminent response before the reducer spends chips or changes reach.
    if (next.request.publicState.status === "betting") await this.policyAt(next, check, signal);
    check(); this.prepared = { key, policy: node.policy }; this.detail = structuredClone(node.description);
    this.pending = { key, action: actionToken(actual), likelihood: h => node.policy.probability(selection.group.action, h) };
    return selection.mapping ? "translation" : "on-tree";
  }

  humanModel(request: HumanModelRequest, action: BridgeAction) {
    this.policy(request); validateAction(request, action);
    if (this.pending?.key === preparationKey(request) && this.pending.action === actionToken(action)) return this.pending.likelihood;
    return super.humanModel(request, action);
  }

  description(request: HumanModelRequest): FlopDescription {
    this.policy(request); if (!this.detail) throw new Error("Flop description has not been prepared");
    return structuredClone(this.detail);
  }
}
