import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mulberry32 } from "../src/lib/poker/equity";
import { grade } from "../src/lib/drills/grade";
import { initialState } from "../src/lib/drills/scheduler";
import { advance, resolvePending, startSession, submit } from "../src/lib/drills/session";
import { loadState, parseState, saveState } from "../src/lib/drills/storage";
import type { Question } from "../src/lib/drills/types";
import {
  BAND_LIMITS_PCT_POT, EV_NOISE_CHIPS, HAND_MIN_RELATIVE_REACH, MIXED_MIN_FREQUENCY, NODE_MIN_FREQUENCY, SolverKeyError,
  bandFor, createSolverSource, eligibleNodes, gradeActions, pickFromEligible, weightedIndex,
} from "../src/lib/drills/solver";
import { EV_SCALE, type BridgeLibraryManifest, type BridgeLibraryNode } from "../src/lib/solver/bridge/library/model";

// Solver-backed decision drills: sampling, grading and explanations are checked against the raw
// chunk JSON on disk, recomputed here without the drill code.

const diskFetcher = (async (url: string) => new Response(readFileSync(`public${url}`))) as unknown as typeof fetch;
const MANIFEST = JSON.parse(readFileSync("public/solver-data/bridge-v1/manifest.json", "utf8")) as BridgeLibraryManifest;
const STARTING_POT = MANIFEST.formation.startingPot;

interface RawNode {
  path: string; board: string[]; player: 0 | 1; committed: [number, number]; actions: string[];
  live: [number[], number[]]; reachMax: [number, number]; reach: [number[], number[]];
  equity: [(number | null)[], (number | null)[]]; strategy: number[][]; actionEv: (number | null)[][];
}
interface RawSpot { ranges: { combos: { combo: string; weight: number }[] }[] }

const rawFile = (url: string) => JSON.parse(readFileSync(`public${url}`, "utf8"));
const spotEntry = (id: string) => MANIFEST.spots.find(s => s.id === id)!;
function rawNodeFor(q: Question): { node: RawNode; spot: RawSpot } {
  const d = q.solver!;
  const entry = spotEntry(d.spotId);
  const spot = rawFile(entry.spot.url) as RawSpot;
  for (const ref of Object.values(entry.chunks)) {
    const node = (rawFile(ref.url).nodes as RawNode[]).find(n => n.path === d.path);
    if (node) return { node, spot };
  }
  throw new Error(`no raw node ${d.path}`);
}

async function sample(count: number, levels: readonly (1 | 2 | 3)[] = [1, 2, 3]): Promise<Question[]> {
  const source = createSolverSource({ fetcher: diskFetcher });
  const out: Question[] = [];
  for (let seed = 0; seed < count; seed += 1) out.push(await source.generate(seed * 7919 + 3, levels[seed % levels.length]));
  return out;
}

const SAMPLE = sample(45);

test("weightedIndex picks in exact proportion to the weights and never a zero weight", () => {
  const weights = [0, 3, 1, 0, 6, 0.5];
  const total = weights.reduce((s, w) => s + w, 0);
  const N = 100_000;
  const counts = new Array(weights.length).fill(0);
  for (let k = 0; k < N; k += 1) counts[weightedIndex((k + 0.5) / N, weights)] += 1;
  weights.forEach((w, i) => assert.ok(Math.abs(counts[i] / N - w / total) <= 1 / N + 1e-12, `index ${i}`));
  assert.equal(counts[0] + counts[3], 0);
  assert.throws(() => weightedIndex(0.5, [0, 0]));
});

test("seeded hand sampling at a node follows reach (and skips negligible reach)", async () => {
  const source = createSolverSource({ fetcher: diskFetcher });
  await source.manifest();
  const entry = spotEntry("srp-btn-bb-ks7h2d");
  const { loadLibraryChunk, loadLibraryRanges } = await import("../src/lib/solver/bridge/library/load");
  const ranges = await loadLibraryRanges(entry, undefined, diskFetcher);
  const chunk = await loadLibraryChunk(entry, "flop", ranges, undefined, diskFetcher);
  // The eligible flop node whose reach is furthest from uniform, so a uniform pick would fail.
  const gapOf = (e: ReturnType<typeof eligibleNodes>[number]) => {
    const r = e.node.reach[e.node.player], m = e.hands.reduce((s, i) => s + r[i], 0);
    return e.hands.reduce((s, i) => s + Math.abs(1 / e.hands.length - r[i] / m), 0) / 2;
  };
  const pool = [eligibleNodes(chunk, ranges, STARTING_POT).sort((x, y) => gapOf(y) - gapOf(x))[0]];
  const node = pool[0].node, reach = node.reach[node.player];
  const uniformGap = gapOf(pool[0]);
  assert.ok(uniformGap > 0.1, `reach must be far from uniform for this test to bite (${uniformGap})`);
  const rng = mulberry32(12345), draws = 60_000, counts = new Map<number, number>();
  for (let k = 0; k < draws; k += 1) { const { row } = pickFromEligible(rng, pool); counts.set(row, (counts.get(row) ?? 0) + 1); }
  const total = pool[0].hands.reduce((s, i) => s + reach[i], 0);
  let tv = 0;
  for (const i of pool[0].hands) tv += Math.abs((counts.get(i) ?? 0) / draws - reach[i] / total);
  assert.ok(tv / 2 < 0.05, `total variation ${tv / 2}`);
  for (const row of counts.keys()) assert.ok(reach[row] >= HAND_MIN_RELATIVE_REACH * 10_000, "never below the reach floor");
});

