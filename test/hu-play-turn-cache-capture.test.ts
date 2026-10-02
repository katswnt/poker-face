import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlaySpot } from "../src/lib/hu-play/sources/resolved";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { POSTFLOP_SOLVER_COMMIT } from "../src/lib/solver/bridge/contract";
import { smallTurnRequest } from "./helpers/hu-play-turn";

test("P3 cache capture freezes exact public inputs before measuring and refuses overwrite or changed inputs", async () => {
  assert.ok(existsSync("scripts/capture-hu-play-turn-cache.ts"), "Immutable input capture must precede cache measurements");
  const { writeTurnCacheInputs, readTurnCacheInputs } = await import("../scripts/capture-hu-play-turn-cache");
  const q = smallTurnRequest(), spot = buildPlaySpot(q), directory = mkdtempSync(join(tmpdir(), "poker-turn-freeze-test-"));
  const inputs = { format: "poker-face-turn-cache-inputs" as const, version: 1 as const,
    identity: { buildHash: "1".repeat(64), sourceHash: "2".repeat(64), engineCommit: POSTFLOP_SOLVER_COMMIT, bridgeVersion: "0.1.0" },
    librarySha256: "3".repeat(64), supplementSha256: "4".repeat(64), selectionSources: [],
    nativeBinarySha256: "5".repeat(64),
    roots: [{ librarySpotId: "tiny-test", flopPath: ["x", "x"], turn: spot.board.turn!, status: "ready" as const,
      request: q, spot, spotHash: hashBridgeSpot(spot) }] };
  const hash = writeTurnCacheInputs(directory, inputs);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(readTurnCacheInputs(directory), { inputs, hash });
  assert.throws(() => writeTurnCacheInputs(directory, inputs), /exist|already|overwrite/i);
  // Corruption cannot become a new frozen input just because JSON still parses.
  const path = join(directory, "inputs.json.gz"), bytes = readFileSync(path);
  bytes[bytes.length - 1] ^= 1; writeFileSync(path, bytes);
  assert.throws(() => readTurnCacheInputs(directory), /hash|integrity/i);
  const other = mkdtempSync(join(tmpdir(), "poker-turn-freeze-test-"));
  assert.throws(() => writeTurnCacheInputs(other, { ...inputs,
    roots: [{ ...inputs.roots[0], spotHash: "0".repeat(64) }] }), /spot|hash/i);
  assert.equal(existsSync(join(other, "inputs.json.gz")), false, "Validation precedes publication");
});
