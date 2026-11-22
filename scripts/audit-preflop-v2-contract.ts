/** Freeze inputs once; ordinary audits replay inputs and never draw fresh boards or solve. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, CORPUS_DIRECTORY, corpusSpot, drawSelection, hashJson, prettyJson, sha256,
  verifyManifest, type SelectionTranscript, type ValidationManifest } from "../src/lib/solver/preflop-v2/corpus";

const selectionPath = `${CORPUS_DIRECTORY}/selection.json`, manifestPath = `${CORPUS_DIRECTORY}/manifest.json`;
export function auditPreflopV2Contract() {
  const bytes = readFileSync(manifestPath, "utf8"), manifest: unknown = JSON.parse(bytes);
  verifyManifest(manifest); assert.equal(bytes, prettyJson(manifest), "manifest bytes must reproduce exactly");
  const selectionBytes = readFileSync(selectionPath, "utf8"), selection = JSON.parse(selectionBytes);
  assert.equal(selectionBytes, prettyJson(selection)); assert.equal(hashJson(selection), manifest.selectionHash);
  assert.equal(manifest.boards.length, 84); assert.equal(manifest.roots.length, 504);
  assert.equal(new Set(manifest.boards.map(b => b.key)).size, 84);
  assert.equal(new Set(manifest.roots.map(r => r.spotHash)).size, 504);
  for (const s of manifest.strata) {
    const boards: ValidationManifest["boards"] = manifest.boards.filter(b => b.stratum === s.stratum);
    assert.deepEqual(["legacy", "calibration", "holdout"].map(role => boards.filter(b => b.role === role).length), [1, 3, 3]);
  }
  for (const root of manifest.roots) {
    const spot = corpusSpot(root, manifest);
    assert.ok(spot.ranges.every(r => r.combos.length === 1176));
    assert.equal(spot.startingPot - 2 * manifest.potSettings[root.potType].paidPerPlayer, 50);
    assert.equal(spot.effectiveStack + manifest.potSettings[root.potType].paidPerPlayer, 10000);
  }
  return { format: "poker-face-preflop-v2-contract-audit", version: 1, status: "prospective-inputs-verified",
    manifestHash: manifest.payloadHash, manifestFileHash: sha256(bytes), selectionHash: manifest.selectionHash,
    contractHash: manifest.sourceHashes[`${CORPUS_DIRECTORY}/frozen-contract.md`], physicalFlops: manifest.physicalFlops,
    suitOrbits: manifest.flopOrbits, boards: manifest.boards.length, roots: manifest.roots.length,
    roles: { legacy: 12, calibration: 36, boardHoldout: 36 }, rangeProfiles: 2, preBoardClassesPerPlayer: 169,
    preBoardCombosPerPlayer: 1326, postBoardCombosPerPlayer: 1176, potTypes: 3,
    observations: 0, fits: 0, productionRangePromotion: false,
    note: "Input and accounting contract only. No continuation-value accuracy, solve performance or preflop validation result." };
}
export function readValidationManifest(): ValidationManifest {
  const m: unknown = JSON.parse(readFileSync(manifestPath, "utf8")); verifyManifest(m); return m;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && ["--freeze", "--check", "--write-manifest"].includes(args[0]))) throw new Error("use --check (default), --freeze once, or --write-manifest to recover a saved selection");
  if (args[0] === "--freeze") {
    if (existsSync(selectionPath) || existsSync(manifestPath)) throw new Error("inputs already frozen; refusing to redraw or overwrite");
    // Save randomness BEFORE building the manifest. A later failure must preserve the original draws.
    writeFileSync(selectionPath, prettyJson(drawSelection()), { flag: "wx" });
  }
  if (args[0] === "--freeze" || args[0] === "--write-manifest") {
    const selection = JSON.parse(readFileSync(selectionPath, "utf8")) as SelectionTranscript;
    writeFileSync(manifestPath, prettyJson(buildManifest(selection)), { flag: "wx" });
  }
  console.log(JSON.stringify(auditPreflopV2Contract(), null, 2));
}
