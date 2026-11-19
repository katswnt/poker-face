// Production is an explicit source-complete release. Preview builds can be saved-only.
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPreparedRelease } from "./verify-live-release.mjs";

/** @param {{root?: string, env?: NodeJS.ProcessEnv, run?: (command: string, args: string[], options: import('node:child_process').ExecFileSyncOptions) => unknown}} options */
export function runVercelBuild({ root = process.cwd(), env = process.env, run = execFileSync } = {}) {
  const required = env.VERCEL_ENV === "production" || env.POKER_FACE_LIVE_REQUIRED === "1";
  if (required) verifyPreparedRelease(root);
  run(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build"], {
    cwd: root, stdio: "inherit", env: { ...env, ...(required ? { POKER_FACE_LIVE_REQUIRED: "1" } : {}) },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runVercelBuild();
