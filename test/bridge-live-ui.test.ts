import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLiveInput, LiveInputError, SMALL_TURN, SMALL_RIVER, compatibleDeals } from "../src/lib/solver/bridge/live/input";
import { actionText, hasCompatibleOpponent, type SavedLiveExample } from "../src/lib/solver/bridge/live/view";
import { initialLiveUi, liveUiReducer } from "../src/lib/solver/bridge/live/ui-state";
import { parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import { readLiveDeployment } from "../src/lib/solver/bridge/live/deployment-node";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { verifyDistribution } from "../scripts/prepare-bridge-live.mjs";
import saved from "../src/lib/solver/bridge/live/example.json";
import type { LiveEvent } from "../src/lib/solver/bridge/live/model";
const example = saved as unknown as SavedLiveExample;
if (process.env.npm_lifecycle_event === "test:wasm:ui") assert.ok(existsSync("native/solver-bridge-wasm/target/web/manifest.json"), "run build:wasm first");

test("guided inputs create bounded turn/river Spot v1 games without changing imported rules", () => {
  for (const input of [SMALL_TURN, SMALL_RIVER]) {
    const parsed = parseLiveInput(input), s = parsed.spot;
    assert.deepEqual(parseLiveSpot(JSON.stringify(s)), s);
    assert.equal(s.board.river === null, input === SMALL_TURN);
    assert.equal(s.solve.compression, "off"); assert.equal(s.solve.exportScope, "full");
    assert.equal(s.solve.maxIterations, 1000); assert.equal(s.effectiveStack, 100);
    assert.equal(s.tree.mode, "menu"); assert.ok(compatibleDeals(s) > 0);
    for (const h of s.ranges[0].combos) assert.equal(hasCompatibleOpponent(s, h.combo), true, "every teaching-preset hand must be reachable");
  }
  assert.deepEqual(parseLiveSpot(JSON.stringify(example.spot)), example.spot);
});

test("guided validation associates errors with cards, ranges, sizes, caps and stack", () => {
  const cases = [
    ["board", "As As 2c 3d"], ["range0", "AA AA"], ["range1", "AA KK QQ JJ TT 99 88 77 66 55 44 33 22"],
    ["bets", "50 100 200"], ["bets", "1"], ["bets", "50 50"], ["stack", "1001"], ["iterations", "10001"], ["pot", "3"],
  ] as const;
  for (const [field, value] of cases) assert.throws(() => parseLiveInput({ ...SMALL_TURN, [field]: value }),
    e => e instanceof LiveInputError && !!e.errors[field], `${field}: ${value}`);
  assert.throws(() => parseLiveInput({ ...SMALL_TURN, raiseLimit: "1", raise: "1.5" }), e => e instanceof LiveInputError && !!e.errors.raise);
  assert.equal(parseLiveInput({ ...SMALL_TURN, raiseLimit: "1", raise: "2.5" }).spot.tree.mode, "menu");
});

test("range normalization is explicit, board removals counted, float32 underflow refused", () => {
  const result = parseLiveInput({ ...SMALL_TURN, range0: "AA QcJd:10%" });
  assert.equal(result.roundedWeights, true);
  assert.ok(result.spot.ranges[0].combos.some(h => h.weight === Math.fround(.1)));
  const blocked = parseLiveInput({ ...SMALL_TURN, range0: "KK AcAd" });
  assert.equal(blocked.removed[0], 3);
  assert.throws(() => parseLiveInput({ ...SMALL_TURN, range0: "AcAd QcJd:1e-100" }), /too small/);
});

test("compatible deal counts respect cross-range blockers; impossible root hands are not taught as zero EV", () => {
  const s = parseLiveInput({ ...SMALL_TURN, range0: "AcAd QcJd", range1: "AcQd AcJc" }).spot;
  assert.equal(compatibleDeals(s), 2);
  assert.equal(hasCompatibleOpponent(s, "AcAd"), false); assert.equal(hasCompatibleOpponent(s, "QcJd"), true);
});

test("saved UI summary is hashed, spot-matched and contains no fabricated action EV", () => {
  const { payloadHash, ...payload } = example;
  assert.equal(createHash("sha256").update(canonicalSolverJson(payload)).digest("hex"), payloadHash);
  assert.equal(hashBridgeSpot(example.spot), example.summary.spotHash);
  assert.ok(Math.abs(example.independent.exploitability - example.summary.exploitability) < .0002);
  assert.equal("actionEv" in example.summary, false);
  for (let h = 0; h < example.summary.hands.length; h++) assert.ok(Math.abs(example.summary.strategy.reduce((n, row) => n + row[h], 0) - 1) < 1e-5);
  assert.equal(actionText("bet50"), "Bet to 50 chips"); assert.equal(actionText("check"), "Check");
  assert.equal(actionText("AllIn(100)"), "All-in to 100 chips");
});

test("UI state keeps input checks separate from the completed result and refuses late publication after cancel", () => {
  let s = initialLiveUi(example); const before = s.displayed;
  s = liveUiReducer(s, { type: "start", spot: example.spot, json: "game", mode: "estimate" });
  const event = { type: "estimate", id: 1, estimate: {}, provenance: {}, verdict: { ok: true } } as Extract<LiveEvent, { type: "estimate" }>;
  s = liveUiReducer(s, { type: "event", event }); assert.equal(s.busy, null); assert.equal(s.prepared?.json, "game");
  s = liveUiReducer(s, { type: "edit" }); assert.equal(s.prepared, null); assert.deepEqual(s.displayed, before);
  s = liveUiReducer(s, { type: "start", spot: example.spot, json: "game2", mode: "solve" });
  s = liveUiReducer(s, { type: "cancel" });
  assert.equal(liveUiReducer(s, { type: "event", event }), s);
  s = liveUiReducer(s, { type: "event", event: { type: "cancelled", id: 1, elapsedMs: 12, hard: true } });
  assert.equal(s.busy, null); assert.equal(s.elapsedMs, 12); assert.equal(s.displayed.summary, before.summary);
  assert.equal(liveUiReducer(s, { type: "event", event }), s);
});

test("refused estimates and Worker errors do not replace a completed example", () => {
  let s = initialLiveUi(example);
  s = liveUiReducer(s, { type: "start", spot: example.spot, json: "x", mode: "solve" });
  s = liveUiReducer(s, { type: "event", event: { type: "estimate", id: 1, verdict: { ok: false } } as Extract<LiveEvent, { type: "estimate" }> });
  assert.equal(s.busy, null); assert.equal(s.displayed.source, "saved");
  s = liveUiReducer(s, { type: "start", spot: example.spot, json: "x", mode: "estimate" });
  s = liveUiReducer(s, { type: "event", event: { type: "error", id: 2, message: "missing asset" } });
  assert.equal(s.error, "missing asset"); assert.equal(s.displayed.source, "saved");
});

test("missing deployment supports a saved-only build; malformed descriptors fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "poker-live-descriptor-")), previous = process.env.POKER_FACE_LIVE_REQUIRED;
  try {
    delete process.env.POKER_FACE_LIVE_REQUIRED; assert.equal(readLiveDeployment(root), null);
    process.env.POKER_FACE_LIVE_REQUIRED = "1"; assert.throws(() => readLiveDeployment(root), /prepare:wasm:live/);
    mkdirSync(join(root, "public/solver-live"), { recursive: true });
    writeFileSync(join(root, "public/solver-live/current.json"), JSON.stringify({ version: 1, buildHash: "../../bad" }));
    assert.throws(() => readLiveDeployment(root), /Invalid prepared/);
  } finally { if (previous === undefined) delete process.env.POKER_FACE_LIVE_REQUIRED; else process.env.POKER_FACE_LIVE_REQUIRED = previous; }
});

test("prepared distribution includes corresponding source; modified/missing bytes are rejected", {
  skip: existsSync("native/solver-bridge-wasm/target/web/manifest.json") ? false : "run build:wasm",
}, () => {
  const m = JSON.parse(readFileSync("native/solver-bridge-wasm/target/web/manifest.json", "utf8"));
  const from = join("native/solver-bridge-wasm/target/web", m.buildHash); assert.equal(verifyDistribution(from).buildHash, m.buildHash);
  const temp = mkdtempSync(join(tmpdir(), "poker-live-distribution-")); cpSync(from, temp, { recursive: true });
  writeFileSync(join(temp, "LICENSES.txt"), "corrupted"); assert.throws(() => verifyDistribution(temp), /hash mismatch/);
});
