/** Measurement harness only. Observe the actual finish call/string; do not re-solve,
 * re-encode an already parsed result, or report process/page memory as Worker memory.
 */
import type { LiveEngine } from "../src/lib/solver/bridge/live/model";
export function observeLiveExports(original: LiveEngine, now: () => number) {
  let last: { jsonBytes: number; elapsedMs: number } | null = null;
  const engine: LiveEngine = { ...original, create: bytes => {
    last = null;
    const session = original.create(bytes), finish = session.finish.bind(session);
    session.finish = () => {
      last = null;
      const start = now(), json = finish(), elapsedMs = now() - start;
      last = { jsonBytes: new TextEncoder().encode(json).length, elapsedMs }; return json;
    };
    return session;
  } };
  return { engine, read: () => last };
}
