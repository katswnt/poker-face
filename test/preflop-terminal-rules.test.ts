// Preflop solver v1, PF0: contract validation, tree closure and terminal rules by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handIndex } from "../src/lib/solver/hands";
import {
  huStructure, JAM_FOLD_MENU, makeSpot, SIX_MAX_BTN_BB, V1_MENU, validatePreflopSpot, validateRealizationTable,
} from "../src/lib/solver/preflop/contract";
import { hashPreflopSpot } from "../src/lib/solver/preflop/hash";
import { defaultRealizationTable, mapRealizationTable, unitRealizationTable, bucketOf, HAND_BUCKETS, CLASS_BUCKETS } from "../src/lib/solver/preflop/realization";
import { buildPreflopGame, EQ, flopShareIp, foldUtility, rakeAmount, shareUtility, terminalUtility } from "../src/lib/solver/preflop/terminal";
import { buildPreflopTree } from "../src/lib/solver/preflop/tree";

const mainSpot = (realization = defaultRealizationTable()) =>
  makeSpot({ label: "test 6-max", structure: SIX_MAX_BTN_BB, menu: V1_MENU, realization });

test("PF0 contract: valid spots pass, malformed ones are rejected with a reason", () => {
  const spot = mainSpot();
  assert.equal(validatePreflopSpot(spot), spot);
  const bad = (patch: Record<string, unknown>, pattern: RegExp) =>
    assert.throws(() => validatePreflopSpot({ ...spot, ...patch }), pattern);
  bad({ menu: { ...V1_MENU, allowLimp: true } }, /limping is not implemented/);
  bad({ menu: { ...V1_MENU, raises: [2.5, 2, 24] } }, /must exceed the previous bet/);
  bad({ menu: { ...V1_MENU, raises: [2.5, 11, 100] } }, /below the stack/);
  bad({ structure: { ...SIX_MAX_BTN_BB, dead: 0 } }, /6max-btn-bb posts/);
  bad({ structure: { ...SIX_MAX_BTN_BB, ante: 1 } }, /ante/);
  bad({ rake: { pct: 0.05, capBb: 3, noFlopNoDrop: false } }, /noFlopNoDrop/);
  bad({ classes: [3, 2] }, /ascending/);
  bad({ extra: 1 }, /exactly the keys/);
  const table = defaultRealizationTable();
  assert.throws(() => validateRealizationTable({ ...table, ip: { ...table.ip, srp: table.ip.srp.slice(1) } }), /169 entries/);
  assert.throws(() => validateRealizationTable({ ...table, oop: { ...table.oop, srp: table.oop.srp.map(() => 0) } }), /outside/);
});

test("PF0 spot hash is stable, and changes with any input (menu, R, stack)", () => {
  const a = hashPreflopSpot(mainSpot()), b = hashPreflopSpot(mainSpot());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashPreflopSpot(makeSpot({ label: "test 6-max", structure: SIX_MAX_BTN_BB, menu: { ...V1_MENU, raises: [2.5, 11, 25] }, realization: defaultRealizationTable() })));
  assert.notEqual(a, hashPreflopSpot(mainSpot(mapRealizationTable(defaultRealizationTable(), "x", (_p, _t, c, v) => c === 0 ? v + 0.01 : v))));
  assert.notEqual(a, hashPreflopSpot(makeSpot({ label: "test 6-max", structure: { ...SIX_MAX_BTN_BB, stack: 99 }, menu: V1_MENU, realization: defaultRealizationTable() })));
});

test("PF0 tree: spec §2 menu, pots close exactly (SRP 5.5, 3BP 22.5, 4BP 48.5, all-in 200.5)", () => {
  const tree = buildPreflopTree(mainSpot());
  const actions = Object.fromEntries(tree.decisions.map(d => [d.id, d.actions.join(" ")]));
  assert.deepEqual(actions, {
    "": "fold r2.5",
    "r2.5": "fold call r11 jam",
    "r2.5/jam": "fold call",
    "r2.5/r11": "fold call r24 jam",
    "r2.5/r11/jam": "fold call",
    "r2.5/r11/r24": "fold call jam",
    "r2.5/r11/r24/jam": "fold call",
  });
  const pot = (id: string) => { const n = tree.byId.get(id)!; assert.equal(n.kind, "terminal"); return n.kind === "terminal" ? [n.terminal, n.potType ?? null, n.pot] : null; };
  assert.deepEqual(pot("r2.5/call"), ["flop", "srp", 5.5]);
  assert.deepEqual(pot("r2.5/r11/call"), ["flop", "3bp", 22.5]);
  assert.deepEqual(pot("r2.5/r11/r24/call"), ["flop", "4bp", 48.5]);
  for (const id of ["r2.5/jam/call", "r2.5/r11/jam/call", "r2.5/r11/r24/jam/call"]) assert.deepEqual(pot(id), ["showdown", null, 200.5]);
  assert.deepEqual(pot("fold"), ["fold", null, 1.5]);
  assert.equal(tree.decisions.length, 7);
  assert.equal(tree.terminals.length, 13);

  const hu = buildPreflopTree(makeSpot({ label: "hu", structure: huStructure(10), menu: JAM_FOLD_MENU, realization: defaultRealizationTable() }));
  assert.deepEqual(hu.decisions.map(d => [d.id, d.actions.join(" ")]), [["", "fold jam"], ["jam", "fold call"]]);
  assert.equal(hu.terminals.filter(t => t.terminal === "flop").length, 0);
});

