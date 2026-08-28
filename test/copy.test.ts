import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardTeachingNote,
  getHandOutcomeNote,
  getMissedNote,
  positionTeachingNote,
} from "../src/components/PokerSim";
import type { Decision, Stage } from "../src/lib/poker/types";
import { cards } from "./helpers";

test("call-versus-raise feedback explains the real tradeoff without reversing hand disguise", () => {
  const trainerRaise: Decision = {
    action: "raise",
    dialogue: "Raise.",
    reasoning: "Trainer raises.",
    thoughts: [],
    math: [],
  };
  const stage: Stage = {
    type: "action",
    street: "preflop",
    board: [],
    pot: 45,
    folded: [false, false, false, false],
  };

  const note = getMissedNote("call", trainerRaise, stage);
  assert.match(note?.reason ?? "", /starting-hand chart/);
  assert.match(note?.reason ?? "", /Calling keeps the pot smaller/);
  assert.doesNotMatch(note?.reason ?? "", /disguised less/);
});

test("preflop chart caveats plainly separate an app rule from unmeasured profit", () => {
  const trainerFold: Decision = {
    action: "fold",
    dialogue: "Fold.",
    reasoning: "Trainer folds.",
    thoughts: [],
    math: [],
  };
  const stage: Stage = {
    type: "action",
    street: "preflop",
    board: [],
    pot: 45,
    folded: [false, false, false, false],
  };

  const note = getMissedNote("call", trainerFold, stage);
  assert.equal(note?.reason, "The trainer's starting-hand chart puts this hand below its calling group, so the trainer folds.");
  assert.equal(note?.caveat, "The app has not calculated whether calling here would win or lose chips.");
});

test("hand review explains a fold win without treating one result as proof", () => {
  const riverBet: Stage = {
    type: "action",
    street: "river",
    playerIdx: 1,
    board: [],
    pot: 80,
    folded: [true, false, true, false],
    decision: {
      action: "bet",
      amount: 40,
      dialogue: "You bet.",
      reasoning: "Bet.",
      thoughts: [],
      math: [],
    },
  };
  const showdown: Stage = {
    type: "showdown",
    board: [],
    pot: 120,
    folded: [true, false, true, true],
    winner: 1,
    foldWin: true,
  };

  const note = getHandOutcomeNote([riverBet, showdown], 1, ["different", "model"]);
  assert.equal(note?.title, "Why you won");
  assert.equal(note?.reason, "Every opponent folded. Your river bet ended the hand, so your cards did not have to be best.");
  assert.match(note?.lesson ?? "", /marked it as different, not as a measured loss/);
});

test("preflop position lessons match the table's actual action order", () => {
  const notes = {
    button: positionTeachingNote("Dealer", true),
    smallBlind: positionTeachingNote("Small Blind", true),
    bigBlind: positionTeachingNote("Big Blind", true),
    utg: positionTeachingNote("UTG", true),
  };

  assert.match(notes.button, /after UTG and before the blinds/);
  assert.doesNotMatch(notes.button, /acting last preflop|acts last before the flop/);
  assert.match(notes.smallBlind, /first after the flop/);
  assert.match(notes.bigBlind, /acts early/);
  assert.doesNotMatch(notes.bigBlind, /worst postflop position/);
  assert.match(notes.utg, /first to act before the flop/);
});

test("board lessons describe possibilities without pretending future cards are harmless", () => {
  const dryFlop = boardTeachingNote(cards("As", "7d", "2c")) ?? "";
  const pairedFlop = boardTeachingNote(cards("As", "Ad", "7c")) ?? "";
  const connectedRiver = boardTeachingNote(cards("9s", "8d", "7c", "2h", "3s")) ?? "";

  assert.match(dryFlop, /later cards can still change who is ahead/);
  assert.doesNotMatch(dryFlop, /stable|should|don't/);
  assert.match(pairedFlop, /possible/);
  assert.doesNotMatch(pairedFlop, /reveal strength/);
  assert.match(connectedRiver, /no cards remain/);
  assert.doesNotMatch(connectedRiver, /draws are live|should|protect/i);
});

test("river feedback never teaches about a next card or drawing hands", () => {
  const riverStage: Stage = {
    type: "action",
    street: "river",
    playerIdx: 0,
    board: cards("As", "7d", "2c", "Jh", "4s"),
    pot: 100,
    currentBet: 0,
    bets: [0, 0],
    folded: [false, false],
  };
  const decisions: Array<[string, Decision]> = [
    ["call", { action: "raise", equity: 0.8, dialogue: "Raise.", reasoning: "Value raise.", thoughts: [], math: [] }],
    ["check", { action: "bet", amount: 50, equity: 0.7, dialogue: "Bet.", reasoning: "Value bet.", thoughts: [], math: [] }],
    ["bet", { action: "check", equity: 0.35, dialogue: "Check.", reasoning: "Check.", thoughts: [], math: [] }],
    ["fold", { action: "check", equity: 0.35, dialogue: "Check.", reasoning: "Check.", thoughts: [], math: [] }],
  ];

  for (const [userAction, trainerDecision] of decisions) {
    const note = getMissedNote(userAction, trainerDecision, riverStage);
    const copy = `${note?.reason ?? ""} ${note?.caveat ?? ""}`;
    assert.doesNotMatch(copy, /drawing hands|next card|free card|acting early/i, `${userAction} vs ${trainerDecision.action}`);
  }
});
