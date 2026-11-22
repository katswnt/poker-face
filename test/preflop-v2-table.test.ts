import assert from "node:assert/strict";
import { test } from "node:test";
import { continuationTable, tablePairValue, expectedTableValue, conditionalTableValues } from "../src/lib/solver/preflop-v2/table";
const input = () => ({ deckSize: 6, pot: 10, stack: 4, ranges: [
  [{ cards: [0, 1], weight: 1 }, { cards: [2, 3], weight: 0.5 }, { cards: [2, 4], weight: 0.5 }],
  [{ cards: [2, 3], weight: 1 }, { cards: [4, 5], weight: 0.25 }],
] as const, oopGross: [[12, -2], [null, 5], [null, null]] });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-10, `${a} != ${b}`);

test("immutable continuation tables permit future transfers and retain exact compatible-pair mass", () => {
  const source = input(), table = continuationTable(source);
  assert.deepEqual(tablePairValue(table, 0, 0), [12, -2]); assert.deepEqual(tablePairValue(table, 0, 1), [-2, 12]);
  assert.equal(table.version, 2); near(table.partition, 11 / 8);
  near(expectedTableValue(table)[0], 97 / 11); near(expectedTableValue(table)[1], 13 / 11);
  const conditional = conditionalTableValues(table);
  near(conditional[0][0]!, 9.2); near(conditional[0][1]!, 5); assert.equal(conditional[0][2], null);
  near(conditional[1][0]!, -2); near(conditional[1][1]!, 29 / 3);
  source.oopGross[0][0] = 7; assert.deepEqual(tablePairValue(table, 0, 0), [12, -2]);
  assert.equal(Reflect.set(table.oopGross[0], "0", 7), false);
  assert.ok(Object.isFrozen(table) && Object.isFrozen(table.ranges[0][0].cards));
  assert.throws(() => tablePairValue(table, 1, 0), /incompatible/);
});

test("continuation tables reject missing/imputed cells, invalid weights and unphysical chip values", () => {
  for (const value of [NaN, Infinity, 14.001, -4.001, null]) {
    const x = input(); x.oopGross[0][0] = value; assert.throws(() => continuationTable(x));
  }
  const imputed = input(); imputed.oopGross[1][0] = 0; assert.throws(() => continuationTable(imputed), /incompatible/);
  assert.throws(() => continuationTable({ ...input(), oopGross: [[1]] }), /shape/);
  assert.throws(() => continuationTable({ ...input(), pot: -1 }));
  assert.throws(() => continuationTable({ ...input(), stack: Infinity }));
});

test("swapping players transposes blocker mass and complements original gross values", () => {
  const source = input(), original = continuationTable(source);
  const swapped = continuationTable({ ...source, ranges: [source.ranges[1], source.ranges[0]],
    oopGross: source.ranges[1].map((_, k) => source.ranges[0].map((_, h) => source.oopGross[h][k] === null ? null : 10 - source.oopGross[h][k]!)) });
  near(expectedTableValue(swapped)[0], expectedTableValue(original)[1]);
  for (let h = 0; h < source.ranges[0].length; h++) for (let k = 0; k < source.ranges[1].length; k++) near(original.mass[h][k], swapped.mass[k][h]);
  const a = conditionalTableValues(original), b = conditionalTableValues(swapped);
  assert.deepEqual(a, [b[1], b[0]]);
});
