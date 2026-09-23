// Pure hand replay extracted from the trainer; no React or hidden-state equity input.
import { SB, BB, cardStr } from "./cards";
import { bestHand } from "./eval";
import { distributePots } from "./pots";
import { postBlinds, runBettingRound } from "./engine";
import { generateFullDecision } from "./decide";
import type { CardObj, Decision, PlayerInfo, Stage, TableStyle } from "./types";

export interface TrainerHandInput {
  gs: { hands: CardObj[][]; board: CardObj[]; seed: number; style: TableStyle };
  dealerIdx: number;
  startingStacks: number[];
  players: PlayerInfo[];
  heroIdx: number | null;
  heroChoices: Decision[];
  includeMoneySnapshots?: boolean;
}

export function calculateTrainerHand(input: TrainerHandInput): Stage[] {
  const { gs, dealerIdx, startingStacks, players, heroIdx, heroChoices, includeMoneySnapshots = false } = input;
  const dealSeed = gs.seed; // per-spot equity is seeded from this (see equity.ts)
  const { hands, board } = gs;
  const handStyle = gs.style;
  const all: Stage[] = [];
  let folded = [false, false, false, false];

  // Dynamic positions from dealerIdx
  const btnIdx = dealerIdx;
  const sbIdx = (dealerIdx + 1) % 4;
  const bbIdx = (dealerIdx + 2) % 4;
  const utgIdx = (dealerIdx + 3) % 4;

  // Stacks and blinds. Short stacks post only what they have; the nominal bring-in
  // remains one full BB for everyone else.
  const blindPosting = postBlinds(startingStacks, sbIdx, bbIdx, SB, BB);
  let stacks = blindPosting.stacks;
  let pot = blindPosting.pot;
  let contributions = blindPosting.contributions;

  const sbName = players[sbIdx].name;
  const bbName = players[bbIdx].name;
  const sbAllIn = blindPosting.smallBlindPosted < SB ? " and is all-in" : "";
  const bbAllIn = blindPosting.bigBlindPosted < BB ? " and is all-in" : "";
  all.push({ type: "info", street: "preflop", title: "Blinds posted", board: [], pot, folded: [...folded], stacks: [...stacks], description: `${sbName} posts ${blindPosting.smallBlindPosted} (SB)${sbAllIn}. ${bbName} posts ${blindPosting.bigBlindPosted} (BB)${bbAllIn}. Forced bets seed the pot.` });

  // Preflop: UTG first, then BTN, SB, BB. Blinds are already posted (in `stacks`/`pot`),
  // so they carry into the round as the starting bets with currentBet = BB.
  const preflopOrder = [utgIdx, btnIdx, sbIdx, bbIdx];
  const preflopBets = blindPosting.bets;
  const pf = runBettingRound({
    order: preflopOrder, hands, board: [], street: "preflop", players,
    pot, contributions, folded, stacks, bets: preflopBets, currentBet: blindPosting.currentBet, raiseCount: 0, countRaises: true,
    heroIdx, heroChoices, heroActionStart: 0,
    decide: ({ pi, pot, currentBet, playerBet, stack, numActive, raiseCount, minRaiseTo, canRaise, callQuote }) =>
      generateFullDecision(pi, hands[pi], [], pot, currentBet, playerBet, "preflop", false, players[pi].name, players[pi].pos, stack, numActive, handStyle, raiseCount, dealSeed, minRaiseTo, canRaise, callQuote),
  });
  all.push(...pf.stages);
  pot = pf.pot; folded = pf.folded; stacks = pf.stacks; contributions = pf.contributions;

  // Postflop: SB first, then BB, UTG, BTN. Fresh betting each street (currentBet 0).
  const postflopOrder = [sbIdx, bbIdx, utgIdx, btnIdx];
  const streets = [{ name: "flop", n: 3 }, { name: "turn", n: 4 }, { name: "river", n: 5 }];
  let heroActions = pf.heroActionsConsumed;
  for (const { name, n } of streets) {
    if (folded.filter(f => !f).length <= 1) break;
    const curBoard = board.slice(0, n);
    const streetLabel = name === "flop" ? `Flop — ${curBoard.map(cardStr).join("  ")}` : `${name.charAt(0).toUpperCase() + name.slice(1)} — ${cardStr(board[n - 1])}`;
    const baseNotes: Record<string, string> = { flop: "Three community cards dealt. New betting round begins.", turn: "Fourth card. Outs now use Rule of 2.", river: "Final card. No more outs." };
    const activePlayers = postflopOrder.filter(i => !folded[i]);
    const playersWithChips = activePlayers.filter(i => stacks[i] > 0);
    const bettingClosed = activePlayers.length >= 2 && playersWithChips.length < 2;
    const heroAllIn = heroIdx !== null && !folded[heroIdx] && stacks[heroIdx] === 0;
    const note = bettingClosed
      ? `${baseNotes[name]} No side pot can be contested — board running out, no betting.`
      : heroAllIn
      ? `${baseNotes[name]} You are all-in — no more decisions to make.`
      : baseNotes[name];
    all.push({ type: "street", street: name, title: streetLabel, note, board: curBoard, pot, folded: [...folded], stacks: [...stacks], ...(includeMoneySnapshots ? { contributions: [...contributions] } : {}) });
    const result = runBettingRound({
      order: postflopOrder, hands, board: curBoard, street: name, players,
      pot, contributions, folded, stacks, bets: [0, 0, 0, 0], currentBet: 0, raiseCount: 0, countRaises: false,
      heroIdx, heroChoices, heroActionStart: heroActions,
      decide: ({ pi, pot, currentBet, playerBet, stack, numActive, minRaiseTo, canRaise, callQuote }) =>
        generateFullDecision(pi, hands[pi], curBoard, pot, currentBet, playerBet, name, false, players[pi].name, players[pi].pos, stack, numActive, handStyle, 0, dealSeed, minRaiseTo, canRaise, callQuote),
    });
    heroActions += result.heroActionsConsumed;
    all.push(...result.stages);
    pot = result.pot; folded = result.folded; stacks = result.stacks; contributions = result.contributions;
  }

  if (folded.filter(f => !f).length > 1) {
    const finalBoard = board.slice(0, 5);
    const results = hands.map((h, i) => folded[i] ? { idx: i, folded: true, hand: null } : { idx: i, folded: false, hand: bestHand(h, finalBoard) });
    // The betting engine tracks each seat's total contribution so this payout path uses
    // the same money record as call pricing and the action feed.
    const awardOrder = [sbIdx, bbIdx, utgIdx, btnIdx]; // first active seat clockwise from BTN
    const { payouts, rankedResults, pots } = distributePots(contributions, folded, hands, finalBoard, awardOrder);
    payouts.forEach((amt, i) => { stacks[i] += amt; });
    const chop = pots.some(layer => layer.winners.length > 1);
    const winner = pots[0]?.winners[0] ?? rankedResults[0]?.idx ?? results.find(r => !r.folded)!.idx;
    all.push({ type: "showdown", board: finalBoard, pot, folded: [...folded], results, rankedResults, pots, winner, payouts, chop, stacks: [...stacks], ...(includeMoneySnapshots ? { contributions: [...contributions] } : {}) });
  } else {
    const w = folded.findIndex(f => !f);
    if (w >= 0) {
      stacks[w] += pot;
      all.push({ type: "showdown", board: all[all.length - 1]?.board || [], pot, folded: [...folded], results: [], rankedResults: [], winner: w, foldWin: true, stacks: [...stacks] });
    }
  }
  return all;
}
