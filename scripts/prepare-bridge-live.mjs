// Explicit local release preparation, not a remote deployment. Never copy only the binary.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
export function verifyDistribution(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const { buildHash, ...contents } = manifest;
  if (!/^[a-f0-9]{64}$/.test(buildHash) || hash(json(contents)) !== buildHash || manifest.mode !== "single-thread"
    || manifest.format !== "poker-face-bridge-wasm-build" || manifest.version !== 1) throw new Error("Invalid WASM distribution manifest");
  const actual = [];
  function walk(dir, prefix = "") {
    for (const entry of readdirSync(dir)) {
      const name = prefix + entry, path = join(dir, entry), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("WASM distribution must not contain symlinks");
      if (stat.isDirectory()) walk(path, name + "/"); else actual.push(name);
    }
  }
  walk(directory);
  for (const name of Object.keys(manifest.files)) {
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some(p => p === ".." || p === ".")) throw new Error("Unsafe distribution filename");
    const entry = manifest.files[name], bytes = readFileSync(join(directory, name));
    if (entry.bytes !== bytes.length || entry.sha256 !== hash(bytes)) throw new Error(`Distribution hash mismatch: ${name}`);
  }
  if (actual.sort().join("\n") !== [...Object.keys(manifest.files), "manifest.json"].sort().join("\n")) throw new Error("Unlisted files in distribution");
  for (const required of ["solver_bridge_wasm.js", "solver_bridge_wasm_bg.wasm", "LICENSES.txt", "source/BUILD.txt",
    "source/.cargo/config.toml", "source/native/solver-bridge/src/lib.rs", "rust-notices/COPYRIGHT-library.html"]) {
    if (!manifest.files[required]) throw new Error(`Missing corresponding source or notice: ${required}`);
  }
  if (!Object.keys(manifest.files).some(n => n.startsWith("source/vendor/"))) throw new Error("Missing vendored dependencies");
  return manifest;
}

export function prepareLiveAssets(projectRoot = root) {
  const web = join(projectRoot, "native/solver-bridge-wasm/target/web");
  const pointer = JSON.parse(readFileSync(join(web, "manifest.json"), "utf8"));
  if (!/^[a-f0-9]{64}$/.test(pointer.buildHash)) throw new Error("Invalid build pointer");
  const from = join(web, pointer.buildHash), manifest = verifyDistribution(from);
  if (manifest.buildHash !== pointer.buildHash) throw new Error("Build pointer/directory mismatch");
  // Reject stale local bridge inputs, including the build recipe itself.
  for (const [name, entry] of Object.entries(manifest.files)) {
    if (name.startsWith("source/native/") || name === "source/scripts/build-bridge-wasm.mjs" || name === "source/LICENSE") {
      if (hash(readFileSync(join(projectRoot, name.slice(7)))) !== entry.sha256) throw new Error(`Stale bridge source: ${name}; rebuild WASM`);
    }
  }
  const output = join(projectRoot, "public/solver-live"); mkdirSync(join(output, "wasm"), { recursive: true });
  const destination = join(output, "wasm", manifest.buildHash);
  if (existsSync(destination)) {
    if (verifyDistribution(destination).buildHash !== manifest.buildHash) throw new Error("Existing hash directory has another manifest");
  }
  else {
    const stage = mkdtempSync(join(output, ".prepare-")); cpSync(from, stage, { recursive: true });
    verifyDistribution(stage); renameSync(stage, destination);
  }
  // The archive has its OWN content address: tar timestamps do not change the WASM identity.
  // Include hidden Cargo config, exact source, vendor dependencies and all license notices.
  const archive = gzipSync(execFileSync("tar", ["-cf", "-", "-C", from, "source", "LICENSES.txt", "rust-notices", "manifest.json"],
    { maxBuffer: 128 * 1024 ** 2 })); // Node gzip omits the changing wall-clock timestamp.
  const archiveHash = hash(archive); mkdirSync(join(output, "source"), { recursive: true });
  const archivePath = join(output, "source", `${archiveHash}.tar.gz`);
  if (!existsSync(archivePath)) writeFileSync(archivePath, archive, { flag: "wx" });
  else if (hash(readFileSync(archivePath)) !== archiveHash) throw new Error("Existing source archive was modified");
  const deployment = { version: 1, buildHash: manifest.buildHash, sourceHash: manifest.sourceHash,
    assetBase: `/solver-live/wasm/${manifest.buildHash}/`,
    sourceArchive: `/solver-live/source/${archiveHash}.tar.gz`, sourceArchiveHash: archiveHash };
  const temporary = join(mkdtempSync(join(output, ".pointer-")), "current.json");
  writeFileSync(temporary, json(deployment)); renameSync(temporary, join(output, "current.json"));
  return deployment;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(json(prepareLiveAssets()));
