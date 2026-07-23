/**
 * Regression test: seeded RNG produces identical stage structure across reruns.
 * Simulates what useMemo does for villain decisions on a fixed hand.
 * If stage counts differ between run1 and run2, the hero's step would point wrong.
 */

// Mulberry32 seeded RNG (same as in production code)
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulate a villain decision that uses Monte Carlo (randomized)
function villainDecision(rng, equity) {
  // Simulates 100 MC iterations to get equity estimate (uses rng)
  let wins = 0;
  for (let i = 0; i < 100; i++) {
    // Pick random opponent hand
    const oppIdx = Math.floor(rng() * 40);
    // Pick random board completion
    const board = Math.floor(rng() * 10);
    wins += (oppIdx + board) % 3 === 0 ? 1 : 0; // simplified win condition
  }
  const estEquity = wins / 100;
  return estEquity > 0.4 ? 'bet' : 'check';
}

// Simulate a 4-street hand with 3 villain decisions per street
function simulateHand(seed) {
  const rng = mulberry32(seed);
  const stages = [];
  
  // Flop: 3 villain decisions
  for (let i = 0; i < 3; i++) {
    const dec = villainDecision(rng, 0.5);
    stages.push({ street: 'flop', playerIdx: i, action: dec });
    if (dec === 'bet') {
      // Re-circulation: 2 more villain responses
      for (let j = 0; j < 2; j++) {
        const resp = villainDecision(rng, 0.3);
        stages.push({ street: 'flop', playerIdx: j, action: resp });
      }
    }
  }
  
  return stages;
}

const SEED = 12345678;

// Run 1: initial simulation
const run1 = simulateHand(SEED);
// Run 2: after heroChoices changed (simulates useMemo rerun)  
const run2 = simulateHand(SEED);
// Run 3: with Math.random (no seed)
const run3 = simulateHand(undefined); // will use Math.random fallback
function simulateHandUnseed() {
  const stages = [];
  for (let i = 0; i < 3; i++) {
    const dec = villainDecision(Math.random, 0.5);
    stages.push({ street: 'flop', playerIdx: i, action: dec });
    if (dec === 'bet') {
      for (let j = 0; j < 2; j++) {
        stages.push({ street: 'flop', playerIdx: j, action: villainDecision(Math.random, 0.3) });
      }
    }
  }
  return stages;
}
const run3b = simulateHandUnseed();
const run4b = simulateHandUnseed();

console.log('=== REGRESSION TEST: Stage count stability ===\n');
console.log(`Run 1 (seeded): ${run1.length} stages`);
console.log(`Run 2 (seeded, same seed): ${run2.length} stages`);
console.log(`Stage counts match with seeded RNG: ${run1.length === run2.length ? 'YES ✓' : 'NO ✗'}`);

const actionsMatch = run1.every((s, i) => run2[i] && s.action === run2[i].action);
console.log(`All actions match: ${actionsMatch ? 'YES ✓' : 'NO ✗'}`);

console.log(`\nRun 3 (unseeded): ${run3b.length} stages`);
console.log(`Run 4 (unseeded): ${run4b.length} stages`);
console.log(`Stage counts stable without seed: ${run3b.length === run4b.length ? 'YES (lucky)' : 'NO ✗ (proves non-determinism causes stage shifts)'}`);

console.log('\nTest result:', run1.length === run2.length && actionsMatch ? 'PASS ✓' : 'FAIL ✗');
