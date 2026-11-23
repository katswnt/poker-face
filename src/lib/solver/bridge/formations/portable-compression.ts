/** Pinned offline gzip accounting; no host zlib or application dependency. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { sha256 } from "../../preflop-v2/corpus";
const require = createRequire(import.meta.url);
assert.equal(require("pako/package.json").version, "2.1.0", "pinned compressor required");
const pako = require("pako") as { gzip(input: Uint8Array, options: object): Uint8Array };
export const COMPRESSION_PROFILE = Object.freeze({ algorithm: "gzip", packageName: "pako", packageVersion: "2.1.0",
  packageIntegrity: "sha512-w+eufiZ1WuJYgPXbV/PO3NCMEc3xqylkKHzp8bxp1uW4qaSNQUkwmLLEc3kKsfz8lpV1F8Ht3U1Cm+9Srog2ug==",
  level: 9, windowBits: 15, memLevel: 8, strategy: 0, header: { time: 0, os: 255, text: false } });
export function portableGzip(text: string): Buffer {
  return Buffer.from(pako.gzip(Buffer.from(text), { level: 9, windowBits: 15, memLevel: 8, strategy: 0,
    header: { time: 0, os: 255, text: false } }));
}
export function portableFileTotals(files: ReadonlyMap<string, string>) {
  let rawBytes = 0, gzipBytes = 0;
  for (const text of files.values()) { rawBytes += Buffer.byteLength(text); gzipBytes += portableGzip(text).length; }
  return { files: files.size, rawBytes, gzipBytes };
}
const ORIGINAL_HASHES: Readonly<Record<string, string>> = {"sb-bb-srp-v1": "f1aae3dffb9a93ed08e22530883cde4cbf81c2bc5dd42bb2b558b9e36cc0931c", "btn-bb-3bp-v1": "37b7209565be60f68a3ce731c5782752cda10934fa7a26e51be483d9831441bd"};
export function originalPublicationManifest(formation: string) {
  const hash = ORIGINAL_HASHES[formation]; assert.ok(hash, "unknown original formation");
  const text = readFileSync(`tasks/artifacts/formation-libraries-v1/compression-v5/original-manifests/${formation}.json`, "utf8");
  assert.equal(sha256(text), hash, "original publication evidence changed"); return text;
}
export function allowManifestMigration(formation: string, text: string): boolean {
  return !!ORIGINAL_HASHES[formation] && sha256(text) === ORIGINAL_HASHES[formation] && text === originalPublicationManifest(formation);
}
