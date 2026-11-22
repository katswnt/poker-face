/** Independent leaf-sum/response oracle: no game transitions, settlement helper or grader. */
import type { BehavioralStrategy } from "../toy/game";
import { TINY_INPUT, type TinyAction, type TinyMode } from "./tiny-game";

export function tinyOracleWinner(h: number, k: number): 0 | 1 | "split" {
  if (![h, k].every(n => Number.isInteger(n) && n >= 0 && n < 3) || (h === k && h !== 0)) throw new Error("invalid tiny private pair");
  return h === k ? "split" : h < k ? 0 : 1;
}
const rankCard = (c: string) => "23456789TJQKA".indexOf(c[0]) * 4 + "cdhs".indexOf(c[1]);
interface World { h: number; k: number; board: string; weight: number }
function worlds(): World[] {
  const pairs: { h: number; k: number; weight: number }[] = [];
  for (let h = 0; h < 3; h++) for (let k = 0; k < 3; k++) {
    if (new Set([...TINY_INPUT.ranges[0][h].cards, ...TINY_INPUT.ranges[1][k].cards]).size !== 4) continue;
    pairs.push({ h, k, weight: TINY_INPUT.ranges[0][h].weight * TINY_INPUT.ranges[1][k].weight });
  }
  const denominator = pairs.reduce((s, p) => s + p.weight, 0), rows: World[] = [];
  for (const p of pairs) {
    const privateCards = new Set<string>([...TINY_INPUT.ranges[0][p.h].cards, ...TINY_INPUT.ranges[1][p.k].cards]);
    const available = TINY_INPUT.deck.filter(c => !privateCards.has(c));
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++) {
      const board = [available[a], available[b], available[c]].sort((a, b) => rankCard(a) - rankCard(b)).join("");
      rows.push({ h: p.h, k: p.k, board, weight: p.weight / denominator / 10 });
    }
  }
  return rows;
}
function probability(policy: BehavioralStrategy<TinyAction>, key: string, action: TinyAction) {
  const entry = policy.get(key); if (!entry) throw new Error(`oracle missing ${key}`);
  const i = entry.actions.indexOf(action); if (i < 0) return 0;
  const p = entry.probabilities[i]; if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error("invalid oracle probability");
  return p;
}
interface OopGroup { bet: number; checkNoBet: number; fold: number; call: number }
interface IpGroup { hand: number; facingFold: number; facingCall: number; check: number; bet: number }

export function tinyOracleGrade(policy: BehavioralStrategy<TinyAction>, mode: TinyMode = "bet") {
  if (!["bet", "checkdown", "allin"].includes(mode)) throw new Error("unknown tiny oracle mode");
  const wager = mode === "allin" ? 7 : 2, oop = new Map<string, OopGroup>(), ip = new Map<string, IpGroup>();
  const ipMass = [0, 0, 0], ipContinue = [0, 0, 0]; let value0 = 0, oopBeforeFlop = 0;
  for (const { h, k, board, weight } of worlds()) {
    const pre = probability(policy, `pre|1|${k}`, "c"), winner = tinyOracleWinner(h, k);
    // Direct chip ledger: match a wager -> +/- (half original pot + wager); split -> 0.
    const noBet = winner === "split" ? 0 : winner === 0 ? 3.25 : -3.25;
    const called = winner === "split" ? 0 : winner === 0 ? 3.25 + wager : -3.25 - wager;
    const p = (seat: number, hand: number, history: string, action: TinyAction) => mode === "checkdown" ? 0
      : probability(policy, `flop|${seat}|${hand}|${board}|${history}`, action);
    const lead = p(0, h, "", "b"), ipCall = p(1, k, "b", "c"), stab = p(1, k, "x", "b"), oopCall = p(0, h, "xb", "c");
    const leadValue = (1 - ipCall) * 3.25 + ipCall * called;
    const checkValue = (1 - stab) * noBet + stab * ((1 - oopCall) * -3.25 + oopCall * called);
    value0 += weight * ((1 - pre) * 1.25 + pre * (lead * leadValue + (1 - lead) * checkValue));
    oopBeforeFlop += weight * (1 - pre) * 1.25;

    const okey = `${h}|${board}`, og = oop.get(okey) ?? { bet: 0, checkNoBet: 0, fold: 0, call: 0 };
    const reached = weight * pre;
    og.bet += reached * leadValue; og.checkNoBet += reached * (1 - stab) * noBet;
    og.fold += reached * stab * -3.25; og.call += reached * stab * called; oop.set(okey, og);

    // IP's own preflop reach is removed when evaluating its unilateral deviation.
    ipMass[k] += weight;
    const ikey = `${k}|${board}`, ig = ip.get(ikey) ?? { hand: k, facingFold: 0, facingCall: 0, check: 0, bet: 0 };
    ig.facingFold += weight * lead * -3.25; ig.facingCall += weight * lead * -called;
    ig.check += weight * (1 - lead) * -noBet;
    ig.bet += weight * (1 - lead) * ((1 - oopCall) * 3.25 + oopCall * -called); ip.set(ikey, ig);
  }
  // Each max is AFTER summing all hidden states sharing the acting player's information.
  let response0 = oopBeforeFlop;
  for (const g of oop.values()) {
    const check = g.checkNoBet + Math.max(g.fold, g.call);
    response0 += mode === "checkdown" ? g.checkNoBet : Math.max(g.bet, check);
  }
  for (const g of ip.values()) ipContinue[g.hand] += mode === "checkdown" ? g.check
    : Math.max(g.facingFold, g.facingCall) + Math.max(g.check, g.bet);
  const response1 = ipContinue.reduce((s, v, k) => s + Math.max(-1.25 * ipMass[k], v), 0);
  return { value: [value0, -value0] as const, bestResponse: [response0, response1] as const,
    gains: [response0 - value0, response1 + value0] as const };
}

export function tinyCheatingWitness() {
  // IP KK, public AcAd2c, facing a bet. AA and QQ are both legal hidden OOP hands.
  const rows = [0, 2].map(h => ({ weight: TINY_INPUT.ranges[0][h].weight * TINY_INPUT.oopLead[h],
    fold: -3.25, call: tinyOracleWinner(h, 1) === 1 ? 5.25 : -5.25 }));
  const mass = rows.reduce((s, r) => s + r.weight, 0);
  const fold = rows.reduce((s, r) => s + r.weight * r.fold, 0), call = rows.reduce((s, r) => s + r.weight * r.call, 0);
  return { hiddenStates: 2, legalValue: Math.max(fold, call) / mass,
    cheatingValue: rows.reduce((s, r) => s + r.weight * Math.max(r.fold, r.call), 0) / mass };
}
