/** P4 full-hand composition. The saved-flop adapter never supplies live turn prices. */
import type { BridgeAction } from "../../solver/bridge/contract";
import type { HumanModelRequest } from "../hand";
import type { PlayDecisionSource } from "../play-hand";
import type { FlopPlaySource } from "./flop-play";
import { preparationKey, PreparedPolicySource } from "./policy";
import type { PostflopPlaySource } from "./postflop-play";

export class TranslatedHeadsUpPlaySource extends PreparedPolicySource implements PlayDecisionSource {
  private generation = 0;
  constructor(private readonly flop: FlopPlaySource, private readonly live: PostflopPlaySource) { super(); }

  private source(request: HumanModelRequest) {
    return request.publicState.street === "flop" ? this.flop : this.live;
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), source = this.source(snapshot);
    await source.prepare(snapshot, signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Translated full-hand preparation superseded");
    this.prepared = { key, policy: source.policy(snapshot) };
  }

  async prepareHumanAction(request: HumanModelRequest, action: BridgeAction, signal?: AbortSignal) {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), source = this.source(snapshot);
    const outcome = await source.prepareHumanAction(snapshot, structuredClone(action), signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Translated full-hand action superseded");
    this.prepared = { key, policy: source.policy(snapshot) }; return outcome;
  }

  humanModel(request: HumanModelRequest, action: BridgeAction) {
    this.policy(request); return this.source(request).humanModel(request, action);
  }

  flopDescription(request: HumanModelRequest) {
    this.policy(request); return this.flop.description(request);
  }

  publicTree(request: HumanModelRequest) {
    this.policy(request);
    if (request.publicState.street === "flop") throw new Error("The saved flop has no live resolved tree");
    return this.live.publicTree(request);
  }
}
