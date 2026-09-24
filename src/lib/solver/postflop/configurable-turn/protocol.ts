import type { VectorJob } from "../vector/protocol";
import type { TurnV2Request } from "./rules";
export type TurnV2Job = Omit<VectorJob, "request"> & {
  readonly request: TurnV2Request;
  /** Grade here too and never accept a policy before this many iterations (default: first grade). */
  readonly minimumIterations?: number;
};
// Progress/checkpoint envelopes are shared with M2; rules are bound by gameIdentity.
export type { VectorProgress as TurnV2Progress, VectorWorkerMessage as TurnV2WorkerMessage } from "../vector/protocol";
