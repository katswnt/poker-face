import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  createSidePotArtifactPayload,
  type SidePotSolveArtifact,
} from "./side-pot-artifact";
import { sidePotRiverV1Game } from "./side-pot-fixture";
import { auditSidePotIndependentChecks } from "./side-pot-independent-node";
import { auditSidePotRules } from "./side-pot-oracle";
import type { SidePotRiverAction, SidePotRiverState } from "./side-pot-river-game";

function hashPayload(payload: Omit<SidePotSolveArtifact, "payloadHash">): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: SidePotRiverState): string {
  const node = sidePotRiverV1Game.node(state);
  const stateRecord = { hands: state.hands, public: state.public };
  if (node.kind === "terminal") {
    return canonicalSolverJson({
      state: stateRecord,
      node,
      settlement: sidePotRiverV1Game.settlement(state),
    });
  }
  if (node.kind === "chance") {
    return canonicalSolverJson({ state: stateRecord, node: { kind: node.kind, outcomes: node.outcomes } });
  }
  return canonicalSolverJson({
    state: stateRecord,
    node: {
      kind: node.kind,
      player: node.player,
      actions: node.actions,
      informationSet: sidePotRiverV1Game.informationSet(state, node.player),
      callCost: sidePotRiverV1Game.callCost(state, node.player),
    },
  });
}

/** SHA-256 over the exact cards, actions, stacks, pot layers, information sets, and payoffs. */
export function fingerprintSidePotGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(sidePotRiverV1Game.scenario)}\n`);
  const visit = (state: SidePotRiverState): void => {
    const node = sidePotRiverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const edge of node.outcomes) visit(sidePotRiverV1Game.nextChance(state, edge.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(sidePotRiverV1Game.nextAction(state, action));
    }
  };
  visit(sidePotRiverV1Game.initialState());
  return hash.digest("hex");
}

export function createSidePotSolveArtifact(
  result: MultiwayCfrSolveResult<SidePotRiverAction>,
): SidePotSolveArtifact {
  const payload = createSidePotArtifactPayload(
    result,
    fingerprintSidePotGame(),
    auditSidePotRules(sidePotRiverV1Game),
    auditSidePotIndependentChecks(),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifySidePotArtifactHash(artifact: SidePotSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintSidePotGame();
}
