import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { verifyPreparedRelease, verifyDeployedRelease } from "../scripts/verify-live-release.mjs";
import { runVercelBuild } from "../scripts/build-vercel.mjs";

const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const put = (root: string, path: string, data: string | Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data);
};
function fixture(options: { stale?: boolean; baseCommit?: string; wrongArchive?: boolean; linkedArchive?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "poker-release-test-"));
  const owned = { "LICENSE": "test license", "scripts/build-bridge-wasm.mjs": "// test build recipe",
    "native/solver-bridge/src/lib.rs": "// current bridge source" };
  for (const [name, data] of Object.entries(owned)) put(root, name, data);
  put(root, ".gitignore", "/public/solver-live/\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("add", ".");
  git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const commit = git("rev-parse", "HEAD");
  const contents: Record<string, string> = {
    "solver_bridge_wasm.js": "// fixture glue", "solver_bridge_wasm_bg.wasm": "fixture binary",
    "LICENSES.txt": "fixture notices", "source/BUILD.txt": "fixture instructions",
    "source/.cargo/config.toml": "# fixture offline config", "source/vendor/dependency/lib.rs": "// fixture dependency",
    "rust-notices/COPYRIGHT-library.html": "fixture standard library notices",
    ...Object.fromEntries(Object.entries(owned).map(([name, data]) => ["source/" + name, data])),
  };
  if (options.stale) contents["source/native/solver-bridge/src/lib.rs"] = "// stale bridge source";
  const sourceHash = hash(Object.keys(owned).sort().map(name => `${name}\0${hash(contents["source/" + name])}`).join("\n"));
  const manifestBody = { format: "poker-face-bridge-wasm-build", version: 1, mode: "single-thread",
    baseCommit: options.baseCommit ?? commit, sourceHash,
    files: Object.fromEntries(Object.entries(contents).map(([name, data]) => [name, { bytes: Buffer.byteLength(data), sha256: hash(data) }])) };
  const buildHash = hash(json(manifestBody)), manifest = { ...manifestBody, buildHash };
  const assetBase = `/solver-live/wasm/${buildHash}/`, directory = join(root, "public", assetBase);
  for (const [name, data] of Object.entries(contents)) put(directory, name, data);
  put(directory, "manifest.json", json(manifest));
  const stage = mkdtempSync(join(tmpdir(), "poker-archive-test-"));
  let archive: Buffer;
  try {
    cpSync(directory, stage, { recursive: true });
    if (options.wrongArchive) put(stage, "source/native/solver-bridge/src/lib.rs", "// wrong corresponding source");
    if (options.linkedArchive) {
      rmSync(join(stage, "source/vendor/dependency/lib.rs"));
      symlinkSync("../../BUILD.txt", join(stage, "source/vendor/dependency/lib.rs"));
    }
    archive = gzipSync(execFileSync("tar", ["-cf", "-", "-C", stage, "source", "LICENSES.txt", "rust-notices", "manifest.json"]));
  } finally { rmSync(stage, { recursive: true, force: true }); }
  const sourceArchiveHash = hash(archive), sourceArchive = `/solver-live/source/${sourceArchiveHash}.tar.gz`;
  put(root, "public" + sourceArchive, archive);
  const pointer = { version: 1, buildHash, sourceHash, assetBase, sourceArchive, sourceArchiveHash };
  put(root, "public/solver-live/current.json", json(pointer));
  return { root, commit, pointer, directory, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("production Git pushes cannot replace the prepared release; previews keep their default", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.deepEqual(config.git.deploymentEnabled, { main: false });
  assert.equal(config.buildCommand, "node scripts/build-vercel.mjs");
});

test("production refuses absent assets before invoking Next; preview supports saved-only builds", () => {
  const root = mkdtempSync(join(tmpdir(), "poker-empty-release-"));
  const calls: unknown[][] = [], run = (...args: unknown[]) => { calls.push(args); };
  try {
    assert.throws(() => runVercelBuild({ root, env: { NODE_ENV: "production", VERCEL_ENV: "production" }, run }), /prepare|missing/i);
    assert.equal(calls.length, 0);
    assert.throws(() => runVercelBuild({ root, env: { NODE_ENV: "production", POKER_FACE_LIVE_REQUIRED: "1" }, run }), /prepare|missing/i);
    assert.equal(calls.length, 0);
    runVercelBuild({ root, env: { NODE_ENV: "production", VERCEL_ENV: "preview" }, run });
    assert.equal(calls.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a complete clean release binds the engine, current commit and source archive before building", () => {
  const f = fixture(), calls: unknown[][] = [], run = (...args: unknown[]) => { calls.push(args); };
  try {
    const release = verifyPreparedRelease(f.root);
    assert.equal(release.commit, f.commit); assert.equal(release.deployment.buildHash, f.pointer.buildHash);
    runVercelBuild({ root: f.root, env: { NODE_ENV: "production", VERCEL_ENV: "production" }, run });
    assert.equal(calls.length, 1);
    assert.equal((calls[0][2] as { env: Record<string, string> }).env.POKER_FACE_LIVE_REQUIRED, "1");
  } finally { f.close(); }
});

test("release verification rejects modified engine bytes, missing source and dirty worktrees", () => {
  for (const kind of ["binary", "missing archive", "dirty tracked", "dirty untracked", "unsafe descriptor"] as const) {
    const f = fixture();
    try {
      if (kind === "binary") put(f.directory, "solver_bridge_wasm_bg.wasm", "tampered");
      if (kind === "missing archive") rmSync(join(f.root, "public" + f.pointer.sourceArchive));
      if (kind === "dirty tracked") put(f.root, "LICENSE", "modified license");
      if (kind === "dirty untracked") put(f.root, "unexpected.txt", "not committed");
      if (kind === "unsafe descriptor") put(f.root, "public/solver-live/current.json", json({ ...f.pointer, assetBase: "../../outside/" }));
      assert.throws(() => verifyPreparedRelease(f.root), /hash|source|archive|clean|dirty|descriptor|ENOENT/i, kind);
    } finally { f.close(); }
  }
});

test("valid checksums alone cannot hide old source, a different commit, a wrong archive or archive links", () => {
  for (const options of [{ stale: true }, { baseCommit: "0".repeat(40) }, { wrongArchive: true }, { linkedArchive: true }]) {
    const f = fixture(options);
    try { assert.throws(() => verifyPreparedRelease(f.root), /source|commit|archive|link/i); }
    finally { f.close(); }
  }
});

test("public verification checks actual fetched bytes and source links on both serving pages", async () => {
  const f = fixture();
  const page = `<a href="${f.pointer.sourceArchive}">source</a>${f.pointer.buildHash} 23.4% of the subgame pot`;
  let corrupt = "";
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const path = new URL(typeof url === "string" || url instanceof URL ? url : url.url).pathname; seen.push(path);
    const bytes = path === "/play" || path === "/solver/live" ? Buffer.from(page) : readFileSync(join(f.root, "public", path));
    return new Response(new Uint8Array(path === corrupt ? Buffer.from("wrong bytes") : bytes), { status: 200 });
  };
  try {
    const result = await verifyDeployedRelease(f.root, "https://release.example", { fetchImpl });
    assert.equal(result.passed, true); assert.ok(seen.includes("/play")); assert.ok(seen.includes("/solver/live"));
    assert.ok(seen.includes(f.pointer.sourceArchive));
    corrupt = f.pointer.assetBase + "solver_bridge_wasm_bg.wasm";
    await assert.rejects(verifyDeployedRelease(f.root, "https://release.example", { fetchImpl }), /mismatch/i);
    corrupt = "/solver/live";
    await assert.rejects(verifyDeployedRelease(f.root, "https://release.example", { fetchImpl }), /source|build/i);
  } finally { f.close(); }
});


test("release typography uses the licensed local variable font without Google build requests", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.match(layout, /from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /variable: "--font-jetbrains"/);
  const path = "public/fonts/jetbrains-mono/";
  const provenance = JSON.parse(readFileSync(path + "provenance.json", "utf8"));
  const font = readFileSync(path + "JetBrainsMono-variable.ttf");
  assert.equal(font.readUInt32BE(0), 0x00010000, "TrueType font, not a download error page");
  assert.equal(font.length, 303144);
  assert.equal(hash(font), provenance.sha256);
  const blob = createHash("sha1").update(`blob ${font.length}\0`).update(font).digest("hex");
  assert.equal(blob, "b60e77f5dbf5505436c1904cb7a9ac4111ee76d0", "unmodified upstream v2.304 file");
  assert.match(readFileSync(path + "OFL.txt", "utf8"), /SIL OPEN FONT LICENSE Version 1.1/);
  assert.equal(hash(readFileSync(path + "OFL.txt")), provenance.licenseSha256);
});
