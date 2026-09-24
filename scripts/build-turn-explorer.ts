import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import type { TurnV2Artifact } from "../src/lib/solver/postflop/configurable-turn/artifact-node";
import { vectorDigest } from "../src/lib/solver/postflop/vector/artifact-node";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { canonicalSolverJson, deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { deriveTurnExplorer } from "../src/lib/solver/postflop/explorer/derive";
import { validateExplorerChunk } from "../src/lib/solver/postflop/explorer/load";
import { CHUNK_BYTE_LIMIT, TURN_BYTE_LIMIT, type ExplorerCatalog, type SavedScenario } from "../src/lib/solver/postflop/explorer/model";

const sources = [
  { id: "turn-v2-dry-value", title: "An ace on the board", description: "Strong pairs, a set, and a straight draw. See how the last card changes what a hand can beat." },
  { id: "turn-v2-paired-short", title: "Paired board, shorter stacks", description: "Trips, pairs, and unequal stacks. Follow raises, all-ins, and returned unmatched chips." },
];
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) throw new Error("Usage: build-turn-explorer.ts --check|--write");
  const started = performance.now(), catalog: ExplorerCatalog = { version: 1, scenarios: [] };
  const outputs = new Map<string, string>();
  let totalRaw = 0, totalGzip = 0;
  const publish = (path: string, json: string) => {
    if (args[0] === "--check") assert.equal(readFileSync(path, "utf8"), json, `Explorer reproduction failed: ${path}`);
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, json); }
  };
  for (const source of sources) {
    const artifact = JSON.parse(readFileSync(`src/lib/solver/postflop/configurable-turn/artifacts/${source.id}.json`, "utf8")) as TurnV2Artifact;
    const { payloadHash, ...payload } = artifact;
    assert.equal(artifact.schemaVersion, 1); assert.equal(artifact.rules, "turn-v2"); assert.equal(artifact.rulesVersion, 2);
    assert.equal(artifact.backend, "vector-turn"); assert.equal(artifact.backendVersion, 1);
    assert.equal(vectorDigest(payload), payloadHash); assert.equal(vectorDigest(artifact.strategy), artifact.policyHash);
    assert.equal(vectorDigest(artifact.request), artifact.requestHash); assert.equal(artifact.request.id, source.id);
    assert.ok(artifact.acceptance.passed && artifact.acceptance.maximumExploitability === 0.25);
    const game = compileTurnV2(artifact.request), policy = deserializeBehavioralStrategy(game.index, artifact.strategy);
    assert.equal(vectorDigest(game.gameIdentity), artifact.gameHash);
    const grade = gradeVectorTurn(game, policy), naive = gradeVectorTurn(game, policy, "naive");
    assert.deepEqual(grade.value, artifact.value); assert.deepEqual(grade.gains, artifact.gains);
    assert.equal(grade.exploitability, artifact.exploitability); assert.ok(grade.exploitability <= 0.25);
    for (const p of [0, 1] as const) assert.ok(Math.abs(grade.value[p] - naive.value[p]) < 1e-8);
    const scenario: SavedScenario = { ...source, request: game.request, hands: game.ranges.players.map(p => p.hands.map(h => h.join(" "))),
      quality: { iterations: artifact.iterations, exploitability: grade.exploitability, percentOfPot: artifact.exploitabilityPercentOfPot, gains: [...grade.gains], value: [...grade.value] },
      provenance: { requestHash: artifact.requestHash, policyHash: artifact.policyHash, payloadHash },
      counts: { deals: game.ranges.compatibleDeals, publicStates: game.publicStates.length, informationSets: game.index.informationSets.length }, chunks: {} };
    const chunks = deriveTurnExplorer(game, policy, payloadHash);
    assert.equal(chunks.length, 49);
    let raw = 0, compressed = 0, maxParseMs = 0, maxHeapDelta = 0;
    for (const chunk of chunks) {
      const json = `${canonicalSolverJson(chunk)}\n`, bytes = Buffer.byteLength(json), gzipBytes = gzipSync(json).length;
      assert.ok(bytes <= (chunk.card ? CHUNK_BYTE_LIMIT : TURN_BYTE_LIMIT), `Chunk budget exceeded: ${source.id}/${chunk.card}`);
      const before = process.memoryUsage().heapUsed, start = performance.now();
      JSON.parse(json); maxParseMs = Math.max(maxParseMs, performance.now() - start); maxHeapDelta = Math.max(maxHeapDelta, process.memoryUsage().heapUsed - before);
      const key = chunk.card ?? "turn", url = `/solver-data/turn-v1/${source.id}/${key}.json`;
      // Raw bytes/hashes are reproducible. Gzip size is an observed budget check,
      // not manifest identity: Node/zlib versions can compress identical bytes differently.
      scenario.chunks[key] = { url, bytes, sha256: createHash("sha256").update(json).digest("hex") };
      outputs.set(`public${url}`, json); raw += bytes; compressed += gzipBytes;
    }
    let maxValidationMs = 0;
    for (const chunk of chunks) { const start = performance.now(); validateExplorerChunk(chunk, scenario, chunk.card); maxValidationMs = Math.max(maxValidationMs, performance.now() - start); }
    assert.ok(compressed <= 5 * 1024 ** 2, "Scenario compressed budget exceeded");
    totalRaw += raw; totalGzip += compressed; catalog.scenarios.push(scenario);
    console.log(JSON.stringify({ scenario: source.id, nodes: game.publicStates.length, chunks: chunks.length, rawBytes: raw, gzipBytes: compressed,
      maxChunkBytes: Math.max(...Object.values(scenario.chunks).map(c => c.bytes)), maxParseMs, maxValidationMs, maxSampledHeapDeltaBytes: maxHeapDelta }));
  }
  const json = `${canonicalSolverJson(catalog)}\n`;
  assert.ok(Buffer.byteLength(json) <= 128 * 1024, "Manifest budget exceeded");
  assert.ok(totalRaw <= 64 * 1024 ** 2 && totalGzip <= 10 * 1024 ** 2, "Catalog budget exceeded");
  outputs.set("src/lib/solver/postflop/explorer/artifacts/catalog.json", json);
  // Validate both complete scenarios and ALL budgets before writing any file.
  // This is not an atomic deployment; readers still check their manifest hashes.
  for (const [path, content] of outputs) publish(path, content);
  console.log(JSON.stringify({ mode: args[0], manifestBytes: Buffer.byteLength(json), totalRawBytes: totalRaw, totalGzipBytes: totalGzip, elapsedMs: performance.now() - started }));
}
main();
