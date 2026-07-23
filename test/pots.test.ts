import { test } from "node:test";
import assert from "node:assert/strict";
import { distributePots } from "../src/lib/poker/pots";
import { cards } from "./helpers";

// 4 seats. hands[i] = hole cards, board shared. folded/contributions per seat.
test("single winner takes the whole pot", () => {
  const board = cards("Ah", "Kd", "Qc", "2s", "7h");
  const hands = [cards("As", "Ac"), cards("Kh", "Kc"), cards("3d", "4d"), cards("5c", "6c")];
  const folded = [false, false, true, true];
  const contributions = [100, 100, 0, 0]; // both live seats matched 100
  const { payouts } = distributePots(contributions, folded, hands, board);
  assert.deepEqual(payouts, [200, 0, 0, 0], "trip aces (set) wins the 200 pot");
});

test("exact tie splits the pot evenly", () => {
  const board = cards("Ah", "Kd", "Qc", "Jc", "Ts"); // board is a royal-ish broadway straight
  const hands = [cards("2s", "3d"), cards("4c", "5h"), cards("7c", "8c"), cards("9d", "9s")];
  const folded = [false, false, true, true];
  const contributions = [50, 50, 0, 0];
  const { payouts } = distributePots(contributions, folded, hands, board);
  // Both play the board (A-K-Q-J-T straight) → chop 100.
  assert.deepEqual(payouts, [50, 50, 0, 0]);
});

test("odd chip on a chopped pot goes to the lower seat index (deterministic)", () => {
  const board = cards("Ah", "Kd", "Qc", "Jc", "Ts");
  const hands = [cards("2s", "3d"), cards("4c", "5h"), cards("7c", "8c"), cards("9d", "9s")];
  const folded = [false, false, true, true];
  // Three seats each matched 17 (one later folded) → a single 51-chip pot, fully matched,
  // chopped between the two tied live seats: 25/25 with one odd chip to break.
  const contributions = [17, 17, 17, 0];
  const { payouts } = distributePots(contributions, folded, hands, board);
  assert.equal(payouts[0] + payouts[1], 51, "no chips lost");
  assert.equal(payouts[0], 26, "odd chip to lower seat");
  assert.equal(payouts[1], 25);
});

test("short all-in only wins the main pot; side pot goes to the bigger stack", () => {
  // Seat 0 all-in for 40 with the best hand. Seats 1 & 2 keep betting to 120.
  const board = cards("2h", "7d", "9c", "Jd", "4s");
  const hands = [
    cards("As", "Ac"), // best: pair of aces
    cards("Kh", "Kc"), // second: pair of kings
    cards("Qd", "Qs"), // third: pair of queens
    cards("3c", "5c"),
  ];
  const folded = [false, false, false, true];
  const contributions = [40, 120, 120, 0];
  const { payouts, pots } = distributePots(contributions, folded, hands, board);
  // Main pot: 40 from each of the 3 contributors = 120 → seat 0 (aces) wins.
  // Side pot: 80 each from seats 1&2 = 160 → seat 1 (kings) wins (seat 0 not eligible).
  assert.equal(payouts[0], 120, "aces win only the 120 main pot");
  assert.equal(payouts[1], 160, "kings win the 160 side pot");
  assert.equal(payouts[2], 0);
  assert.equal(payouts.reduce((a, b) => a + b, 0), 280, "all chips distributed");
  assert.equal(pots.length, 2, "one main + one side pot");
});

test("uncalled excess returns to the sole highest contributor", () => {
  const board = cards("2h", "7d", "9c", "Jd", "4s");
  const hands = [cards("As", "Ac"), cards("Kh", "Kc"), cards("3d", "4d"), cards("5c", "6c")];
  const folded = [false, false, true, true];
  const contributions = [200, 100, 30, 0]; // seat 0 over-committed; seat 1 called 100
  const { payouts } = distributePots(contributions, folded, hands, board);
  // Seat 0 (aces) wins the matched pot; the uncalled 100 comes back to seat 0.
  assert.equal(payouts.reduce((a, b) => a + b, 0), 330);
  assert.equal(payouts[0], 330, "aces win everything they matched plus their uncalled excess");
});
