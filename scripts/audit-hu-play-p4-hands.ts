/** All 1,000 seed-frozen hands through P4's actual full-hand/action-preparation routing.
 * Reuse the fresh P1 native policies for the same on-tree games, verifying every numerical
 * hash and complete log. This is composition/replay evidence, not new browser latency.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { loadScriptedHand, scriptedSettlement } from "../src/lib/hu-play/scripted";
import { handLog } from "../src/lib/hu-play/hand";
import { hashHandLog } from "../src/lib/hu-play/log-node";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";
import { TranslatedHeadsUpPlaySource } from "../src/lib/hu-play/sources/translated-heads-up";
import { FlopPlaySource } from "../src/lib/hu-play/sources/flop-play";
import { PostflopPlaySource } from "../src/lib/hu-play/sources/postflop-play";
import { ResolvedPolicySource, type PublicSolve } from "../src/lib/hu-play/sources/resolved";
import { TurnPlaySource } from "../src/lib/hu-play/sources/turn-play";
import { RiverPlaySource } from "../src/lib/hu-play/sources/river-play";
import { playP3BotHand } from "./hu-play-p3-selfplay";
import { mathProjection } from "./hu-play-wide-measurement";
import { wideHash } from "./hu-play-wide-corpus";
import type { Hands } from "./audit-hu-play-p1";

const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function main() {
  const [flag, sourcePath, outFlag, outPath, ...rest] = process.argv.slice(2);
  assert.ok(flag === "--native-p1" && sourcePath && outFlag === "--out" && outPath && !rest.length);
  const input = resolve(sourcePath), directory = resolve(outPath); assert.ok(!existsSync(directory));
  const report: Hands = JSON.parse(readFileSync(join(input, "report.json"), "utf8"));
  const { payloadHash, ...payload } = report; assert.equal(payloadHash, wideHash(payload));
  assert.equal(report.format, "poker-face-p1-production-hands"); assert.deepEqual(report.seeds, { first: 0, count: 1000 });
  assert.equal(report.hands.length, 1000);
  for (const ref of report.sourceSnapshot.sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256, "P1 measurement source changed");
  const bundle = await build({ entryPoints: ["scripts/audit-hu-play-p4-hands.ts"], bundle: true, platform: "node",
    format: "esm", packages: "external", write: false, metafile: true });
  const sourceFiles = Object.keys(bundle.metafile.inputs).sort().map(path => ({ path, sha256: digest(readFileSync(path)) }));
  const fetcher: typeof fetch = async value => {
    assert.match(String(value), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/); assert.ok(!String(value).includes(".."));
    return new Response(readFileSync(`public${value}`));
  };
  const catalog = await loadPlayCatalog(undefined, fetcher); mkdirSync(directory); const rows = [];
  for (let seed = 0; seed < 1000; seed++) {
    console.error(JSON.stringify({ stage: "p4-full-hand", seed }));
    const native = report.hands[seed]; assert.equal(native.seed, seed); assert.ok(native.deterministicReplay && native.conserved);
    const references = report.solves.filter(s => s.seed === seed);
    const dealt = await loadScriptedHand(catalog, seed, seed % 2 as 0 | 1, undefined, fetcher);
    const repeat = async () => {
      const keys: string[] = [];
      const solve: PublicSolve = async spot => {
        assert.ok(!/humanHand|aiHand|runout/.test(JSON.stringify(spot)), "Private deal leaked into solve input");
        const key = hashBridgeSpot(spot), ref = references[keys.length]; keys.push(key);
        assert.ok(ref); assert.equal(key, ref.spotHash, "P4 requested a different public game than P1");
        const result = JSON.parse(readFileSync(join(input, "results", `${key}.json`), "utf8"));
        assert.equal(wideHash(mathProjection(result)), ref.numericalHash); return result;
      };
      const root = new ResolvedPolicySource(solve), live = new PostflopPlaySource(
        new TurnPlaySource(root, solve, seed), new RiverPlaySource(root, solve, seed));
      const state = await playP3BotHand(dealt.state, new TranslatedHeadsUpPlaySource(new FlopPlaySource(dealt.library, seed), live));
      assert.deepEqual(keys, references.map(r => r.spotHash)); assert.ok(state.result);
      assert.equal(state.result.net[0] + state.result.net[1], 0);
      assert.equal(state.result.payouts[0] + state.result.payouts[1], state.public.pot);
      const ledger = scriptedSettlement(state), logHash = hashHandLog(handLog(state));
      assert.equal(logHash, native.logHash, "Complete P4 log differs from the independently run P1 source");
      assert.deepEqual(ledger, native.ledger); return { logHash, keys, ledger };
    };
    const a = await repeat(), b = await repeat(); assert.deepEqual(a, b, "P4 replay must be exact");
    rows.push({ seed, aiSeat: seed % 2, ...a, conserved: true, deterministicReplay: true, identicalToP1: true });
  }
  for (const ref of sourceFiles) assert.equal(digest(readFileSync(ref.path)), ref.sha256);
  const out = { format: "poker-face-p4-production-hands", version: 1, measuredAt: new Date().toISOString(),
    nativeP1ReportHash: report.payloadHash, sourceFiles, sourceHash: wideHash(sourceFiles), rows,
    method: "First 1,000 seeds, both seats; actual TranslatedHeadsUpPlaySource and prospective-action reducer; same fresh native P1 games/policies, independently hashed on read; two P4 replays match every full P1 log and chip ledger. No cache-coverage or timing claim." };
  write(join(directory, "report.json"), { ...out, payloadHash: wideHash(out) });
  console.log(JSON.stringify({ directory, hands: rows.length, passed: true }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
