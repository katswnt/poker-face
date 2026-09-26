// Node-only: read the B4 library's 12 root.json files, verifying bytes and sha256 against the
// library manifest (the same references the browser loader enforces).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BridgeLibraryRoot } from "../bridge/library/model";
import { sha256 } from "./hash";

export const LIBRARY_DIR = "public/solver-data/bridge-v1";

export interface LibraryRootInput {
  readonly spotId: string;
  readonly spotHash: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export function loadLibraryRoots(repoRoot: string): { roots: BridgeLibraryRoot[]; inputs: LibraryRootInput[]; manifestSha256: string } {
  const manifestText = readFileSync(path.join(repoRoot, LIBRARY_DIR, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    spots: { id: string; spotHash: string; root: { url: string; bytes: number; sha256: string } }[];
  };
  const roots: BridgeLibraryRoot[] = [];
  const inputs: LibraryRootInput[] = [];
  for (const spot of manifest.spots) {
    const { url, bytes, sha256: expected } = spot.root;
    if (!url.startsWith(`/solver-data/bridge-v1/${spot.id}/`)) throw new Error(`root url ${url} outside the spot's folder`);
    const buffer = readFileSync(path.join(repoRoot, "public", url));
    if (buffer.length !== bytes) throw new Error(`${url}: ${buffer.length} bytes, manifest says ${bytes}`);
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== expected) throw new Error(`${url}: sha256 ${actual} ≠ manifest ${expected}`);
    const root = JSON.parse(buffer.toString("utf8")) as BridgeLibraryRoot;
    if (root.spotId !== spot.id || root.spotHash !== spot.spotHash) throw new Error(`${url}: identity does not match the manifest`);
    roots.push(root);
    inputs.push({ spotId: spot.id, spotHash: spot.spotHash, url, bytes, sha256: expected });
  }
  return { roots, inputs, manifestSha256: sha256(manifestText) };
}