test("fresh questions are deterministic in (seed, level) and vary across seeds", async () => {
  const a = createSolverSource({ fetcher: diskFetcher }), b = createSolverSource({ fetcher: diskFetcher });
  for (const [seed, level] of [[1, 1], [42, 2], [0xffffffff, 3], [987654, 3]] as const) {
    assert.deepEqual(await a.generate(seed, level), await b.generate(seed, level));
  }
  const ids = new Set((await SAMPLE).map(q => q.id));
  assert.ok(ids.size >= 40, `only ${ids.size} distinct questions`);
  const streets = new Set((await SAMPLE).map(q => q.solver!.street));
  assert.deepEqual([...streets].sort(), ["flop", "river", "turn"]);
  for (const q of await SAMPLE) if (q.level === 1) assert.equal(q.solver!.street, "flop");
});

test("sampled spots are on-path and sampled hands have real reach (recomputed from raw chunks)", async () => {
  for (const q of await SAMPLE) {
    const { node, spot } = rawNodeFor(q);
    const d = q.solver!;
    const board = new Set(node.board);
    const share = (p: 0 | 1) => {
      const combos = spot.ranges[p].combos;
      const mass = combos.filter(c => !board.has(c.combo.slice(0, 2)) && !board.has(c.combo.slice(2))).reduce((s, c) => s + c.weight, 0);
      return node.reach[p].reduce((s, r) => s + r, 0) / 10_000 * node.reachMax[p] / mass;
    };
    const frequency = share(0) * share(1);
    assert.ok(frequency >= NODE_MIN_FREQUENCY, `${d.path} reached only ${frequency}`);
    assert.ok(Math.abs(frequency - d.nodeFrequency) < 1e-9);
    const hand = spot.ranges[node.player].combos.findIndex(c => c.combo === d.combo);
    const row = node.live[node.player].indexOf(hand);
    assert.ok(row >= 0, "hand is live at the node");
    assert.ok(node.reach[node.player][row] >= HAND_MIN_RELATIVE_REACH * 10_000, "hand reach above the floor, never zero");
    assert.ok(node.actionEv.every(r => r[row] !== null));
  }
});

test("explanation numbers match an independent recomputation from the raw chunk", async () => {
  for (const q of await SAMPLE) {
    const { node, spot } = rawNodeFor(q);
    const d = q.solver!;
    assert.equal(q.answer.kind, "decision");
    if (q.answer.kind !== "decision") continue;
    const hand = spot.ranges[node.player].combos.findIndex(c => c.combo === d.combo);
    const row = node.live[node.player].indexOf(hand);
    const pot = STARTING_POT + node.committed[0] + node.committed[1];
    const toCall = Math.max(0, node.committed[1 - node.player] - node.committed[node.player]);
    assert.equal(d.potChips, pot);
    assert.equal(d.toCallChips, toCall);
    if (toCall > 0) {
      assert.equal(d.price.length, 1);
      assert.ok(Math.abs(d.price[0].potOdds - toCall / (pot + toCall)) < 1e-12, "pot odds = call ÷ (pot incl. bet + call)");
      assert.ok(Math.abs(d.price[0].mdf - (pot - toCall) / pot) < 1e-12, "MDF = pot before bet ÷ (pot before bet + bet)");
    }
    const evs = node.actionEv.map(r => r[row] as number);
    const max = Math.max(...evs);
    node.actions.forEach((token, a) => {
      const g = q.answer.kind === "decision" ? q.answer.grades[token] : undefined;
      assert.ok(g, token);
      const lossChips = max - evs[a] <= 1 ? 0 : (max - evs[a]) / 10;
      assert.ok(Math.abs(g.evLossChips - lossChips) < 1e-9, `${d.path} ${token} loss`);
      assert.ok(Math.abs(g.evLossPctPot - lossChips / pot * 100) < 1e-9);
      assert.ok(Math.abs(g.frequency - node.strategy[a][row] / 1000) < 1e-12);
      assert.ok(Math.abs(g.evChips - evs[a] / 10) < 1e-12);
    });
    const eq = node.equity[node.player][row];
    assert.equal(d.equity, eq === null ? null : eq / 1000);
    const shares = d.villainRange.reduce((s, g) => s + g.share, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9, "range groups sum to 100%");
    assert.match(d.provenance, /postflop-solver \(AGPL\) via the audited bridge; 12 BTN vs BB flops; ranges are hand-written approximations; not exact or universal GTO/);
  }
});

