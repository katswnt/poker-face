/** Re-solve the immutable P4 cases using a newly built native or Node/WASM engine.
 * Binary/build hashes may differ across paths/commits; games, source and every numerical
 * cell must not. Does not rewrite evidence, change gates or claim new browser timings.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { parseLiveSpot } from "../src/lib/solver/bridge/live/admission";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { requireTurnPlayingResult } from "../src/lib/solver/bridge/live/turn-quality";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { requirePlayingResult } from "../src/lib/hu-play/sources/resolved";
import { solveNativePlay } from "../src/lib/hu-play/sources/native";
import { BRIDGE_BINARY, runBridgeSpot } from "./bridge-runner";
import { loadWasm, runWasmSpot, wasmBuild } from "./bridge-wasm-runner";
import { checkP4Evidence, p4Hash, p4PipelineSources, readP4Evidence } from "./audit-hu-play-p4";
import { checkCompleteTurnReference } from "./audit-hu-play-p4-turn-grades";
import { playFlopCase } from "./hu-play-p4-playing-case";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { mathProjection } from "./hu-play-wide-measurement";

const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const profileOf = (s: BridgeSpotV1) => s.tree.mode === "turn-subgame-v1" ? "play-turn-v1" as const
  : s.tree.mode === "river-subgame-v1" ? "play-river-v1" as const : "play-v1" as const;
export function checkP4ReproducedPolicy(spot: BridgeSpotV1, fresh: BridgeResultV1, original: BridgeResultV1) {
  const hash = hashBridgeSpot(spot);
  assert.equal(original.spotHash, hash, "Frozen policy belongs to a different game");
  if (spot.tree.mode === "turn-subgame-v1") requireTurnPlayingResult(fresh, spot, hash);
  else if (spot.tree.mode === "river-subgame-v1") requireRiverPlayingResult(fresh, spot, hash);
  else requirePlayingResult(fresh, spot, hash);
  const numericalHash = p4Hash(mathProjection(fresh));
  assert.equal(numericalHash, p4Hash(mathProjection(original)), "Every reproduced numerical cell must match");
  return numericalHash;
}
async function main() {
  const [backendFlag, backend, outFlag, output, ...rest] = process.argv.slice(2);
  assert.ok(backendFlag === "--backend" && ["native", "wasm"].includes(backend) && outFlag === "--out"
    && output && !rest.length, "Use --backend native|wasm --out NEW_DIRECTORY");
  const directory = resolve(output); assert.ok(!existsSync(directory));
  const evidence = readP4Evidence(); await checkP4Evidence(evidence);
  const { manifest } = wasmBuild(); assert.equal(manifest.sourceHash, evidence.inputs.engineSourceHash, "Engine source changed");
  const sourceFiles = await p4PipelineSources();
  const wasm = backend === "wasm" ? await loadWasm() : null;
  const nativeBinarySha256 = backend === "native" ? digest(readFileSync(BRIDGE_BINARY)) : null;
  mkdirSync(directory);
  const write = (path: string, value: unknown) => writeFileSync(join(directory, path),
    canonicalSolverJson(value) + "\n", { flag: "wx" });
  const fetcher: typeof fetch = async input => {
    assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(input).includes(".."));
    return new Response(readFileSync(`public${input}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const rows = [], complete = [];
  for (const c of evidence.inputs.cases) {
    console.error(JSON.stringify({ stage: "fresh-p4-case", backend, seed: c.seed }));
    const saved = evidence.cases[c.seed], reference = evidence.native.rows[c.seed];
    let at = 0;
    const attempts: { spot: BridgeSpotV1; spotHash: string; accepted: boolean; numericalHash?: string; error?: string }[] = [];
    try {
      const played = await playFlopCase(c, catalog, async (spot, signal) => {
          const expected = saved.attempts[at++]; assert.ok(expected, "Unexpected new solve");
          const spotHash = hashBridgeSpot(spot); assert.equal(spotHash, expected.spotHash, "Frozen public game changed");
          const profile = profileOf(spot); parseLiveSpot(canonicalSolverJson(spot), profile);
          const attempt = { spot, spotHash, accepted: false } as (typeof attempts)[number]; attempts.push(attempt);
          try {
            const fresh = wasm ? runWasmSpot(wasm.bindings, spot) : await solveNativePlay(spot, {}, signal, profile);
            write(`case-${c.seed}-attempt-${at - 1}.json`, { spot, result: fresh });
            assert.ok(expected.accepted && expected.result, "A formerly refused attempt changed");
            attempt.numericalHash = checkP4ReproducedPolicy(spot, fresh, expected.result); attempt.accepted = true;
            return fresh;
          } catch (error) {
            attempt.error = error instanceof Error ? error.message : String(error);
            // The controller may catch a solve failure; the case-level exact-attempt
            // checks below still reject changed quality, policy or fallback behavior.
            throw error;
          }
        }, undefined, fetcher);
      assert.equal(at, saved.attempts.length);
      assert.deepEqual(attempts.map(a => a.accepted), saved.attempts.map(a => a.accepted));
      assert.deepEqual(attempts.filter(a => a.accepted).map(a => a.numericalHash), reference.solves.map(s => s.numericalHash));
      assert.equal(played.logHash, reference.logHash); assert.equal(played.passiveResponses, reference.passiveResponses);
      assert.deepEqual(played.ledger, reference.ledger);
      const row = { seed: c.seed, passed: true, logHash: played.logHash, attempts };
      rows.push(row); write(`case-${c.seed}.json`, row);
    } catch (error) {
      const row = { seed: c.seed, passed: false, error: String(error), attempts };
      rows.push(row); write(`case-${c.seed}.json`, row);
    }
  }
  for (const sample of evidence.complete) {
    console.error(JSON.stringify({ stage: "fresh-p4-complete-turn", backend, seed: sample.seed }));
    try {
      const fresh = wasm ? runWasmSpot(wasm.bindings, sample.spot) : (await runBridgeSpot(sample.spot, { threads: 1 })).result;
      write(`complete-${sample.seed}.json`, { spot: sample.spot, result: fresh });
      assert.equal(p4Hash(mathProjection(fresh)), p4Hash(mathProjection(sample.result)), "Complete reference changed");
      const first = evidence.cases[sample.seed].attempts[0]; assert.ok(first.result);
      const grade = checkCompleteTurnReference(sample.spot, fresh, first.result);
      complete.push({ seed: sample.seed, passed: true, grade });
    } catch (error) { complete.push({ seed: sample.seed, passed: false, error: String(error) }); }
  }
  assert.deepEqual(sourceFiles, await p4PipelineSources(), "Source changed during reproduction");
  const passed = rows.length === 200 && rows.every(r => r.passed) && complete.length === 4 && complete.every(r => r.passed);
  const report = { format: "poker-face-p4-fresh-build-reproduction", version: 1, measuredAt: new Date().toISOString(),
    backend, inputsHash: p4Hash(evidence.inputs), frozenNativeReportHash: evidence.native.payloadHash,
    engineSourceHash: manifest.sourceHash, wasmBuildHash: manifest.buildHash, nativeBinarySha256,
    sourceFiles, rows, complete, passed,
    method: "Re-solve all frozen games and four complete references; compare every numerical cell and full reducer log. Unchanged quality gates and full ranges. No timing, memory, physical-device or binary-byte reproducibility claim." };
  write("report.json", { ...report, payloadHash: p4Hash(report) });
  console.log(JSON.stringify({ directory, backend, passed, cases: rows.length, complete: complete.length,
    failures: rows.filter(r => !r.passed), completeFailures: complete.filter(r => !r.passed) }));
  assert.ok(passed, "Fresh-build P4 reproduction failed; retain every failure");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
