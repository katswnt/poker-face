import { createHash } from "node:crypto";
import { canonicalSolverJson, deserializeBehavioralStrategy, serializeBehavioralStrategy } from "../../toy/artifact";
import { validateStrategy, type BehavioralStrategy, type SolverPlayer } from "../../toy/game";
import type { ConfigurableRiverAction } from "../configurable/game";
import { prepareConfigurableRiverV3, type ConfigurableRiverV3Request } from "../configurable-v3/solve";
import {
  compileFactorizedRiverGame, FACTORIZED_PLAYER_NODE, factorizedTerminalUtility0,
} from "../factorized/game";
import { compileFactorizedRiverScorekeeper, gradeFactorizedRiverStrategy } from "../factorized/scorekeeper";
import {
  RIVER_EXCHANGE_SCHEMA_VERSION, RIVER_EXCHANGE_STATE_LIMIT, RIVER_EXCHANGE_UNITS,
  RIVER_POLICY_PROBABILITY_TOLERANCE,
  type RiverExchangeGame, type RiverExchangeGamePayload, type RiverExchangeGrade,
  type RiverExchangePolicy, type RiverExchangePublicNode,
} from "./types";

export function hashRiverExchange(value: unknown): string {
  return createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
}

export function stringifyRiverExchange(value: unknown): string {
  return `${canonicalSolverJson(value, true)}\n`;
}

/** Trusted local request only; imported JSON never supplies a game tree or grading code. */
export function prepareRiverExchange(request: ConfigurableRiverV3Request) {
  const { game } = prepareConfigurableRiverV3(request, { maxProjectedStates: RIVER_EXCHANGE_STATE_LIMIT });
  const compiled = compileFactorizedRiverGame(game);
  const publicTree: RiverExchangePublicNode[] = compiled.publicHistories.map((history, id) => {
    if (compiled.nodeKinds[id] === FACTORIZED_PLAYER_NODE) {
      return {
        id, history: [...history], kind: "player", player: compiled.nodePlayers[id] as SolverPlayer,
        edges: compiled.publicActions[id].map((action, index) => ({
          action, child: compiled.edgeChildren[compiled.nodeEdgeStarts[id] + index],
        })),
      };
    }
    return {
      id, history: [...history], kind: "terminal",
      utility0ByDeal: game.deals.map((_, deal) => factorizedTerminalUtility0(compiled, deal, id)),
    };
  });
  const payload: RiverExchangeGamePayload = {
    format: "poker-face-river-game", schemaVersion: RIVER_EXCHANGE_SCHEMA_VERSION,
    rules: "configurable-river-v3", scenario: game.scenario,
    conventions: {
      units: RIVER_EXCHANGE_UNITS, utilityOrigin: "hand-start-including-prior-contributions",
      playerOneUtility: "negative-player-zero-utility",
      sizedActions: "total-river-contribution-excluding-prior-contributions",
      chance: "one-private-deal-before-public-node-zero", observation: "own-cards-and-public-history-only", rake: 0,
    },
    counts: {
      compatibleDeals: game.deals.length, publicStates: compiled.publicNodeCount,
      equivalentRepeatedStates: compiled.equivalentRepeatedStates,
      informationSets: compiled.index.informationSets.length, terminalStates: compiled.index.terminalNodes,
    },
    chanceDeals: game.deals.map(deal => ({ hands: deal.outcome.hands, probability: deal.probability })),
    publicTree,
    informationSets: compiled.index.informationSets.map((entry, index) => ({
      key: entry.key, player: entry.player,
      privateCards: game.scenario.ranges[entry.player][compiled.informationSetHandIndexes[index]].cards,
      publicNode: compiled.informationSetPublicNodes[index], actions: [...entry.actions],
    })),
  };
  const exported: RiverExchangeGame = { ...payload, gameFingerprint: hashRiverExchange(payload) };
  return { game, compiled, exported };
}

export type PreparedRiverExchange = ReturnType<typeof prepareRiverExchange>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} must contain exactly the required keys; missing or unknown entries are not allowed`);
  }
}

/** Strict import boundary: probabilities are not clipped, filled in, or renormalized. */
export function importRiverPolicy(
  prepared: PreparedRiverExchange,
  input: unknown,
): BehavioralStrategy<ConfigurableRiverAction> {
  const envelope = record(input, "Policy");
  exactKeys(envelope, ["format", "schemaVersion", "gameFingerprint", "units", "strategy"], "Policy");
  if (envelope.format !== "poker-face-river-policy" || envelope.schemaVersion !== RIVER_EXCHANGE_SCHEMA_VERSION) {
    throw new Error("Unsupported river policy format or schema version");
  }
  if (envelope.gameFingerprint !== prepared.exported.gameFingerprint) {
    throw new Error("Policy game fingerprint does not match the trusted local game");
  }
  if (envelope.units !== RIVER_EXCHANGE_UNITS) throw new Error("Policy payoff units must be net-chips-per-hand");
  const strategy = record(envelope.strategy, "Strategy");
  exactKeys(strategy, prepared.compiled.index.informationSets.map(entry => entry.key), "Strategy information sets");
  for (const definition of prepared.compiled.index.informationSets) {
    const entry = record(strategy[definition.key], `Strategy at ${definition.key}`);
    exactKeys(entry, definition.actions, `Actions at ${definition.key}`);
    let sum = 0;
    for (const action of definition.actions) {
      const probability = entry[action];
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error(`Probability for ${definition.key} / ${action} must be a finite number in [0,1]`);
      }
      sum += probability;
    }
    if (Math.abs(sum - 1) > RIVER_POLICY_PROBABILITY_TOLERANCE) {
      throw new Error(`Probabilities at ${definition.key} must sum to one; received ${sum}`);
    }
  }
  return deserializeBehavioralStrategy(prepared.compiled.index, strategy as RiverExchangePolicy["strategy"]);
}

export function exportRiverPolicy(
  prepared: PreparedRiverExchange,
  strategy: BehavioralStrategy<ConfigurableRiverAction>,
): RiverExchangePolicy {
  validateStrategy(prepared.compiled.index, strategy);
  const policy: RiverExchangePolicy = {
    format: "poker-face-river-policy", schemaVersion: RIVER_EXCHANGE_SCHEMA_VERSION,
    gameFingerprint: prepared.exported.gameFingerprint, units: RIVER_EXCHANGE_UNITS,
    strategy: serializeBehavioralStrategy(strategy),
  };
  importRiverPolicy(prepared, policy);
  return policy;
}

export function gradeRiverPolicy(prepared: PreparedRiverExchange, input: unknown): RiverExchangeGrade {
  const strategy = importRiverPolicy(prepared, input);
  const policy = exportRiverPolicy(prepared, strategy);
  const grade = gradeFactorizedRiverStrategy(compileFactorizedRiverScorekeeper(prepared.compiled), strategy);
  return {
    format: "poker-face-river-grade", schemaVersion: RIVER_EXCHANGE_SCHEMA_VERSION,
    gameFingerprint: prepared.exported.gameFingerprint, policyHash: hashRiverExchange(policy),
    units: RIVER_EXCHANGE_UNITS, utilityOrigin: "hand-start-including-prior-contributions",
    method: "independent-factorized-information-set-best-response", evaluation: "full-enumeration-floating-point",
    value: grade.value, bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
    gains: grade.gains, nashGap: grade.nashGap, exploitability: grade.exploitability,
    exploitabilityConvention: "half-nash-gap-two-player-zero-sum",
  };
}
