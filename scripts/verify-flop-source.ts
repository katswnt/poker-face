import { readFileSync } from "node:fs";
import { readFlopBinary } from "../src/lib/solver/postflop/flop/binary-node";
import { verifyFlopSource } from "../src/lib/solver/postflop/flop/verify-node";
const base = "src/lib/solver/postflop/flop/artifacts/flop-vector-wide-64";
const verified = verifyFlopSource(JSON.parse(readFileSync(`${base}.json`, "utf8")), readFlopBinary(`${base}.policy.f64.gz`));
console.log(JSON.stringify({ task: "regrade-saved-wide-flop-policy", policyHash: verified.policyHash,
  iterations: verified.iterations, exploitability: verified.grade.exploitability, gains: verified.grade.gains }));