test("mixed actions are never graded wrong; every question has a wrong answer and a correct best", async () => {
  for (const q of await SAMPLE) {
    if (q.answer.kind !== "decision") continue;
    const grades = Object.values(q.answer.grades);
    for (const g of grades) if (g.frequency >= MIXED_MIN_FREQUENCY) assert.equal(g.correct, true);
    assert.ok(grades.some(g => !g.correct), "a real decision");
    assert.equal(q.answer.grades[q.answer.value].band, "best");
    const right = grade(q, q.answer.value, 1000);
    assert.equal(right?.correct, true);
    assert.equal(right?.band, "best");
    assert.equal(grade(q, "not-an-action", 1000), null, "unknown actions are invalid, not wrong");
  }
});

test("bands: best ≤ 0.3% pot, mixed guard at 20%, then inaccuracy / mistake / blunder", () => {
  assert.deepEqual(bandFor(0, 0), { band: "best", correct: true });
  assert.deepEqual(bandFor(BAND_LIMITS_PCT_POT.best, 0), { band: "best", correct: true });
  assert.deepEqual(bandFor(0.31, 0), { band: "inaccuracy", correct: false });
  assert.deepEqual(bandFor(2, 0), { band: "inaccuracy", correct: false });
  assert.deepEqual(bandFor(2.01, 0), { band: "mistake", correct: false });
  assert.deepEqual(bandFor(8, 0.1), { band: "mistake", correct: false });
  assert.deepEqual(bandFor(8.01, 0), { band: "blunder", correct: false });
  assert.deepEqual(bandFor(5, MIXED_MIN_FREQUENCY), { band: "mixed", correct: true });
  assert.deepEqual(bandFor(5, 0.199), { band: "mistake", correct: false });
});

function syntheticNode(evUnits: number[], strategy: number[], committed: [number, number] = [0, 0]): BridgeLibraryNode {
  return {
    path: "x", street: "flop", board: ["Ks", "7h", "2d"], player: 1, committed,
    actions: evUnits.map((_, a) => ["x", "b363", "b700"][a]), live: [[0], [0]], reachMax: [1, 1], omittedReach: [0, 0],
    reach: [[10_000], [10_000]], ev: [[0], [0]], equity: [[500], [500]],
    strategy: strategy.map(p => [p]), actionEv: evUnits.map(u => [u]),
  };
}

test("EV gaps inside the quantization step are ties (noise floor = 1 / EV_SCALE chips)", () => {
  assert.equal(EV_NOISE_CHIPS, 1 / EV_SCALE);
  // Pot 20 chips: 0.3% of it is 0.06 chips, below the 0.1-chip rounding step.
  const tie = gradeActions(syntheticNode([1000, 999], [1000, 0]), 0, 20);
  assert.equal(tie.grades[1].evLossChips, 0);
  assert.equal(tie.grades[1].band, "best");
  const gap = gradeActions(syntheticNode([1000, 998], [1000, 0]), 0, 20);
  assert.ok(Math.abs(gap.grades[1].evLossChips - 0.2) < 1e-12);
  assert.equal(gap.grades[1].band, "inaccuracy");
  // Ties go to the action the solver plays most; a mixed action with a real EV gap stays correct.
  const tied = gradeActions(syntheticNode([500, 500, 100], [300, 700, 0]), 0, 550);
  assert.equal(tied.best, 1);
  const mixed = gradeActions(syntheticNode([1000, 900, 0], [700, 250, 50]), 0, 550);
  assert.equal(mixed.grades[1].band, "mixed");
  assert.equal(mixed.grades[1].correct, true);
  assert.equal(mixed.grades[2].band, "blunder");
});

