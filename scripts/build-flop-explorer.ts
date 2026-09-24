import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { riverComboKey } from "../src/lib/solver/river/cards";
import { atomicFlopWrite } from "../src/lib/solver/postflop/flop/binary-node";
import { FLOP_PRESETS } from "../src/lib/solver/postflop/flop-library/fixtures";
import { readFlopLibrarySource } from "../src/lib/solver/postflop/flop-library/source-node";
import { deriveFlopFront } from "../src/lib/solver/postflop/flop-library/derive";
import { FLOP_INITIAL_BYTES, FLOP_SLICE_BYTES, type FlopCatalog, type FlopFileRef, type FlopScenario, type FlopSlice } from "../src/lib/solver/postflop/flop-library/model";
import { validateFlopScenario, validateFlopSlice } from "../src/lib/solver/postflop/flop-library/load";

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!["--write", "--check"].includes(mode) || rest.length) throw new Error("Usage: build-flop-explorer.ts --write|--check");
  const started = performance.now(), temporary = mode === "--write" ? mkdtempSync(join(tmpdir(), "poker-flop-publication-")) : null;
  const paths: string[] = [], catalog: FlopCatalog = { version: 1, scenarios: [] }; let rawBytes = 0, gzipBytes = 0, maxParseMs = 0, maxHeapDelta = 0, initial: unknown;
  const put = (path: string, value: unknown, limit = FLOP_SLICE_BYTES) => {
    const bytes = Buffer.from(canonicalSolverJson(value) + "\n"); if (bytes.length > limit) throw new Error(`${path} exceeds its ${limit}-byte slice limit`);
    const compressed = gzipSync(bytes).length; rawBytes += bytes.length; gzipBytes += compressed;
    if (gzipBytes > 100 * 1024 ** 2) throw new Error("Flop catalog exceeds 100 MiB gzip budget");
    if (process.memoryUsage().rss > 2 * 1024 ** 3 || performance.now() - started > 600000) throw new Error("Flop export exceeded 2 GiB/10-minute envelope");
    const parseStart = performance.now(), heap = process.memoryUsage().heapUsed, parsed = JSON.parse(bytes.toString());
    maxParseMs = Math.max(maxParseMs, performance.now() - parseStart); maxHeapDelta = Math.max(maxHeapDelta, process.memoryUsage().heapUsed - heap);
    if (temporary) { const target = join(temporary, path); mkdirSync(dirname(target), { recursive: true }); atomicFlopWrite(target, bytes, false); paths.push(path); }
    else if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw new Error(`Flop browser data does not reproduce: ${path}`);
    return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), gzipBytes: compressed, parsed };
  };
  for (const preset of FLOP_PRESETS) {
    const source = readFlopLibrarySource(preset), game = source.game, begun = performance.now();
    const facts = deriveFlopFront(game, source.policy, n => { if (n % 1000 === 0) console.error(JSON.stringify({ stage: "deriving", scenario: preset.request.id, completedDeals: n, totalDeals: game.ranges.compatibleDeals })); });
    if (Math.abs(facts.rootValue0 - source.grade.value[0]) > 1e-10 * (preset.request.committedPerPlayer + Math.min(...preset.request.stackBehind))) throw new Error("Explanation value differs from independent source grade");
    const prefix = `/solver-data/flop-v1/${preset.request.id}/${source.payloadHash}/`, riverGroups = Object.fromEntries(game.ranges.deck.map(t => [t, game.ranges.deck.filter(r => r !== t)]));
    const groups = new Map<string, number[]>();
    game.states.forEach((s, n) => {
      const key = s.street === 0 ? "flop" : s.street === 1 ? `t-${s.turn}` : `t-${s.turn}-r-${Math.floor(riverGroups[s.turn!].indexOf(s.river!) / 4)}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(n);
    });
    const scenario: FlopScenario = { version: 1, id: preset.request.id, title: preset.title, description: preset.description, texture: preset.texture,
      provenance: preset.provenance, request: game.request, hands: game.ranges.players.map(p => p.hands.map(riverComboKey)), weights: game.ranges.players.map(p => Array.from(p.weights)),
      quality: { iterations: source.iterations, value: [...source.grade.value], gains: [...source.grade.gains], exploitability: source.grade.exploitability,
        percentOfPot: 100 * source.grade.exploitability / (2 * game.request.committedPerPlayer) }, sourceHash: source.payloadHash, policyHash: source.policyHash,
      counts: { compatibleDeals: game.ranges.compatibleDeals, publicStates: game.states.length, informationSets: game.informationSets }, riverGroups,
      inputs: { url: `${prefix}inputs.json`, bytes: 1, sha256: "0".repeat(64) }, chunks: {} };
    let maximumSliceBytes = 0, firstGzip = 0; const beforeRaw = rawBytes, beforeGzip = gzipBytes; let flop: FlopSlice | undefined;
    for (const [key, ids] of groups) {
      const slice: FlopSlice = { version: 1, scenario: scenario.id, sourceHash: source.payloadHash, key, nodes: ids.map(facts.node) };
      const url = `${prefix}${key}.json`, saved = put(`public${url}`, slice, key === "flop" ? FLOP_INITIAL_BYTES : FLOP_SLICE_BYTES);
      scenario.chunks[key] = { url, sha256: saved.sha256, bytes: saved.bytes }; validateFlopSlice(saved.parsed, scenario, key);
      maximumSliceBytes = Math.max(maximumSliceBytes, saved.bytes);
      if (key === "flop") { flop = slice; firstGzip += saved.gzipBytes; }
    }
    const inputs = put(`public${scenario.inputs.url}`, scenario.request, FLOP_INITIAL_BYTES);
    scenario.inputs = { url: scenario.inputs.url, sha256: inputs.sha256, bytes: inputs.bytes };
    const metadataUrl = `${prefix}scenario.json`, metadata = put(`public${metadataUrl}`, scenario, FLOP_INITIAL_BYTES);
    const ref: FlopFileRef = { url: metadataUrl, sha256: metadata.sha256, bytes: metadata.bytes };
    const entry = { id: scenario.id, title: scenario.title, texture: scenario.texture, description: scenario.description, sourceHash: source.payloadHash, metadata: ref };
    validateFlopScenario(metadata.parsed, entry); catalog.scenarios.push(entry);
    firstGzip += metadata.gzipBytes; if (firstGzip > 5 * 1024 ** 2 || !flop) throw new Error("Flop first-view budget/initial data failed");
    if (!initial) initial = { scenario, flop };
    console.log(JSON.stringify({ scenario: scenario.id, chunks: groups.size, rawBytes: rawBytes - beforeRaw, gzipBytes: gzipBytes - beforeGzip,
      maximumSliceBytes, metadataBytes: metadata.bytes, firstViewGzipBytes: firstGzip, derivationWorkingBytes: facts.workingBytes, elapsedMs: performance.now() - begun }));
  }
  put("src/lib/solver/postflop/flop-library/artifacts/catalog.json", catalog, FLOP_INITIAL_BYTES);
  put("src/lib/solver/postflop/flop-library/artifacts/initial.json", initial, 2 * FLOP_INITIAL_BYTES);
  // Validate the complete candidate before any publication. Each file is atomic; the
  // deployment as a whole is not. Source-bound hashes reject mixed-version responses.
  if (temporary) for (const path of paths) {
    mkdirSync(dirname(path), { recursive: true }); const bytes = readFileSync(join(temporary, path)), exists = existsSync(path);
    if (!exists || !readFileSync(path).equals(bytes)) atomicFlopWrite(path, bytes, exists);
  }
  console.log(JSON.stringify({ mode, files: temporary ? paths.length : undefined, rawBytes, gzipBytes, maxParseMs, maxSampledHeapDelta: maxHeapDelta,
    elapsedMs: performance.now() - started, maximumRssBytes: process.resourceUsage().maxRSS * 1024 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
