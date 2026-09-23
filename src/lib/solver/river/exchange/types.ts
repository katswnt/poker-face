import type { SolverPlayer, Utility } from "../../toy/game";
import type { SerializedBehavioralStrategy } from "../../toy/artifact";
import type { RiverCombo } from "../cards";
import type { ConfigurableRiverAction } from "../configurable/game";
import type { ConfigurableRiverV3Scenario } from "../configurable-v3/game";

export const RIVER_EXCHANGE_SCHEMA_VERSION = 1;
export const RIVER_EXCHANGE_STATE_LIMIT = 100_000;
export const RIVER_EXCHANGE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const RIVER_EXCHANGE_UNITS = "net-chips-per-hand";
export const RIVER_POLICY_PROBABILITY_TOLERANCE = 1e-12;

export type RiverExchangePublicNode = {
  readonly id: number;
  readonly history: readonly ConfigurableRiverAction[];
} & ({
  readonly kind: "player";
  readonly player: SolverPlayer;
  readonly edges: readonly { readonly action: ConfigurableRiverAction; readonly child: number }[];
} | {
  readonly kind: "terminal";
  /** One net payoff per chance deal, in exactly the exported chance-deal order. */
  readonly utility0ByDeal: readonly number[];
});

export interface RiverExchangeGamePayload {
  readonly format: "poker-face-river-game";
  readonly schemaVersion: 1;
  readonly rules: "configurable-river-v3";
  readonly scenario: ConfigurableRiverV3Scenario;
  readonly conventions: {
    readonly units: typeof RIVER_EXCHANGE_UNITS;
    readonly utilityOrigin: "hand-start-including-prior-contributions";
    readonly playerOneUtility: "negative-player-zero-utility";
    readonly sizedActions: "total-river-contribution-excluding-prior-contributions";
    readonly chance: "one-private-deal-before-public-node-zero";
    readonly observation: "own-cards-and-public-history-only";
    readonly rake: 0;
  };
  readonly counts: {
    readonly compatibleDeals: number;
    readonly publicStates: number;
    readonly equivalentRepeatedStates: number;
    readonly informationSets: number;
    readonly terminalStates: number;
  };
  readonly chanceDeals: readonly {
    readonly hands: readonly [RiverCombo, RiverCombo];
    readonly probability: number;
  }[];
  readonly publicTree: readonly RiverExchangePublicNode[];
  readonly informationSets: readonly {
    readonly key: string;
    readonly player: SolverPlayer;
    readonly privateCards: RiverCombo;
    readonly publicNode: number;
    readonly actions: readonly ConfigurableRiverAction[];
  }[];
}

export interface RiverExchangeGame extends RiverExchangeGamePayload {
  readonly gameFingerprint: string;
}

export interface RiverExchangePolicy {
  readonly format: "poker-face-river-policy";
  readonly schemaVersion: 1;
  readonly gameFingerprint: string;
  readonly units: typeof RIVER_EXCHANGE_UNITS;
  readonly strategy: SerializedBehavioralStrategy<ConfigurableRiverAction>;
}

export interface RiverExchangeGrade {
  readonly format: "poker-face-river-grade";
  readonly schemaVersion: 1;
  readonly gameFingerprint: string;
  readonly policyHash: string;
  readonly units: typeof RIVER_EXCHANGE_UNITS;
  readonly utilityOrigin: "hand-start-including-prior-contributions";
  readonly method: "independent-factorized-information-set-best-response";
  readonly evaluation: "full-enumeration-floating-point";
  readonly value: Utility;
  readonly bestResponseValue: Utility;
  readonly gains: Utility;
  readonly nashGap: number;
  readonly exploitability: number;
  readonly exploitabilityConvention: "half-nash-gap-two-player-zero-sum";
}
