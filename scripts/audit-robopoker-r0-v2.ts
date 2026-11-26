/** A passing audit reproduces the recorded outcome, which may be a rejection. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "../src/lib/solver/multiway/robopoker/contract";
import { fixtures } from "../src/lib/solver/multiway/robopoker-v2/fixtures";
import { assess, type Observation } from "../src/lib/solver/multiway/robopoker-v2/audit";

const directory = "tasks/artifacts/robopoker-r0-v2";
const binary = "native/robopoker-referee-v2/target/release/robopoker-referee-v2";
const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).filter(e => e.name !== "target").flatMap(e =>
    e.isDirectory() ? files(`${path}/${e.name}`) : [`${path}/${e.name}`]).sort();
}
function sources() {
  const paths = [...files("native/robopoker-referee-v2"), ...files("src/lib/solver/multiway/robopoker-v2"),
    "src/lib/solver/multiway/robopoker/contract.ts", "src/lib/solver/multiway/fixture.ts",
    "src/lib/solver/multiway/river-game.ts", "src/lib/solver/multiway/game.ts",
    "src/lib/solver/multiway/best-response.ts", "src/lib/solver/multiway/artifact.ts",
    "scripts/audit-robopoker-r0-v2.ts", "test/robopoker-r0-v2.test.ts", "tasks/robopoker-r0-v2-contract.md"];
  return Object.fromEntries(paths.sort().map(p => [p, hashFile(p)]));
}
const inputs = fixtures();
const sequence = [...inputs.flatMap(f => [0, 1].map(repeat => ({ id: f.id, mode: f.profile ? "profile" : "uniform", repeat }))),
  ...["external", "pluribus"].flatMap(mode => [0, 1].map(repeat => ({ id: "three-player-river-v1", mode, repeat })))];
type Step = typeof sequence[number];
type Assessment = ReturnType<typeof assess>;
interface Attempt {
  step: Step; startedAt: string; wallMs: number; status: number | null; signal: string | null;
  error: string | null; stdout: string; stderr: string;
}
interface Outcome { observation?: Observation; assessment?: Assessment; error?: string; passed: boolean }
function numerical(o: Observation) {
  const { elapsedMs, peakRssBytes, ...rest } = o;
  assert.ok(elapsedMs > 0 && peakRssBytes > 0);
  return rest;
}
function outcome(a: Attempt): Outcome {
  if (a.status !== 0 || a.error || a.signal) return { passed: false, error: `process: ${a.error ?? a.signal ?? a.status}` };
  try {
    const observation = JSON.parse(a.stdout) as Observation;
    const fixture = inputs.find(f => f.id === a.step.id)!;
    const assessment = assess(fixture, observation, a.step.mode);
    return { observation, assessment, passed: assessment.passed && a.wallMs < 60_000 };
  } catch (error) { return { passed: false, error: String(error) }; }
}
function fresh(step: Step): Attempt {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(binary, [step.mode], { input: JSON.stringify(inputs.find(f => f.id === step.id)),
    encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, RAYON_NUM_THREADS: "1" } });
  return { step, startedAt, wallMs: performance.now() - start, status: result.status,
    signal: result.signal, error: result.error ? String(result.error) : null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function save(path: string, payload: unknown) {
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", { flag: "wx" });
}
function verifyVendor() {
  const original = JSON.parse(readFileSync("native/robopoker-referee-v2/upstream-sources.json", "utf8")) as Record<string, string>;
  for (const [file, hash] of Object.entries(original)) {
    if (file === "Cargo.toml" || file === "src/strategy/mod.rs") continue;
    assert.equal(hashFile(`native/robopoker-referee-v2/vendor/mccfr/${file}`), hash, `untouched upstream ${file}`);
  }
  const mod = readFileSync("native/robopoker-referee-v2/vendor/mccfr/src/strategy/mod.rs", "utf8").replace("mod exact;\n", "").replace("pub use exact::*;\n", "");
  assert.equal(createHash("sha256").update(mod).digest("hex"), original["src/strategy/mod.rs"]);
  const cargo = readFileSync("native/robopoker-referee-v2/vendor/mccfr/Cargo.toml", "utf8").replace('version = "1.2.0-poker-face.1"', 'version = "1.2.0"');
  assert.equal(createHash("sha256").update(cargo).digest("hex"), original["Cargo.toml"]);
}
function freeze() {
  verifyVendor();
  mkdirSync(directory, { recursive: true });
  const payload = { version: 2, frozenAt: new Date().toISOString(), sources: sources(),
    inputs: inputs.map(f => ({ id: f.id, hash: digest(f) })), sequence,
    platform: platform(), arch: arch(), binaryHash: hashFile(binary),
    processDeadlineMs: 60_000, memoryLimitBytes: 1_000_000_000, maximumGain: 0.45, agreementChips: 1e-6 };
  save(`${directory}/freeze.json`, { ...payload, payloadHash: digest(payload) });
}
function frozen() {
  const { payloadHash, ...payload } = JSON.parse(readFileSync(`${directory}/freeze.json`, "utf8"));
  assert.equal(payloadHash, digest(payload), "freeze payload hash");
  assert.deepEqual(payload.sources, sources(), "frozen R0 v2 source identity");
  assert.deepEqual(payload.inputs, inputs.map(f => ({ id: f.id, hash: digest(f) })));
  assert.deepEqual(payload.sequence, sequence);
  assert.equal(payload.processDeadlineMs, 60_000); assert.equal(payload.memoryLimitBytes, 1_000_000_000);
  assert.equal(payload.maximumGain, 0.45); assert.equal(payload.agreementChips, 1e-6);
  verifyVendor();
  return payloadHash as string;
}
interface Summary { version: 2; freezeHash: string; status: string; attempts: { file: string; hash: string; outcome: Outcome }[]; unattempted: Step[]; turnRiverAttempted: false }
function observe() {
  const freezeHash = frozen();
  const attempts: Summary["attempts"] = [];
  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i];
    console.log(`Starting ${i + 1}/${sequence.length}: ${step.id} ${step.mode} repeat ${step.repeat}`);
    const a = fresh(step);
    const file = `${String(i).padStart(2, "0")}-${step.mode}-${step.repeat}.json`;
    save(`${directory}/${file}`, a); // Preserve the raw process result before any grading.
    const checked = outcome(a);
    if (checked.passed && step.repeat === 1) {
      try { assert.deepEqual(numerical(checked.observation!), numerical(attempts[i - 1].outcome.observation!)); }
      catch { checked.passed = false; checked.error = "deterministic repeat mismatch"; }
    }
    attempts.push({ file, hash: hashFile(`${directory}/${file}`), outcome: checked });
    console.log(JSON.stringify({ step, wallMs: a.wallMs, passed: checked.passed, assessment: checked.assessment, error: checked.error }));
    if (!checked.passed) break;
  }
  const last = attempts.at(-1)!;
  const summary: Summary = { version: 2, freezeHash,
    status: last.outcome.passed ? "passed-local-fork-r0-v2" : last.outcome.assessment?.convergencePassed === false ? "blocked-trained-convergence" : "blocked-r0-v2-gate",
    attempts, unattempted: sequence.slice(attempts.length), turnRiverAttempted: false };
  save(`${directory}/result.json`, { ...summary, payloadHash: digest(summary) });
}
export function auditR0V2() {
  const { payloadHash, ...summary } = JSON.parse(readFileSync(`${directory}/result.json`, "utf8")) as Summary & { payloadHash: string };
  assert.equal(payloadHash, digest(summary)); assert.equal(summary.freezeHash, frozen());
  assert.equal(summary.version, 2); assert.equal(summary.turnRiverAttempted, false);
  assert.ok(summary.attempts.length > 0 && summary.attempts.length <= sequence.length);
  summary.attempts.forEach((entry, i) => {
    const path = `${directory}/${entry.file}`;
    assert.equal(hashFile(path), entry.hash);
    const a = JSON.parse(readFileSync(path, "utf8")) as Attempt;
    assert.deepEqual(a.step, sequence[i]);
    assert.ok(Number.isFinite(a.wallMs) && a.wallMs > 0);
    const checked = outcome(a);
    if (checked.passed && a.step.repeat === 1) {
      try { assert.deepEqual(numerical(checked.observation!), numerical(summary.attempts[i - 1].outcome.observation!)); }
      catch { checked.passed = false; checked.error = "deterministic repeat mismatch"; }
    }
    assert.deepEqual(checked, entry.outcome);
    if (i < summary.attempts.length - 1) assert.equal(checked.passed, true, "stop at first failed gate");
  });
  assert.deepEqual(summary.unattempted, sequence.slice(summary.attempts.length));
  const last = summary.attempts.at(-1)!.outcome;
  if (last.passed) assert.equal(summary.attempts.length, sequence.length);
  assert.equal(summary.status, last.passed ? "passed-local-fork-r0-v2" : last.assessment?.convergencePassed === false ? "blocked-trained-convergence" : "blocked-r0-v2-gate");
  return { ...summary, payloadHash };
}
function reproduce() {
  const saved = auditR0V2();
  for (let i = 0; i < saved.attempts.length; i++) {
    const actual = fresh(sequence[i]);
    const result = outcome(actual);
    const previous = saved.attempts[i].outcome;
    assert.equal(result.passed, previous.passed);
    if (previous.observation) assert.deepEqual(numerical(result.observation!), numerical(previous.observation));
    if (previous.error) assert.equal(result.error, previous.error);
    assert.ok(actual.wallMs < 60_000);
    assert.ok(!result.assessment || (result.assessment.runtimePassed && result.assessment.memoryPassed));
    console.log(JSON.stringify({ step: actual.step, wallMs: actual.wallMs, elapsedMs: result.observation?.elapsedMs,
      peakRssBytes: result.observation?.peakRssBytes, passed: result.passed }));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  switch (process.argv[2]) {
    case "--freeze": freeze(); break;
    case "--observe": observe(); break;
    case "--check": break;
    case "--reproduce": reproduce(); break;
    default: throw new Error("Use --freeze, --observe, --check or --reproduce");
  }
  if (process.argv[2] !== "--freeze") {
    const record = auditR0V2();
    console.log(JSON.stringify({ status: record.status, payloadHash: record.payloadHash,
      attempts: record.attempts.length, unattempted: record.unattempted, turnRiverAttempted: false }));
  }
}
