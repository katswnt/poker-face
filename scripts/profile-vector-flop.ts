import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLOP_WIDE_REQUEST } from "../src/lib/solver/postflop/flop/fixtures";
import { flopDigest } from "../src/lib/solver/postflop/flop/artifact-node";
import { compileVectorFlop } from "../src/lib/solver/postflop/flop/compiled";
import { createVectorFlopSession } from "../src/lib/solver/postflop/flop/session";
import { gradeVectorFlop } from "../src/lib/solver/postflop/flop/scorekeeper";

const lock = JSON.parse(readFileSync("tasks/vector-flop-v1-input-hashes.json", "utf8"));
assert.equal(flopDigest(FLOP_WIDE_REQUEST), lock[FLOP_WIDE_REQUEST.id]);
const started = performance.now(), game = compileVectorFlop(FLOP_WIDE_REQUEST), compileMs = performance.now() - started;
const session = createVectorFlopSession(game, { iterations: 12, algorithm: "cfr-plus", averagingDelay: 2 });
session.advance(2); const samples: number[] = [];
for (let i = 0; i < 10; i++) { const t = performance.now(); session.advance(1); samples.push(performance.now() - t); }
const snapshotAt = performance.now(), snapshot = session.snapshot(), snapshotMs = performance.now() - snapshotAt;
const gradeAt = performance.now(), grade = gradeVectorFlop(game, snapshot.policy), gradeMs = performance.now() - gradeAt;
console.log(JSON.stringify({ kind: "flop-vector-profile-not-acceptance", preflight: game.preflight, informationSets: game.informationSets,
  compileMs, iterationMs: samples, snapshotMs, gradeMs, exploitability: grade.exploitability,
  typedStructureBytes: game.typedStorageBytes, sessionBytes: session.workingStorageBytes, gradeBytes: grade.workingStorageBytes,
  observedRssBytes: process.memoryUsage().rss, processMaximumRssBytes: process.resourceUsage().maxRSS * 1024, elapsedMs: performance.now() - started }));
