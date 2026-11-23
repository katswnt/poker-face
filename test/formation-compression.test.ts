import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { portableGzip, portableFileTotals, COMPRESSION_PROFILE, allowManifestMigration } from "../src/lib/solver/bridge/formations/portable-compression";

test("the pinned gzip profile produces fixed bytes independent of host zlib", () => {
  const expected = Buffer.from("1f8b08000000000002ffcb48cdc9c9070086a6103605000000", "hex");
  assert.deepEqual(portableGzip("hello"), expected);
  assert.deepEqual(gunzipSync(portableGzip("♠♥♦♣\n")), Buffer.from("♠♥♦♣\n"));
  assert.deepEqual(portableFileTotals(new Map([["a", "hello"], ["b", "hello"]])), { files: 2, rawBytes: 10, gzipBytes: 2 * expected.length });
  assert.equal(COMPRESSION_PROFILE.packageVersion, "2.1.0");
});

test("manifest migration accepts only the two preserved exact previous publication files", () => {
  for (const id of ["sb-bb-srp-v1", "btn-bb-3bp-v1"]) {
    const original = readFileSync(`tasks/artifacts/formation-libraries-v1/compression-v5/original-manifests/${id}.json`, "utf8");
    assert.equal(allowManifestMigration(id, original), true);
    assert.equal(allowManifestMigration(id, original + " "), false);
  }
  assert.equal(allowManifestMigration("sb-bb-srp-v1", "changed"), false);
  assert.equal(allowManifestMigration("unknown", "changed"), false);
});
