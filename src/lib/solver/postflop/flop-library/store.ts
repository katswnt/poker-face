import { fetchFlopJson, validateFlopScenario, validateFlopSlice } from "./load";
import type { FlopCatalog, FlopScenario, FlopSlice, FlopViewNode } from "./model";
import type { FlopInspectionReply, FlopInspectionRequest } from "./worker";

export interface FlopWorkerPort {
  postMessage(message: FlopInspectionRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FlopInspectionReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
export interface FlopExplorerView {
  scenario: FlopScenario; flop: FlopSlice; turn: FlopSlice | null; river: FlopSlice | null; inspected: FlopViewNode[];
  node: number; hand: number | null; status: "ready" | "loading" | "inspecting" | "error"; message: string; revision: number;
  cause: "initial" | "push" | "pop" | "cancel" | "error"; elapsedMs: number | null; repeatedStates: number | null;
}
export const flopViewNodes = (view: FlopExplorerView) => new Map([view.flop, view.turn, view.river].flatMap(s => s?.nodes ?? []).concat(view.inspected).map(n => [n.id, n]));
export function flopDecisionLink(scenario: FlopScenario, node: FlopViewNode, hand: number | null = null) {
  const params = new URLSearchParams({ v: "1", game: scenario.id, source: scenario.sourceHash, node: String(node.id) });
  if (node.state.turn) params.set("turn", node.state.turn); if (node.state.river) params.set("river", node.state.river);
  if (hand !== null) params.set("hand", String(hand)); return `#${params}`;
}
export function parseFlopDecisionLink(hash: string) {
  if (hash.length > 512) throw new Error("This saved-decision link is too long");
  const p = new URLSearchParams(hash.replace(/^#/, "")), keys = ["v", "game", "source", "node", "turn", "river", "hand"];
  for (const key of p.keys()) if (!keys.includes(key) || p.getAll(key).length !== 1) throw new Error("Invalid saved-decision link");
  if (p.get("v") !== "1" || !/^[a-z0-9-]{1,80}$/.test(p.get("game") ?? "") || !/^[0-9a-f]{64}$/.test(p.get("source") ?? "")
    || !/^\d{1,6}$/.test(p.get("node") ?? "") || (p.has("hand") && !/^\d{1,2}$/.test(p.get("hand")!))) throw new Error("Invalid saved-decision link");
  for (const key of ["turn", "river"]) if (p.has(key) && !/^[2-9TJQKA][cdhs]$/.test(p.get(key)!)) throw new Error("Invalid card in saved-decision link");
  if (p.has("river") && !p.has("turn")) throw new Error("A river link needs a turn card");
  return { id: p.get("game")!, source: p.get("source")!, node: Number(p.get("node")), turn: p.get("turn"), river: p.get("river"), hand: p.has("hand") ? Number(p.get("hand")) : null };
}

export function createFlopExplorerStore(catalog: FlopCatalog, initial: { scenario: FlopScenario; flop: FlopSlice }, options: {
  worker: () => FlopWorkerPort; fetcher?: typeof fetch;
}) {
  const entry = catalog.scenarios.find(e => e.id === initial.scenario.id); if (!entry) throw new Error("Missing initial flop scenario");
  validateFlopScenario(initial.scenario, entry); validateFlopSlice(initial.flop, initial.scenario, "flop");
  const first: FlopExplorerView = { ...initial, turn: null, river: null, inspected: [], node: 0, hand: null, status: "ready", message: "", revision: 0,
    cause: "initial", elapsedMs: null, repeatedStates: null };
  let view = first, serial = 0, controller: AbortController | null = null, worker: FlopWorkerPort | null = null, retry: (() => Promise<void>) | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: FlopExplorerView) => { view = next; listeners.forEach(fn => fn()); };
  const stop = () => { serial++; controller?.abort(); controller = null; worker?.terminate(); worker = null; };
  const run = async (operation: (base: FlopExplorerView, signal: AbortSignal, ticket: number) => Promise<FlopExplorerView>, cause: "push" | "pop") => {
    const base = view; stop(); controller = new AbortController(); const signal = controller.signal, ticket = serial;
    retry = () => run(operation, cause); publish({ ...view, status: "loading", message: "Loading checked saved data…" });
    try {
      const result = await operation(base, signal, ticket); signal.throwIfAborted(); if (ticket !== serial) return;
      worker?.terminate(); worker = null; controller = null;
      publish({ ...result, status: "ready", message: "", revision: view.revision + 1, cause });
    } catch (error) {
      if (ticket !== serial || signal.aborted) return; worker?.terminate(); worker = null; controller = null;
      publish({ ...base, status: "error", message: error instanceof Error ? error.message : "Could not load the saved result", revision: view.revision + 1, cause: "error" });
    }
  };
  const inspect = (candidate: FlopExplorerView, signal: AbortSignal, ticket: number) => new Promise<FlopExplorerView>((resolve, reject) => {
    try {
      publish({ ...view, status: "inspecting", message: "Evaluating the saved river strategy. This is not a new solve…" });
      const nodes = flopViewNodes(candidate), context = { request: candidate.scenario.request, hands: candidate.scenario.hands, weights: candidate.scenario.weights };
      worker = options.worker(); const active = worker;
      const abort = () => { active.terminate(); reject(new Error("River inspection cancelled")); }; signal.addEventListener("abort", abort, { once: true });
      const fail = (message: string) => { signal.removeEventListener("abort", abort); active.terminate(); reject(new Error(message)); };
      active.onerror = () => fail("River inspection could not run. Retry; no main-thread calculation was used.");
      active.onmessageerror = () => fail("River inspection returned an unreadable result. Retry.");
      active.onmessage = event => {
        const result = event.data;
        if (ticket !== serial || signal.aborted || result.id !== ticket) return;
        if (result.sourceHash !== candidate.scenario.sourceHash || result.node !== candidate.node) { fail("River inspection does not match this saved decision"); return; }
        if (result.type === "error") { fail(result.message); return; }
        try {
          if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0 || !Number.isSafeInteger(result.repeatedStates) || result.repeatedStates < 0 || result.repeatedStates > 100000
            || !Number.isSafeInteger(result.compatibleDeals) || result.compatibleDeals < 0
            || result.repeatedStates !== result.compatibleDeals * result.publicStates || result.publicStates !== result.nodes.length) throw new Error("Invalid river inspection work counts");
          const slice = validateFlopSlice({ ...candidate.river!, nodes: result.nodes }, candidate.scenario, candidate.river!.key, true);
          if (!slice.nodes.some(n => n.id === candidate.node) || slice.nodes.length > 9) throw new Error("River inspection omitted this decision");
          for (const node of slice.nodes) {
            const saved = nodes.get(node.id);
            if (!saved || JSON.stringify([node.parent, node.state, node.edges, node.policy]) !== JSON.stringify([saved.parent, saved.state, saved.edges, saved.policy])) throw new Error("River inspection changed the saved policy or history");
          }
          signal.removeEventListener("abort", abort); active.terminate(); resolve({ ...candidate, inspected: slice.nodes, elapsedMs: result.elapsedMs, repeatedStates: result.repeatedStates });
        } catch (error) { fail(error instanceof Error ? error.message : "Invalid river result"); }
      };
      active.postMessage({ id: ticket, sourceHash: candidate.scenario.sourceHash, context, node: candidate.node,
        nodes: [...nodes.values()].map(n => ({ ...n, summary: null, hands: [] })) });
    } catch (error) { reject(error); }
  });
  const open = (id: string, node = 0, turn: string | null = null, river: string | null = null, hand: number | null = null, cause: "push" | "pop" = "push", sourceHash?: string) => run(async (base, signal, ticket) => {
    const entry = catalog.scenarios.find(s => s.id === id); if (!entry || (sourceHash && sourceHash !== entry.sourceHash)) throw new Error("This scenario or saved strategy version is unavailable");
    const scenario = base.scenario.id === id ? base.scenario : validateFlopScenario(await fetchFlopJson(entry.metadata, signal, options.fetcher), entry);
    const load = async (key: string) => {
      const ref = scenario.chunks[key]; if (!ref) throw new Error("That board is not in this saved scenario");
      return validateFlopSlice(await fetchFlopJson(ref, signal, options.fetcher), scenario, key);
    };
    const same = scenario.sourceHash === base.scenario.sourceHash;
    const flop = same ? base.flop : await load("flop");
    const turnSlice = turn ? same && base.turn?.key === `t-${turn}` ? base.turn : await load(`t-${turn}`) : null;
    const r = river && turn ? scenario.riverGroups[turn]?.indexOf(river) : -1; if (river && (r === undefined || r < 0)) throw new Error("That river is not available after this turn");
    const riverKey = river ? `t-${turn}-r-${Math.floor(r! / 4)}` : null;
    const riverSlice = riverKey ? same && base.river?.key === riverKey ? base.river : await load(riverKey) : null;
    let candidate: FlopExplorerView = { ...base, scenario, flop, turn: turnSlice, river: riverSlice, node, hand, inspected: [], elapsedMs: null, repeatedStates: null };
    const current = flopViewNodes(candidate).get(node);
    if (!current || current.state.turn !== turn || current.state.river !== river) throw new Error("That exact public history is not available");
    if (river) {
      if (same && base.river?.key === riverKey && base.inspected.some(n => n.id === node)) candidate = { ...candidate, inspected: base.inspected, elapsedMs: base.elapsedMs, repeatedStates: base.repeatedStates };
      else candidate = await inspect(candidate, signal, ticket);
    }
    if (hand !== null && !flopViewNodes(candidate).get(node)!.hands.some(h => h.hand === hand)) throw new Error("That exact hand is unavailable at this decision");
    return candidate;
  }, cause);
  return {
    getSnapshot: () => view, getServerSnapshot: () => first,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); if (!listeners.size) stop(); }; },
    openScenario: (id: string) => open(id),
    follow(a: number) { const node = flopViewNodes(view).get(view.node)!, edge = node.edges[a]; if (!edge) return Promise.resolve();
      return open(view.scenario.id, edge.node, node.state.phase === "card" && node.state.street === 0 ? edge.label : node.state.turn,
        node.state.phase === "card" && node.state.street === 1 ? edge.label : node.state.river); },
    back() { const node = flopViewNodes(view).get(view.node)!, parent = node.parent === null ? null : flopViewNodes(view).get(node.parent);
      return parent ? open(view.scenario.id, parent.id, parent.state.turn, parent.state.river) : Promise.resolve(); },
    reset: () => open(view.scenario.id),
    openLink(hash: string) {
      try { const link = parseFlopDecisionLink(hash); return open(link.id, link.node, link.turn, link.river, link.hand, "pop", link.source); }
      catch (error) { stop(); retry = null; publish({ ...view, status: "error", message: `${(error as Error).message}. Use Start over to reopen the checked scenario.`, revision: view.revision + 1, cause: "error" }); return Promise.resolve(); }
    },
    cancel() { stop(); publish({ ...view, status: "ready", message: "Cancelled. The previous checked decision is unchanged.", revision: view.revision + 1, cause: "cancel" }); },
    retry: () => retry?.() ?? Promise.resolve(),
    canRetry: () => retry !== null,
  };
}
