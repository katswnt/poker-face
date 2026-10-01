import assert from "node:assert/strict";
import test from "node:test";
import estimates from "../tasks/artifacts/hu-play-p1-wide-native-estimates.json";
import { loadP1WideRoots } from "../scripts/hu-play-wide-corpus";
import { assessPlayProposal, PLAY_PROPOSAL } from "../scripts/hu-play-wide-proposal";
import { parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";

test("play proposal keeps the full seed-0 game and bounds mobile more tightly than desktop", () => {
  const root = loadP1WideRoots().find(r => r.corpusIndex === 0)!;
  const estimate = parseLiveEstimate(JSON.stringify(estimates.rows.find(r => r.corpusIndex === 0)!.estimate), root.spot, root.sourceSpotHash);
  const mobile = assessPlayProposal(root.spot, estimate, 2 * 1024 ** 2, { profile: "mobile" });
  const desktop = assessPlayProposal(root.spot, estimate, 2 * 1024 ** 2, { profile: "desktop-chromium" });
  assert.equal(mobile.ok, true); assert.equal(desktop.ok, true);
  assert.equal(mobile.budgetBytes, 192 * 1024 ** 2); assert.equal(desktop.budgetBytes, 256 * 1024 ** 2);
  assert.equal(mobile.totalBytes, desktop.totalBytes);
  assert.equal(mobile.totalBytes, estimate.estimatedBytes + estimate.estimateExport.workingBytesEstimate + 130 * 1024 ** 2);
  assert.equal(PLAY_PROPOSAL.rangeHands, 640); assert.equal(PLAY_PROPOSAL.stackPotRatio, 18);
  assert.equal(PLAY_PROPOSAL.productionEnabled, false);
  assert.equal(assessPlayProposal(root.spot, estimate, 2 * 1024 ** 2, { profile: "mobile", deviceMemoryGiB: .25 }).ok, false);
});

test("proposal refuses a changed raw menu or high stack/pot before it can justify a wide preflight", () => {
  const root = loadP1WideRoots()[0];
  const estimate = parseLiveEstimate(JSON.stringify(estimates.rows.find(r => r.corpusIndex === root.corpusIndex)!.estimate), root.spot, root.sourceSpotHash);
  assert.throws(() => assessPlayProposal({ ...root.spot, effectiveStack: 19 * root.spot.startingPot }, estimate, 0, { profile: "unknown" }), /stack\/pot/i);
  const tree = structuredClone(root.spot.tree);
  assert.equal(tree.mode, "menu"); if (tree.mode !== "menu") return;
  assert.throws(() => assessPlayProposal({ ...root.spot, tree: { ...tree, addAllInThreshold: .1 } }, estimate, 0, { profile: "unknown" }), /lean menu/i);
  assert.throws(() => assessPlayProposal(root.spot, { ...estimate, spotHash: "wrong" }, 0, { profile: "unknown" }), /different spot/i);
  assert.equal(assessPlayProposal(root.spot, { ...estimate, estimatedBytes: PLAY_PROPOSAL.engineBytes + 1 }, 0, { profile: "unknown" }).ok, false);
});
