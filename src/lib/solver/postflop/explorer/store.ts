import { readExplorerChunk, validateExplorerChunk } from "./load";
import type { ExplorerCatalog, ExplorerChunk } from "./model";

export interface Location { scenario: string; node: number; card: string | null }
interface Target { location: Location; trail: Location[] }
export interface ExplorerSnapshot extends Location {
  chunk: ExplorerChunk;
  trail: Location[];
  status: "ready" | "loading" | "error";
  error: string | null;
  /** Only successful navigation changes this focus/announcement token. */
  navigation: number;
}

export function createExplorerStore(catalog: ExplorerCatalog, initial: ExplorerChunk, read = readExplorerChunk) {
  const first = catalog.scenarios.find(s => s.id === initial.scenario);
  if (!first) throw new Error("Unknown initial saved scenario");
  validateExplorerChunk(initial, first, null);
  let snapshot: ExplorerSnapshot = { scenario: first.id, node: 0, card: null, chunk: initial, trail: [], status: "ready", error: null, navigation: 0 };
  const serverSnapshot = snapshot, listeners = new Set<() => void>();
  const cache = new Map<string, ExplorerChunk>([[`${first.id}/turn`, initial]]);
  let controller: AbortController | undefined, generation = 0, pending: Target | undefined;
  const emit = (patch: Partial<ExplorerSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(l => l()); };
  const cancel = () => { generation++; controller?.abort(); controller = undefined; pending = undefined; emit({ status: "ready", error: null }); };
  const go = async (target: Target) => {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal, id = ++generation;
    pending = target; emit({ status: "loading", error: null });
    try {
      const scenario = catalog.scenarios.find(s => s.id === target.location.scenario);
      if (!scenario) throw new Error("Unknown saved scenario");
      const key = `${scenario.id}/${target.location.card ?? "turn"}`;
      const chunk = cache.get(key) ?? (key === `${first.id}/turn` ? serverSnapshot.chunk : await read(scenario, target.location.card, signal));
      if (id !== generation || signal.aborted) return;
      if (!chunk.nodes.some(node => node.id === target.location.node)) throw new Error("That decision is not in the saved result.");
      cache.delete(key); cache.set(key, chunk);
      // One active lazy chunk plus the immutable hydration snapshot: at most two.
      while (cache.size > 1) cache.delete(cache.keys().next().value!);
      pending = undefined; controller = undefined;
      emit({ ...target.location, chunk, trail: target.trail, status: "ready", error: null, navigation: snapshot.navigation + 1 });
    } catch (error) {
      if (id !== generation || signal.aborted) return;
      controller = undefined; emit({ status: "error", error: error instanceof Error ? error.message : "Could not load the saved result." });
    }
  };
  return {
    getSnapshot: () => snapshot, getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) { cancel(); cache.clear(); cache.set(`${snapshot.scenario}/${snapshot.card ?? "turn"}`, snapshot.chunk); } };
    },
    navigate(location: Location) { return go({ location, trail: [...snapshot.trail, { scenario: snapshot.scenario, node: snapshot.node, card: snapshot.card }] }); },
    start(scenario = snapshot.scenario) { return go({ location: { scenario, node: 0, card: null }, trail: [] }); },
    jump(node: number) { return go({ location: { scenario: snapshot.scenario, node, card: null }, trail: [] }); },
    back() { const location = snapshot.trail.at(-1); return location ? go({ location, trail: snapshot.trail.slice(0, -1) }) : Promise.resolve(); },
    retry() { return pending ? go(pending) : Promise.resolve(); }, cancel,
    cachedChunks: () => cache.size,
  };
}
