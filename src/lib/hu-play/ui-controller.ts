/** React-independent P5 state layer. Existing reducers/sources remain the poker authority. */
import type { BridgeAction, BridgePlayer } from "../solver/bridge/contract";
import { advanceAsync, type AdvanceOutcome } from "./async-hand";
import { handLog, type DecisionRequest, type HeadsUpHandState, type HumanModelRequest } from "./hand";
import { applyPlayHumanActionAsync, type PlayDecisionSource } from "./play-hand";
import { loadScriptedHand, scriptedSettlement } from "./scripted";
import { FlopPlaySource } from "./sources/flop-play";
import { loadPlayCatalog } from "./sources/library-data";
import { PostflopPlaySource } from "./sources/postflop-play";
import type { NodePolicy, PreparedPolicySource } from "./sources/policy";
import { ResolvedPolicySource, type PublicSolve } from "./sources/resolved";
import { RiverPlaySource } from "./sources/river-play";
import { TurnPlaySource } from "./sources/turn-play";
import { TranslatedHeadsUpPlaySource } from "./sources/translated-heads-up";
import type { RangeEquityInput } from "./teaching";
import type { ActionDistribution, DecisionProvenance, HeadsUpPublicState } from "./types";

export interface PlayHandBundle {
  readonly state: HeadsUpHandState;
  readonly source: PreparedPolicySource & PlayDecisionSource;
  readonly dispose?: () => void;
}
export interface PlayProgress {
  readonly stage: string; readonly iterations: number | null; readonly measuredAtIteration: number | null;
  readonly exploitability: number | null; readonly pot: number; readonly street: string;
}
export type PlayHandFactory = (seed: number, humanSeat: BridgePlayer, signal: AbortSignal,
  progress: (event: PlayProgress) => void) => Promise<PlayHandBundle>;

