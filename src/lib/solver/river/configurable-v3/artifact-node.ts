import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../../toy/artifact";
import { gradeStrategy } from "../../toy/best-response";
import { solveCfr } from "../../toy/cfr";
import type { BehavioralStrategy } from "../../toy/game";
import { configurableRiverDecisionFacts } from "../configurable/explain";
import type { ConfigurableRiverAction } from "../configurable/game";
import { CONFIGURABLE_RIVER_V2_DEMO_SCENARIO } from "../configurable/fixture";
import { createConfigurableRiverGame } from "../configurable/game";
import { solveCompiledFactorizedRiverCfr, type FactorizedRiverCfrResult } from "../factorized/cfr";
import { compileFactorizedRiverGame } from "../factorized/game";
import {
  compileFactorizedRiverScorekeeper,
  gradeFactorizedRiverStrategy,
} from "../factorized/scorekeeper";
import {
  createConfigurableRiverV3ArtifactPayload,
  type ConfigurableRiverV3Artifact,
  type ConfigurableRiverV3ArtifactPayload,
} from "./artifact";
import { configurableRiverV3DemoGame } from "./fixture";
import {
  createConfigurableRiverV3Game,
  type ConfigurableRiverV3Scenario,
  type ConfigurableRiverV3State,
} from "./game";
import { auditConfigurableRiverV3Rules } from "./oracle";
import { CONFIGURABLE_RIVER_V3_TEACHING_STATE_LIMIT } from "./solve";

function hashPayload(payload: ConfigurableRiverV3ArtifactPayload): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

export function hashConfigurableRiverV3Decisions(
  decisions: ReturnType<typeof configurableRiverDecisionFacts>,
): string {
  return createHash("sha256").update(canonicalSolverJson(decisions)).digest("hex");
}

function fingerprintState(state: ConfigurableRiverV3State): string {
  const game = configurableRiverV3DemoGame;
  const node = game.node(state);
  const stateRecord = { hands: state.hands, public: state.public };
  if (node.kind === "terminal") return canonicalSolverJson({ state: stateRecord, node });
  if (node.kind === "chance") {
    return canonicalSolverJson({ state: stateRecord, node: { kind: node.kind, outcomes: node.outcomes } });
  }
  return canonicalSolverJson({
    state: stateRecord,
    node: {
      kind: node.kind,
      player: node.player,
      actions: node.actions,
      informationSet: game.informationSet(state, node.player),
    },
  });
}

export function fingerprintConfigurableRiverV3Game(): string {
  const game = configurableRiverV3DemoGame;
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(game.scenario)}\n`);
  const visit = (state: ConfigurableRiverV3State): void => {
    const node = game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const child of node.outcomes) visit(game.nextChance(state, child.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(game.nextAction(state, action));
    }
  };
  visit(game.initialState());
  return hash.digest("hex");
}

function maximumStrategyDifference(
  left: BehavioralStrategy<ConfigurableRiverAction>,
  right: BehavioralStrategy<ConfigurableRiverAction>,
): number {
  let maximum = 0;
  for (const [key, entry] of left) {
    const other = right.get(key);
    if (!other || other.actions.join("|") !== entry.actions.join("|")) {
      return Number.POSITIVE_INFINITY;
    }
    entry.probabilities.forEach((probability, action) => {
      maximum = Math.max(maximum, Math.abs(probability - other.probabilities[action]));
    });
  }
  return left.size === right.size ? maximum : Number.POSITIVE_INFINITY;
}

function maximumGradeDifference(
  left: ReturnType<typeof gradeStrategy<unknown, ConfigurableRiverAction, unknown>>,
  right: ReturnType<typeof gradeFactorizedRiverStrategy>,
): number {
  return Math.max(
    Math.abs(left.value[0] - right.value[0]),
    Math.abs(left.value[1] - right.value[1]),
    Math.abs(left.bestResponses[0].value - right.bestResponses[0].value),
    Math.abs(left.bestResponses[1].value - right.bestResponses[1].value),
    Math.abs(left.exploitability - right.exploitability),
  );
}

function independentChecks(): ConfigurableRiverV3ArtifactPayload["independentChecks"] {
  const compiled = compileFactorizedRiverGame(configurableRiverV3DemoGame);
  const readable = solveCfr(configurableRiverV3DemoGame, { iterations: 200 });
  const factorized = solveCompiledFactorizedRiverCfr(compiled, { iterations: 200 });
  const ordinaryCfrMaximumDifference = maximumStrategyDifference(
    readable.averageStrategy,
    factorized.averageStrategy,
  );
  const factorizedGradeMaximumDifference = maximumGradeDifference(
    gradeStrategy(configurableRiverV3DemoGame, factorized.averageStrategy, compiled.index),
    gradeFactorizedRiverStrategy(
      compileFactorizedRiverScorekeeper(compiled),
      factorized.averageStrategy,
    ),
  );

  const v2 = compileFactorizedRiverGame(createConfigurableRiverGame(CONFIGURABLE_RIVER_V2_DEMO_SCENARIO));
  const reductionScenario: ConfigurableRiverV3Scenario = {
    ...CONFIGURABLE_RIVER_V2_DEMO_SCENARIO,
    version: 3,
  };
  const reduction = compileFactorizedRiverGame(createConfigurableRiverV3Game(reductionScenario));
  const exactV2OneRaiseReduction =
    canonicalSolverJson(reduction.publicActions) === canonicalSolverJson(v2.publicActions) &&
    canonicalSolverJson(reduction.publicHistories) === canonicalSolverJson(v2.publicHistories) &&
    canonicalSolverJson(Array.from(reduction.edgeChildren)) === canonicalSolverJson(Array.from(v2.edgeChildren)) &&
    canonicalSolverJson(Array.from(reduction.terminalUtility0Win)) ===
      canonicalSolverJson(Array.from(v2.terminalUtility0Win)) &&
    canonicalSolverJson(Array.from(reduction.terminalUtility0Tie)) ===
      canonicalSolverJson(Array.from(v2.terminalUtility0Tie)) &&
    canonicalSolverJson(Array.from(reduction.terminalUtility0Loss)) ===
      canonicalSolverJson(Array.from(v2.terminalUtility0Loss));
  if (!exactV2OneRaiseReduction) throw new Error("River v3 no longer reduces exactly to v2");
  return {
    exactV2OneRaiseReduction: true,
    ordinaryCfrMaximumDifference,
    factorizedGradeMaximumDifference,
    hiddenOpponentCardsExcluded: true,
  };
}

export function createConfigurableRiverV3Artifact(
  result: FactorizedRiverCfrResult,
): ConfigurableRiverV3Artifact {
  const decisions = configurableRiverDecisionFacts(
    configurableRiverV3DemoGame,
    result.averageStrategy,
  );
  const payload = createConfigurableRiverV3ArtifactPayload(
    result,
    fingerprintConfigurableRiverV3Game(),
    auditConfigurableRiverV3Rules(configurableRiverV3DemoGame),
    {
      decisionCount: decisions.length,
      bulkExportStateLimit: CONFIGURABLE_RIVER_V3_TEACHING_STATE_LIMIT,
      decisionsSha256: hashConfigurableRiverV3Decisions(decisions),
    },
    independentChecks(),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyConfigurableRiverV3ArtifactHash(
  artifact: ConfigurableRiverV3Artifact,
): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintConfigurableRiverV3Game();
}
