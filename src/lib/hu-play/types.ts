/**
 * Heads-up play vs a solver-backed AI: data contract (P0 of tasks/heads-up-play-resolving-spec.md).
 *
 * Seats use the bridge convention: player 0 is out of position (the big blind in the scripted
 * BTN-vs-BB formation), player 1 is in position. Chips are whole numbers; a sized action's `to`
 * is the actor's street total after the action, exactly as in the bridge contract, so a public
 * history maps 1:1 onto slice-path tokens ("x", "c", "f", "b<to>", "r<to>", card names).
 *
 * Privacy split: `HeadsUpPublicState` holds only what both players see. Hole cards live in
 * `PrivateDeal`, which only the hand reducer holds. Anything that builds a spot, a cache key or a
 * log line before the hand ends receives the public state and ranges, never a `PrivateDeal`.
 *
 * Browser-safe: no node imports.
 */
import type { BridgeAction, BridgeBoard, BridgePlayer, BridgeStreet } from "../solver/bridge/contract";
import type { RiverCard } from "../solver/river/cards";

export const HU_PUBLIC_STATE_FORMAT = "poker-face-hu-public-state";
export const HU_HAND_LOG_FORMAT = "poker-face-hu-hand-log";
export const HU_CONTRACT_VERSION = 1;

export type HuPublicEvent =
  | { readonly kind: "action"; readonly player: BridgePlayer; readonly action: BridgeAction }
  | { readonly kind: "card"; readonly street: "turn" | "river"; readonly card: RiverCard };

/** Everything derivable from the configuration and the event list (see derivePublicState). */
export interface HeadsUpPublicState {
  readonly format: typeof HU_PUBLIC_STATE_FORMAT;
  readonly version: 1;
  /** Pot before the first flop action (both players put in startingPot / 2). */
  readonly startingPot: number;
  /** Each player's stack behind at the flop (equal stacks). */
  readonly startingStack: number;
  /** Smallest opening bet in chips unless it would be all-in (the engine's `minimumBet`). */
  readonly minimumBet: number;
  readonly flop: BridgeBoard["flop"];
  readonly events: readonly HuPublicEvent[];
  // --- derived (validatePublicState recomputes and compares) ---
  readonly board: BridgeBoard;
  readonly street: BridgeStreet;
  /** betting: someone is to act; chance: the next card is due; showdown / fold: the hand is over. */
  readonly status: "betting" | "chance" | "showdown" | "fold";
  readonly toAct: BridgePlayer | null;
  /** Chips each player put in on closed postflop streets (streets close matched). */
  readonly closed: number;
  /** Each player's chips on the current street. */
  readonly streetPut: readonly [number, number];
  /** Number of actions taken on the current street. */
  readonly streetActions: number;
  readonly pot: number;
  readonly stacks: readonly [number, number];
  readonly folder: BridgePlayer | null;
  /** Slice-path tokens from the flop root, e.g. ["x", "b363", "c", "Qh"]. */
  readonly path: readonly string[];
}

/** Hole cards and the pre-shuffled runout. Only the hand reducer holds this. */
export interface PrivateDeal {
  /** Canonical bridge combos ("AsKs", higher deck index first). */
  readonly aiHand: string;
  readonly humanHand: string;
  /** The turn and river cards in deal order (only the dealt prefix is ever public). */
  readonly runout: readonly [RiverCard, RiverCard];
}

/** A per-combo weight vector. The AI's is exact; the human's is the solver's model. */
export interface HuRange {
  readonly source: string;
  /** Sorted canonical combos (bridge order), weight ≥ 0; board-blocked combos removed. */
  readonly entries: readonly { readonly combo: string; readonly weight: number }[];
}

/** Probability of each action for one hand at one node (sums to 1). */
export type ActionDistribution = readonly { readonly action: BridgeAction; readonly probability: number }[];

/** Where an AI decision came from (spec 2.2). Every variant names the spot it was read from. */
export type DecisionProvenance =
  | {
    readonly source: "library";
    /** sha256 of the canonical library spot. */
    readonly spotHash: string;
    readonly librarySpotId: string;
  }
  | {
    readonly source: "resolve";
    readonly kind: "street-root" | "nested";
    /** Content-addressed cache key: sha256 of the canonical re-solve spot. */
    readonly spotHash: string;
    readonly iterations: number;
    readonly exploitabilityPctPot: number | null;
    readonly precision: "float32" | "int16-compressed";
    readonly bridgeVersion: string;
    readonly engineCommit: string;
    /** Which rung of the admission ladder ran (0 = full solve). */
    readonly degradation: number;
  }
  | {
    readonly source: "translation";
    /** Spot whose node the off-tree size was mapped onto. */
    readonly spotHash: string;
    /** Actual bet and neighbouring tree sizes, as fractions of the pot. */
    readonly x: number;
    readonly a: number;
    readonly b: number;
    /** Pseudo-harmonic probability of mapping to `a`. */
    readonly probabilityA: number;
    readonly mappedTo: "a" | "b";
  };

/** One AI decision, as logged (spec 2.6). Contains nothing about the human's cards. */
export interface AiDecisionRecord {
  /** k: 0-based index of this AI decision in the hand. */
  readonly index: number;
  readonly path: readonly string[];
  readonly provenance: DecisionProvenance;
  /** σ(· | aiHand) at this node. */
  readonly strategy: ActionDistribution;
  /** The draw u_k in [0, 1). */
  readonly u: number;
  /** Distance from u_k to the nearest interior CDF boundary (replay divergence diagnostics). */
  readonly boundaryDistance: number;
  readonly action: BridgeAction;
}

export interface HuHandConfig {
  readonly handSeed: number;
  readonly aiSeat: BridgePlayer;
  readonly startingPot: number;
  readonly startingStack: number;
  readonly minimumBet: number;
  readonly flop: BridgeBoard["flop"];
}

export interface HuHandResult {
  /** Chips returned to each seat from the pot (pots.ts distributePots on showdown). */
  readonly payouts: readonly [number, number];
  /** Net chips vs the start of the hand, including the startingPot / 2 each put in preflop. */
  readonly net: readonly [number, number];
}

/** Versioned hand history (hash it with log-node.ts hashHandLog). */
export interface HuHandLogV1 {
  readonly format: typeof HU_HAND_LOG_FORMAT;
  readonly version: 1;
  readonly config: HuHandConfig;
  readonly events: readonly HuPublicEvent[];
  readonly humanActions: readonly BridgeAction[];
  readonly decisions: readonly AiDecisionRecord[];
  /** Hole cards, filled only once the hand is over. */
  readonly reveal: { readonly aiHand: string; readonly humanHand: string } | null;
  readonly result: HuHandResult | null;
}
