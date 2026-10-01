import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { wideHash } from "../scripts/hu-play-wide-corpus";

test("P1 source evolution requires archived original bytes AND complete unchanged successor gates", async () => {
  assert.ok(existsSync("scripts/hu-play-p1-successor.ts"), "Versioned successor verification required; never bypass historical hashes");
  const { readP1Successor, checkP1SuccessorEvidence, p1PipelineSources } = await import("../scripts/hu-play-p1-successor");
  const closure = p1PipelineSources();
  for (const crate of ["solver-bridge", "solver-bridge-wasm"]) assert.ok(closure.some(s => s.path === `native/${crate}/rust-toolchain.toml`),
    "Source closure must bind the pinned toolchain, not only Rust code and Cargo dependencies");
  const { checkP1Reports } = await import("../scripts/audit-hu-play-p1");
  const old = ["hands", "corpus", "browser"].map(n => JSON.parse(readFileSync(`tasks/artifacts/hu-play-p1-production-${n}.json`, "utf8")));
  const evidence = readP1Successor();
  checkP1SuccessorEvidence(evidence, old as Parameters<typeof checkP1SuccessorEvidence>[1], checkP1Reports);
  const archive = structuredClone(evidence); archive.originalSources[0].text += "\nchanged";
  assert.throws(() => checkP1SuccessorEvidence(archive, old as Parameters<typeof checkP1SuccessorEvidence>[1], checkP1Reports), /source|hash/i);
  const missing = structuredClone(evidence); missing.currentSources.pop();
  assert.throws(() => checkP1SuccessorEvidence(missing, old as Parameters<typeof checkP1SuccessorEvidence>[1], checkP1Reports), /source|closure/i);
  const altered = structuredClone(evidence); altered.successor[0].hands[0].logHash = "0".repeat(64);
  const { payloadHash, ...payload } = altered.successor[0]; void payloadHash;
  altered.successor[0].payloadHash = wideHash(payload);
  assert.throws(() => checkP1SuccessorEvidence(altered, old as Parameters<typeof checkP1SuccessorEvidence>[1], checkP1Reports), /log|numerical|identical/i);
});
