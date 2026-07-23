import { test } from "node:test";
import assert from "node:assert/strict";
import { preflopHandTier, preflopThresholds } from "../src/lib/poker/ranges";

// Guards the exact SHIPPED tier boundaries. The old debug/full-audit.mjs asserted
// "TT is tier 1" against a stale COPY of this function while the app treated TT as
// tier 2 — green tests, wrong claim. These assertions read the real module.
test("pocket pair tiers match shipped thresholds", () => {
  assert.equal(preflopHandTier(14, 14, false), 1, "AA");
  assert.equal(preflopHandTier(13, 13, false), 1, "KK");
  assert.equal(preflopHandTier(12, 12, false), 1, "QQ");
  assert.equal(preflopHandTier(11, 11, false), 1, "JJ");
  assert.equal(preflopHandTier(10, 10, false), 2, "TT is tier 2, not 1");
  assert.equal(preflopHandTier(7, 7, false), 2, "77");
  assert.equal(preflopHandTier(6, 6, false), 3, "66");
  assert.equal(preflopHandTier(2, 2, false), 4, "22");
});

test("suited matters for broadways", () => {
  assert.equal(preflopHandTier(14, 13, true), 1, "AKs");
  assert.equal(preflopHandTier(14, 13, false), 1, "AKo");
  assert.equal(preflopHandTier(14, 12, true), 1, "AQs");
  assert.equal(preflopHandTier(14, 12, false), 2, "AQo");
  assert.equal(preflopHandTier(11, 10, true), 2, "JTs");
  assert.equal(preflopHandTier(11, 10, false), 3, "JTo");
});

test("junk is tier 6", () => {
  assert.equal(preflopHandTier(9, 2, false), 6, "92o");
  assert.equal(preflopHandTier(13, 2, false), 6, "K2o");
});

test("thresholds tighten as raises stack up", () => {
  const open = preflopThresholds("BTN", 0, "gto");
  const vs3bet = preflopThresholds("BTN", 1, "gto");
  const vs4bet = preflopThresholds("BTN", 2, "gto");
  assert.ok(open[0] > vs3bet[0], "opening raise range is wider than vs a 3-bet");
  assert.ok(vs3bet[0] >= vs4bet[0], "4-bet range is tightest");
  assert.equal(vs4bet[0], 1, "only tier-1 raises into a 4-bet");
});

test("looser table styles widen opening ranges", () => {
  assert.ok(preflopThresholds("UTG", 0, "loose")[0] > preflopThresholds("UTG", 0, "gto")[0]);
  assert.ok(preflopThresholds("UTG", 0, "wild")[0] >= preflopThresholds("UTG", 0, "loose")[0]);
});
