import type { HumanModelRequest } from "../hand";
import { preparationKey, PreparedPolicySource } from "./policy";
import type { LibraryPolicySource } from "./library";
import type { ResolvedPolicySource } from "./resolved";

/** The measured P1 path: complete library flop, full-range live street roots thereafter.
 * No measured pruning is needed for the widened corpus. Unsupported/failed live jobs are
 * explicit refusals, not silently substituted policies or missing-board translations.
 */
export class PlayPolicySource extends PreparedPolicySource {
  constructor(private readonly library: LibraryPolicySource, private readonly live: ResolvedPolicySource) { super(); }
  async prepare(request: HumanModelRequest, signal?: AbortSignal): Promise<void> {
    const key = preparationKey(request); signal?.throwIfAborted();
    const source = request.publicState.street === "flop" ? this.library : this.live;
    await source.prepare(request, signal); signal?.throwIfAborted();
    this.prepared = { key, policy: source.policy(request) };
  }
}
