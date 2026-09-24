// Builds the EXACT 169×169 canonical heads-up preflop all-in equity matrix and writes it to
// src/lib/solver/equity-matrix.json.
//
//   npm run generate:equity-matrix   (--write)  full exact enumeration, all cores
//   npm run audit:equity-matrix      (--check)  hash + structure + independent spot recompute
//   node --import tsx scripts/build-equity-matrix.ts --sample 2000   timing estimate only
//
// Definition (unchanged from the earlier Monte-Carlo matrix): eq[A][B] is row class A's
// all-in equity against column class B, averaged UNIFORMLY over every ordered pair of
// card-disjoint concrete combos (a ∈ A, b ∈ B) and every 5-card board from the remaining 48
// cards. Ties count half. (All combos of a class are suit-isomorphic, so "pick a uniformly,
// then b uniformly among combos disjoint from a" — what the old sampler did — is the same
// measure.)
//
// Method: iterate BOARDS instead of matchups. For each of the 134,459 suit-canonical 5-card
// boards (weighted by orbit size under the 24 suit permutations; Σ weights = C(52,5) =
// 2,598,960), score all 1,081 remaining combos once with the shared score7 evaluator, then
// compare every card-disjoint combo pair and accumulate integer win/tie counts per class
// pair. Class-pair counts are invariant under suit permutation, so summing canonical boards
// times orbit weight equals summing all boards. Every quantity is an integer below 2^53, so
// the result is an exact rational per cell; the JSON stores it rounded to 6 decimals.
//
// --check recomputes a few cells by a DIFFERENT method (fix one combo of A, enumerate every
// disjoint combo of B and all C(48,5) = 1,712,304 boards directly) and compares.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { score7 } from "../src/lib/poker/score7";
import type { CardObj } from "../src/lib/poker/types";
import { CARD_OBJECTS, COMBOS, DISJOINT, NUM_CLASSES } from "../src/lib/solver/comboCounts";
import { HANDS, handIndex } from "../src/lib/solver/hands";

const N = NUM_CLASSES;
const BOARDS_PER_MATCHUP = 1_712_304; // C(48,5)
const DECIMALS = 6;
const OUT_PATH = fileURLToPath(new URL("../src/lib/solver/equity-matrix.json", import.meta.url));
// sha256 of the committed equity-matrix.json bytes. `--write` prints the new value; update it
// here whenever the definition or the evaluator deliberately changes.
const EXPECTED_SHA256 = "709b195c9cc30f123d8114fa9d64088ea0e50e37b53a187ef454afed25baee78";

// Cells recomputed by independent direct enumeration in --check (each ~10M boards, run in parallel).
const SPOT_CHECKS: [string, string][] = [["AA", "KK"], ["AKs", "QQ"], ["72o", "AA"], ["T9s", "76s"]];

// ── Suit-canonical boards ───────────────────────────────────────────────────────────────
const PERMS: number[][] = [];
(function permute(prefix: number[], rest: number[]) {
  if (!rest.length) { PERMS.push(prefix); return; }
  rest.forEach((s, i) => permute([...prefix, s], [...rest.slice(0, i), ...rest.slice(i + 1)]));
})([], [0, 1, 2, 3]);

function boardCode(cards: number[], perm: number[]): number {
  const m = cards.map(c => (c & ~3) | perm[c & 3]).sort((x, y) => x - y);
  return (((m[0] * 52 + m[1]) * 52 + m[2]) * 52 + m[3]) * 52 + m[4];
}

/** Canonical boards as flat [c0..c4, weight] records. */
function canonicalBoards(): Int32Array {
  const out: number[] = [];
  let totalWeight = 0;
  const b = [0, 0, 0, 0, 0];
  for (b[0] = 0; b[0] < 48; b[0]++) for (b[1] = b[0] + 1; b[1] < 49; b[1]++) for (b[2] = b[1] + 1; b[2] < 50; b[2]++)
    for (b[3] = b[2] + 1; b[3] < 51; b[3]++) for (b[4] = b[3] + 1; b[4] < 52; b[4]++) {
      const own = boardCode(b, PERMS[0]);
      let stab = 0, canonical = true;
      for (const p of PERMS) {
        const code = boardCode(b, p);
        if (code < own) { canonical = false; break; }
        if (code === own) stab++;
      }
      if (!canonical) continue;
      const w = 24 / stab;
      out.push(b[0], b[1], b[2], b[3], b[4], w);
      totalWeight += w;
    }
  if (totalWeight !== 2_598_960) throw new Error(`canonical board weights sum to ${totalWeight}`);
  return Int32Array.from(out);
}

