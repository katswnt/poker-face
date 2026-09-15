import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  createRaisedRiverArtifactPayload,
  type RaisedRiverSolveArtifact,
} from "./raised-artifact";
import { raisedRiverV1Game } from "./raised-fixture";
import { auditRaisedRiverIndependentChecks } from "./raised-independent-node";
import { auditRaisedRiverRules } from "./raised-oracle";
import type { RaisedRiverAction, RaisedRiverState } from "./raised-river-game";

function hashPayload(payload: Omit<RaisedRiverSolveArtifact, "payloadHash">): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: RaisedRiverState): string {
  const node = raisedRiverV1Game.node(state);
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
      informationSet: raisedRiverV1Game.informationSet(state, node.player),
    },
  });
}

/** SHA-256 over the exact raised rules, states, information sets, actions, and payoffs. */
export function fingerprintRaisedRiverGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(raisedRiverV1Game.scenario)}\n`);
  const visit = (state: RaisedRiverState): void => {
    const node = raisedRiverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const edge of node.outcomes) visit(raisedRiverV1Game.nextChance(state, edge.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(raisedRiverV1Game.nextAction(state, action));
    }
  };
  visit(raisedRiverV1Game.initialState());
  return hash.digest("hex");
}

export function createRaisedRiverSolveArtifact(
  result: MultiwayCfrSolveResult<RaisedRiverAction>,
): RaisedRiverSolveArtifact {
  const payload = createRaisedRiverArtifactPayload(
    result,
    fingerprintRaisedRiverGame(),
    auditRaisedRiverRules(raisedRiverV1Game),
    auditRaisedRiverIndependentChecks(),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyRaisedRiverArtifactHash(artifact: RaisedRiverSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintRaisedRiverGame();
}
