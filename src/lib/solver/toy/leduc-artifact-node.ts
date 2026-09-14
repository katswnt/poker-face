// Node-only Leduc artifact hashing. Browser-facing consumers can import
// leduc-artifact.ts without pulling node:crypto into a client bundle.
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "./artifact";
import type { CfrSolveResult } from "./cfr";
import {
  createLeducSolveArtifactPayload,
  type LeducReferenceResult,
  type LeducSolveArtifact,
  type LeducSolveArtifactPayload,
} from "./leduc-artifact";
import { leducGame, type LeducAction, type LeducState } from "./leduc";

function hashPayload(payload: LeducSolveArtifactPayload): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: LeducState): string {
  const node = leducGame.node(state);
  const stateRecord = {
    privateCards: state.privateCards,
    board: state.board,
    round: state.round,
    histories: state.histories,
  };
  if (node.kind === "terminal") {
    return canonicalSolverJson({ state: stateRecord, node });
  }
  if (node.kind === "chance") {
    return canonicalSolverJson({
      state: stateRecord,
      node: { kind: node.kind, outcomes: node.outcomes },
    });
  }
  return canonicalSolverJson({
    state: stateRecord,
    node: {
      kind: node.kind,
      player: node.player,
      actions: node.actions,
      informationSet: leducGame.informationSet(state, node.player),
    },
  });
}

/** Hash the complete public game contract, including hidden-state grouping and payoffs. */
export function fingerprintLeducGame(): string {
  const hash = createHash("sha256");
  hash.update(`${leducGame.id}\n`);
  const visit = (state: LeducState): void => {
    const node = leducGame.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const { outcome } of node.outcomes) visit(leducGame.nextChance(state, outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(leducGame.nextAction(state, action));
    }
  };
  visit(leducGame.initialState());
  return hash.digest("hex");
}

export function createLeducSolveArtifact(
  result: CfrSolveResult<LeducAction>,
  reference: LeducReferenceResult,
): LeducSolveArtifact {
  const payload = createLeducSolveArtifactPayload(result, reference, fingerprintLeducGame());
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyLeducArtifactHash(artifact: LeducSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintLeducGame();
}
