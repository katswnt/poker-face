// Release tooling only. No secrets, deployment writes, or changes to the solver.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDistribution } from "./prepare-bridge-live.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const maxBuffer = 64 * 1024 ** 2;
const sha256 = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sourceFile = name => name.startsWith("source/native/") || name === "source/LICENSE"
  || name === "source/scripts/build-bridge-wasm.mjs";
const archiveFile = name => name.startsWith("source/") || name.startsWith("rust-notices/") || name === "LICENSES.txt";

function verifySourceArchive(path, directory, manifest) {
  // Inspect before extracting: no symlinks, hardlinks, devices, ambiguous or escaping paths.
  const names = execFileSync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer }).trimEnd().split("\n");
  const verbose = execFileSync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer }).trimEnd().split("\n");
  assert.equal(verbose.length, names.length, "Ambiguous source archive entries");
  assert.ok(verbose.every(line => line.startsWith("-") || line.startsWith("d")), "Source archive must not contain links or special files");
  for (const name of names) {
    assert.ok(name && !name.startsWith("/") && !name.includes("\\") && !name.includes("\r")
      && !name.replace(/\/$/, "").split("/").some(part => !part || part === "." || part === ".."), "Unsafe source archive path");
  }
  const expected = [...Object.keys(manifest.files).filter(archiveFile), "manifest.json"].sort();
  assert.deepEqual(names.filter(name => !name.endsWith("/")).sort(), expected, "Source archive coverage mismatch");
  const temporary = mkdtempSync(join(tmpdir(), "poker-release-archive-"));
  try {
    execFileSync("tar", ["-xzf", path, "-C", temporary], { stdio: "pipe", maxBuffer });
    for (const name of expected) {
      const file = join(temporary, name), stat = lstatSync(file);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), "Source archive entry must be a regular file");
      assert.equal(hash(readFileSync(file)), hash(readFileSync(join(directory, name))), `Source archive mismatch: ${name}`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function verifyPreparedRelease(root = process.cwd()) {
  const pointer = join(root, "public/solver-live/current.json");
  assert.ok(existsSync(pointer), "Prepared live assets missing; run build:wasm and prepare:wasm:live in the clean release checkout");
  const deployment = JSON.parse(readFileSync(pointer, "utf8"));
  assert.ok(deployment && deployment.version === 1 && [deployment.buildHash, deployment.sourceHash, deployment.sourceArchiveHash].every(sha256)
    && deployment.assetBase === `/solver-live/wasm/${deployment.buildHash}/`
    && deployment.sourceArchive === `/solver-live/source/${deployment.sourceArchiveHash}.tar.gz`, "Invalid prepared release descriptor");
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "", "Release requires a clean checkout; preserve unrelated work and use an isolated copy");
  const commit = git(["rev-parse", "HEAD"]);
  const directory = join(root, "public", deployment.assetBase), manifest = verifyDistribution(directory);
  assert.equal(manifest.baseCommit, commit, "Engine was built at a different commit; rebuild WASM from this release checkout");
  assert.equal(manifest.buildHash, deployment.buildHash, "Descriptor/build mismatch");
  assert.equal(manifest.sourceHash, deployment.sourceHash, "Descriptor/source mismatch");
  const inputs = Object.keys(manifest.files).filter(sourceFile).sort();
  for (const name of inputs) {
    assert.equal(hash(readFileSync(join(root, name.slice(7)))), manifest.files[name].sha256, `Stale bridge source: ${name}`);
  }
  assert.equal(hash(inputs.map(name => `${name.slice(7)}\0${manifest.files[name].sha256}`).join("\n")), manifest.sourceHash,
    "Source identity does not match the archived bridge inputs");
  const archive = join(root, "public", deployment.sourceArchive);
  assert.equal(hash(readFileSync(archive)), deployment.sourceArchiveHash, "Source archive hash mismatch");
  verifySourceArchive(archive, directory, manifest);
  const paths = ["/solver-live/current.json", `${deployment.assetBase}manifest.json`,
    ...["solver_bridge_wasm.js", "solver_bridge_wasm_bg.wasm", "LICENSES.txt"].map(name => deployment.assetBase + name), deployment.sourceArchive];
  return { commit, deployment, paths };
}

export async function verifyDeployedRelease(root, origin, { fetchImpl = fetch } = {}) {
  const release = verifyPreparedRelease(root), base = new URL(origin);
  assert.equal(base.protocol, "https:", "Public release origin must use HTTPS");
  assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash, "Supply a deployment origin without credentials or a path");
  const files = [];
  for (const path of release.paths) {
    const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, `Public release HTTP status: ${path}`);
    const actual = Buffer.from(await response.arrayBuffer()), expected = readFileSync(join(root, "public", path));
    assert.equal(actual.length, expected.length, `Public release byte-length mismatch: ${path}`);
    assert.equal(hash(actual), hash(expected), `Public release hash mismatch: ${path}`);
    files.push({ path, bytes: actual.length, sha256: hash(actual) });
  }
  for (const path of ["/play", "/solver/live"]) {
    const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, `Serving page HTTP status: ${path}`);
    const html = await response.text();
    assert.ok(html.includes(release.deployment.sourceArchive), `${path}: missing corresponding source link`);
    assert.ok(html.includes(release.deployment.buildHash), `${path}: missing release build identity`);
    if (path === "/play") assert.ok(html.includes("23.4% of the subgame pot"), "Missing measured exploitability warning");
  }
  return { passed: true, checkedAt: new Date().toISOString(), origin: base.origin, commit: release.commit,
    ...release.deployment, files };
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--origin"), "Usage: verify-live-release.mjs [--origin https://deployment.example]");
  const result = args.length ? await verifyDeployedRelease(process.cwd(), args[1]) : verifyPreparedRelease();
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