test("PF0 terminal rules by hand: folds, showdowns, flop shares, rake stub", () => {
  // BTN folds the root: BTN loses nothing, BB wins the dead 0.5.
  assert.deepEqual(foldUtility([0, 1], 0.5, 0), [-0, 1.5 - 1]);
  // BB folds to the open: BTN wins 1 + 0.5 dead, BB loses its 1.
  assert.deepEqual(foldUtility([2.5, 1], 0.5, 1), [1.5, -1]);
  // HU SB folds: loses the 0.5 small blind.
  assert.deepEqual(foldUtility([0.5, 1], 0, 0), [-0.5, 0.5]);
  // All-in: 200.5 × eq − 100.
  const aa = handIndex("AA"), kk = handIndex("KK");
  const spot = mainSpot();
  const tree = buildPreflopTree(spot);
  const showdown = tree.byId.get("r2.5/jam/call")!;
  assert.equal(showdown.kind, "terminal");
  if (showdown.kind !== "terminal") return;
  const [u0, u1] = terminalUtility(spot, showdown, aa, kk);
  assert.ok(Math.abs(u0 - (200.5 * EQ[aa][kk] - 100)) < 1e-12);
  assert.ok(Math.abs(u0 + u1 - 0.5) < 1e-12, "constant-sum: the dead 0.5 is the only surplus");
  // Flop share: R = 1 ⇒ share = eq; always in [0, 1]; shares sum to the pot.
  assert.equal(flopShareIp(0.37, 1, 1), 0.37);
  assert.ok(Math.abs(flopShareIp(0.5, 1.05, 0.85) - 1.05 / 1.9) < 1e-15);
  for (const [eq, a, b] of [[0.01, 1.6, 0.3], [0.99, 0.3, 1.6], [0.5, 10, 0.01]]) {
    const s = flopShareIp(eq, a, b);
    assert.ok(s >= 0 && s <= 1);
  }
  const [f0, f1] = shareUtility([2.5, 2.5], 5.5, spot.rake, 0.6);
  assert.ok(Math.abs(f0 - (5.5 * 0.6 - 2.5)) < 1e-12 && Math.abs(f0 + f1 - 0.5) < 1e-12);
  // Rake: min(pct·pot, cap); applied to flop/showdown pots only.
  const rake = { pct: 0.05, capBb: 3, noFlopNoDrop: true as const };
  assert.equal(rakeAmount(5.5, rake), 0.275);
  assert.equal(rakeAmount(200.5, rake), 3);
});

test("PF0 terminal rules: R = 1 everywhere makes every flop terminal pay raw equity", () => {
  const spot = mainSpot(unitRealizationTable());
  const tree = buildPreflopTree(spot);
  for (const t of tree.terminals.filter(x => x.terminal === "flop")) {
    for (const [h, k] of [[0, 1], [handIndex("72o"), handIndex("AKs")], [handIndex("T9s"), handIndex("T9s")]]) {
      const [u0] = terminalUtility(spot, t, h, k);
      assert.ok(Math.abs(u0 - (t.pot * EQ[h][k] - t.contrib[0])) < 1e-12, `${t.id}`);
    }
  }
});

test("PF0 game: every terminal is constant-sum (u0 + u1 = dead) for all 169×169 class pairs", () => {
  const game = buildPreflopGame(mainSpot());
  assert.equal(game.dealTotal, 1624350);
  for (const t of game.tree.terminals) {
    for (let h = 0; h < 169; h += 7) for (let k = 0; k < 169; k += 5) {
      const [a, b] = terminalUtility(game.spot, t, h, k);
      assert.ok(Math.abs(a + b - 0.5) < 1e-9, `${t.id} ${h} ${k}`);
    }
  }
});

test("hand buckets: every class has one bucket, examples follow the stated precedence", () => {
  assert.equal(CLASS_BUCKETS.length, 169);
  const expect: Record<string, string> = { AA: "pairs", A5s: "suited-ax", KQs: "suited-broadway", T9s: "suited-connectors", "96s": "suited-connectors", "95s": "suited-other", AKo: "offsuit-ax", KTo: "offsuit-broadway", "72o": "offsuit-other" };
  for (const [label, bucket] of Object.entries(expect)) assert.equal(bucketOf(handIndex(label)), bucket, label);
  for (const b of HAND_BUCKETS) assert.ok(CLASS_BUCKETS.includes(b), b);
});
