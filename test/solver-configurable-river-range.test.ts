import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { riverComboKey, type RiverCard } from "../src/lib/solver/river/cards";
import { parseConfigurableRiverRange } from "../src/lib/solver/river/configurable/range";

const BOARD = ["Ks", "8s", "4s", "2c", "9d"] as const;

test("configurable river range syntax expands into exact canonical combinations", () => {
  assert.equal(parseConfigurableRiverRange("AA", BOARD).entries.length, 6);
  assert.equal(parseConfigurableRiverRange("AKs", BOARD).entries.length, 3);
  assert.equal(parseConfigurableRiverRange("AKo", BOARD).entries.length, 9);
  assert.equal(parseConfigurableRiverRange("AK", BOARD).entries.length, 12);
  assert.deepEqual(parseConfigurableRiverRange("AsQh:50%", BOARD).entries, [{
    cards: ["As", "Qh"],
    weight: 0.5,
  }]);
});

test("range expansion reports board blockers and rejects ambiguous overlap", () => {
  const kings = parseConfigurableRiverRange("KK", BOARD);
  assert.equal(kings.entries.length, 3);
  assert.equal(kings.blockedComboCount, 3);
  assert.throws(() => parseConfigurableRiverRange("AQs AsQs", BOARD), /overlap on exact combo AsQs/);
  assert.throws(() => parseConfigurableRiverRange("AKs:0%", BOARD), /invalid weight/);
  assert.throws(() => parseConfigurableRiverRange("AK+", BOARD), /Unsupported range token/);
  assert.throws(() => parseConfigurableRiverRange("KsKh", BOARD), /no combinations after board blockers/);
});

test("token order and physical exact-card order do not change expanded range meaning", () => {
  const first = parseConfigurableRiverRange("AA AQs JTo", BOARD).entries;
  const second = parseConfigurableRiverRange("JTo QAs AA", BOARD).entries;
  assert.deepEqual(second, first);

  fc.assert(fc.property(
    fc.constantFrom<[RiverCard, RiverCard]>(
      ["As", "Qh"],
      ["Td", "7c"],
      ["Jh", "Jc"],
    ),
    ([left, right]) => {
      const direct = parseConfigurableRiverRange(`${left}${right}`, BOARD).entries[0];
      const reversed = parseConfigurableRiverRange(`${right}${left}`, BOARD).entries[0];
      assert.equal(riverComboKey(direct.cards), riverComboKey(reversed.cards));
    },
  ));
});
