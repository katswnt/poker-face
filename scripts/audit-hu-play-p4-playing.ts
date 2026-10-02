/** All 200 frozen P4 parents through the same public controllers/reducer used by the
 * browser harness. Preserve failures; no success-selected cases or partial policies.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { BRIDGE_BINARY } from "./bridge-runner";
import { wasmBuild } from "./bridge-wasm-runner";
import { buildFlopCorpus } from "./hu-play-p4-corpus";
import { playFlopCase } from "./hu-play-p4-playing-case";
import { mathProjection } from "./hu-play-wide-measurement";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { requireTurnPlayingResult } from "../src/lib/solver/bridge/live/turn-quality";
import { gradeRiverHands } from "../src/lib/solver/bridge/river-hand-values";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { BridgeSpotV1, BridgeResultV1 } from "../src/lib/solver/bridge/contract";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";

const bytesOf = (v: unknown) => Buffer.from(canonicalSolverJson(v) + "\n");
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const write = (path: string, v: unknown) => writeFileSync(path, bytesOf(v), { flag: "wx" });
const profileOf = (s: BridgeSpotV1) => s.tree.mode === "turn-subgame-v1" ? "play-turn-v1" as const
  : s.tree.mode === "river-subgame-v1" ? "play-river-v1" as const : "play-v1" as const;

async function main() {
  const [flag, inputPath, outFlag, outputPath, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--inputs" && inputPath && outFlag === "--out" && outputPath && !rest.length, "Use --inputs FROZEN_DIRECTORY --out NEW_DIRECTORY");
  const input = resolve(inputPath), directory = resolve(outputPath); assert.ok(!existsSync(directory)); mkdirSync(directory);
  const meta = JSON.parse(readFileSync(join(input, "inputs.json"), "utf8"));
  assert.equal(meta.format, "poker-face-p4-flop-inputs-bundle"); assert.equal(meta.version, 1); assert.equal(meta.cases, 200);
  const bytes = readFileSync(join(input, "inputs.json.gz")); assert.equal(bytes.length, meta.bytes); assert.equal(digest(bytes), meta.sha256);
  const plain = gunzipSync(bytes, { maxOutputLength: 128 * 1024 ** 2 });
  assert.equal(plain.length, meta.plainBytes); assert.equal(digest(plain), meta.inputsHash);
  const frozen = JSON.parse(plain.toString("utf8")); assert.equal(frozen.format, "poker-face-p4-flop-inputs"); assert.equal(frozen.version, meta.version);
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher), cases = await buildFlopCorpus(catalog, fetcher);
  assert.deepEqual(JSON.parse(canonicalSolverJson(cases)), frozen.cases);
  const { manifest } = wasmBuild(); assert.equal(manifest.sourceHash, frozen.engineSourceHash);
  assert.equal(manifest.buildHash, frozen.wasmBuildHash);
  const nativeBinarySha256 = digest(readFileSync(BRIDGE_BINARY)); assert.equal(nativeBinarySha256, frozen.nativeBinarySha256);
  for (const ref of frozen.selectionSources) assert.equal(digest(readFileSync(ref.path)), ref.sha256, `Frozen selection changed: ${ref.path}`);
  const bundle = await build({ entryPoints: ["scripts/audit-hu-play-p4-playing.ts"], bundle: true, platform: "node",
    format: "esm", packages: "external", write: false, metafile: true });
  const sourceFiles = Object.keys(bundle.metafile.inputs).sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const rows = [];
  for (const c of cases) {
    console.error(JSON.stringify({ type: "case", seed: c.seed, family: c.family, category: c.category, prefix: c.request.publicState.path }));
    const attempts: { spot: BridgeSpotV1; profile: ReturnType<typeof profileOf>; spotHash: string; result: BridgeResultV1 | null;
      accepted: boolean; error: string | null; elapsedMs: number }[] = [];
    const solve = async (spot: BridgeSpotV1, signal?: AbortSignal) => {
      const started = performance.now(), profile = profileOf(spot);
      const record = { spot, profile, spotHash: hashBridgeSpot(spot), result: null as BridgeResultV1 | null,
        accepted: false, error: null as string | null, elapsedMs: 0 };
      attempts.push(record);
      try {
        const r = await solveNativePlay(spot, { onResult: (_s, run) => { record.result = run.result; } }, signal, profile);
        // Mirror the Worker's publication gate. Invalid returned data is not a policy.
        if (profile === "play-river-v1") requireRiverPlayingResult(r, spot, record.spotHash);
        else if (profile === "play-turn-v1") requireTurnPlayingResult(r, spot, record.spotHash);
        else requirePlayingResult(r, spot, record.spotHash);
        record.accepted = true; return r;
      } catch (e) { record.error = e instanceof Error ? e.message : String(e); throw e; }
      finally { record.elapsedMs = performance.now() - started; }
    };
    let row: Record<string, unknown>;
    try {
      const completed = await playFlopCase(c, catalog, solve, undefined, fetcher);
      write(join(directory, `case-${c.seed}.playing.json`), completed);
      const accepted = attempts.filter(a => a.accepted);
      let at = 0;
      const replay = await playFlopCase(c, catalog, async spot => {
        const previous = attempts[at++]; assert.ok(previous); assert.equal(hashBridgeSpot(spot), previous.spotHash);
        if (!previous.accepted) throw new Error(previous.error ?? "Recorded refusal"); return previous.result!;
      }, undefined, fetcher);
      assert.equal(at, attempts.length); assert.equal(replay.logHash, completed.logHash, "Exact deterministic P4 replay");
      const riverGrades = accepted.flatMap(a => {
        if (a.spot.board.river === null) return [];
        const grade = gradeRiverHands(a.spot, a.result!);
        assert.ok(grade.exploitabilityPctPot <= .3, "Unchanged independent river quality gate");
        return [{ spotHash: a.spotHash, grade }];
      });
      row = { seed: c.seed, status: "complete", logHash: completed.logHash, passiveResponses: completed.passiveResponses, responses: completed.responses.map(r => r.description),
        elapsedMs: completed.elapsedMs, responseElapsedMs: completed.responseElapsedMs,
        ledger: completed.ledger, publicSolveKeys: attempts.map(a => a.spotHash), deterministicReplay: true, conserved: true, riverGrades,
        solves: accepted.map(a => ({ spotHash: a.spotHash, numericalHash: digest(bytesOf(mathProjection(a.result!))),
          iterations: a.result!.iterations, enginePctPot: a.result!.exploitability.pctPot, elapsedMs: a.elapsedMs,
          street: a.spot.board.river === null ? "turn" : "river" })) };
    } catch (e) { row = { seed: c.seed, status: "failed", error: e instanceof Error ? e.message : String(e) }; }
    // Write every request and raw result, including refused/missed-target attempts.
    for (let i = 0; i < attempts.length; i++) write(join(directory, `case-${c.seed}-attempt-${i}.json`), attempts[i]);
    write(join(directory, `case-${c.seed}.summary.json`), row); rows.push(row);
  }
  for (const ref of sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256, "Source changed during native measurement");
  const report = { format: "poker-face-p4-production-playing", version: 1, measuredAt: new Date().toISOString(),
    inputsHash: meta.inputsHash, nativeBinarySha256, engineSourceHash: manifest.sourceHash, sourceFiles,
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version }, rows,
    method: "One native thread per solve; no cache or range pruning. Wall times are observations, not browser-budget evidence. Turn raw engine grades are local; complete-turn independent samples are a separate required audit." };
  write(join(directory, "report.json"), { ...report, payloadHash: digest(bytesOf(report)) });
  const failures = rows.filter(r => r.status !== "complete");
  console.log(JSON.stringify({ directory, completed: 200 - failures.length, failed: failures.length, failures }));
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
