import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  createTwoSizeRiverArtifactPayload,
  type TwoSizeRiverSolveArtifact,
} from "./two-size-artifact";
import { twoSizeRiverV1Game } from "./two-size-fixture";
import { auditTwoSizeRiverIndependentChecks } from "./two-size-independent-node";
import { auditTwoSizeRiverRules } from "./two-size-oracle";
import type { TwoSizeRiverAction, TwoSizeRiverState } from "./two-size-river-game";

function hashPayload(payload: Omit<TwoSizeRiverSolveArtifact, "payloadHash">): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: TwoSizeRiverState): string {
  const node = twoSizeRiverV1Game.node(state);
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
      informationSet: twoSizeRiverV1Game.informationSet(state, node.player),
    },
  });
}

/** SHA-256 over the exact two-size rules, states, information sets, actions, and payoffs. */
export function fingerprintTwoSizeRiverGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(twoSizeRiverV1Game.scenario)}\n`);
  const visit = (state: TwoSizeRiverState): void => {
    const node = twoSizeRiverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const edge of node.outcomes) visit(twoSizeRiverV1Game.nextChance(state, edge.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(twoSizeRiverV1Game.nextAction(state, action));
    }
  };
  visit(twoSizeRiverV1Game.initialState());
  return hash.digest("hex");
}

export function createTwoSizeRiverSolveArtifact(
  result: MultiwayCfrSolveResult<TwoSizeRiverAction>,
): TwoSizeRiverSolveArtifact {
  const payload = createTwoSizeRiverArtifactPayload(
    result,
    fingerprintTwoSizeRiverGame(),
    auditTwoSizeRiverRules(twoSizeRiverV1Game),
    auditTwoSizeRiverIndependentChecks(),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyTwoSizeRiverArtifactHash(artifact: TwoSizeRiverSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintTwoSizeRiverGame();
}
