// Node-only hashing for the river artifact. Browser code can import artifact.ts safely.
import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import type { CfrSolveResult } from "../toy/cfr";
import {
  createRiverSolveArtifactPayload,
  type RiverReferenceFixture,
  type RiverSolveArtifact,
  type RiverSolveArtifactPayload,
} from "./artifact";
import { riverV1Game } from "./fixture";
import type { RiverAction, RiverState } from "./game";
import { auditRiverRules } from "./oracle";

function hashPayload(payload: RiverSolveArtifactPayload): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: RiverState): string {
  const node = riverV1Game.node(state);
  const stateRecord = { hands: state.hands, history: state.history };
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
      informationSet: riverV1Game.informationSet(state, node.player),
    },
  });
}

/** Hash the exact chance model, hidden-state grouping, action tree, and chip payoffs. */
export function fingerprintRiverGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(riverV1Game.scenario)}\n`);
  const visit = (state: RiverState): void => {
    const node = riverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const { outcome } of node.outcomes) visit(riverV1Game.nextChance(state, outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(riverV1Game.nextAction(state, action));
    }
  };
  visit(riverV1Game.initialState());
  return hash.digest("hex");
}

export function createRiverSolveArtifact(
  result: CfrSolveResult<RiverAction>,
  reference: RiverReferenceFixture,
): RiverSolveArtifact {
  const payload = createRiverSolveArtifactPayload(
    result,
    reference,
    fingerprintRiverGame(),
    auditRiverRules(riverV1Game),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyRiverArtifactHash(artifact: RiverSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintRiverGame();
}