// ── Board-major accumulation (worker body) ──────────────────────────────────────────────
const C1 = Int32Array.from(COMBOS.map(c => c.c1));
const C2 = Int32Array.from(COMBOS.map(c => c.c2));
const CLS = Int32Array.from(COMBOS.map(c => c.cls));

/** win2[A·169+B] += 2 per win, 1 per tie (times board weight); cnt[A·169+B] += weight. */
function accumulateBoards(boards: Int32Array, from: number, to: number, win2: Float64Array, cnt: Float64Array) {
  const s = new Int32Array(1326), a1 = new Int32Array(1326), a2 = new Int32Array(1326), cl = new Int32Array(1326);
  const seven: CardObj[] = new Array(7);
  const onBoard = new Uint8Array(52);
  for (let r = from; r < to; r++) {
    const o = r * 6, w = boards[o + 5];
    onBoard.fill(0);
    for (let i = 0; i < 5; i++) { onBoard[boards[o + i]] = 1; seven[2 + i] = CARD_OBJECTS[boards[o + i]]; }
    let n = 0;
    for (let k = 0; k < 1326; k++) {
      const x = C1[k], y = C2[k];
      if (onBoard[x] || onBoard[y]) continue;
      seven[0] = CARD_OBJECTS[x]; seven[1] = CARD_OBJECTS[y];
      s[n] = score7(seven); a1[n] = x; a2[n] = y; cl[n] = CLS[k]; n++;
    }
    const w2 = 2 * w;
    for (let i = 0; i < n; i++) {
      const si = s[i], xi = a1[i], yi = a2[i], rowI = cl[i] * N, ci = cl[i];
      for (let j = i + 1; j < n; j++) {
        const xj = a1[j], yj = a2[j];
        if (xi === xj || xi === yj || yi === xj || yi === yj) continue;
        const cj = cl[j], ij = rowI + cj, ji = cj * N + ci, sj = s[j];
        cnt[ij] += w; cnt[ji] += w;
        if (si > sj) win2[ij] += w2;
        else if (si < sj) win2[ji] += w2;
        else { win2[ij] += w; win2[ji] += w; }
      }
    }
  }
}

// ── Independent direct enumeration of one cell (for --check) ────────────────────────────
function directCell(rowLabel: string, colLabel: string): { win2: number; count: number } {
  const A = handIndex(rowLabel), B = handIndex(colLabel);
  const a = COMBOS.find(c => c.cls === A)!;
  const bs = COMBOS.filter(c => c.cls === B && c.c1 !== a.c1 && c.c1 !== a.c2 && c.c2 !== a.c1 && c.c2 !== a.c2);
  let win2 = 0, count = 0;
  const sa: CardObj[] = new Array(7), sb: CardObj[] = new Array(7);
  sa[0] = CARD_OBJECTS[a.c1]; sa[1] = CARD_OBJECTS[a.c2];
  for (const b of bs) {
    sb[0] = CARD_OBJECTS[b.c1]; sb[1] = CARD_OBJECTS[b.c2];
    const deck: number[] = [];
    for (let c = 0; c < 52; c++) if (c !== a.c1 && c !== a.c2 && c !== b.c1 && c !== b.c2) deck.push(c);
    for (let i = 0; i < 44; i++) { sa[2] = sb[2] = CARD_OBJECTS[deck[i]];
      for (let j = i + 1; j < 45; j++) { sa[3] = sb[3] = CARD_OBJECTS[deck[j]];
        for (let k = j + 1; k < 46; k++) { sa[4] = sb[4] = CARD_OBJECTS[deck[k]];
          for (let l = k + 1; l < 47; l++) { sa[5] = sb[5] = CARD_OBJECTS[deck[l]];
            for (let m = l + 1; m < 48; m++) { sa[6] = sb[6] = CARD_OBJECTS[deck[m]];
              const x = score7(sa), y = score7(sb);
              win2 += x > y ? 2 : x === y ? 1 : 0; count++;
            } } } } }
  }
  return { win2, count };
}

