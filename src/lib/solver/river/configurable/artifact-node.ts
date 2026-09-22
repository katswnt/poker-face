import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../../toy/artifact";
import type { CfrSolveResult } from "../../toy/cfr";
import {
  createConfigurableRiverArtifactPayload,
  type ConfigurableRiverReferenceFixture,
  type ConfigurableRiverSolveArtifact,
  type ConfigurableRiverSolveArtifactPayload,
} from "./artifact";
import { configurableRiverV2DemoGame } from "./fixture";
import type { ConfigurableRiverAction, ConfigurableRiverState } from "./game";
import { auditConfigurableRiverRules } from "./oracle";

function hashPayload(payload: ConfigurableRiverSolveArtifactPayload): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: ConfigurableRiverState): string {
  const game = configurableRiverV2DemoGame;
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

export function fingerprintConfigurableRiverGame(): string {
  const game = configurableRiverV2DemoGame;
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(game.scenario)}\n`);
  const visit = (state: ConfigurableRiverState): void => {
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

export function createConfigurableRiverArtifact(
  result: CfrSolveResult<ConfigurableRiverAction>,
  reference: ConfigurableRiverReferenceFixture,
): ConfigurableRiverSolveArtifact {
  const payload = createConfigurableRiverArtifactPayload(
    result,
    reference,
    fingerprintConfigurableRiverGame(),
    auditConfigurableRiverRules(configurableRiverV2DemoGame),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyConfigurableRiverArtifactHash(
  artifact: ConfigurableRiverSolveArtifact,
): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintConfigurableRiverGame();
}
