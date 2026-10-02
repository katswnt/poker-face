/** Production composition of P1 on-tree decisions, P3 nested solving and explicit fallback.
 * Only this public controller selects the human likelihood; the reducer applies it once.
 */
import type { BridgeAction } from "../../solver/bridge/contract";
import { mulberry32 } from "../../poker/equity";
import type { HumanModelRequest } from "../hand";
import { actionToken, applyPublicEvent, illegalActionReason, isStreetRoot } from "../public-state";
import { applyStrategy } from "../reach";
import { fnv1a } from "../rng";
import { chooseTurnTranslation } from "../turn-translation";
import { NestedTurnSource, TurnSolveUnavailable, ZeroSupportTurnAction } from "./nested-turn";
import { preparationKey, PreparedPolicySource, type NodePolicy } from "./policy";
import { ResolvedPolicySource, type PublicSolve, type ResolvedTreeSnapshot } from "./resolved";

type TurnSource = ResolvedPolicySource | NestedTurnSource;
interface PendingTranslation {
  key: string; actual: BridgeAction; mapped: BridgeAction; policy: NodePolicy;
  previous: TurnSource; previousTree: ResolvedTreeSnapshot;
}

export class TurnPlaySource extends PreparedPolicySource {
  private active: TurnSource;
  private pending: PendingTranslation | null = null;
  private generation = 0;
  constructor(private readonly onTree: ResolvedPolicySource, private readonly nestedSolve: PublicSolve,
    private readonly handSeed: number) {
    super(); this.active = onTree;
    if (!Number.isSafeInteger(handSeed)) throw new Error("Translation needs a whole hand seed");
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation;
    if (this.prepared?.key === key) return;
    const snapshot = structuredClone(request), source = isStreetRoot(snapshot.publicState) ? this.onTree : this.active;
    await source.prepare(snapshot, signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Public play preparation superseded");
    this.active = source; this.pending = null; this.prepared = { key, policy: source.policy(snapshot) };
  }

  async prepareHumanAction(request: HumanModelRequest, actual: BridgeAction, signal?: AbortSignal): Promise<"on-tree" | "nested" | "translation"> {
    const key = preparationKey(request), snapshot = structuredClone(request), action = structuredClone(actual);
    if (snapshot.publicState.toAct === snapshot.aiSeat) throw new Error("It is not the human's decision");
    const illegal = illegalActionReason(snapshot.publicState, action); if (illegal) throw new Error(`Illegal human action: ${illegal}`);
    await this.prepare(snapshot, signal);
    const generation = ++this.generation, policy = this.policy(snapshot);
    const previous = this.pending?.key === key ? this.pending.previous : this.active;
    if (policy.actions.some(a => actionToken(a) === actionToken(action))) {
      this.active = previous; this.pending = null; return "on-tree";
    }
    if (snapshot.publicState.street !== "turn") throw new Error("Turn controller requires a turn action");
    const current = () => {
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new Error("Human preparation superseded; no policy published");
    };
    const candidate = new NestedTurnSource(this.nestedSolve);
    try {
      await candidate.prepareOffTree(snapshot, action, signal); current();
      this.active = candidate; this.pending = null; this.prepared = { key, policy: candidate.policy(snapshot) };
      return "nested";
    } catch (error) {
      current(); // cancellation/stale work MUST NOT trigger a second solve
      if (!(error instanceof ZeroSupportTurnAction) && !(error instanceof TurnSolveUnavailable)) throw error;
      const draw = mulberry32(fnv1a(`hu-turn-translation|${this.handSeed >>> 0}|${snapshot.publicState.path.join(",")}|${actionToken(action)}`))();
      const translation = { ...chooseTurnTranslation(snapshot, policy, action, draw),
        reason: error instanceof ZeroSupportTurnAction ? "zero-support" as const : "solve-unavailable" as const };
      const next: HumanModelRequest = { ...snapshot, publicState: applyPublicEvent(snapshot.publicState,
        { kind: "action", player: snapshot.publicState.toAct!, action }), ranges: { ...snapshot.ranges,
        human: applyStrategy(snapshot.ranges.human, h => policy.probability(translation.mappedAction, h)) } };
      const fallback = new NestedTurnSource(this.nestedSolve);
      await fallback.prepareTranslatedResponse(next, translation, signal); current();
      this.pending = { key, actual: action, mapped: translation.mappedAction, policy, previous, previousTree: previous.publicTree(snapshot) };
      this.active = fallback;
      // This parent is still the previous decision. No fake expanded distribution is made:
      // only humanModel(actual) is translated; the response policy starts AFTER real action.
      this.prepared = { key, policy }; return "translation";
    }
  }

  humanModel(request: HumanModelRequest, action: BridgeAction) {
    const pending = this.pending;
    if (pending && pending.key === preparationKey(request) && actionToken(action) === actionToken(pending.actual)) {
      return (combo: string) => pending.policy.probability(pending.mapped, combo);
    }
    return super.humanModel(request, action);
  }

  publicTree(request: HumanModelRequest): ResolvedTreeSnapshot {
    this.policy(request);
    return this.pending?.key === preparationKey(request) ? structuredClone(this.pending.previousTree) : this.active.publicTree(request);
  }
}