test("review keys rebuild the same spot, node and hand; bad keys are refused", async () => {
  const source = createSolverSource({ fetcher: diskFetcher });
  for (const q of (await SAMPLE).slice(0, 8)) {
    assert.equal(q.id, `solver:${q.reviewKey}`);
    assert.deepEqual(await source.fromKey(q.reviewKey!, q.seed, q.level), q);
  }
  await assert.rejects(source.fromKey("nope", 1, 1), SolverKeyError);
  await assert.rejects(source.fromKey("srp-missing|x|AsKs", 1, 1), SolverKeyError);
  await assert.rejects(source.fromKey("srp-btn-bb-ks7h2d|x|2c2c", 1, 1), SolverKeyError);
});

test("a corrupted, missing or unreachable file fails loudly; a retry after the fault succeeds", async () => {
  const clean = await createSolverSource({ fetcher: diskFetcher }).generate(42, 2);
  const flip = (async (url: string) => {
    const bytes = readFileSync(`public${url}`);
    if (!url.endsWith("manifest.json") && !url.endsWith("spot.json")) bytes[bytes.length - 3] ^= 1;
    return new Response(bytes);
  }) as unknown as typeof fetch;
  await assert.rejects(createSolverSource({ fetcher: flip }).generate(42, 2), /integrity/);
  const missing = (async (url: string) => url.endsWith("manifest.json") || url.endsWith("spot.json")
    ? new Response(readFileSync(`public${url}`)) : new Response("gone", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(createSolverSource({ fetcher: missing }).generate(42, 2), /\(404\)/);
  const truncated = (async (url: string) => {
    const bytes = readFileSync(`public${url}`);
    return new Response(url.endsWith("manifest.json") ? bytes : bytes.subarray(0, bytes.length - 1));
  }) as unknown as typeof fetch;
  await assert.rejects(createSolverSource({ fetcher: truncated }).generate(42, 2), /wrong size/);

  let offline = true;
  const flaky = (async (url: string) => {
    if (offline && !url.endsWith("manifest.json")) throw new TypeError("Failed to fetch");
    return new Response(readFileSync(`public${url}`));
  }) as unknown as typeof fetch;
  const source = createSolverSource({ fetcher: flaky });
  await assert.rejects(source.generate(42, 2), /Check your connection and retry/);
  offline = false;
  assert.deepEqual(await source.generate(42, 2), clean, "failed loads are not cached");
  offline = true;
  assert.deepEqual(await source.generate(42, 2), clean, "loaded chunks keep working offline");
});

test("session: solver questions are pending until resolved; a miss is saved by key and replayed from it", async () => {
  const source = createSolverSource({ fetcher: diskFetcher });
  let s = startSession(initialState(), 77, { kind: "type", type: "solver" }, 2, 0);
  assert.equal(s.question, null);
  assert.ok(s.pending && !s.pending.key && s.pending.level === 2);
  const first = s.pending!;
  const q = await source.generate(first.seed, first.level);
  s = resolvePending(s, first, q, 500);
  assert.equal(s.question, q);
  assert.equal(s.shownAt, 500, "the timer starts when the question is shown");
  assert.equal(resolvePending(s, first, q, 900), s, "a stale resolve is ignored");
  if (q.answer.kind !== "decision") throw new Error("decision expected");
  const wrong = Object.entries(q.answer.grades).find(([, g]) => !g.correct)![0];
  s = submit(s, wrong, 2500);
  assert.equal(s.result?.correct, false);
  assert.equal(s.state.review[0].key, q.reviewKey);
  assert.equal(s.state.review[0].id, q.id);

  let store: string | null = null;
  const fake = { getItem: () => store, setItem: (_: string, v: string) => { store = v; } };
  assert.ok(saveState(fake, s.state));
  assert.deepEqual(loadState(fake).review, s.state.review, "solver items survive storage");
  const tampered = JSON.parse(store!);
  tampered.review[0].key = "bad key";
  assert.equal(parseState(JSON.stringify(tampered)).review.length, 0, "malformed keys are dropped");

  for (let i = 0; i < 3; i += 1) {
    s = advance(s, 3000 + i);
    assert.ok(s.pending && !s.pending.key, "fresh until the item is due");
    const p = s.pending!;
    s = resolvePending(s, p, await source.generate(p.seed, p.level), 3000 + i);
    if (s.question!.answer.kind !== "decision") throw new Error("decision expected");
    s = submit(s, s.question!.answer.value, 4000 + i);
  }
  s = advance(s, 5000);
  assert.equal(s.pending?.key, q.reviewKey);
  assert.equal(s.pending?.fromReview, true);
  const again = await source.fromKey(s.pending!.key!, s.pending!.seed, s.pending!.level);
  assert.deepEqual(again, q);
});
