import assert from "node:assert/strict";
import { makeDeck } from "../src/lib/poker/cards";
import { evalHand } from "../src/lib/poker/eval";

const expected = new Map<string, number>([
  ["Royal Flush", 4],
  ["Straight Flush", 36],
  ["Four of a Kind", 624],
  ["Full House", 3_744],
  ["Flush", 5_108],
  ["Straight", 10_200],
  ["Three of a Kind", 54_912],
  ["Two Pair", 123_552],
  ["Pair", 1_098_240],
  ["High Card", 1_302_540],
]);

const deck = makeDeck();
const observed = new Map<string, number>();
let total = 0;

for (let a = 0; a < deck.length - 4; a++) {
  for (let b = a + 1; b < deck.length - 3; b++) {
    for (let c = b + 1; c < deck.length - 2; c++) {
      for (let d = c + 1; d < deck.length - 1; d++) {
        for (let e = d + 1; e < deck.length; e++) {
          const name = evalHand([deck[a], deck[b], deck[c], deck[d], deck[e]]).name;
          observed.set(name, (observed.get(name) ?? 0) + 1);
          total++;
        }
      }
    }
  }
}

assert.equal(total, 2_598_960);
for (const [name, count] of expected) {
  assert.equal(observed.get(name), count, `${name} count drifted`);
}
assert.equal(observed.size, expected.size, "unexpected hand category appeared");

console.log("Exhaustive five-card audit passed: all 2,598,960 hands match canonical category counts.");
for (const [name, count] of expected) console.log(`${name.padEnd(17)} ${count.toLocaleString()}`);
