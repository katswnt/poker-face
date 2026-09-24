import { test } from "node:test";
import assert from "node:assert/strict";
import { TURN_V2_CORPUS, TURN_V2_HELD_OUT } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { replayTurnV2Money } from "../src/lib/solver/postflop/configurable-turn/oracle";
import { initialTurnV2State, nextTurnV2Action, nextTurnV2River, turnV2Actions, validateTurnV2Request,
  type TurnV2Action, type TurnV2Menu, type TurnV2Request, type TurnV2State } from "../src/lib/solver/postflop/configurable-turn/rules";

// Audit 2026-09-24: the river solvers (commit 401ed22) collapse every bet/raise target
// above what the opponent can match into ONE target equal to the opponent's reachable
// street total. The turn v2 tree carried payoff-identical duplicates instead, e.g.
// stacks [250, 60] offered bet-to-75 AND bet-to-250 (both put a 60-chip player all-in).

const menu = (openingTargets: number[], raiseTargets: number[], raiseLimit: 0 | 1, includeAllIn: boolean): TurnV2Menu =>
  ({ openingTargets, raiseTargets, raiseLimit, includeAllIn });
const request = (id: string, stackBehind: [number, number], streets: [TurnV2Menu, TurnV2Menu]) => validateTurnV2Request({
  id, version: 2, board: ["Ah", "Kd", "7c", "2s"], rangeText: ["AsAc KK", "QQ JhTh"], committedPerPlayer: 50, stackBehind, streets });

const AUDIT_MENUS: [TurnV2Menu, TurnV2Menu][] = [
  [menu([33, 75], [100, 250], 1, true), menu([100], [], 0, true)],
  [menu([10, 120], [40], 1, false), menu([25], [60, 90], 1, true)],
  [menu([1], [2], 1, true), menu([1, 5], [3, 7], 1, true)],
];
const AUDIT_REQUESTS: TurnV2Request[] = [
  ...[[0, 50], [30, 30], [100, 100], [250, 60], [60, 250], [400, 400], [150, 1000]].flatMap(([a, b], i) =>
    AUDIT_MENUS.map((streets, j) => request(`audit-turn-${i}-${j}`, [a, b], streets))),
  ...TURN_V2_CORPUS, ...TURN_V2_HELD_OUT,
];

const target = (action: TurnV2Action) => action.includes("-to-") ? Number(action.split("-to-")[1]) : null;

function walk(req: TurnV2Request, visit: (state: TurnV2State, production: readonly TurnV2Action[], oracle: readonly TurnV2Action[]) => void) {
  const go = (state: TurnV2State) => {
    if (state.phase === "terminal") return;
    // Betting is river-card independent, so one representative river covers every public line.
    if (state.phase === "river-card") return go(nextTurnV2River(req, state, (["3d", "4d", "5d"] as const).find(card => !req.board.includes(card))!));
    const actions = turnV2Actions(req, state);
    visit(state, actions, replayTurnV2Money(req, state.histories, state.river).legal);
    for (const action of actions) go(nextTurnV2Action(req, state, action));
  };
  go(initialTurnV2State(req));
}

test("turn v2: no two bet/raise actions at a node share a target, and none exceed the opponent's reach", () => {
  for (const req of AUDIT_REQUESTS) walk(req, (state, production, oracle) => {
    const opponent = (1 - state.actor!) as 0 | 1;
    // Street-relative targets: the opponent can match at most their stack less chips already carried.
    const reach = req.stackBehind[opponent] - state.carried;
    for (const [label, actions] of [["production", production], ["oracle", oracle]] as const) {
      const targets = actions.map(target).filter((t): t is number => t !== null);
      const where = `${label} ${req.id} ${JSON.stringify(state.histories)}: ${actions.join(" ")}`;
      assert.equal(new Set(targets).size, targets.length, `duplicate target at ${where}`);
      for (const t of targets) assert.ok(t <= reach, `target ${t} exceeds opponent reach ${reach} at ${where}`);
    }
    assert.deepEqual(production, oracle, `${req.id} ${JSON.stringify(state.histories)}`);
  });
});

test("turn v2: stacks [250, 60] collapse uncallable targets on both streets", () => {
  const req = request("audit-250-60", [250, 60], AUDIT_MENUS[0]);
  const root = initialTurnV2State(req);
  assert.deepEqual(turnV2Actions(req, root), ["check", "bet-to-33", "bet-to-60"]);
  const facing = nextTurnV2Action(req, root, "bet-to-33");
  // Player 0 bet 33 into a 60-chip opponent who then raises; opponent's own all-in is still available.
  assert.deepEqual(turnV2Actions(req, facing), ["fold", "call", "raise-to-60"]);
  const checked = nextTurnV2Action(req, root, "check");
  const bet = nextTurnV2Action(req, checked, "bet-to-33");
  // Facing 33, player 0 (250 behind) had raise-to-100 AND raise-to-250 against 60 chips.
  assert.deepEqual(turnV2Actions(req, bet), ["fold", "call", "raise-to-60"]);
  // River after bet-33/call: opponent has 27 behind, so bet-to-100 and all-in both become bet-to-27.
  const river = nextTurnV2River(req, nextTurnV2Action(req, facing, "call"), "3d");
  assert.deepEqual(turnV2Actions(req, river), ["check", "bet-to-27"]);
});
