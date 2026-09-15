import { createHash } from "node:crypto";
import { canonicalSolverJson } from "../toy/artifact";
import type { MultiwayCfrSolveResult } from "./cfr";
import {
  createFourPlayerArtifactPayload,
  type FourPlayerSolveArtifact,
} from "./four-player-artifact";
import { fourPlayerRiverV1Game } from "./four-player-fixture";
import { auditFourPlayerIndependentChecks } from "./four-player-independent-node";
import { auditFourPlayerRules } from "./four-player-oracle";
import type { FourPlayerRiverAction, FourPlayerRiverState } from "./four-player-river-game";

function hashPayload(payload: Omit<FourPlayerSolveArtifact, "payloadHash">): string {
  return createHash("sha256").update(canonicalSolverJson(payload)).digest("hex");
}

function fingerprintState(state: FourPlayerRiverState): string {
  const node = fourPlayerRiverV1Game.node(state);
  const stateRecord = { hands: state.hands, public: state.public };
  if (node.kind === "terminal") {
    return canonicalSolverJson({
      state: stateRecord,
      node,
      settlement: fourPlayerRiverV1Game.settlement(state),
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
      informationSet: fourPlayerRiverV1Game.informationSet(state, node.player),
    },
  });
}

/** SHA-256 over the exact cards, ranges, action order, information sets, and payoffs. */
export function fingerprintFourPlayerGame(): string {
  const hash = createHash("sha256");
  hash.update(`${canonicalSolverJson(fourPlayerRiverV1Game.scenario)}\n`);
  const visit = (state: FourPlayerRiverState): void => {
    const node = fourPlayerRiverV1Game.node(state);
    hash.update(`${fingerprintState(state)}\n`);
    if (node.kind === "chance") {
      for (const edge of node.outcomes) visit(fourPlayerRiverV1Game.nextChance(state, edge.outcome));
    } else if (node.kind === "player") {
      for (const action of node.actions) visit(fourPlayerRiverV1Game.nextAction(state, action));
    }
  };
  visit(fourPlayerRiverV1Game.initialState());
  return hash.digest("hex");
}

export function createFourPlayerSolveArtifact(
  result: MultiwayCfrSolveResult<FourPlayerRiverAction>,
): FourPlayerSolveArtifact {
  const payload = createFourPlayerArtifactPayload(
    result,
    fingerprintFourPlayerGame(),
    auditFourPlayerRules(fourPlayerRiverV1Game),
    auditFourPlayerIndependentChecks(),
  );
  return { ...payload, payloadHash: hashPayload(payload) };
}

export function verifyFourPlayerArtifactHash(artifact: FourPlayerSolveArtifact): boolean {
  const { payloadHash, ...payload } = artifact;
  return payloadHash === hashPayload(payload) &&
    payload.rulesFingerprint === fingerprintFourPlayerGame();
}
