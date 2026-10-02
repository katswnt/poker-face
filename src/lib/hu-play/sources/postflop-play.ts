/** Public turn/river routing. A dealt river uses its own street-root policy, never a
 * truncated turn export. Both controllers prepare actual custom actions before commitment.
 */
import type { BridgeAction } from "../../solver/bridge/contract";
import type { HumanModelRequest } from "../hand";
import { preparationKey, PreparedPolicySource } from "./policy";
import { TurnPlaySource } from "./turn-play";
import { RiverPlaySource } from "./river-play";

export class PostflopPlaySource extends PreparedPolicySource {
  private generation = 0;
  constructor(private readonly turn: TurnPlaySource, private readonly river: RiverPlaySource) { super(); }

  private source(request: HumanModelRequest) {
    if (request.publicState.street === "turn") return this.turn;
    if (request.publicState.street === "river") return this.river;
    throw new Error("Live postflop play starts on the turn; the flop uses the saved library");
  }

  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), source = this.source(snapshot);
    await source.prepare(snapshot, signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Public street preparation superseded");
    this.prepared = { key, policy: source.policy(snapshot) };
  }

  async prepareHumanAction(request: HumanModelRequest, action: BridgeAction, signal?: AbortSignal) {
    const key = preparationKey(request); signal?.throwIfAborted();
    const generation = ++this.generation, snapshot = structuredClone(request), source = this.source(snapshot);
    const result = await source.prepareHumanAction(snapshot, structuredClone(action), signal); signal?.throwIfAborted();
    if (generation !== this.generation) throw new Error("Human street preparation superseded");
    this.prepared = { key, policy: source.policy(snapshot) }; return result;
  }

  humanModel(request: HumanModelRequest, action: BridgeAction) {
    this.policy(request); return this.source(request).humanModel(request, action);
  }

  publicTree(request: HumanModelRequest) {
    this.policy(request); return this.source(request).publicTree(request);
  }
}
