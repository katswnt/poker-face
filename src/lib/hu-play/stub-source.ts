/**
 * Deterministic stub decision source for tests and the replay harness. NOT a strategy: its
 * σ(a | h) is a hash of (node path, combo, action), so it exercises the plumbing (draws, reach
 * bookkeeping, spot building, caching, provenance) without solving anything.
 *
 * At every street root it builds the re-solve spot the real policy would request and caches it
 * by spot hash (content-addressed, as spec 2.5). Node-only (uses hashBridgeSpot).
 */
import { canonicalBridgeSpotJson, hashBridgeSpot } from "../solver/bridge/contract-node";
import { POSTFLOP_SOLVER_COMMIT, type BridgeAction, type BridgeMenuTree, type BridgeSpotV1 } from "../solver/bridge/contract";
import type { DecisionRequest, DecisionResponse, DecisionSource, HumanModelRequest } from "./hand";
import { actionToken, illegalActionReason, isStreetRoot, sizedActionBounds } from "./public-state";
import { buildResolveSpot, HU_RESOLVE_SOLVE } from "./resolve-spot";
import { fnv1a } from "./rng";
import type { HeadsUpPublicState, HuRange } from "./types";

export interface SpotCapture {
  readonly spot: BridgeSpotV1;
  /** The exact bytes that are hashed. */
  readonly hashInput: string;
  /** The cache key (sha256 of hashInput). */
  readonly cacheKey: string;
}

export interface StubSourceOptions {
  readonly tree: BridgeMenuTree;
  readonly onSpot?: (capture: SpotCapture) => void;
  readonly onRequest?: (request: DecisionRequest | HumanModelRequest) => void;
}

function stubMenu(state: HeadsUpPublicState): BridgeAction[] {
  const bounds = sizedActionBounds(state);
  const currentBet = Math.max(...state.streetPut);
  const actions: BridgeAction[] = currentBet === 0 ? [{ type: "check" }] : [{ type: "fold" }, { type: "call" }];
  if (bounds) {
    const target = bounds.type === "bet" ? Math.round(0.66 * state.pot) : Math.round(currentBet * 3);
    for (const to of new Set([Math.min(bounds.max, Math.max(bounds.min, target)), bounds.max])) actions.push({ type: bounds.type, to });
  }
  return actions.filter(a => illegalActionReason(state, a) === null);
}

const weight = (path: readonly string[], combo: string, action: BridgeAction) =>
  1 + (fnv1a(`${path.join(",")}|${combo}|${actionToken(action)}`) % 1000);

/** Path to the current street's root: everything up to and including the last dealt card. */
function rootPath(state: HeadsUpPublicState): string {
  const cards = [state.board.turn, state.board.river].filter(Boolean) as string[];
  const last = cards.length ? state.path.lastIndexOf(cards[cards.length - 1]) + 1 : 0;
  return state.path.slice(0, last).join(",");
}

export function createStubSource(options: StubSourceOptions): DecisionSource & { readonly cache: ReadonlyMap<string, BridgeSpotV1> } {
  const cache = new Map<string, BridgeSpotV1>();
  const rootHashes = new Map<string, string>();
  const ensureRoot = (state: HeadsUpPublicState, aiSeat: 0 | 1, ranges: { ai: HuRange; human: HuRange }) => {
    if (!isStreetRoot(state)) return;
    const spot = buildResolveSpot({ publicState: state, aiSeat, ranges, tree: options.tree, solve: HU_RESOLVE_SOLVE, minimumRelativeReach: 0 });
    const hashInput = canonicalBridgeSpotJson(spot);
    const cacheKey = hashBridgeSpot(spot);
    options.onSpot?.({ spot, hashInput, cacheKey });
    cache.set(cacheKey, spot);
    rootHashes.set(rootPath(state), cacheKey);
  };
  const rootHash = (state: HeadsUpPublicState) => {
    const hash = rootHashes.get(rootPath(state));
    if (!hash) throw new Error(`Stub source: no street-root spot for ${rootPath(state) || "the flop"}`);
    return hash;
  };
  return {
    cache,
    decide(request) {
      options.onRequest?.(request);
      const state = request.publicState;
      ensureRoot(state, request.aiSeat, request.ranges);
      const menu = stubMenu(state);
      const probability = (action: BridgeAction, combo: string) => {
        const total = menu.reduce((s, a) => s + weight(state.path, combo, a), 0);
        return weight(state.path, combo, action) / total;
      };
      const spotHash = rootHash(state);
      const provenance: DecisionResponse["provenance"] = state.street === "flop"
        ? { source: "library", spotHash, librarySpotId: "stub-flop" }
        : { source: "resolve", kind: "street-root", spotHash, iterations: 0, exploitabilityPctPot: null, precision: "float32",
          bridgeVersion: "stub", engineCommit: POSTFLOP_SOLVER_COMMIT, degradation: 0 };
      return {
        strategy: menu.map(action => ({ action, probability: probability(action, request.aiHand) })),
        provenance,
        rangeProbability: probability,
      };
    },
    humanModel(request, action) {
      options.onRequest?.(request);
      ensureRoot(request.publicState, request.aiSeat, request.ranges);
      const path = request.publicState.path;
      return combo => weight(path, combo, action) / 1001;
    },
  };
}
