// Minimal reproduction: does seeded RNG make useMemo-equivalent reruns deterministic?
// Simulates the monteCarloEquity random calls twice with same seed, checks they match.

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulate what monteCarloEquity does: N random calls per sim, numSims sims
function simulateMonteCarloRandomCalls(rng, numSims = 1000, opponentsPerSim = 1) {
  const results = [];
  for (let i = 0; i < numSims; i++) {
    // pick opponent hand index (1 call)
    const idx = Math.floor(rng() * 50);
    // shuffle board pool (5 calls for 5-card shuffle)
    let shuffleResult = 0;
    for (let j = 4; j > 0; j--) shuffleResult += Math.floor(rng() * (j + 1));
    results.push({ idx, shuffleResult });
  }
  return results;
}

const SEED = 0xDEADBEEF;

// Run 1: first useMemo call (heroChoices = [])
const rng1 = mulberry32(SEED);
const run1 = simulateMonteCarloRandomCalls(rng1);

// Run 2: second useMemo call (heroChoices = [checkDec]) — same seed, should match
const rng2 = mulberry32(SEED);
const run2 = simulateMonteCarloRandomCalls(rng2);

// Run 3: without seeded RNG (Math.random) — should differ
const run3 = simulateMonteCarloRandomCalls(Math.random);

const match12 = run1.every((r, i) => r.idx === run2[i].idx && r.shuffleResult === run2[i].shuffleResult);
const match13 = run1.every((r, i) => r.idx === run3[i].idx && r.shuffleResult === run3[i].shuffleResult);

console.log(`Run 1 vs Run 2 (seeded same seed): ${match12 ? 'IDENTICAL ✓' : 'DIFFERENT ✗'}`);
console.log(`Run 1 vs Run 3 (Math.random):       ${match13 ? 'IDENTICAL (unlikely)' : 'DIFFERENT ✓ (expected)'}`);
console.log(`First 3 pairs (run1 vs run2):`);
for (let i = 0; i < 3; i++) console.log(`  [${i}] run1.idx=${run1[i].idx} run2.idx=${run2[i].idx}`);