if (!isMainThread) {
  const job = workerData as { kind: "boards"; boards: Int32Array } | { kind: "cell"; row: string; col: string };
  if (job.kind === "cell") {
    parentPort!.postMessage(directCell(job.row, job.col));
  } else {
    const win2 = new Float64Array(N * N), cnt = new Float64Array(N * N);
    parentPort!.on("message", (msg: { from: number; to: number } | null) => {
      if (msg === null) { parentPort!.postMessage({ done: true, win2, cnt }); return; }
      accumulateBoards(job.boards, msg.from, msg.to, win2, cnt);
      parentPort!.postMessage({ done: false, boards: msg.to - msg.from });
    });
  }
}

// Workers load this same file through tsx's CommonJS hook (a URL-based worker is resolved as
// ESM, where the repo's extensionless imports do not resolve).
const spawn = (data: unknown) => new Worker(
  `require("tsx/cjs"); require(${JSON.stringify(fileURLToPath(import.meta.url))});`,
  { eval: true, workerData: data },
);

async function enumerate(boards: Int32Array, limit: number): Promise<{ win2: Float64Array; cnt: Float64Array }> {
  const threads = Math.max(1, availableParallelism());
  const total = Math.min(limit, boards.length / 6), chunk = 250;
  let next = 0, processed = 0;
  const win2 = new Float64Array(N * N), cnt = new Float64Array(N * N);
  const started = performance.now();
  await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
    const worker = spawn({ kind: "boards", boards });
    const feed = () => {
      if (next >= total) { worker.postMessage(null); return; }
      const from = next; next = Math.min(total, next + chunk);
      worker.postMessage({ from, to: next });
    };
    worker.on("message", (msg: { done: boolean; boards?: number; win2?: Float64Array; cnt?: Float64Array }) => {
      if (msg.done) {
        for (let i = 0; i < N * N; i++) { win2[i] += msg.win2![i]; cnt[i] += msg.cnt![i]; }
        void worker.terminate(); resolve(); return;
      }
      processed += msg.boards!;
      const secs = (performance.now() - started) / 1000;
      process.stdout.write(`\r  ${processed}/${total} canonical boards  ${secs.toFixed(0)}s  eta ${(secs / processed * (total - processed)).toFixed(0)}s   `);
      feed();
    });
    worker.on("error", reject);
    feed();
  })));
  process.stdout.write("\n");
  return { win2, cnt };
}

const round = (x: number) => Number(x.toFixed(DECIMALS));
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function buildJson(win2: Float64Array, cnt: Float64Array): string {
  const M = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const expected = DISJOINT[i][j] * BOARDS_PER_MATCHUP;
      if (cnt[i * N + j] !== expected) throw new Error(`${HANDS[i].label}/${HANDS[j].label}: ${cnt[i * N + j]} pair-boards, expected ${expected}`);
      if (win2[i * N + j] + win2[j * N + i] !== 2 * cnt[i * N + j]) throw new Error(`${HANDS[i].label}/${HANDS[j].label} is not zero-sum`);
    }
    if (win2[i * N + i] !== cnt[i * N + i]) throw new Error(`${HANDS[i].label} vs itself is not exactly 0.5`);
  }
  for (let i = 0; i < N; i++) {
    M[i][i] = 0.5;
    for (let j = i + 1; j < N; j++) {
      M[i][j] = round(win2[i * N + j] / (2 * cnt[i * N + j]));
      M[j][i] = round(1 - M[i][j]); // derive from the stored value so each pair sums to exactly 1
    }
  }
  return `${JSON.stringify({
    meta: {
      description: "Canonical 169×169 heads-up all-in preflop equity matrix (row hand's equity vs. col hand).",
      method: "exact",
      definition: "Uniform over ordered card-disjoint combo pairs and all C(48,5) boards; ties count half.",
      boardsPerMatchup: BOARDS_PER_MATCHUP,
      decimals: DECIMALS,
      generatedBy: "scripts/build-equity-matrix.ts",
      diagonal: "Exactly 0.5 (verified by the enumeration, not assumed).",
      handOrder: "grid row-major (matches HANDS in src/lib/solver/hands.ts)",
    },
    hands: HANDS.map(h => h.label),
    equity: M,
  })}\n`;
}

