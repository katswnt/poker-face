/** Complete P1 native-source/replay gate. Generated results are public-range policies. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus, release } from "node:os";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { NativeResolveSource } from "../src/lib/hu-play/sources/native";
import { PlayPolicySource } from "../src/lib/hu-play/sources/play";
import { ResolvedPolicySource } from "../src/lib/hu-play/sources/resolved";
import { loadScriptedHand, playBotHand, scriptedSettlement } from "../src/lib/hu-play/scripted";
import { handLog } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { gradeRiverSubgame } from "../src/lib/solver/bridge/subgame-referee";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { mathProjection } from "./hu-play-wide-measurement";

const hash = (value: unknown) => createHash("sha256").update(canonicalSolverJson(value)).digest("hex");
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, "Use --hands N --out NEW_DIRECTORY");
  assert.equal(args[0], "--hands"); assert.equal(args[2], "--out");
  const count = Number(args[1]), directory = resolve(args[3]);
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 1000);
  assert.ok(!existsSync(directory), "Refusing to overwrite an audit");
  mkdirSync(directory); mkdirSync(join(directory, "results")); mkdirSync(join(directory, "hands"));
  const fetcher: typeof fetch = async input => {
    const path = String(input); assert.match(path, /^\/solver-data\/[a-z0-9/._-]+$/i); assert.ok(!path.includes(".."));
    return new Response(readFileSync(`public${path}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher);
  const sourcePaths = ["scripts/audit-hu-play-p1-hands.ts", "scripts/bridge-runner.ts",
    ...["hand", "async-hand", "types", "scripted", "public-state", "reach", "rng", "resolve-spot"].map(n => `src/lib/hu-play/${n}.ts`),
    ...["library-data", "library", "policy", "resolved", "native", "play"].map(n => `src/lib/hu-play/sources/${n}.ts`),
    "src/lib/solver/bridge/live/admission.ts", "src/lib/solver/bridge/live/play-profile.ts"];
  const sourceFiles = sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const sourceSnapshot = { baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceFiles };
  const solves: unknown[] = [], hands: unknown[] = [], riverGrades: unknown[] = [];
  const riverHashes = new Set<string>(), resultHashes = new Map<string, string>();
  const started = performance.now();
  for (let seed = 0; seed < count; seed++) {
    console.error(JSON.stringify({ type: "hand-start", seed, count }));
    try {
      const dealt = await loadScriptedHand(catalog, seed, (seed % 2) as 0 | 1, undefined, fetcher);
      const native = new NativeResolveSource({ onResult: (spot, run) => {
        const key = hashBridgeSpot(spot), numericalHash = hash(mathProjection(run.result));
        const path = join(directory, "results", `${key}.json`);
        if (resultHashes.has(key)) assert.equal(resultHashes.get(key), numericalHash);
        else { write(path, run.result); resultHashes.set(key, numericalHash); }
        solves.push({ seed, street: spot.board.river ? "river" : "turn", spotHash: key,
          hands: spot.ranges.map(r => r.combos.length), numericalHash, iterations: run.result.iterations,
          reached: run.result.exploitability.reached, enginePctPot: run.result.exploitability.pctPot,
          nativeSolveMs: run.elapsedMs, nativePeakRssBytes: run.result.memory.peakRssBytes });
        // Freeze the first 32 distinct production rivers, not a success-selected sample.
        if (spot.board.river && !riverHashes.has(key) && riverHashes.size < 32) {
          riverHashes.add(key);
          const grade = gradeRiverSubgame({ hands: run.result.hands, startingPot: spot.startingPot,
            subtree: { path: [], nodes: run.result.tree, ev: run.result.root.engineEv,
              reach: [spot.ranges[0].combos.map(h => h.weight), spot.ranges[1].combos.map(h => h.weight)] } });
          riverGrades.push({ seed, spotHash: key, grade });
          assert.ok(grade.localExploitabilityPctPot <= .3, `Independent river quality failed at seed ${seed}`);
        }
      } });
      const complete = await playBotHand(dealt.state, new PlayPolicySource(dealt.library, native));
      assert.ok(complete.result); assert.equal(complete.result.net[0] + complete.result.net[1], 0);
      assert.equal(complete.result.payouts[0] + complete.result.payouts[1], complete.public.pot);
      const ledger = scriptedSettlement(complete), log = handLog(complete), logHash = hashHandLog(log);
      for (const decision of log.decisions) assert.deepEqual(decision.provenance.ladder?.prunedMass, [0, 0]);
      const cached = new ResolvedPolicySource(async spot => {
        const key = hashBridgeSpot(spot); assert.ok(resultHashes.has(key), "Replay requested a different public game");
        return JSON.parse(readFileSync(join(directory, "results", `${key}.json`), "utf8"));
      });
      const replay = await playBotHand(dealt.state, new PlayPolicySource(dealt.library, cached));
      assert.equal(hashHandLog(handLog(replay)), logHash, `Non-deterministic hand ${seed}`);
      write(join(directory, "hands", `${seed}.json`), log);
      const row = { seed, aiSeat: seed % 2, librarySpotId: dealt.library.entry.id, logHash,
        actions: log.events.filter(e => e.kind === "action").length, outcome: complete.public.status,
        ledger, deterministicReplay: true, conserved: true };
      hands.push(row); console.log(JSON.stringify(row));
    } catch (error) {
      write(join(directory, "failure.json"), { seed, completed: hands.length, message: error instanceof Error ? error.message : String(error),
        hands, solves, riverGrades });
      throw error;
    }
  }
  if (count === 1000) assert.ok(riverGrades.length >= 20, "P1 needs at least 20 sampled independent river grades");
  const report = { format: "poker-face-p1-production-hands", version: 1, measuredAt: new Date().toISOString(),
    machine: { cpu: cpus()[0].model, osRelease: release(), node: process.version },
    sourceSnapshot, sourceSnapshotHash: hash(sourceSnapshot),
    libraryManifestSha256: catalog.supplement.libraryManifestSha256,
    flopSourceSha256: catalog.supplement.sourceSha256, seeds: { first: 0, count },
    interpretation: "Complete native-backed P1 hands and cache-backed replays through the actual async reducer. Native clocks are not browser latency; river grades are local, not whole-game safety.",
    elapsedMs: performance.now() - started, hands, solves, riverGrades };
  write(join(directory, "report.json"), { ...report, payloadHash: hash(report) });
  console.error(JSON.stringify({ type: "complete", hands: hands.length, solves: solves.length, independentRivers: riverGrades.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
