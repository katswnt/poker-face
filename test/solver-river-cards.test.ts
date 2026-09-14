import { test } from "node:test";
import assert from "node:assert/strict";
import { handScore } from "../src/lib/poker/eval";
import {
  RIVER_DECK,
  canonicalRiverCombo,
  parseRiverCombo,
  riverCardObject,
  riverComboKey,
  riverHandScore,
  type RiverCard,
} from "../src/lib/solver/river/cards";

test("river cards form one canonical 52-card deck", () => {
  assert.equal(RIVER_DECK.length, 52);
  assert.equal(new Set(RIVER_DECK).size, 52);
  assert.deepEqual(parseRiverCombo("AsQs"), ["As", "Qs"]);
  assert.deepEqual(parseRiverCombo("QsAs"), ["As", "Qs"]);
  assert.equal(riverComboKey(["Qs", "As"]), "AsQs");
  assert.deepEqual(canonicalRiverCombo(["2c", "Ad"]), ["Ad", "2c"]);
});

test("river cards reject malformed codes and repeated physical cards", () => {
  assert.throws(() => parseRiverCombo("ASQS"), /Invalid river/);
  assert.throws(() => parseRiverCombo("AsQ"), /Invalid river combo/);
  assert.throws(() => parseRiverCombo("AsAs"), /repeats As/);
  assert.throws(
    () => canonicalRiverCombo(["As", "1c" as RiverCard]),
    /Invalid river card 1c/,
  );
});

test("fast river scoring matches the slow five-of-seven reference across hand classes", () => {
  const examples = [
    { hand: "AsQs", board: ["Ts", "7s", "3s", "2c", "9d"] },
    { hand: "9h9c", board: ["9s", "Kh", "4d", "2c", "3d"] },
    { hand: "KhQh", board: ["Ks", "8s", "4s", "2c", "9d"] },
    { hand: "AhQh", board: ["Ks", "8s", "4s", "2c", "9d"] },
    { hand: "2h3h", board: ["As", "Ks", "Qs", "Js", "Ts"] },
  ] as const;

  for (const example of examples) {
    const hand = parseRiverCombo(example.hand);
    const board = example.board as readonly RiverCard[];
    assert.equal(
      riverHandScore(hand, board),
      handScore(hand.map(riverCardObject), board.map(riverCardObject)),
      `${example.hand} on ${example.board.join(" ")}`,
    );
  }
});
