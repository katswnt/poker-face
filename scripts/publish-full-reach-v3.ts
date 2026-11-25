/** Metadata-only correction; native experiments, saved data and v2 auditors stay frozen. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareFullReachRows, fullReachContext } from "./build-full-reach-v2";
import { hashes, readHashed } from "./capture-formation-export-diagnostic";
import { FULL_REACH_EVIDENCE as DIR } from "./measure-full-reach-v2";
import { FORMATION_BUDGETS as B } from "../src/lib/solver/bridge/formations/fixtures";
import { FULL_REACH_URL } from "../src/lib/solver/bridge/formations/full-reach-v2";
import { V2_DIRECTORY, V2_FORMATION, v2Roots, auditFullReachLibrary, FULL_REACH_ENCODING, FULL_REACH_PROVENANCE,
  type FullReachManifest } from "../src/lib/solver/bridge/formations/full-reach-library-v2";
import { COMPRESSION_PROFILE, portableFileTotals } from "../src/lib/solver/bridge/formations/portable-compression";
import { hashJson, prettyJson, sha256 } from "../src/lib/solver/preflop-v2/corpus";

const EVIDENCE = `${DIR}/publication-v3`, STAGE = "build/formation-full-reach-v2/stage";
const SOURCES = ["scripts/publish-full-reach-v3.ts", "scripts/audit-full-reach-v2.ts", `${EVIDENCE}/contract.md`,
  `${EVIDENCE}/failure.json`, `${EVIDENCE}/original-manifest.json`, `${EVIDENCE}/original-run.log`, `${EVIDENCE}/original-audit-source.txt`];
type Row = Parameters<typeof compareFullReachRows>[0];
interface Attempt { phase: "generate" | "reproduce"; id: string; startedAt: string; reservedMs: number;
  status: string; budgetMs: number; elapsedMs: number; rawBytes: number; nativeFileHash: string; row: Row; error: string | null }
interface Report { payloadHash: string; format: string; version: number; status: string; error: string | null;
  identity: ReturnType<typeof fullReachContext>["identity"]; environmentHash: string; generation: Row[]; reproduction: Row[];
  attempts: Attempt[]; chargedNativeMs: number; nativeInputBytes: number }
const withHash = <T extends object>(payload: T) => ({ ...payload, payloadHash: hashJson(payload) });

export function restoreNativeQuality(chips: number, pctPot: number, startingPot: number) {
  assert.ok(Number.isFinite(chips) && chips >= 0 && Number.isFinite(pctPot) && pctPot >= 0 && startingPot > 0);
  const restored = Math.fround(chips), computed = restored / startingPot * 100;
  assert.ok(Math.abs(computed - pctPot) <= 1e-9, "native quality identity mismatch");
  assert.ok(computed <= B.gatePctPot && pctPot <= B.gatePctPot, "native quality gate missed");
  return { chips: restored, pctPot };
}

function checkedReport() {
  const c = fullReachContext(), r = readHashed<Report>(`${DIR}/experiment.json`);
  assert.equal(r.format, "poker-face-full-reach-experiment"); assert.equal(r.version, 2); assert.equal(r.status, "complete"); assert.equal(r.error, null);
  assert.deepEqual(r.identity, c.identity);
  const env = readHashed<{ payloadHash: string; identity: typeof c.identity }>(`${DIR}/environment.json`);
  assert.equal(r.environmentHash, env.payloadHash); assert.deepEqual(env.identity, c.identity);
  const roots = v2Roots(), order = [...roots.slice(6).map(s => `generate-${s.id}`), ...roots.map(s => `reproduce-${s.id}`)];
  assert.deepEqual(r.attempts.map(a => `${a.phase}-${a.id}`), order);
  let charged = c.identity.priorChargedNativeMs, nativeBytes = c.scan.selectedInputBytes;
  for (const a of r.attempts) {
    const key = `${a.phase}-${a.id}`;
    assert.deepEqual(JSON.parse(readFileSync(`${DIR}/attempts/${key}.start.json`, "utf8")), { phase: a.phase, id: a.id, startedAt: a.startedAt, reservedMs: B.perSolveMs });
    assert.deepEqual(JSON.parse(readFileSync(`${DIR}/attempts/${key}.finish.json`, "utf8")), a);
    assert.equal(a.status, "passed"); assert.equal(a.error, null); assert.ok(a.row);
    assert.ok(Number.isFinite(a.elapsedMs) && a.elapsedMs > 0 && a.elapsedMs <= B.perSolveMs); assert.equal(a.budgetMs, a.elapsedMs);
    assert.equal(a.nativeFileHash, a.row.nativeFileHash); assert.equal(a.rawBytes, a.row.rawBytes);
    assert.ok(Number.isSafeInteger(a.rawBytes) && a.rawBytes > 0 && a.rawBytes <= B.rawResultBytes);
    charged += a.budgetMs; nativeBytes += a.rawBytes;
  }
  assert.ok(Math.abs(charged - r.chargedNativeMs) < 1e-6 && charged <= B.totalNativeMs);
  assert.equal(nativeBytes, r.nativeInputBytes); assert.ok(nativeBytes <= B.cacheBytes);
  assert.deepEqual(r.generation.map(s => s.id), roots.map(s => s.id)); assert.deepEqual(r.reproduction.map(s => s.id), roots.map(s => s.id));
  r.generation.forEach((row, i) => {
    compareFullReachRows(row, r.reproduction[i]);
    if (i < 6) { assert.equal(row.resultHash, c.scan.rows[i].resultHash); assert.equal(row.nativeFileHash, c.scan.rows[i].sourceBytesHash); }
    else assert.deepEqual(row, r.attempts.find(a => a.phase === "generate" && a.id === row.id)!.row);
    const fresh = r.reproduction[i]; assert.deepEqual(fresh, r.attempts.find(a => a.phase === "reproduce" && a.id === row.id)!.row);
    const refs = [fresh.entry.spot, fresh.entry.root, ...fresh.entry.chunks, ...(fresh.referee ? [fresh.referee.ref] : [])];
    assert.deepEqual(Object.keys(fresh.dataHashes).sort(), refs.map(r => r.url).sort()); refs.forEach(ref => assert.equal(fresh.dataHashes[ref.url], ref.sha256));
    assert.equal(fresh.entry.iterations, fresh.iterations); assert.equal(fresh.entry.solveMs, Math.round(fresh.elapsedMs));
    assert.equal(fresh.entry.peakRssBytes, fresh.peakRssBytes); assert.equal(fresh.entry.exploitability.pctPot, fresh.pctPot);
  });
  return r;
}

function candidate(directory: string) {
  const report = checkedReport(), prefix = `${FULL_REACH_URL}${V2_FORMATION}/`, files = new Map<string, string>();
  for (const row of report.generation) for (const [url, hash] of Object.entries(row.dataHashes)) {
    assert.ok(url.startsWith(prefix) && !url.includes("..") && /^[a-zA-Z0-9/_.-]+$/.test(url) && !files.has(url));
    const text = readFileSync(join(directory, url.slice(prefix.length)), "utf8"); assert.equal(sha256(text), hash); files.set(url, text);
  }
  const referees = report.reproduction.flatMap(r => r.referee ? [r.referee] : []); assert.equal(referees.length, 1);
  const originalPayload = { format: "poker-face-formation-library" as const, version: 2 as const, formation: V2_FORMATION,
    corpusHash: report.identity.corpusHash, provenance: FULL_REACH_PROVENANCE, sourceHashes: report.identity.sourceHashes,
    generationRecordHash: hashJson(report.generation), reproductionRecordHash: report.payloadHash, encoding: FULL_REACH_ENCODING,
    compression: COMPRESSION_PROFILE, spots: report.reproduction.map(r => r.entry), referee: referees[0], totals: portableFileTotals(files) };
  const original = prettyJson(withHash(originalPayload)), archived = readFileSync(`${EVIDENCE}/original-manifest.json`, "utf8");
  assert.equal(original, archived, "original publication candidate changed");
  const failure = JSON.parse(readFileSync(`${EVIDENCE}/failure.json`, "utf8"));
  assert.equal(failure.originalManifestSha256, sha256(original)); assert.equal(failure.experimentHash, report.payloadHash); assert.equal(failure.published, false);
  const publication = { revision: 3, originalManifestHash: sha256(original), sourceHashes: hashes(SOURCES),
    change: "restore native float32 exploitability chip metadata; all policy bytes unchanged" };
  const corrected = { ...originalPayload, spots: originalPayload.spots.map(s => ({ ...s,
    exploitability: restoreNativeQuality(s.exploitability.chips, s.exploitability.pctPot, 650) })), publication };
  const manifest: FullReachManifest & { publication: typeof publication } = withHash(corrected), text = prettyJson(manifest);
  const receipt = withHash({ publication, experimentHash: report.payloadHash, manifestHash: sha256(text),
    unchangedFiles: files.size, unchangedDataHashesHash: hashJson(Object.fromEntries([...files].map(([p, s]) => [p, sha256(s)]))), chargedNativeMs: report.chargedNativeMs });
  return { report, text, receipt };
}

export function auditPublishedFullReachV3() {
  const c = candidate(V2_DIRECTORY);
  assert.equal(readFileSync(join(V2_DIRECTORY, "manifest.json"), "utf8"), c.text);
  assert.deepEqual(readHashed<typeof c.receipt>(`${EVIDENCE}/publication.json`), c.receipt);
  return { status: "published", publicationRevision: 3, experimentHash: c.report.payloadHash, publicationHash: c.receipt.payloadHash,
    chargedNativeMs: c.report.chargedNativeMs, nativeInputBytes: c.report.nativeInputBytes,
    ...auditFullReachLibrary(V2_DIRECTORY, c.report.identity.sourceHashes), playChanged: false, productionRangesPromoted: false };
}
function publish() {
  assert.ok(!existsSync(V2_DIRECTORY) && !existsSync(`${EVIDENCE}/publication.json`), "publication cannot overwrite or retry");
  const c = candidate(STAGE); assert.equal(readFileSync(join(STAGE, "manifest.json"), "utf8"), readFileSync(`${EVIDENCE}/original-manifest.json`, "utf8"));
  writeFileSync(`${EVIDENCE}/publication-start.json`, prettyJson(c.receipt), { flag: "wx" });
  writeFileSync(join(STAGE, "manifest.json"), c.text);
  auditFullReachLibrary(STAGE, c.report.identity.sourceHashes);
  writeFileSync(`${EVIDENCE}/publication.json`, prettyJson(c.receipt), { flag: "wx" });
  mkdirSync(dirname(V2_DIRECTORY), { recursive: true }); renameSync(STAGE, V2_DIRECTORY);
  console.log(JSON.stringify(auditPublishedFullReachV3()));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--publish"]); publish();
}
