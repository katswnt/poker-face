import { exactRangeEquity, type RangeEquityInput, type RangeEquityProgress, type RangeEquityResult } from "./teaching";
export type TeachingEvent =
  | { type: "progress"; id: number; progress: RangeEquityProgress }
  | { type: "result"; id: number; result: RangeEquityResult }
  | { type: "error"; id: number; message: string }
  | { type: "cancelled"; id: number };
export interface TeachingRequest { type: "equity"; id: number; input: RangeEquityInput }

/** Synchronous only inside the dedicated teaching Worker. Termination is cancellation;
 * partial enumeration is never published as equity. No actual AI hand/runout accepted.
 */
export function runTeachingRequest(message: unknown, emit: (event: TeachingEvent) => void): void {
  const request = message as TeachingRequest;
  const id = Number.isSafeInteger(request?.id) ? request.id : -1;
  try {
    if (!request || Object.keys(request).sort().join() !== "id,input,type" || request.type !== "equity" || id < 1) {
      throw new Error("Invalid teaching Worker request");
    }
    const result = exactRangeEquity(request.input, progress => emit({ type: "progress", id, progress }));
    emit({ type: "result", id, result });
  } catch (error) { emit({ type: "error", id, message: error instanceof Error ? error.message : String(error) }); }
}