/** The same composition is injected with native solving for audits and W2 for the page. */
export async function loadPlayHand(seed: number, humanSeat: BridgePlayer, solve: PublicSolve,
  signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PlayHandBundle> {
  const catalog = await loadPlayCatalog(signal, fetcher);
  const { state, library } = await loadScriptedHand(catalog, seed, (1 - humanSeat) as BridgePlayer, signal, fetcher);
  const root = new ResolvedPolicySource(solve);
  return { state, source: new TranslatedHeadsUpPlaySource(new FlopPlaySource(library, seed),
    new PostflopPlaySource(new TurnPlaySource(root, solve, seed), new RiverPlaySource(root, solve, seed))) };
}

export interface PlayDecisionView {
  readonly key: string; readonly actor: "human" | "ai"; readonly public: HeadsUpPublicState;
  readonly provenance: DecisionProvenance;
  readonly strategy: ActionDistribution | null;
  readonly actionEvs: readonly (number | null)[] | null;
  readonly actionEvBasis: NodePolicy["actionEvBasis"];
  readonly humanActionMode: string | null;
}
interface Observation extends PlayDecisionView { readonly request: HumanModelRequest }
export interface PlayLedgerRow {
  readonly id: number; readonly seed: number; readonly humanSeat: BridgePlayer;
  readonly humanNet: number; readonly aiNet: number; readonly externalDeadBlind: 50;
}
export interface PlayView {
  readonly phase: "idle" | "loading" | "thinking" | "cancelling" | "human" | "complete" | "cancelled" | "error";
  readonly message: string;
  readonly hand: { readonly seed: number; readonly humanSeat: BridgePlayer; readonly humanHand: string;
    readonly aiHand: string | null; readonly public: HeadsUpPublicState; readonly finalStacks: readonly [number, number] | null } | null;
  readonly decisions: readonly PlayDecisionView[];
  readonly ledger: readonly PlayLedgerRow[];
  readonly progress: PlayProgress | null;
}
const keyOf = (q: HumanModelRequest) => q.publicState.path.join(" ") || "root";

export class PlayController {
  private view: PlayView = { phase: "idle", message: "Choose your seat, then deal a hand.", hand: null, decisions: [], ledger: [], progress: null };
  private readonly listeners = new Set<() => void>();
  private readonly observed = new Map<string, Observation>();
  private hand: HeadsUpHandState | null = null;
  private bundle: PlayHandBundle | null = null;
  private source: PlayDecisionSource | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private handId = 0;
  private disposed = false;
  private requested: { seed: number; humanSeat: BridgePlayer } | null = null;
  constructor(private readonly create: PlayHandFactory) {}
  getSnapshot = (): PlayView => this.view;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<PlayView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch }; this.listeners.forEach(f => f());
  }
  private sync(phase: PlayView["phase"], message: string) {
    const s = this.hand, complete = !!s?.result;
    const settled = complete ? scriptedSettlement(s!) : null;
    let ledger = this.view.ledger;
    if (settled && !ledger.some(row => row.id === this.handId)) {
      const humanSeat = (1 - s!.config.aiSeat) as BridgePlayer;
      ledger = [...ledger, { id: this.handId, seed: s!.config.handSeed, humanSeat,
        humanNet: settled.netSinceBeforeBlinds[humanSeat], aiNet: settled.netSinceBeforeBlinds[s!.config.aiSeat], externalDeadBlind: 50 }];
    }
    this.publish({ phase, message, ledger, hand: s ? { seed: s.config.handSeed,
      humanSeat: (1 - s.config.aiSeat) as BridgePlayer, humanHand: s.deal.humanHand,
      aiHand: complete ? s.deal.aiHand : null, public: s.public, finalStacks: settled?.finalStacks ?? null } : null,
      decisions: [...this.observed.values()].map(({ request: _request, ...o }) => {
        void _request;
        return o.actor === "ai" && !complete ? { ...o, strategy: null, actionEvs: null } : o;
      }) });
  }
  private remember(q: HumanModelRequest, policy: NodePolicy, generation: number) {
    if (generation !== this.generation || this.disposed) return;
    const key = keyOf(q), old = this.observed.get(key), actor = q.publicState.toAct === q.aiSeat ? "ai" : "human";
    let strategy: ActionDistribution | null = old?.strategy ?? null, evs = old?.actionEvs ?? null;
    if (actor === "human" && this.hand) {
      // A human's real hand can be outside the model after a deviation. That does not
      // authorize inventing its policy column or changing public solve ranges.
      try { strategy = policy.distribution(this.hand.deal.humanHand); evs = policy.actionEvs(this.hand.deal.humanHand); }
      catch { strategy = null; evs = null; }
    }
    this.observed.set(key, { key, actor, public: structuredClone(q.publicState), request: structuredClone(q),
      provenance: structuredClone(policy.provenance), strategy, actionEvs: evs,
      actionEvBasis: policy.actionEvBasis, humanActionMode: old?.humanActionMode ?? null });
  }
  private observer(inner: PlayHandBundle["source"], generation: number): PlayDecisionSource {
    return {
      prepare: async (q, signal) => { await inner.prepare(q, signal); this.remember(q, inner.policy(q), generation); },
      prepareHumanAction: async (q, action, signal) => {
        const result = await inner.prepareHumanAction(q, action, signal);
        this.remember(q, inner.policy(q), generation);
        if (generation === this.generation && !this.disposed) {
          const o = this.observed.get(keyOf(q))!;
          this.observed.set(o.key, { ...o, humanActionMode: typeof result === "string" ? result : null });
        }
        return result;
      },
      decide: (q: DecisionRequest) => {
        const result = inner.decide(q);
        if (generation === this.generation && !this.disposed) {
          const request = { publicState: q.publicState, aiSeat: q.aiSeat, ranges: q.ranges };
          const o = this.observed.get(keyOf(request))!;
          this.observed.set(o.key, { ...o, strategy: result.strategy, actionEvs: inner.policy(request).actionEvs(q.aiHand) });
        }
        return result;
      },
      humanModel: (q, action) => inner.humanModel(q, action),
    };
  }
  async start(seed: number, humanSeat: BridgePlayer): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation; this.abort?.abort(); this.bundle?.dispose?.();
    this.bundle = null; this.source = null; this.hand = null; this.observed.clear();
    this.handId++; this.requested = { seed, humanSeat }; this.abort = new AbortController();
    this.publish({ progress: null }); this.sync("loading", "Loading the checked flop policy…");
    try {
      const b = await this.create(seed, humanSeat, this.abort.signal, progress => {
        if (generation === this.generation && !this.disposed) this.publish({ progress });
      });
      if (generation !== this.generation || this.disposed || this.abort.signal.aborted) {
        b.dispose?.();
        if (generation === this.generation && !this.disposed) this.sync("cancelled", "Loading cancelled. Retry to deal this seed.");
        return;
      }
      this.bundle = b; this.source = this.observer(b.source, generation); this.hand = b.state;
      await this.advance();
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.sync(this.abort.signal.aborted ? "cancelled" : "error",
        this.abort.signal.aborted ? "Loading cancelled. Retry to deal this seed." : error instanceof Error ? error.message : String(error));
    }
  }
  private async advance(action?: BridgeAction): Promise<void> {
    if (!this.hand || !this.source || this.disposed) return;
    const generation = this.generation, signal = (this.abort = new AbortController()).signal;
    this.publish({ progress: null }); this.sync("thinking", "AI thinking / preparing the next decision…");
    try {
      const outcome: AdvanceOutcome = action
        ? await applyPlayHumanActionAsync(this.hand, action, this.source, signal)
        : await advanceAsync(this.hand, this.source, signal);
      if (generation !== this.generation || this.disposed) return;
      this.hand = outcome.state;
      this.sync(outcome.status === "unavailable" ? "error" : outcome.status,
        outcome.reason ?? (outcome.status === "complete" ? "Hand complete. Inspect any decision or deal again." : "Your turn."));
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.sync(signal.aborted ? "cancelled" : "error",
        error instanceof Error ? error.message : String(error));
    }
  }
  async act(action: BridgeAction): Promise<void> {
    if (this.disposed || this.view.phase !== "human") return;
    await this.advance(structuredClone(action));
  }
  async resume(): Promise<void> {
    if (this.disposed || ["loading", "thinking", "cancelling", "complete", "human"].includes(this.view.phase)) return;
    if (this.hand && this.source) await this.advance();
    else if (this.requested) await this.start(this.requested.seed, this.requested.humanSeat);
  }
  cancel(): void {
    if (this.disposed || !["loading", "thinking"].includes(this.view.phase)) return;
    this.abort?.abort(); this.publish({ phase: "cancelling", message: "Cancelling… Completed actions stay in the hand." });
  }
  equityInput(key: string): RangeEquityInput {
    const o = this.observed.get(key); if (!o || !this.hand) throw new Error("No such decision to inspect");
    const b = o.public.board;
    return structuredClone({ humanHand: this.hand.deal.humanHand,
      board: [...b.flop, ...(b.turn ? [b.turn] : []), ...(b.river ? [b.river] : [])], aiRange: o.request.ranges.ai });
  }
  completedLog() {
    if (!this.hand?.result) throw new Error("The hand must be complete before exporting private decisions");
    return structuredClone(handLog(this.hand));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.abort?.abort(); this.bundle?.dispose?.(); this.listeners.clear();
  }
}
