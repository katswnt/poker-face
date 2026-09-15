import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import { createMultiwayArtifactPayload, type MultiwaySolveArtifact } from "./artifact";
import type { MultiwayCfrSolveResult } from "./cfr";
import { multiwayRiverV1Game } from "./fixture";
import { auditMultiwayIndependentChecks } from "./independent-node";
import type { MultiwayRiverAction, MultiwayRiverState } from "./river-game";
import { auditMultiwayRiverRules } from "./oracle";

function payloadHash(payload: Omit<MultiwaySolveArtifact, "payloadHash">): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: MultiwayRiverState): string {
  const node = multiwayRiverV1Game.node(state);
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
      informationSet: multiwayRiverV1Game.informationSet(state, node.player),
    },
  });
}

/** SHA-256 over the exact rules, joint chance states, information sets, actions, and payoffs. */
export function fingerprintMultiwayRiverGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(multiwayRiverV1Game.scenario)}\n`);
  const visit = (state: MultiwayRiverState): void => {
    const node = multiwayRiverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const edge of node.outcomes) visit(multiwayRiverV1Game.nextChance(state, edge.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(multiwayRiverV1Game.nextAction(state, action));
    }
  };
  visit(multiwayRiverV1Game.initialState());
  return hash.digest("hex");
}

export function createMultiwaySolveArtifact(
  result: MultiwayCfrSolveResult<MultiwayRiverAction>,
): MultiwaySolveArtifact {
  const payload = createMultiwayArtifactPayload(
    result,
    fingerprintMultiwayRiverGame(),
    auditMultiwayRiverRules(multiwayRiverV1Game),
    auditMultiwayIndependentChecks(),
  );
  return { ...payload, payloadHash: payloadHash(payload) };
}

export function verifyMultiwayArtifactHash(artifact: MultiwaySolveArtifact): boolean {
  const { payloadHash: storedHash, ...payload } = artifact;
  return storedHash === payloadHash(payload) && payload.rulesFingerprint === fingerprintMultiwayRiverGame();
}
