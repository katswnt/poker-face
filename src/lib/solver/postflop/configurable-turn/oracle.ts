// Audit only. Replay public histories with a cash ledger; never call production
// actions, transitions, compiled terminal scales or the fast showdown evaluator.
import { handScore } from "../../../poker/eval";
import { riverCardObject, type RiverCard, type RiverCombo } from "../../river/cards";
import type { TurnV2Action, TurnV2Request, TurnV2State } from "./rules";

export function replayTurnV2Money(request: TurnV2Request, histories: TurnV2State["histories"], river: RiverCard | null) {
  const cash = [...request.stackBehind] as [number, number], gross = [0, 0], refunds = [0, 0];
  let carried = 0, folded: 0 | 1 | null = null;
  let result: TurnV2State | undefined, legal: TurnV2Action[] = [];
  for (const street of [0, 1] as const) {
    if (street === 1 && river === null) {
      if (histories[1].length) throw new Error("Oracle: river actions without a river");
      break;
    }
    let paid: [number, number] = [0, 0], actor: 0 | 1 = 0, bet = 0, full = 0, raises = 0, checks = 0;
    let closed = cash.includes(0);
    const settings = request.streets[street];
    const choices = (): TurnV2Action[] => {
      if (closed || folded !== null) return [];
      const owe = paid[1 - actor] - paid[actor];
      const menu: TurnV2Action[] = owe > 0 ? ["fold", "call"] : ["check"];
      if (cash[1 - actor] === 0 || cash[actor] === 0 || (owe > 0 && raises === settings.raiseLimit)) return menu;
      const targets = [...(owe > 0 ? settings.raiseTargets : settings.openingTargets)];
      if (settings.includeAllIn) targets.push(cash[actor] + paid[actor]);
      // The opponent can match at most what they hold plus what they already put in this
      // street; any larger target only adds a refund, so it becomes that one target.
      const reach = cash[1 - actor] + paid[1 - actor];
      for (const target of [...new Set(targets)].sort((a, b) => a - b)) {
        const payment = target - paid[actor];
        const increase = payment - Math.max(0, owe);
        if (payment <= 0 || payment > cash[actor] || increase <= 0) continue;
        if (owe > 0 && increase < full && payment !== cash[actor]) continue;
        const label: TurnV2Action = `${owe > 0 ? "raise" : "bet"}-to-${target > reach ? reach : target}`;
        if (menu.indexOf(label) < 0) menu.push(label);
      }
      return menu;
    };
    for (const action of histories[street]) {
      if (!choices().includes(action)) throw new Error(`Oracle: illegal history action ${action}`);
      let payment = 0;
      if (action === "fold") { folded = actor; closed = true; }
      else if (action === "check") { checks++; closed = checks === 2; }
      else if (action === "call") { payment = Math.min(cash[actor], paid[1 - actor] - paid[actor]); closed = true; }
      else {
        const target = Number(action.split("-").at(-1));
        payment = target - paid[actor];
        const raise = target - bet;
        if (raise >= full) full = raise;
        bet = target; checks = 0;
        if (action.startsWith("raise")) raises++;
      }
      cash[actor] -= payment; gross[actor] += payment; paid[actor] += payment;
      actor = actor === 0 ? 1 : 0;
    }
    if (closed) {
      const matched = Math.min(...paid);
      for (const p of [0, 1] as const) { const refund = paid[p] - matched; cash[p] += refund; refunds[p] += refund; }
      carried += matched; paid = [0, 0]; bet = 0; full = 0; raises = 0; checks = 0;
    }
    legal = choices();
    result = { street, river: street === 0 ? null : river, histories, carried, streetPaid: paid,
      returned: refunds as [number, number], currentBet: bet, lastFullRaise: full, raisesUsed: raises, checks,
      actor: closed ? null : actor, folded, phase: !closed ? "play" : folded !== null || street === 1 ? "terminal" : "river-card" };
    if (street === 0 && river !== null && (!closed || folded !== null)) throw new Error("Oracle: river revealed before turn closure or after fold");
  }
  return { state: result!, legal, cash, gross, refunds };
}

export function oracleTurnV2Utility(request: TurnV2Request, histories: TurnV2State["histories"], river: RiverCard | null,
  hands: readonly [RiverCombo, RiverCombo]): readonly [number, number] {
  const { state, gross, refunds } = replayTurnV2Money(request, histories, river);
  if (state.phase !== "terminal") throw new Error("Oracle: cannot settle unfinished hand");
  const net = gross.map((chips, p) => request.committedPerPlayer + chips - refunds[p]);
  if (net[0] !== net[1]) throw new Error("Oracle: unreturned unmatched chips");
  let sign = state.folded === 0 ? -1 : 1;
  if (state.folded === null) {
    if (river === null) throw new Error("Oracle: missing showdown river");
    const board = [...request.board, river].map(riverCardObject);
    sign = Math.sign(handScore(hands[0].map(riverCardObject), board) - handScore(hands[1].map(riverCardObject), board));
  }
  return [sign * net[0], -sign * net[1]];
}
