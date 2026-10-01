import { canonicalSolverJson } from "../../solver/toy/artifact";
import { canonicalBridgeCombo, parseBridgeCombo, type BridgeAction } from "../../solver/bridge/contract";
import type { AsyncDecisionSource } from "../async-hand";
import type { DecisionRequest, HumanModelRequest } from "../hand";
import { actionToken, illegalActionReason, validatePublicState } from "../public-state";
import { assertSortedRange } from "../reach";
import type { ActionDistribution, DecisionProvenance } from "../types";

function exactKeys(value: object, keys: string[], label: string) {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== keys.sort().join()) {
    throw new Error(`Unexpected ${label} fields; preparation accepts public state and ranges only`);
  }
}

/** Runtime non-interference boundary. Never accepts a DecisionRequest spread containing aiHand. */
export function preparationKey(request: HumanModelRequest): string {
  exactKeys(request, ["publicState", "aiSeat", "ranges"], "request");
  const p = validatePublicState(request.publicState);
  if (p.status !== "betting" || (request.aiSeat !== 0 && request.aiSeat !== 1)) throw new Error("Preparation needs a public player decision");
  exactKeys(request.ranges, ["ai", "human"], "ranges");
  const board = [...p.board.flop, p.board.turn, p.board.river];
  for (const range of [request.ranges.ai, request.ranges.human]) {
    exactKeys(range, ["source", "entries"], "range");
    if (typeof range.source !== "string" || range.source.length > 500 || !Array.isArray(range.entries)
      || range.entries.length > 1326 || !range.entries.some(h => h.weight > 0)) throw new Error("Invalid or empty public reach range");
    for (const h of range.entries) {
      exactKeys(h, ["combo", "weight"], "range entry");
      const cards = parseBridgeCombo(h.combo);
      if (canonicalBridgeCombo(...cards) !== h.combo || cards.some(c => board.includes(c))
        || !Number.isFinite(h.weight) || h.weight < 0) throw new Error("Invalid public range entry");
    }
    assertSortedRange(range);
  }
  return canonicalSolverJson(request);
}

export interface NodePolicy {
  readonly player: 0 | 1;
  readonly actions: readonly BridgeAction[];
  readonly provenance: DecisionProvenance;
  readonly actionEvBasis: "original-saved-policy" | "not-exported";
  distribution(combo: string): ActionDistribution;
  probability(action: BridgeAction, combo: string): number;
  actionEvs(combo: string): readonly (number | null)[];
}

export function nodePolicy(request: HumanModelRequest, input: {
  player: 0 | 1; actions: readonly BridgeAction[]; hands: readonly string[];
  rows: readonly (readonly (number | null)[])[]; encoding: "per-mille" | "float32";
  provenance: DecisionProvenance; actionEvRows?: readonly (readonly (number | null)[])[];
}): NodePolicy {
  if (input.player !== request.publicState.toAct || !input.actions.length
    || input.actions.length !== input.rows.length || new Set(input.hands).size !== input.hands.length) throw new Error("Policy dimensions or acting player differ");
  const tokens = input.actions.map(actionToken);
  if (new Set(tokens).size !== tokens.length) throw new Error("Repeated policy action");
  for (const action of input.actions) {
    const illegal = illegalActionReason(request.publicState, action);
    if (illegal) throw new Error(`Policy action is illegal: ${illegal}`);
  }
  if (input.rows.some(r => r.length !== input.hands.length)) throw new Error("Incomplete policy rows");
  const distributions = new Map<string, ActionDistribution>();
  input.hands.forEach((hand, h) => {
    const column = input.rows.map(r => r[h]);
    if (column.some(n => n === null || !Number.isFinite(n) || n < 0)) throw new Error("Missing or negative policy column");
    const total = (column as number[]).reduce((sum, n) => sum + n, 0);
    if (input.encoding === "per-mille" ? total !== 1000 || column.some(n => !Number.isSafeInteger(n)) : Math.abs(total - 1) > 1e-5) {
      throw new Error("Policy column is not a probability distribution");
    }
    distributions.set(hand, input.actions.map((action, a) => ({ action, probability: column[a]! / total })));
  });
  const incoming = request.publicState.toAct === request.aiSeat ? request.ranges.ai : request.ranges.human;
  for (const h of incoming.entries) if (h.weight > 0 && !distributions.has(h.combo)) throw new Error("Policy omits a positive-reach hand");
  return { player: input.player, actions: input.actions, provenance: input.provenance,
    actionEvBasis: input.actionEvRows ? "original-saved-policy" : "not-exported",
    distribution(combo) {
      const d = distributions.get(combo); if (!d) throw new Error("Hand has no policy column at this decision"); return d;
    },
    probability(action, combo) {
      const a = tokens.indexOf(actionToken(action)); if (a < 0) throw new Error("Action is outside this on-tree policy");
      return distributions.get(combo)?.[a].probability ?? 0; // only zero incoming reach may lack a column
    },
    actionEvs(combo) {
      const h = input.hands.indexOf(combo);
      return input.actions.map((_, a) => h < 0 || !input.actionEvRows ? null : input.actionEvRows[a][h]);
    },
  };
}

export abstract class PreparedPolicySource implements AsyncDecisionSource {
  protected prepared: { key: string; policy: NodePolicy } | null = null;
  abstract prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void>;
  policy(request: HumanModelRequest): NodePolicy {
    if (!this.prepared || this.prepared.key !== preparationKey(request)) throw new Error("This exact public decision has not been prepared");
    return this.prepared.policy;
  }
  decide(request: DecisionRequest) {
    const p = this.policy({ publicState: request.publicState, aiSeat: request.aiSeat, ranges: request.ranges });
    return { strategy: p.distribution(request.aiHand), provenance: p.provenance, rangeProbability: p.probability };
  }
  humanModel(request: HumanModelRequest, action: BridgeAction) {
    const p = this.policy(request);
    if (!p.actions.some(a => actionToken(a) === actionToken(action))) throw new Error("Human action is outside this on-tree policy");
    return (combo: string) => p.probability(action, combo);
  }
}
