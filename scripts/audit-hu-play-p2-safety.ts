/** Recompute all safety/value comparisons from preserved full strategy evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { compareRiverPolicies } from "./hu-play-p2-safety";
import { wideHash } from "./hu-play-wide-corpus";
import { mathProjection } from "./hu-play-wide-measurement";
import { requireRiverPlayingResult } from "../src/lib/solver/bridge/live/river-quality";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import type { playRiverCase, RiverOffTreeCase } from "./hu-play-p2-playing-case";
import type { BridgeResultV1, BridgeSpotV1 } from "../src/lib/solver/bridge/contract";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
function checked(path: string) { const { payloadHash, ...payload } = read(path); assert.equal(wideHash(payload), payloadHash); return { ...payload, payloadHash }; }
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 6 && args[0] === "--inputs" && args[2] === "--playing" && args[4] === "--out");
  const input = resolve(args[1]), playing = resolve(args[3]), out = resolve(args[5]);
  assert.ok(!existsSync(out)); mkdirSync(out);
  const frozen = checked(join(input, "inputs.json")), native = checked(join(playing, "report.json"));
  assert.equal(frozen.payloadHash, "4f2a1442b882460371645954ce69ae700324d7427a3271d013d505a156f6325c");
  assert.equal(native.inputsHash, frozen.payloadHash); assert.equal(native.rows.length, 200);
  const bundle = await build({ entryPoints: ["scripts/audit-hu-play-p2-safety.ts"], bundle: true, platform: "node", format: "esm", packages: "external", write: false, metafile: true });
  const contractPath = "tasks/heads-up-play-p2-river.md";
  const contractText = () => {
    const text = readFileSync(contractPath, "utf8").match(/### Prospective safety comparison contract\n[\s\S]*?(?=\n#{1,3} |$)/)?.[0].trim();
    assert.ok(text, "Missing prospective safety contract"); return text;
  };
  const safetyContract = { path: contractPath, text: contractText(), sha256: createHash("sha256").update(contractText()).digest("hex") };
  const sourceFiles = Object.keys(bundle.metafile.inputs).sort()
    .map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  const rows: (Omit<ReturnType<typeof compareRiverPolicies>, "profiles"> & {
    seed: number; aiSeat: 0 | 1; provenance: Awaited<ReturnType<typeof playRiverCase>>["provenance"];
    profileHashes: { actual: string; translated: string; blueprint: string };
  })[] = [];
  for (const c of frozen.cases as (RiverOffTreeCase & { baselineHash: string })[]) {
    const ref = native.rows.find((r: { seed: number }) => r.seed === c.seed); assert.equal(ref.status, "complete");
    const completed: Awaited<ReturnType<typeof playRiverCase>> = read(join(playing, `case-${c.seed}.playing.json`));
    assert.equal(wideHash(completed.log), ref.logHash); assert.equal(completed.logHash, ref.logHash);
    assert.equal(completed.previous.result.spotHash, c.baselineHash);
    const solves: { spot: BridgeSpotV1; result: BridgeResultV1 }[] = ref.solves.map((r: { spotHash: string; numericalHash: string }, i: number) => {
      const solve = read(join(playing, `case-${c.seed}-solve-${i}.json`));
      assert.equal(hashBridgeSpot(solve.spot), r.spotHash); assert.equal(wideHash(mathProjection(solve.result)), r.numericalHash);
      requireRiverPlayingResult(solve.result, solve.spot, r.spotHash); return solve;
    });
    const chosen = solves.find(s => s.result.spotHash === completed.response.result.spotHash); assert.ok(chosen);
    assert.deepEqual(completed.response.result, chosen.result);
    const compared = compareRiverPolicies(c, solves[0], completed.previous, completed.response);
    const { profiles, ...comparison } = compared;
    const row = { seed: c.seed, aiSeat: c.request.aiSeat, provenance: completed.provenance,
      profileHashes: { actual: wideHash(profiles.actual), translated: wideHash(profiles.translated), blueprint: wideHash(profiles.blueprint) }, ...comparison };
    rows.push(row); write(join(out, `case-${c.seed}.json`), row);
  }
  assert.equal(rows.length, 200);
  const marginSummary = (key: "versusBlueprint" | "versusTranslated") => {
    const all = rows.flatMap(r => r.margins.flatMap(m => m[key] === null ? [] : [m[key]!]));
    const maxima = rows.map(r => Math.max(...r.margins.flatMap(m => m[key] === null ? [] : [m[key]!])));
    return { minChips: Math.min(...all), maxChips: Math.max(...all), positiveHands: all.filter(x => x > 0).length,
      positiveAboveLockedToleranceHands: all.filter(x => x > .0002).length,
      casesWithPositiveAboveLockedTolerance: maxima.filter(x => x > .0002).length, totalHands: all.length };
  };
  const summary = { versusBlueprint: marginSummary("versusBlueprint"), versusTranslated: marginSummary("versusTranslated"),
    aiValueDifferenceChips: { min: Math.min(...rows.map(r => r.aiValueDifference)), max: Math.max(...rows.map(r => r.aiValueDifference)),
      mean: rows.reduce((s, r) => s + r.aiValueDifference, 0) / rows.length },
    forcedActionAiValueDifferenceChips: { min: Math.min(...rows.map(r => r.forcedActionAiValueDifference)), max: Math.max(...rows.map(r => r.forcedActionAiValueDifference)) },
    maxComposedExploitabilityPctPot: Math.max(...rows.map(r => r.grades.actual.exploitabilityPctPot)),
    terminalTranslationCases: rows.filter(r => r.translation.convention === "terminal-call-through").length };
  for (const ref of sourceFiles) assert.equal(createHash("sha256").update(readFileSync(ref.path)).digest("hex"), ref.sha256);
  assert.equal(contractText(), safetyContract.text, "Safety contract changed during measurement");
  const report = { format: "poker-face-p2-river-safety", version: 1, measuredAt: new Date().toISOString(),
    inputsHash: frozen.payloadHash, playingReportHash: native.payloadHash, sourceFiles, sourceHash: wideHash(sourceFiles), safetyContract, summary, rows,
    interpretation: "Unsafe composed river policies, not global safety. Per-hand BR compares old action space and complete translated expanded action space separately. Forced-action values keep the parent prior; no undefined posterior is invented. Every raw solve passes the unchanged local quality gate; composed-policy exploitability is measured separately, not advertised as a newly solved equilibrium." };
  write(join(out, "report.json"), { ...report, payloadHash: wideHash(report) }); console.log(JSON.stringify({ out, summary }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
