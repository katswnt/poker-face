import assert from "node:assert/strict";
import test from "node:test";
import { validatePublicState } from "../src/lib/hu-play/public-state";
import { preparationKey } from "../src/lib/hu-play/sources/policy";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { smallTurnRequest } from "./helpers/hu-play-turn";

test("public-state validation ignores object key order, but not ordered events or derived chip state", () => {
  const q = smallTurnRequest(), sorted = JSON.parse(canonicalSolverJson(q));
  assert.doesNotThrow(() => validatePublicState(sorted.publicState), "Canonical JSON must round-trip legal public state");
  assert.deepEqual(validatePublicState(sorted.publicState), q.publicState);
  assert.equal(preparationKey(sorted), preparationKey(q));
  assert.throws(() => validatePublicState({ ...sorted.publicState, pot: sorted.publicState.pot + 1 }), /pot|event/i);
  assert.throws(() => validatePublicState({ ...sorted.publicState, events: [...sorted.publicState.events].reverse() }));
  assert.throws(() => validatePublicState({ ...sorted.publicState, board: { ...sorted.publicState.board, humanHand: "AcAd" } }));
  assert.throws(() => validatePublicState({ ...sorted.publicState, events: sorted.publicState.events.map((e: object, i: number) =>
    i === 0 ? { ...e, humanHand: "AcAd" } : e) }), /unexpected/i);
});
