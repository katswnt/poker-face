/** Historical identity checks, never substitutes for fresh current-source/gate checks. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { P3Evidence } from "./audit-hu-play-p3";
import type { P4Evidence } from "./audit-hu-play-p4";
import type { P5Evidence } from "./audit-hu-play-p5";
import { mathProjection } from "./hu-play-wide-measurement";
import { canonicalSolverJson } from "../src/lib/solver/toy/artifact";
import { checkBridgeResult, type BridgeResultV1, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { hashBridgeSpot } from "../src/lib/solver/bridge/contract-node";

export interface E1Source { path: string; sha256: string }
export type E1SourceArchive = (E1Source & { text: string })[];
export interface E1Parent { evidenceHash: string; sources: E1SourceArchive }
export function checkE1ParentSources(archive: E1SourceArchive, refs: readonly E1Source[]) {
  assert.ok(refs.length, "Historical source closure is required");
  assert.deepEqual(archive.map(({ text, ...ref }) => { void text; return ref; }), refs, "Historical source surface");
  assert.equal(new Set(refs.map(s => s.path)).size, refs.length, "Duplicate historical source");
  for (const s of archive) {
    assert.match(s.path, /^(src|scripts|tasks|native)\/[a-zA-Z0-9/._-]+$/); assert.ok(!s.path.includes(".."));
    assert.equal(createHash("sha256").update(s.text).digest("hex"), s.sha256, `Historical source hash: ${s.path}`);
  }
}

/** Only build identities, source hashes and the envelope version may change.
 * Full cases/ranges, baselines, roots, ancestors and unknown fields stay frozen.
 * The caller ALSO checks current source bytes, rebuilt cases and every measured gate.
 */
export function checkE1InputSuccessor(fresh: Record<string, unknown>, parent: Record<string, unknown>) {
  const split = (value: Record<string, unknown>) => {
    const { version, engineSourceHash, wasmBuildHash, nativeBinarySha256, selectionSources, ...frozen } = value;
    for (const hash of [engineSourceHash, wasmBuildHash, nativeBinarySha256]) assert.match(String(hash), /^[a-f0-9]{64}$/, "Build identity hash");
    assert.ok(Array.isArray(selectionSources) && selectionSources.length, "Selection source surface");
    return { version, selectionSources: selectionSources as E1Source[], frozen };
  };
  const a = split(fresh), b = split(parent);
  assert.equal(a.version, Number(b.version) + 1, "Successor input version");
  assert.deepEqual(a.selectionSources.map(s => s.path), b.selectionSources.map(s => s.path), "Selection source surface");
  assert.deepEqual(a.frozen, b.frozen, "All non-build frozen inputs must remain identical");
}

/** Legacy capability-off captures. No mathematical field is discarded or re-labelled. */
export function checkE1PlayingIdentity(fresh: P3Evidence | P4Evidence, parent: P3Evidence | P4Evidence) {
  const identity = (e: P3Evidence | P4Evidence) => e.cases.map(c => ({ seed: c.seed,
    attempts: c.attempts.map(({ elapsedMs, result, ...attempt }) => {
      void elapsedMs;
      assert.equal(result?.decisionValues, undefined, "Legacy measurement must keep value export disabled");
      return { ...attempt, result: result ? mathProjection(result) : null };
    }) }));
  // Hash large policies to keep a changed-cell failure readable, retaining all old math.
  const hash = (v: unknown) => createHash("sha256").update(canonicalSolverJson(v)).digest("hex");
  assert.equal(hash(identity(fresh)), hash(identity(parent)), "Frozen attempts and policy identities changed");
  const complete = (e: P3Evidence | P4Evidence) => e.complete.map(c => ({ ...c, result: mathProjection(c.result) }));
  assert.equal(hash(complete(fresh)), hash(complete(parent)), "Complete reference identities changed");
  const logs = (e: P3Evidence | P4Evidence) => e.native.rows.map(row => ({ seed: row.seed, status: row.status,
    logHash: row.logHash, publicSolveKeys: row.publicSolveKeys, deterministicReplay: row.deterministicReplay,
    conserved: row.conserved, riverGrades: row.riverGrades,
    solves: row.solves.map(s => ({ spotHash: s.spotHash, numericalHash: s.numericalHash, iterations: s.iterations,
      enginePctPot: s.enginePctPot, street: s.street })),
    ...("provenance" in row ? { provenance: row.provenance } : { ledger: row.ledger, responses: row.responses, passiveResponses: row.passiveResponses }) }));
  assert.equal(hash(logs(fresh)), hash(logs(parent)), "Frozen log hashes and mathematical grades changed");
  assert.equal(hash(fresh.hands.rows), hash(parent.hands.rows), "Frozen 1000-hand identities changed");
}

/** Compare ONLY after validating the complete new teaching block. The old projection
 * itself is unchanged, so no existing EV, strategy, checkpoint or tree field is hidden.
 */
export function checkE1TeachingPolicy(spot: BridgeSpotV1, fresh: BridgeResultV1, parent: BridgeResultV1) {
  checkBridgeResult(fresh, spot, hashBridgeSpot(spot));
  assert.ok(fresh.decisionValues, "Requested teaching values are missing");
  assert.equal(parent.decisionValues, undefined, "Parent must be the pre-E1 policy");
  const { decisionValues, ...legacy } = fresh; void decisionValues;
  assert.equal(canonicalSolverJson(mathProjection(legacy)), canonicalSolverJson(mathProjection(parent)),
    "Teaching changed an existing mathematical field");
}

export function checkE1UiIdentity(fresh: P5Evidence, parent: P5Evidence) {
  assert.deepEqual(fresh.report.frozen.corpus, parent.report.frozen.corpus, "Frozen UI corpus");
  assert.deepEqual(fresh.report.attempts, parent.report.attempts, "Every UI solve request/refusal must remain identical");
  assert.deepEqual(fresh.report.ledger, parent.report.ledger, "Frozen UI ledger");
  assert.deepEqual(fresh.report.replayRows, parent.report.replayRows, "Frozen UI replay outcomes");
  const behavior = (e: P5Evidence) => e.report.rows.map(({ decisionsHash, ...row }) => { void decisionsHash; return row; });
  assert.deepEqual(behavior(fresh), behavior(parent), "Every full UI log and poker behavior must remain identical");
  const old = new Map(parent.solves.map(s => [hashBridgeSpot(s.spot), s]));
  assert.equal(fresh.solves.length, old.size, "Frozen UI policy coverage");
  const seen = new Set<string>();
  for (const s of fresh.solves) {
    const key = hashBridgeSpot(s.spot), previous = old.get(key);
    assert.ok(previous && !seen.has(key), "Changed/duplicate UI game"); seen.add(key);
    assert.deepEqual(s.spot, previous.spot, "Frozen UI input");
    checkE1TeachingPolicy(s.spot, s.result, previous.result);
  }
  // The ordinary P5 checker recomputes the new decisionsHash by running the real
  // controller with these values. It is never compared to the old no-values hash.
}
