// W1 development/test build. No files are copied into public/ or deployed automatically.
// Run: WASM_BINDGEN=/path/to/wasm-bindgen node scripts/build-bridge-wasm.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = "native/solver-bridge-wasm";
const manifest = `${crate}/Cargo.toml`;
const target = "wasm32-unknown-unknown";
const toolchain = "1.98.1", bindgenVersion = "0.2.104";
const bindgen = process.env.WASM_BINDGEN || "wasm-bindgen";
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: "utf8", ...options });
const cargo = args => run("cargo", [`+${toolchain}`, ...args]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
if (run(bindgen, ["--version"]).trim() !== `wasm-bindgen ${bindgenVersion}`) {
  throw new Error(`Install wasm-bindgen-cli ${bindgenVersion} with --locked; the CLI must match the crate`);
}
// Ignore ambient target flags: atomics/SIMD/custom alloc are not part of the verified ST build.
run("cargo", [`+${toolchain}`, "build", "--release", "--locked", "--manifest-path", manifest, "--target", target], {
  stdio: "inherit", env: { ...process.env, RUSTFLAGS: "", CARGO_ENCODED_RUSTFLAGS: "", CARGO_TARGET_DIR: join(root, crate, "target") },
});
const webRoot = join(root, crate, "target/web");
mkdirSync(webRoot, { recursive: true });
const stage = mkdtempSync(join(webRoot, ".build-"));
try {
  run(bindgen, [join(root, crate, `target/${target}/release/solver_bridge_wasm.wasm`), "--target", "web", "--out-dir", stage,
    "--out-name", "solver_bridge_wasm"]);
  writeFileSync(join(stage, "package.json"), json({ type: "module", private: true }));
  const wasm = readFileSync(join(stage, "solver_bridge_wasm_bg.wasm"));
  if (wasm.length > 4 * 1024 ** 2) throw new Error(`WASM exceeds W1's 4 MiB transfer-size regression budget: ${wasm.length}`);

  // Supply the exact changed source as well as the pinned dependencies, not a GitHub link
  // falsely claiming that an uncommitted build came from HEAD. Only these explicit paths
  // are copied; unrelated worktree changes/secrets never enter the source bundle.
  const source = join(stage, "source");
  const owned = ["LICENSE", "scripts/build-bridge-wasm.mjs", ...["native/solver-bridge", crate].flatMap(dir => [
    `${dir}/Cargo.toml`, `${dir}/Cargo.lock`, `${dir}/rust-toolchain.toml`,
    ...files(join(root, dir, "src")).map(path => relative(root, path)),
  ])];
  for (const path of owned) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    cpSync(join(root, path), join(source, path));
  }
  const sourceHash = sha(owned.sort().map(path => `${path}\0${sha(readFileSync(join(root, path)))}`).join("\n"));
  const vendorPath = join(source, "vendor");
  const config = cargo(["vendor", "--locked", "--versioned-dirs", "--manifest-path", manifest, vendorPath]);
  mkdirSync(join(source, ".cargo"));
  writeFileSync(join(source, ".cargo/config.toml"), config.replaceAll(vendorPath, "vendor"));
  const metadata = JSON.parse(cargo(["metadata", "--locked", "--format-version", "1", "--filter-platform", target, "--manifest-path", manifest]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  for (const node of nodes.values()) {
    if (node.features.includes("rayon") || node.features.includes("custom-alloc")) throw new Error("Unexpected WASM engine features");
  }
  const engine = metadata.packages.find(pkg => pkg.name === "postflop-solver");
  const engineCommit = engine.source.split("#")[1];
  const licenses = ["Poker Face WASM bridge: AGPL-3.0-or-later", readFileSync(join(root, "LICENSE"), "utf8")];
  for (const pkg of metadata.packages.filter(pkg => pkg.source && nodes.has(pkg.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const directory = dirname(pkg.manifest_path);
    const notices = readdirSync(directory).filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(name));
    if (!notices.length) throw new Error(`Review missing license text for ${pkg.name}`);
    licenses.push(`\n--- ${pkg.name} ${pkg.version}: ${pkg.license} ---\nSource: ${pkg.source}`);
    for (const name of notices.sort()) {
      const path = join(directory, name);
      const content = readdirSync(directory, { withFileTypes: true }).find(entry => entry.name === name);
      if (content.isFile()) licenses.push(readFileSync(path, "utf8"));
      else for (const notice of files(path)) licenses.push(readFileSync(notice, "utf8"));
    }
  }
  writeFileSync(join(stage, "LICENSES.txt"), licenses.join("\n"));
  // Rust's standard library/allocator also carries notices, outside Cargo metadata.
  const rustDocs = join(run("rustc", [`+${toolchain}`, "--print", "sysroot"]).trim(), "share/doc/rust");
  mkdirSync(join(stage, "rust-notices"));
  cpSync(join(rustDocs, "COPYRIGHT-library.html"), join(stage, "rust-notices/COPYRIGHT-library.html"));
  cpSync(join(rustDocs, "licenses"), join(stage, "rust-notices/licenses"), { recursive: true });
  writeFileSync(join(source, "BUILD.txt"), "Exact W1 source and vendored Cargo dependencies.\n" +
    `Install Rust ${toolchain} with target ${target}, and wasm-bindgen-cli ${bindgenVersion} (--locked).\n` +
    `From this source directory: cargo +${toolchain} build --release --locked --offline --manifest-path ${manifest} --target ${target}\n` +
    `Then: wasm-bindgen ${crate}/target/${target}/release/solver_bridge_wasm.wasm --target web --out-dir pkg --out-name solver_bridge_wasm\n` +
    "No atomics, explicit SIMD or optimizer pass. Standard allocator; panic=abort.\n");
  const artifact = {
    format: "poker-face-bridge-wasm-build", version: 1, mode: "single-thread", rustToolchain: toolchain,
    rustc: run("rustc", [`+${toolchain}`, "--version"]).trim(), wasmBindgen: bindgenVersion,
    engineCommit, sourceHash, sourceDirectory: "source", licenseFile: "LICENSES.txt",
    rustNotices: "rust-notices/COPYRIGHT-library.html",
    // Exact source is supplied even when HEAD is only the parent of uncommitted changes.
    baseCommit: run("git", ["rev-parse", "HEAD"]).trim(),
    files: Object.fromEntries(files(stage).map(path => [relative(stage, path), { sha256: sha(readFileSync(path)), bytes: readFileSync(path).length }])),
  };
  const buildHash = sha(json(artifact));
  const full = { ...artifact, buildHash };
  writeFileSync(join(stage, "manifest.json"), json(full));
  const destination = join(webRoot, buildHash);
  if (existsSync(destination)) {
    if (readFileSync(join(destination, "manifest.json"), "utf8") !== json(full)) throw new Error("Build hash collision");
  } else renameSync(stage, destination);
  writeFileSync(join(webRoot, "manifest.json"), json(full));
  console.log(JSON.stringify({ buildHash, sourceHash, wasmBytes: wasm.length, directory: destination }));
} finally {
  // Only the freshly created staging directory; never remove an existing hashed build.
  rmSync(stage, { recursive: true, force: true });
}