async function check() {
  const bytes = readFileSync(OUT_PATH);
  const hash = sha256(bytes);
  if (hash !== EXPECTED_SHA256) throw new Error(`equity-matrix.json sha256 ${hash} ≠ expected ${EXPECTED_SHA256}`);
  const data = JSON.parse(bytes.toString("utf8")) as { hands: string[]; equity: number[][] };
  if (data.hands.join() !== HANDS.map(h => h.label).join()) throw new Error("hand order drifted");
  for (let i = 0; i < N; i++) {
    if (data.equity[i][i] !== 0.5) throw new Error(`${HANDS[i].label} diagonal`);
    for (let j = i + 1; j < N; j++) if (Math.abs(data.equity[i][j] + data.equity[j][i] - 1) > 1e-12) throw new Error("antisymmetry");
  }
  const started = performance.now();
  const results = await Promise.all(SPOT_CHECKS.map(([row, col]) => new Promise<{ win2: number; count: number }>((resolve, reject) => {
    const w = spawn({ kind: "cell", row, col });
    w.once("message", m => { void w.terminate(); resolve(m); }); w.once("error", reject);
  })));
  SPOT_CHECKS.forEach(([row, col], k) => {
    const { win2, count } = results[k];
    const exact = win2 / (2 * count), stored = data.equity[handIndex(row)][handIndex(col)];
    if (count !== DISJOINT[handIndex(row)][handIndex(col)] / HANDS[handIndex(row)].weight * BOARDS_PER_MATCHUP) throw new Error(`${row}/${col} board count ${count}`);
    if (Math.abs(exact - stored) > 0.5 * 10 ** -DECIMALS + 1e-12) throw new Error(`${row} vs ${col}: stored ${stored}, direct enumeration ${exact}`);
    console.log(`  ${row.padEnd(3)} vs ${col.padEnd(3)}  direct ${exact.toFixed(8)}  stored ${stored}  (${count.toLocaleString()} boards)`);
  });
  console.log(`Equity matrix audit passed: sha256 ${hash.slice(0, 16)}…, antisymmetric, diagonal 0.5, ${SPOT_CHECKS.length} cells match direct enumeration (${((performance.now() - started) / 1000).toFixed(1)}s).`);
}

async function main() {
  const args = process.argv.slice(2);
  const sampleArg = args.indexOf("--sample");
  if (args.includes("--check")) {
    await check();
  } else if (args.includes("--write") || sampleArg >= 0) {
    let t = performance.now();
    const boards = canonicalBoards();
    const count = boards.length / 6;
    console.log(`  ${count.toLocaleString()} suit-canonical boards (${((performance.now() - t) / 1000).toFixed(1)}s)`);
    const limit = sampleArg >= 0 ? Number(args[sampleArg + 1]) : count;
    t = performance.now();
    const { win2, cnt } = await enumerate(boards, limit);
    const secs = (performance.now() - t) / 1000;
    if (sampleArg >= 0) {
      console.log(`  sample: ${limit} boards in ${secs.toFixed(1)}s → full run ≈ ${(secs * count / limit / 60).toFixed(1)} min`);
    } else {
      const json = buildJson(win2, cnt);
      writeFileSync(OUT_PATH, json);
      console.log(`Wrote ${OUT_PATH} (${(json.length / 1024).toFixed(0)} KB) in ${(secs / 60).toFixed(1)} min. sha256 ${sha256(json)}`);
      if (sha256(json) !== EXPECTED_SHA256) console.log("  NOTE: update EXPECTED_SHA256 in scripts/build-equity-matrix.ts to the value above.");
    }
  } else {
    console.error("usage: build-equity-matrix.ts --write | --check | --sample <boards>");
    process.exit(2);
  }
}

if (isMainThread) main().catch(error => { console.error(error); process.exit(1); });
