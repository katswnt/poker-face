/** Full-hand source: unchanged saved flop, public-only live turn/river controllers.
 * Custom flop bets remain refused until P4's measured translation is wired here.
 */
import type { BridgeAction } from "../../solver/bridge/contract";
import type { HumanModelRequest } from "../hand";
import { actionToken, illegalActionReason } from "../public-state";
import type { PlayDecisionSource } from "../play-hand";
import type { LibraryPolicySource } from "./library";
import { preparationKey, PreparedPolicySource } from "./policy";
import type { PostflopPlaySource } from "./postflop-play";

export class HeadsUpPlaySource extends PreparedPolicySource implements PlayDecisionSource {
  private generation = 0;
  constructor(private readonly library: LibraryPolicySource, private readonly live: PostflopPlaySource) { super(); }

  private source(request: HumanModelRequest) {
    return request.publicState.street === "flop" ? this.library : this.live;
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), source = this.source(snapshot);
    await source.prepare(snapshot, signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Full-hand preparation superseded");
    this.prepared = { key, policy: source.policy(snapshot) };
  }

  async prepareHumanAction(request: HumanModelRequest, action: BridgeAction, signal?: AbortSignal) {
    const key = preparationKey(request); signal?.throwIfAborted();
    if (request.publicState.toAct === request.aiSeat) throw new Error("It is not the human's decision");
    const illegal = illegalActionReason(request.publicState, action); if (illegal) throw new Error(illegal);
    const generation = ++this.generation, snapshot = structuredClone(request), actual = structuredClone(action);
    let outcome: "on-tree" | "nested" | "translation";
    if (snapshot.publicState.street === "flop") {
      await this.library.prepare(snapshot, signal);
      if (!this.library.policy(snapshot).actions.some(a => actionToken(a) === actionToken(actual))) {
        throw new Error("Action is outside the saved flop menu; flop translation is not enabled");
      }
      outcome = "on-tree";
    } else outcome = await this.live.prepareHumanAction(snapshot, actual, signal);
    signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Full-hand action preparation superseded");
    this.prepared = { key, policy: this.source(snapshot).policy(snapshot) }; return outcome;
  }

  humanModel(request: HumanModelRequest, action: BridgeAction) {
    this.policy(request); return this.source(request).humanModel(request, action);
  }

  publicTree(request: HumanModelRequest) {
    this.policy(request);
    if (request.publicState.street === "flop") throw new Error("The saved flop has no live resolved tree");
    return this.live.publicTree(request);
  }
}
