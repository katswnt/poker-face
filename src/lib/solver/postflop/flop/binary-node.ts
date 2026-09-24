import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonicalSolverJson } from "../../toy/artifact";
import { validateVectorOptions } from "../vector/session";
import type { VectorFlop } from "./compiled";
import { flopDigest } from "./artifact-node";
import { validateFlopCheckpoint, type FlopCheckpoint } from "./session";
import { validateFlopPolicy } from "./policy";

export const FLOP_BINARY_LIMIT = 256 * 1024 ** 2;
interface Header { version: 1; kind: "policy" | "checkpoint"; gameHash: string; iterations: number;
  options: ReturnType<typeof validateVectorOptions>; arrays: { name: string; length: number }[] }
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
function encode(header: Header, arrays: readonly Float64Array[]) {
  const metadata = Buffer.from(canonicalSolverJson(header)), length = 12 + metadata.length + arrays.reduce((s, a) => s + a.byteLength, 0) + 32;
  if (metadata.length > 65536 || length > FLOP_BINARY_LIMIT) throw new Error("Flop binary exceeds size limit");
  const raw = Buffer.allocUnsafe(length); raw.write("PFFLP001", 0, "ascii"); raw.writeUInt32LE(metadata.length, 8); metadata.copy(raw, 12);
  let offset = 12 + metadata.length;
  for (const array of arrays) for (const value of array) { raw.writeDoubleLE(value, offset); offset += 8; }
  checksum(raw.subarray(0, offset)).copy(raw, offset);
  return { compressed: gzipSync(raw), contentHash: raw.subarray(offset).toString("hex"), rawBytes: raw.length };
}
function decode(bytes: Uint8Array, game: VectorFlop, kind: Header["kind"]) {
  if (bytes.byteLength > FLOP_BINARY_LIMIT) throw new Error("Flop compressed file exceeds size limit");
  const raw = gunzipSync(bytes, { maxOutputLength: FLOP_BINARY_LIMIT });
  if (raw.length < 44 || raw.subarray(0, 8).toString("ascii") !== "PFFLP001") throw new Error("Invalid flop binary magic");
  const metadataLength = raw.readUInt32LE(8), end = raw.length - 32;
  if (metadataLength > 65536 || metadataLength > end - 12) throw new Error("Invalid flop binary header length");
  if (!checksum(raw.subarray(0, end)).equals(raw.subarray(end))) throw new Error("Flop binary checksum mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(12, 12 + metadataLength));
  const header = JSON.parse(text) as Header;
  if (!header || header.version !== 1 || header.kind !== kind || header.gameHash !== flopDigest(game.gameIdentity)
    || canonicalSolverJson(header) !== text) throw new Error("Flop binary version, game or canonical header differs");
  const options = validateVectorOptions(header.options);
  if (!Number.isSafeInteger(header.iterations) || header.iterations < 0 || header.iterations > options.iterations) throw new Error("Invalid binary iteration");
  const names = kind === "policy" ? ["policy"] : ["regrets", "strategySums"];
  if (!Array.isArray(header.arrays) || header.arrays.length !== names.length || header.arrays.some((a, i) =>
    !a || a.name !== names[i] || a.length !== game.preflight.actionSlots)) throw new Error("Flop binary array dimensions differ");
  let offset = 12 + metadataLength;
  if (offset + names.length * game.preflight.actionSlots * 8 !== end) throw new Error("Flop binary truncation or trailing bytes");
  const arrays = names.map(() => {
    const array = new Float64Array(game.preflight.actionSlots);
    for (let i = 0; i < array.length; i++) { array[i] = raw.readDoubleLE(offset); offset += 8; }
    return array;
  });
  return { header: { ...header, options }, arrays, contentHash: raw.subarray(end).toString("hex"), rawBytes: raw.length };
}
export function encodeFlopPolicyFile(game: VectorFlop, snapshot: { gameIdentity: string; policy: Float64Array; iterations: number; options: ReturnType<typeof validateVectorOptions> }) {
  if (snapshot.gameIdentity !== game.gameIdentity) throw new Error("Flop snapshot game differs");
  validateFlopPolicy(game, snapshot.policy); const options = validateVectorOptions(snapshot.options);
  if (!Number.isSafeInteger(snapshot.iterations) || snapshot.iterations < 1 || snapshot.iterations > options.iterations) throw new Error("Invalid policy iteration");
  return encode({ version: 1, kind: "policy", gameHash: flopDigest(game.gameIdentity), iterations: snapshot.iterations, options,
    arrays: [{ name: "policy", length: snapshot.policy.length }] }, [snapshot.policy]);
}
export function decodeFlopPolicyFile(game: VectorFlop, bytes: Uint8Array) {
  const result = decode(bytes, game, "policy"), policy = result.arrays[0];
  if (result.header.iterations < 1) throw new Error("Policy must have a completed iteration");
  validateFlopPolicy(game, policy);
  return { policy, iterations: result.header.iterations, options: result.header.options, contentHash: result.contentHash, rawBytes: result.rawBytes };
}
export function encodeFlopCheckpointFile(game: VectorFlop, state: FlopCheckpoint) {
  const options = validateFlopCheckpoint(game, state);
  return encode({ version: 1, kind: "checkpoint", gameHash: flopDigest(game.gameIdentity), iterations: state.iterations, options,
    arrays: [{ name: "regrets", length: state.regrets.length }, { name: "strategySums", length: state.strategySums.length }] }, [state.regrets, state.strategySums]);
}
export function decodeFlopCheckpointFile(game: VectorFlop, bytes: Uint8Array): FlopCheckpoint {
  const { header, arrays } = decode(bytes, game, "checkpoint");
  const state: FlopCheckpoint = { version: 1, backend: "vector-flop", gameIdentity: game.gameIdentity, options: header.options,
    iterations: header.iterations, regrets: arrays[0], strategySums: arrays[1] };
  validateFlopCheckpoint(game, state); return state;
}
export function readFlopBinary(path: string) {
  if (statSync(path).size > FLOP_BINARY_LIMIT) throw new Error("Flop binary file exceeds size limit");
  return readFileSync(path);
}
export function atomicFlopWrite(path: string, bytes: Uint8Array, replace = true) {
  const temporary = `${path}.tmp-${randomUUID()}`; let fd: number | undefined, created = false;
  try {
    fd = openSync(temporary, "wx"); created = true; writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    if (replace) renameSync(temporary, path);
    else { linkSync(temporary, path); unlinkSync(temporary); }
  }
  catch (error) { if (fd !== undefined) closeSync(fd); if (created) { try { unlinkSync(temporary); } catch { /* Preserve the original write error. */ } } throw error; }
}
