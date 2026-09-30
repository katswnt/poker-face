import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LiveDeployment { version: 1; buildHash: string; sourceHash: string; assetBase: string; sourceArchive: string; sourceArchiveHash: string }
/** Build-time descriptor only. The Worker independently verifies its downloaded assets. */
export function readLiveDeployment(root = process.cwd()): LiveDeployment | null {
  const path = resolve(root, "public/solver-live/current.json");
  if (!existsSync(path)) {
    if (process.env.POKER_FACE_LIVE_REQUIRED === "1") throw new Error("Run npm run prepare:wasm:live before this release build.");
    return null;
  }
  const d: LiveDeployment = JSON.parse(readFileSync(path, "utf8"));
  if (d.version !== 1 || ![d.buildHash, d.sourceHash, d.sourceArchiveHash].every(h => /^[a-f0-9]{64}$/.test(h))
    || d.assetBase !== `/solver-live/wasm/${d.buildHash}/` || d.sourceArchive !== `/solver-live/source/${d.sourceArchiveHash}.tar.gz`) {
    throw new Error("Invalid prepared live-solver descriptor");
  }
  return d;
}
